-- ============================================================================
-- REMOVE DUMMY DRIVES -- run this BEFORE go-live (after remove-test-students).
-- ============================================================================
-- Removes the 10 dummy drives and all their child rows (applications, rounds,
-- campus targets) via cascade. Run AFTER remove-test-students.sql, because
-- test-student applications reference these drives.
--
-- Marker: drives.company_name LIKE 'Dummy Drive%'
-- ============================================================================

begin;

do $check$ declare n integer; begin
  select count(*) into n from drives where company_name like 'Dummy Drive%';
  if n = 0 then raise notice 'No dummy drives found -- nothing to remove.';
  else raise notice 'About to delete % dummy drive(s) and all child rows.', n;
  end if;
end $check$;

delete from drives where company_name like 'Dummy Drive%';

commit;

-- Confirmation
select count(*) as dummy_drives_remaining from drives where company_name like 'Dummy Drive%';
-- Expected: 0
