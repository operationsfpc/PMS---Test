-- 0144_auto_pause_five_unapplied_drives.sql
--
-- Automatically pause a student's participation standing if they have not applied
-- to 5 eligible placement drives whose application windows have closed.
-- Notify the student in-app and via notification to meet their Campus Manager.

create or replace function check_and_auto_pause_unapplied_students(p_student_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_student record;
  v_missed_count integer;
  v_paused_count integer := 0;
begin
  for v_student in
    select s.id, s.full_name, s.campus_id, s.degree_id, s.branch_id, s.passing_year,
           s.tenth_percentage, s.twelfth_percentage, s.overall_cgpa,
           s.current_arrears, s.history_of_arrears
      from students s
     where s.srf_status = 'srf_approved'
       and s.participation_status = 'active'
       and (p_student_id is null or s.id = p_student_id)
  loop
    -- Count eligible closed drives where student did not apply
    select count(distinct d.id) into v_missed_count
      from drives d
      join drive_target_campuses dtc on dtc.drive_id = d.id and dtc.campus_id = v_student.campus_id
     where (d.status in ('applications_closed', 'in_rounds', 'completed') or d.application_end < now())
       -- Degree eligibility
       and (
         not exists (select 1 from drive_eligible_degrees ded where ded.drive_id = d.id)
         or exists (select 1 from drive_eligible_degrees ded where ded.drive_id = d.id and ded.degree_id = v_student.degree_id)
       )
       -- Branch eligibility
       and (
         not exists (select 1 from drive_eligible_branches deb where deb.drive_id = d.id)
         or (v_student.branch_id is not null and exists (select 1 from drive_eligible_branches deb where deb.drive_id = d.id and deb.branch_id = v_student.branch_id))
       )
       -- Passing year eligibility
       and (
         d.eligible_passing_years is null
         or cardinality(d.eligible_passing_years) = 0
         or v_student.passing_year = any(d.eligible_passing_years)
       )
       -- 10th percentage criteria
       and (
         d.min_tenth_percentage is null
         or coalesce(v_student.tenth_percentage, 0) >= d.min_tenth_percentage
       )
       -- 12th percentage criteria
       and (
         d.min_twelfth_percentage is null
         or coalesce(v_student.twelfth_percentage, 0) >= d.min_twelfth_percentage
       )
       -- CGPA criteria
       and (
         d.min_overall_cgpa is null
         or coalesce(v_student.overall_cgpa, 0) >= d.min_overall_cgpa
       )
       -- Arrears policy
       and (
         d.arrears_policy = 'flexible'
         or (d.arrears_policy = 'no_standing' and coalesce(v_student.current_arrears, 0) = 0)
         or (d.arrears_policy = 'no_history' and coalesce(v_student.history_of_arrears, 0) = 0)
       )
       -- Did NOT apply
       and not exists (
         select 1 from applications a
          where a.drive_id = d.id and a.student_id = v_student.id
       );

    if v_missed_count >= 5 then
      -- If student doesn't already have an unreleased hold
      if not exists (select 1 from student_holds where student_id = v_student.id and released_at is null) then
        insert into student_holds (
          student_id, kind, reason, starts_at, ends_at, confirmed_at
        ) values (
          v_student.id,
          'pause',
          'Auto-paused: You have not applied for 5 eligible placement drives. Please meet your Campus Manager to review your standing.',
          current_date,
          current_date + interval '14 days',
          now()
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
          'You have not applied for 5 eligible placement drives. Your placement participation has been paused. Please meet your Campus Manager to review your standing.'
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

