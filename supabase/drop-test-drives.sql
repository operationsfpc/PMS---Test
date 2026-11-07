-- Remove the test project's drives, on ONE database: jpejihmcbgerekyiikgb
-- (pms-test-gamma.vercel.app). Written 2026-11-06.
--
-- Paste into Supabase Dashboard > SQL Editor AFTER checking the tab URL really
-- is that project ref. The Dashboard runs the whole script as one transaction,
-- so a guard that raises deletes nothing at all.
--
-- What goes with them, because each of these is 'on delete cascade' from drives:
--   drive_eligible_degrees           30 row(s)
--   drive_eligible_branches          35 row(s)
--   drive_target_campuses            94 row(s)
--   drive_contacts                   4 row(s)
--   recruiter_exports                1 row(s)
--   student_documents_with_drive_id  1 row(s)
--   offers 1 row(s) — not a cascade, but they must be deleted
--     first: offers.drive_id is 'on delete set null', and check
--     on_campus_has_drive then refuses the surviving on-campus row, so a drive
--     with an on-campus offer cannot be deleted until that offer goes.
-- notifications only lose their drive_id (on delete set null): no notification
-- row is deleted. Students, campuses, degrees, branches and companies are
-- untouched — this deletes drives, not the roster.
--
-- The order below is not style. enforce_round_editing_delete (0057) is a BEFORE
-- DELETE trigger on drive_rounds that raises once a round holds results,
-- attendance or scheduled students, and Postgres fires it during a cascade too.
-- So "delete from drives" alone fails outright — the recorded facts in the
-- rounds go first, and the drive last.
--
-- The resume/JD PDFs those rows point at stay in Storage; deleting a database
-- row does not delete the object behind it.
--
-- audit_drives / audit_results / audit_attendance / audit_shortlist are AFTER
-- triggers, so both this delete and an undo insert write audit-log rows. That
-- is the log doing its job, not damage.
--
-- Undo: supabase/undo-drop-test-drives.sql, generated from the same dump.

-- ---------------------------------------------------------------------------
-- 1. Guard: refuse a database that is not the test project
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_drives    integer;
  v_apps      integer;
  v_students  integer;
begin
  if to_regclass('public.company_drives') is null then
    raise exception 'ABORTED: no company_drives table here, so 0116 is not applied on this database.';
  end if;

  select count(*) into v_drives   from drives;
  select count(*) into v_apps     from applications;
  select count(*) into v_students from students;

  -- Production is hundreds of applications and thousands of students. This
  -- database measured 18 drives, 0 apps, 204 students
  -- when the dump was taken (2026-11-06). Any ceiling tripping here
  -- means the wrong tab is open.
  if v_apps > 100 or v_students > 408 or v_drives > 40 then
    raise exception
      'ABORTED: this database has % drives, % applications and % students — not the test
       project this script was written for. Check the project ref in the tab URL.',
      v_drives, v_apps, v_students;
  end if;

  -- Every id in the delete below must exist here. A missing id means the dump
  -- and this database have drifted, so the script is stale rather than aimed.
  if exists (select 1 from unnest(array[
    '64065de6-289f-42cd-b262-302a59f05474',
    'ee5195c5-54af-450b-92cb-9cca8eb3cd88',
    '4ff6b97a-3068-4e27-8f6a-f3dfd0378297',
    '83f89f01-0f09-47ee-b1f3-15ac332caaa9',
    'a8afca23-75ac-4a75-826d-dc6cd2b8a76a',
    'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96',
    '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d',
    'e4137741-0b5e-452c-9777-83d2bf44e88c',
    '6f4a2a7e-29b6-4032-93bc-11e2880922dd',
    'd34f4c95-f0b8-4ca6-809f-265d61551755',
    '64461f38-46f6-430e-a993-8a470652c243',
    'eb7f1749-8847-42e5-ad6e-c9617fd3c14d',
    '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd',
    '1d3e878b-3e8c-468c-8a83-7a3fee8f113c',
    'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9',
    '7bc64ef4-1880-43c7-90ee-2ecb1dd64106',
    'b63bceb5-bb14-46bf-9a09-1542b1e34c6a',
    '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'
  ]::uuid[]) x(id) where not exists (select 1 from drives d where d.id = x.id)) then
    raise exception 'ABORTED: at least one of the ids below is not in this database — re-run node scripts/dump-test-drives.mjs and use the fresh script.';
  end if;

  raise notice 'GUARD OK: % drives, % applications, % students — test-shaped database.',
    v_drives, v_apps, v_students;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Say what is about to go, row by row, before it goes
-- ---------------------------------------------------------------------------
do $report$
declare r record;
begin
  for r in select created_at, company_name, role_title, status, id
             from drives order by created_at desc loop
    raise notice 'WILL DELETE: % | % | % | % | %',
      r.created_at::date, r.company_name, r.role_title, r.status, r.id;
  end loop;
end
$report$;

-- ---------------------------------------------------------------------------
-- 3. The delete, in the order the database demands.
--    Everything is scoped to the ids dumped jpejihmcbgerekyiikgb on 2026-11-06 — the
--    sub-selects read from this same drive list, so no row outside it is touched.
--    To KEEP a drive, remove its id from BOTH the guard array in section 1 and
--    the drive list at the bottom of this file.
-- ---------------------------------------------------------------------------
delete from public.round_results
 where application_id in (select id from public.applications where drive_id in (
  '64065de6-289f-42cd-b262-302a59f05474',
  'ee5195c5-54af-450b-92cb-9cca8eb3cd88',
  '4ff6b97a-3068-4e27-8f6a-f3dfd0378297',
  '83f89f01-0f09-47ee-b1f3-15ac332caaa9',
  'a8afca23-75ac-4a75-826d-dc6cd2b8a76a',
  'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96',
  '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d',
  'e4137741-0b5e-452c-9777-83d2bf44e88c',
  '6f4a2a7e-29b6-4032-93bc-11e2880922dd',
  'd34f4c95-f0b8-4ca6-809f-265d61551755',
  '64461f38-46f6-430e-a993-8a470652c243',
  'eb7f1749-8847-42e5-ad6e-c9617fd3c14d',
  '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd',
  '1d3e878b-3e8c-468c-8a83-7a3fee8f113c',
  'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9',
  '7bc64ef4-1880-43c7-90ee-2ecb1dd64106',
  'b63bceb5-bb14-46bf-9a09-1542b1e34c6a',
  '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'
));
delete from public.attendance
 where application_id in (select id from public.applications where drive_id in (
  '64065de6-289f-42cd-b262-302a59f05474',
  'ee5195c5-54af-450b-92cb-9cca8eb3cd88',
  '4ff6b97a-3068-4e27-8f6a-f3dfd0378297',
  '83f89f01-0f09-47ee-b1f3-15ac332caaa9',
  'a8afca23-75ac-4a75-826d-dc6cd2b8a76a',
  'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96',
  '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d',
  'e4137741-0b5e-452c-9777-83d2bf44e88c',
  '6f4a2a7e-29b6-4032-93bc-11e2880922dd',
  'd34f4c95-f0b8-4ca6-809f-265d61551755',
  '64461f38-46f6-430e-a993-8a470652c243',
  'eb7f1749-8847-42e5-ad6e-c9617fd3c14d',
  '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd',
  '1d3e878b-3e8c-468c-8a83-7a3fee8f113c',
  'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9',
  '7bc64ef4-1880-43c7-90ee-2ecb1dd64106',
  'b63bceb5-bb14-46bf-9a09-1542b1e34c6a',
  '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'
));
delete from public.round_participants
 where application_id in (select id from public.applications where drive_id in (
  '64065de6-289f-42cd-b262-302a59f05474',
  'ee5195c5-54af-450b-92cb-9cca8eb3cd88',
  '4ff6b97a-3068-4e27-8f6a-f3dfd0378297',
  '83f89f01-0f09-47ee-b1f3-15ac332caaa9',
  'a8afca23-75ac-4a75-826d-dc6cd2b8a76a',
  'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96',
  '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d',
  'e4137741-0b5e-452c-9777-83d2bf44e88c',
  '6f4a2a7e-29b6-4032-93bc-11e2880922dd',
  'd34f4c95-f0b8-4ca6-809f-265d61551755',
  '64461f38-46f6-430e-a993-8a470652c243',
  'eb7f1749-8847-42e5-ad6e-c9617fd3c14d',
  '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd',
  '1d3e878b-3e8c-468c-8a83-7a3fee8f113c',
  'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9',
  '7bc64ef4-1880-43c7-90ee-2ecb1dd64106',
  'b63bceb5-bb14-46bf-9a09-1542b1e34c6a',
  '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'
));
delete from public.shortlist_entries
 where application_id in (select id from public.applications where drive_id in (
  '64065de6-289f-42cd-b262-302a59f05474',
  'ee5195c5-54af-450b-92cb-9cca8eb3cd88',
  '4ff6b97a-3068-4e27-8f6a-f3dfd0378297',
  '83f89f01-0f09-47ee-b1f3-15ac332caaa9',
  'a8afca23-75ac-4a75-826d-dc6cd2b8a76a',
  'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96',
  '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d',
  'e4137741-0b5e-452c-9777-83d2bf44e88c',
  '6f4a2a7e-29b6-4032-93bc-11e2880922dd',
  'd34f4c95-f0b8-4ca6-809f-265d61551755',
  '64461f38-46f6-430e-a993-8a470652c243',
  'eb7f1749-8847-42e5-ad6e-c9617fd3c14d',
  '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd',
  '1d3e878b-3e8c-468c-8a83-7a3fee8f113c',
  'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9',
  '7bc64ef4-1880-43c7-90ee-2ecb1dd64106',
  'b63bceb5-bb14-46bf-9a09-1542b1e34c6a',
  '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'
));
delete from public.offers
 where drive_id in (
  '64065de6-289f-42cd-b262-302a59f05474',
  'ee5195c5-54af-450b-92cb-9cca8eb3cd88',
  '4ff6b97a-3068-4e27-8f6a-f3dfd0378297',
  '83f89f01-0f09-47ee-b1f3-15ac332caaa9',
  'a8afca23-75ac-4a75-826d-dc6cd2b8a76a',
  'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96',
  '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d',
  'e4137741-0b5e-452c-9777-83d2bf44e88c',
  '6f4a2a7e-29b6-4032-93bc-11e2880922dd',
  'd34f4c95-f0b8-4ca6-809f-265d61551755',
  '64461f38-46f6-430e-a993-8a470652c243',
  'eb7f1749-8847-42e5-ad6e-c9617fd3c14d',
  '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd',
  '1d3e878b-3e8c-468c-8a83-7a3fee8f113c',
  'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9',
  '7bc64ef4-1880-43c7-90ee-2ecb1dd64106',
  'b63bceb5-bb14-46bf-9a09-1542b1e34c6a',
  '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'
);
delete from public.applications
 where drive_id in (
  '64065de6-289f-42cd-b262-302a59f05474',
  'ee5195c5-54af-450b-92cb-9cca8eb3cd88',
  '4ff6b97a-3068-4e27-8f6a-f3dfd0378297',
  '83f89f01-0f09-47ee-b1f3-15ac332caaa9',
  'a8afca23-75ac-4a75-826d-dc6cd2b8a76a',
  'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96',
  '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d',
  'e4137741-0b5e-452c-9777-83d2bf44e88c',
  '6f4a2a7e-29b6-4032-93bc-11e2880922dd',
  'd34f4c95-f0b8-4ca6-809f-265d61551755',
  '64461f38-46f6-430e-a993-8a470652c243',
  'eb7f1749-8847-42e5-ad6e-c9617fd3c14d',
  '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd',
  '1d3e878b-3e8c-468c-8a83-7a3fee8f113c',
  'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9',
  '7bc64ef4-1880-43c7-90ee-2ecb1dd64106',
  'b63bceb5-bb14-46bf-9a09-1542b1e34c6a',
  '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'
);
delete from public.drive_rounds
 where drive_id in (
  '64065de6-289f-42cd-b262-302a59f05474',
  'ee5195c5-54af-450b-92cb-9cca8eb3cd88',
  '4ff6b97a-3068-4e27-8f6a-f3dfd0378297',
  '83f89f01-0f09-47ee-b1f3-15ac332caaa9',
  'a8afca23-75ac-4a75-826d-dc6cd2b8a76a',
  'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96',
  '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d',
  'e4137741-0b5e-452c-9777-83d2bf44e88c',
  '6f4a2a7e-29b6-4032-93bc-11e2880922dd',
  'd34f4c95-f0b8-4ca6-809f-265d61551755',
  '64461f38-46f6-430e-a993-8a470652c243',
  'eb7f1749-8847-42e5-ad6e-c9617fd3c14d',
  '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd',
  '1d3e878b-3e8c-468c-8a83-7a3fee8f113c',
  'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9',
  '7bc64ef4-1880-43c7-90ee-2ecb1dd64106',
  'b63bceb5-bb14-46bf-9a09-1542b1e34c6a',
  '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'
);

-- and last, the drives themselves; their remaining children cascade.
delete from public.drives
 where id in (
    '64065de6-289f-42cd-b262-302a59f05474',
    'ee5195c5-54af-450b-92cb-9cca8eb3cd88',
    '4ff6b97a-3068-4e27-8f6a-f3dfd0378297',
    '83f89f01-0f09-47ee-b1f3-15ac332caaa9',
    'a8afca23-75ac-4a75-826d-dc6cd2b8a76a',
    'ff803bdc-7e52-400e-aa32-e8f5c9d2ee96',
    '5cdfbaca-4b7d-47f8-aa05-8a25ad09dd1d',
    'e4137741-0b5e-452c-9777-83d2bf44e88c',
    '6f4a2a7e-29b6-4032-93bc-11e2880922dd',
    'd34f4c95-f0b8-4ca6-809f-265d61551755',
    '64461f38-46f6-430e-a993-8a470652c243',
    'eb7f1749-8847-42e5-ad6e-c9617fd3c14d',
    '4470eb4d-ddab-4a96-a9ad-62aa12de9dfd',
    '1d3e878b-3e8c-468c-8a83-7a3fee8f113c',
    'e8e313ee-4911-4a33-bc6f-7ebcace6f8c9',
    '7bc64ef4-1880-43c7-90ee-2ecb1dd64106',
    'b63bceb5-bb14-46bf-9a09-1542b1e34c6a',
    '9edd8c2a-4dc5-486e-a792-a2875f5e6d13'
 );

-- ---------------------------------------------------------------------------
-- 4. OPTIONAL — the company-drive events left behind.
--    Deleting drives does not touch company_drives, so the PIF's "existing
--    event" picker keeps offering these 6 shells with nothing under them.
--    Uncomment only if you want them gone too.
-- ---------------------------------------------------------------------------
-- delete from public.company_drives;

-- ---------------------------------------------------------------------------
-- 5. Verify: the tail must print 0 drives and 0 of every cascade child
-- ---------------------------------------------------------------------------
select 'drives' as table_name, count(*) from drives
union all select 'drive_rounds', count(*) from drive_rounds
union all select 'drive_eligible_degrees', count(*) from drive_eligible_degrees
union all select 'drive_eligible_branches', count(*) from drive_eligible_branches
union all select 'drive_target_campuses', count(*) from drive_target_campuses
union all select 'drive_contacts', count(*) from drive_contacts
union all select 'applications', count(*) from applications
union all select 'shortlist_entries', count(*) from shortlist_entries
union all select 'round_results', count(*) from round_results
union all select 'student_documents with a drive', count(*) from student_documents where drive_id is not null;
