-- Give every legacy drive its own company-drive event, on ONE database: the PMS
-- test project (jpejihmcbgerekyiikgb, pms-test-gamma.vercel.app).
--
-- This is migration 0118 applied by hand, because the test project has no
-- supabase_migrations ledger — its schema was built by pasting migrations.
--
-- Why the PIF save fails here: save_company_drive_with_roles resolves
-- p_event.id against company_drives and raises 'Company drive event not found.'
-- (errcode check_violation, so PostgREST returns HTTP 400) when no event owns
-- that id. The PIF picker builds its event list from drives.company_drive_id and
-- falls back to the legacy drives.id when that column is NULL
-- (src/features/pif/pif-repository.ts:643). On test all 4 drives are legacy and
-- company_drives is empty, so the id the form sends is a drive id no event owns.
-- After this script that id is real.
--
-- Paste into Supabase Dashboard > SQL Editor, having checked the tab's URL really
-- is project jpejihmcbgerekyiikgb. The Dashboard runs the whole script as one
-- transaction, so if the guard raises, nothing at all is written.
--
-- Side effect to know about: it creates one bookkeeping table,
-- public.company_drive_backfill_log, so the undo can delete exactly the rows this
-- script created and nothing the app created later. The undo drops it again.

-- ---------------------------------------------------------------------------
-- 1. Guard: refuse a database that is not the empty test project
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_events    integer;
  v_companies integer;
  v_drives    integer;
begin
  if to_regclass('public.company_drives') is null then
    raise exception
      'ABORTED: this database has no company_drives table, so 0116 is not applied here.';
  end if;

  select count(*) into v_events    from company_drives;
  select count(*) into v_companies from companies;
  select count(*) into v_drives    from drives;

  if v_events > 0 or v_companies > 0 then
    raise exception
      'ABORTED: found % company_drives and % companies. Production always has both, and a
       database that already has events does not need this backfill. Confirm the project ref
       in the tab URL before running anything here.', v_events, v_companies;
  end if;

  if v_drives > 50 then
    raise exception 'ABORTED: % drives is a production-sized roster. Test had 4 on 2026-10-31.',
      v_drives;
  end if;

  raise notice 'GUARD OK: % drives, 0 events, 0 companies — test-shaped database.', v_drives;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Backfill: one event per unlinked drive, mirroring the RPC's own shape
-- ---------------------------------------------------------------------------
do $backfill$
declare
  v_drive      record;
  v_company_id uuid;
  v_event_id   uuid;
  v_created    integer := 0;
  v_skipped    integer := 0;
begin
  create table if not exists public.company_drive_backfill_log (
    drive_id uuid primary key,
    event_id uuid not null,
    done_at  timestamptz not null default now()
  );
  alter table public.company_drive_backfill_log enable row level security;

  for v_drive in
    select id, company_name, industry, company_website, drive_mode, venue,
           tentative_date, timeline_notes, joining_timeline, status, created_by, created_at
    from drives
    where company_drive_id is null
  loop
    if trim(coalesce(v_drive.company_name, '')) = '' then
      v_skipped := v_skipped + 1;
      raise notice 'SKIPPED drive % — no company name, so no company record to hang an event on.',
        left(v_drive.id::text, 8);
      continue;
    end if;

    -- Match the RPC's exact-name rule, so siblings of one company share a record.
    select id into v_company_id
    from companies
    where lower(name) = lower(trim(v_drive.company_name))
    limit 1;
    if v_company_id is null then
      insert into companies (name, industry, website)
      values (trim(v_drive.company_name), v_drive.industry, v_drive.company_website)
      returning id into v_company_id;
    end if;

    insert into company_drives (
      company_id, company_name, drive_mode, venue, tentative_date,
      timeline_notes, joining_timeline, status, created_by, created_at
    )
    values (
      v_company_id, v_drive.company_name, v_drive.drive_mode, v_drive.venue,
      v_drive.tentative_date, v_drive.timeline_notes, v_drive.joining_timeline::text,
      v_drive.status, v_drive.created_by, v_drive.created_at
    )
    returning id into v_event_id;

    update drives set company_drive_id = v_event_id where id = v_drive.id;

    insert into company_drive_contacts (company_drive_id, sequence, name, designation, email, phone)
    select v_event_id, sequence, name, designation, email, phone
    from drive_contacts
    where drive_id = v_drive.id;

    insert into public.company_drive_backfill_log (drive_id, event_id)
    values (v_drive.id, v_event_id)
    on conflict (drive_id) do nothing;

    v_created := v_created + 1;
  end loop;

  raise notice 'DONE: % events created, % drives skipped.', v_created, v_skipped;
end
$backfill$;

-- ---------------------------------------------------------------------------
-- 3. Verify: every drive points at an event that exists
-- ---------------------------------------------------------------------------
select
  left(d.id::text, 8)                                            as drive_id,
  d.company_name                                                 as company,
  d.status,
  d.tentative_date,
  (d.company_drive_id is not null)                               as linked,
  left(coalesce(d.company_drive_id::text, '—'), 8)               as event_id,
  (e.id is not null)                                             as event_row_exists,
  (select count(*) from company_drives x where x.company_id = e.company_id) as events_for_company
from drives d
left join company_drives e on e.id = d.company_drive_id
order by d.tentative_date desc nulls last;
