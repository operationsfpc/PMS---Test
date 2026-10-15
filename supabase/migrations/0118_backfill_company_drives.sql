-- 0118 — Backfill legacy standalone drives into company_drives
--
-- Migration 0116 introduced company_drives (recruitment events) and linked
-- roles via drives.company_drive_id — but only for drives raised AFTER it.
-- Every drive raised before it has company_drive_id NULL, so it can never be
-- grouped with a sibling role, never appears in the event picker, and an
-- "+ Add Role to this Drive" aimed at it would fail the foreign key.
--
-- This gives each legacy drive its own event row (a one-role event is exactly
-- what it is), copies the event-level facts the drive already carries, and
-- mirrors its drive_contacts up to company_drive_contacts — the same shape the
-- save_company_drive_with_roles RPC leaves behind.
--
-- Idempotent: only drives with company_drive_id IS NULL are touched, so
-- running it twice (Dashboard + db push) is safe.

do $$
declare
  v_drive      record;
  v_company_id uuid;
  v_event_id   uuid;
begin
  for v_drive in
    select id, company_name, industry, company_website, drive_mode, venue,
           tentative_date, timeline_notes, joining_timeline, status, created_by, created_at
    from drives
    where company_drive_id is null
  loop
    -- Resolve or create the company, matching the RPC's exact-name rule.
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
      v_drive.tentative_date, v_drive.timeline_notes, v_drive.joining_timeline,
      v_drive.status, v_drive.created_by, v_drive.created_at
    )
    returning id into v_event_id;

    update drives set company_drive_id = v_event_id where id = v_drive.id;

    insert into company_drive_contacts (company_drive_id, sequence, name, designation, email, phone)
    select v_event_id, sequence, name, designation, email, phone
    from drive_contacts
    where drive_id = v_drive.id;
  end loop;
end $$;
