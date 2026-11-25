-- 0158_auto_pause_three_preference_matching_drives.sql
--
-- Automatically pause a student's participation standing if they have not applied
-- to 3 eligible placement drives matching their role and drive type preferences
-- whose application windows have closed.
--
-- Fixes:
-- 1. Threshold reduced from 5 to 3 drives.
-- 2. Respects student_role_preferences and students.drive_type_preferences.
-- 3. Excludes students who are already placed (on-campus placement or self-placed).
-- 4. Excludes historical backfilled drives where created_at >= application_end.
-- 5. Excludes drives that closed before student registration/approval date.
-- 6. Enforces degree, degree-scoped branches (0137), campus, passing year, marks, CGPA and arrears.
-- 7. Only pauses students who have NOT applied to their eligible preference-matching drives.
-- 8. Releases the 374 erroneous auto-pause hold records in student_holds and reactivates affected students.

create or replace function check_and_auto_pause_unapplied_students(p_student_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_student record;
  v_missed_count integer;
  v_paused_count integer := 0;
  v_admin_id uuid;
begin
  select id into v_admin_id 
    from profiles 
   where role in ('central_placement_coordinator', 'delivery_head', 'admin') 
   order by created_at asc limit 1;

  for v_student in
    select s.id, s.full_name, s.campus_id, s.degree_id, s.branch_id, s.passing_year,
           s.tenth_percentage, s.twelfth_percentage, s.overall_cgpa,
           s.current_arrears, s.history_of_arrears,
           s.drive_type_preferences,
           coalesce(s.srf_submitted_at, s.created_at) as srf_active_since,
           latest.cgpa as verified_cgpa,
           latest.current_arrears as verified_current_arrears,
           hist.history_of_arrears as verified_history_of_arrears
      from students s
      left join lateral (
        select m.cgpa, m.current_arrears
          from student_semesters m
         where m.student_id = s.id and m.status = 'verified'
         order by m.semester_number desc
         limit 1
      ) latest on true
      left join lateral (
        select max(m.history_of_arrears) as history_of_arrears
          from student_semesters m
         where m.student_id = s.id and m.status = 'verified'
      ) hist on true
     where s.srf_status = 'srf_approved'
       and s.participation_status = 'active'
       and (p_student_id is null or s.id = p_student_id)
       -- Exclude already placed students (on-campus placement or self-placed)
       and not exists (
         select 1 from offers o
          where o.student_id = s.id
            and (o.source = 'self_placed' or o.drive_type in ('placement', 'internship_convertible'))
       )
  loop
    -- Count eligible closed preference-matching drives where student did not apply
    select count(distinct d.id) into v_missed_count
      from drives d
      join drive_target_campuses dtc on dtc.drive_id = d.id and dtc.campus_id = v_student.campus_id
     where (d.status in ('applications_closed', 'in_rounds', 'completed') or d.application_end < now())
       -- Real recruitment drives only (exclude backfilled drives created after deadline)
       and (d.application_end is null or d.created_at < d.application_end)
       -- Exclude drives that closed before student registered/submitted SRF
       and (d.application_end is null or d.application_end >= v_student.srf_active_since)
       -- Degree targeting
       and (
         not exists (select 1 from drive_eligible_degrees ded where ded.drive_id = d.id)
         or exists (select 1 from drive_eligible_degrees ded where ded.drive_id = d.id and ded.degree_id = v_student.degree_id)
       )
       -- Branch targeting (0137: degree-scoped branches)
       and (
         not exists (select 1 from drive_eligible_branches deb where deb.drive_id = d.id)
         or (
           exists (select 1 from drive_eligible_degrees ded where ded.drive_id = d.id)
           and not exists (
             select 1 from drive_eligible_branches deb
             join branches br on br.id = deb.branch_id
             where deb.drive_id = d.id and br.degree_id = v_student.degree_id
           )
         )
         or (
           v_student.branch_id is not null
           and exists (
             select 1 from drive_eligible_branches deb
              where deb.drive_id = d.id and deb.branch_id = v_student.branch_id
           )
         )
       )
       -- Passing year targeting
       and (
         d.eligible_passing_years is null
         or cardinality(d.eligible_passing_years) = 0
         or v_student.passing_year = any(d.eligible_passing_years)
       )
       -- Academic marks criteria (10th / 12th)
       and (
         d.min_tenth_percentage is null
         or (v_student.tenth_percentage is not null and v_student.tenth_percentage >= d.min_tenth_percentage)
       )
       and (
         d.min_twelfth_percentage is null
         or (v_student.twelfth_percentage is not null and v_student.twelfth_percentage >= d.min_twelfth_percentage)
       )
       -- Academic CGPA and arrears criteria (verified semesters with student fallback)
       and (
         d.min_overall_cgpa is null
         or coalesce(v_student.verified_cgpa, v_student.overall_cgpa, 0) >= d.min_overall_cgpa
       )
       and (
         d.arrears_policy = 'flexible'
         or (
           d.arrears_policy = 'no_standing'
           and coalesce(v_student.verified_current_arrears, v_student.current_arrears, 0) = 0
         )
         or (
           d.arrears_policy = 'no_history'
           and case when v_student.verified_cgpa is not null
                    then coalesce(v_student.verified_history_of_arrears, 0)
                    else coalesce(v_student.history_of_arrears, 0)
               end = 0
         )
       )
       -- Student Role Category Preference (ALWAYS ENFORCED)
       and (
         d.role_category is null
         or not exists (
           select 1 from student_role_preferences p where p.student_id = v_student.id
         )
         or exists (
           select 1 from student_role_preferences p
            where p.student_id = v_student.id and p.category = d.role_category
         )
       )
       -- Student Drive Type Preference (ALWAYS ENFORCED)
       and (
         d.drive_type is null
         or coalesce(cardinality(v_student.drive_type_preferences), 0) = 0
         or d.drive_type = any(v_student.drive_type_preferences)
       )
       -- Internship cap: skip internship drives if student already used internship cap
       and (
         d.drive_type <> 'internship'
         or not exists (
           select 1 from offers o
            where o.student_id = v_student.id
              and o.drive_type in ('internship', 'internship_convertible')
         )
       )
       -- Did NOT apply to this drive
       and not exists (
         select 1 from applications a
          where a.drive_id = d.id and a.student_id = v_student.id
       );

    -- Auto-pause if missed 3 or more eligible preference-matching drives AND has not applied
    -- to any eligible preference drive (protect active applicants who apply to drives)
    if v_missed_count >= 3
       and not exists (
         select 1 from applications a
           join drives ad on ad.id = a.drive_id
          where a.student_id = v_student.id
            and (
              ad.role_category is null
              or not exists (select 1 from student_role_preferences p where p.student_id = v_student.id)
              or exists (select 1 from student_role_preferences p where p.student_id = v_student.id and p.category = ad.role_category)
            )
       ) then
      -- If student doesn't already have an unreleased hold
      if not exists (select 1 from student_holds where student_id = v_student.id and released_at is null) then
        insert into student_holds (
          student_id, kind, reason, starts_at, ends_at, confirmed_at, confirmed_by
        ) values (
          v_student.id,
          'pause',
          'Auto-paused: You have not applied for 3 eligible placement drives matching your preferences. Please meet your Campus Manager to review your standing.',
          current_date,
          current_date + interval '14 days',
          now(),
          v_admin_id
        );

        update students
           set participation_status = 'on_hold'
         where id = v_student.id;

        insert into notifications (
          student_id, kind, title, body
        ) values (
          v_student.id,
          'placement_paused',
          'Placement Participation Paused',
          'You have not applied for 3 eligible placement drives matching your preferences. Your placement participation has been paused. Please meet your Campus Manager to review your standing.'
        );

        v_paused_count := v_paused_count + 1;
      end if;
    end if;
  end loop;

  return v_paused_count;
end;
$$;

-- Trigger to evaluate when a drive's status closes applications
create or replace function trigger_auto_pause_on_drive_close()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('applications_closed', 'in_rounds', 'completed')
     and (old.status is null or old.status not in ('applications_closed', 'in_rounds', 'completed')) then
    perform check_and_auto_pause_unapplied_students();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_pause_on_drive_close on drives;
create trigger trg_auto_pause_on_drive_close
  after update of status on drives
  for each row
  execute function trigger_auto_pause_on_drive_close();

-- Release the 374 erroneous auto-pause hold records from migration 0144
update student_holds
   set released_at = now(),
       release_note = 'System: Released erroneous auto-pause hold. Replaced by 3 preference-matching drives rule.'
 where kind = 'pause'
   and released_at is null
   and reason like 'Auto-paused: You have not applied for 5 eligible placement drives%';

-- Restore participation_status to 'active' for students who have no other unreleased holds
update students s
   set participation_status = 'active'
 where s.participation_status = 'on_hold'
   and s.srf_status = 'srf_approved'
   and not exists (
     select 1 from student_holds h
      where h.student_id = s.id
        and h.released_at is null
   );
