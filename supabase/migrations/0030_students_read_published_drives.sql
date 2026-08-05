-- A student can read the drives that were published TO them.
--
-- Reported 2026-08-05: "even after drives are published by Central PC, they
-- are not shown to eligible students." TCS and Cognizant, both `live`, both
-- inside their application window, both targeted at exactly the campus, degree
-- and branch of three approved students who cleared every cutoff.
--
-- They were eligible. They could not SEE the row. 0008 gave `drives` five
-- policies and not one of them admits a student:
--
--   -- Students never read the drives table directly; they read a filtered view.
--   create policy drives_staff_read on drives for select using (is_org_reader());
--
-- The filtered view was never built. The drives screen queries `drives`
-- directly, and because row level security is a FILTER rather than a guard it
-- returned no rows and no error - so the page rendered a perfectly healthy
-- "no drives open to you right now". Every student has seen that since the day
-- it shipped, and nothing anywhere could have reported it.
--
-- What a student may see is deliberately coarser than what they may APPLY to.
-- R5/R6 live in `src/domain/visibility.ts`, decide the harder question with
-- reasons a student can read, and are evaluated over the rows this returns.
-- Duplicating that logic here would give a student two different answers
-- depending on which layer they asked.
create policy drives_student_read on drives for select
  using (
    current_student_id() is not null
    -- Published, in the ordinary sense: a drive still being negotiated is
    -- commercially confidential and may never happen at all. `applications_
    -- closed`, `in_rounds` and `completed` stay readable because a student
    -- who applied still needs to see what they applied to.
    and status in ('live', 'applications_closed', 'in_rounds', 'completed')
    and (
      -- An empty targeting list means ANY campus, never none - the same rule
      -- `evaluateEligibility` applies, so the two cannot disagree.
      not exists (select 1 from drive_target_campuses t where t.drive_id = drives.id)
      or exists (
        select 1
          from drive_target_campuses t
          join students s on s.id = current_student_id()
         where t.drive_id = drives.id
           and t.campus_id = s.campus_id
      )
    )
  );

-- ---------------------------------------------------------------- targeting
-- The three link tables carry the drive's targeting, and `drive_rounds` its
-- schedule. All four had row level security switched OFF entirely - no
-- policies, no protection - while 0008 grants insert and update on every table
-- in the schema to `authenticated`.
--
-- So any signed-in student could add their own branch to a drive they were not
-- eligible for, or delete the campus targeting that excluded them, and
-- eligibility would then agree with them. Nothing would have looked wrong.
--
-- They must stay READABLE by students, because eligibility is evaluated
-- against them client-side and a student is entitled to know why they do not
-- qualify.
alter table drive_target_campuses   enable row level security;
alter table drive_eligible_degrees  enable row level security;
alter table drive_eligible_branches enable row level security;
alter table drive_rounds            enable row level security;

do $$
declare
  link_table text;
  owns_drive constant text :=
    'is_operator() or current_app_role() = ''delivery_head'' or exists (
       select 1 from drives d
        where d.id = drive_id
          and current_app_role() = ''account_executive''
          and d.created_by = auth.uid())';
begin
  foreach link_table in array array[
    'drive_target_campuses', 'drive_eligible_degrees', 'drive_eligible_branches', 'drive_rounds'
  ]
  loop
    -- Anyone signed in may read the targeting. It says who a drive is for,
    -- which is the one thing a student most needs to be told.
    execute format(
      'create policy %I on %I for select using (auth.uid() is not null)',
      link_table || '_read', link_table
    );

    -- Written by the people who own the drive: the Central CPC or Admin who
    -- publishes it, the Delivery Head who approves it, and the AE who drafted
    -- it. Mirrors the `drives` write policies rather than inventing a second
    -- rule that could drift away from them.
    --
    -- Deliberately THREE policies rather than one `for all`. A `for all`
    -- policy also applies to SELECT, and since these conditions read `drives`
    -- - whose own student policy reads this table back - Postgres refuses the
    -- query outright with "infinite recursion detected in policy". Splitting
    -- the write commands out keeps the read path free of any reference to
    -- `drives`, so the cycle cannot form.
    execute format('create policy %I on %I for insert with check (%s)',
                   link_table || '_insert', link_table, owns_drive);
    execute format('create policy %I on %I for update using (%s) with check (%s)',
                   link_table || '_update', link_table, owns_drive, owns_drive);
    execute format('create policy %I on %I for delete using (%s)',
                   link_table || '_delete', link_table, owns_drive);
  end loop;
end $$;

-- Publishing REPLACES a drive's targeting - delete, then insert - so the
-- delete has to be granted or the publish screen silently keeps the old
-- targeting. 0008 grants only select, insert and update; the live database
-- happens to have `grant all` from Supabase's own setup, which is exactly the
-- drift that hid the SRF re-submission bug for a day.
grant delete on drive_target_campuses, drive_eligible_degrees,
                drive_eligible_branches, drive_rounds to authenticated;
