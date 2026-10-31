-- Undo of supabase/backfill-test-company-drives.sql, on the PMS test project
-- (jpejihmcbgerekyiikgb). Returns that database to the state it was in before the
-- backfill: drives unlinked, no company-drive events, no company records.
--
-- It deletes ONLY the events the backfill created, read out of
-- public.company_drive_backfill_log. Anything raised through the PIF form after
-- the backfill is left alone — which is also why this undo cannot be used to
-- delete events that were never part of the backfill.
--
-- Paste into Supabase Dashboard > SQL Editor after checking the tab's URL is
-- project jpejihmcbgerekyiikgb. One transaction: a raised guard writes nothing.

-- ---------------------------------------------------------------------------
-- 1. Guard: is this the database the seed ran against, and is the work safe to lose?
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_logged    integer;
  v_audience  integer;
  v_extra     integer;
begin
  if to_regclass('public.company_drive_backfill_log') is null then
    raise exception
      'ABORTED: no company_drive_backfill_log here, so this backfill was never run on this
       database (or its undo already ran). Delete individual events from the app instead.';
  end if;

  select count(*) into v_logged from public.company_drive_backfill_log;
  if v_logged = 0 then
    raise exception 'ABORTED: company_drive_backfill_log is empty — nothing to undo.';
  end if;

  -- Published campus targeting is work nobody asked to lose.
  select count(*) into v_audience
  from company_drive_target_campuses tc
  join public.company_drive_backfill_log l on l.event_id = tc.company_drive_id;
  if v_audience > 0 then
    raise exception
      'ABORTED: % audience rows sit on backfilled events. Unpublish them first — deleting the
       event would take that targeting with it.', v_audience;
  end if;

  -- A role added through the app after the backfill belongs to that event; sending it
  -- back to company_drive_id NULL would recreate the exact bug this script fixes.
  select count(*) into v_extra
  from drives d
  join public.company_drive_backfill_log l on l.event_id = d.company_drive_id
  where d.id <> l.drive_id;
  if v_extra > 0 then
    raise exception
      'ABORTED: % roles were attached to backfilled events after the backfill. Undo those PIFs
       through the app first, then run this.', v_extra;
  end if;

  raise notice 'GUARD OK: % backfilled events, no audience rows, no later roles.', v_logged;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Undo: unlinked, then deleted, in the order the foreign keys allow
-- ---------------------------------------------------------------------------
do $undo$
declare
  v_event_ids uuid[];
begin
  select array_agg(event_id) into v_event_ids from public.company_drive_backfill_log;

  -- drives.company_drive_id is ON DELETE RESTRICT, so the links go first.
  update drives set company_drive_id = null where company_drive_id = any(v_event_ids);

  delete from company_drive_contacts where company_drive_id = any(v_event_ids);
  delete from company_drives where id = any(v_event_ids);

  -- Companies the backfill created and nothing else now references.
  delete from companies c
  where not exists (select 1 from company_drives e where e.company_id = c.id);

  drop table public.company_drive_backfill_log;

  raise notice 'UNDONE: % events and their contacts deleted, orphan company records removed, log dropped.',
    array_length(v_event_ids, 1);
end
$undo$;

-- ---------------------------------------------------------------------------
-- 3. Verify: back to the pre-backfill shape
-- ---------------------------------------------------------------------------
select
  (select count(*) from drives)                                     as drives,
  (select count(*) from drives where company_drive_id is null)      as unlinked_drives,
  (select count(*) from company_drives)                             as events,
  (select count(*) from companies)                                  as companies,
  (select count(*) from company_drive_contacts)                     as event_contacts,
  to_regclass('public.company_drive_backfill_log')::text            as log_table;
