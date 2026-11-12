-- 0149_drive_notifications_respect_preferences.sql
-- Enforces that live drive student notifications and emails ALWAYS respect
-- student role category preferences (student_role_preferences) and drive type
-- preferences (drive_type_preferences), even when open_to_all_override is true.
-- open_to_all_override (prestige override) strictly bypasses the placement offer ladder
-- and internship cap for placed candidates — never student career preferences.

CREATE OR REPLACE FUNCTION public.notify_eligible_students_on_drive_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_student_rec record;
  v_notification_id uuid;
  v_drive_title text;
  v_body text;
  v_ctc_display text;
  v_students_notified integer := 0;
begin
  if new.status <> 'live' or (tg_op = 'update' and old.status is not distinct from 'live') then
    return new;
  end if;

  if new.ctc_min_lpa is not null and new.ctc_max_lpa is not null then
    if new.ctc_min_lpa = new.ctc_max_lpa then
      v_ctc_display := new.ctc_min_lpa::text || ' LPA';
    else
      v_ctc_display := new.ctc_min_lpa::text || ' - ' || new.ctc_max_lpa::text || ' LPA';
    end if;
  else
    v_ctc_display := 'As per policy';
  end if;

  v_drive_title := new.company_name || ' — ' || coalesce(new.role_title, 'Placement Opportunity');

  for v_student_rec in
    select s.id, s.full_name
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

       -- Campus targeting
       and (
         not exists (select 1 from drive_target_campuses dtc where dtc.drive_id = new.id)
         or exists (
           select 1 from drive_target_campuses dtc
            where dtc.drive_id = new.id and dtc.campus_id = s.campus_id
         )
       )

       -- Degree targeting
       and (
         not exists (select 1 from drive_eligible_degrees ded where ded.drive_id = new.id)
         or exists (
           select 1 from drive_eligible_degrees ded
            where ded.drive_id = new.id and ded.degree_id = s.degree_id
         )
       )

       -- Branch targeting
       and (
         not exists (select 1 from drive_eligible_branches deb where deb.drive_id = new.id)
         or (
           exists (select 1 from drive_eligible_degrees ded where ded.drive_id = new.id)
           and not exists (
             select 1 from drive_eligible_branches deb
               join branches br on br.id = deb.branch_id
              where deb.drive_id = new.id
                and br.degree_id = s.degree_id
           )
         )
         or exists (
           select 1 from drive_eligible_branches deb
            where deb.drive_id = new.id
              and deb.branch_id = s.branch_id
         )
       )

       -- Passing year targeting
       and (
         array_length(new.eligible_passing_years, 1) is null
         or s.passing_year = any (new.eligible_passing_years)
       )

       -- Academic marks criteria (10th / 12th)
       and (
         new.min_tenth_percentage is null
         or (s.tenth_percentage is not null and s.tenth_percentage >= new.min_tenth_percentage)
       )
       and (
         new.min_twelfth_percentage is null
         or (s.twelfth_percentage is not null
             and s.twelfth_percentage >= new.min_twelfth_percentage)
       )

       -- Academic CGPA and arrears criteria
       and (
         new.min_overall_cgpa is null
         or coalesce(latest.cgpa, s.overall_cgpa, 0) >= new.min_overall_cgpa
       )
       and (
         new.arrears_policy = 'flexible'
         or coalesce(latest.current_arrears, s.current_arrears, 0) = 0
       )
       and (
         new.arrears_policy <> 'no_history'
         or case when latest.cgpa is not null
                 then coalesce(hist.history_of_arrears, 0)
                 else coalesce(s.history_of_arrears, 0)
            end = 0
       )

       -- -------------------------------------------------------------
       -- Student Role Category Preference (ALWAYS ENFORCED)
       -- Students with declared preferences only receive alerts matching their preferences.
       -- -------------------------------------------------------------
       and (
         new.role_category is null
         or not exists (
           select 1 from student_role_preferences p where p.student_id = s.id
         )
         or exists (
           select 1 from student_role_preferences p
            where p.student_id = s.id and p.category = new.role_category
         )
       )

       -- -------------------------------------------------------------
       -- Student Drive Type Preference (ALWAYS ENFORCED)
       -- -------------------------------------------------------------
       and (
         new.drive_type is null
         or coalesce(cardinality(s.drive_type_preferences), 0) = 0
         or new.drive_type = any (s.drive_type_preferences)
       )

       -- -------------------------------------------------------------
       -- Placement Ladder & Internship Cap
       -- Bypassed by open_to_all_override for prestige drives so placed students can apply.
       -- -------------------------------------------------------------
       and (
         new.open_to_all_override
         or (
              -- Plain internship cap
              (
                new.drive_type <> 'internship'
                or not exists (
                  select 1 from offers o
                   where o.student_id = s.id
                     and o.drive_type in ('internship', 'internship_convertible')
                )
              )
              -- Offer category ladder
              and (
                new.drive_type not in ('placement', 'internship_convertible')
                or new.offer_category is null
                or not exists (
                  select 1 from offers o
                   where o.student_id = s.id
                     and o.drive_type in ('placement', 'internship_convertible')
                     and o.offer_category is not null
                     and case o.offer_category
                           when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
                         end
                       >= case new.offer_category
                           when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
                         end
                )
              )
         )
       )

       -- Dedup guard: skip students already notified about this drive
       and not exists (
         select 1 from notifications n
          where n.student_id = s.id
            and n.kind = 'drive_published'
            and n.drive_id = new.id
       )
  loop
    v_body := 'A new placement drive is now open for applications at your campus.' || E'\n\n' ||
              '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n';

    if new.application_end is not null then
      v_body := v_body || '**Application Deadline:** ' ||
                to_char(new.application_end, 'DD Mon YYYY, HH12:MI AM') || E'\n';
    end if;

    v_body := v_body || E'\n' || 'Log in to the portal to view full details and submit your application.';

    insert into notifications (student_id, kind, title, body, drive_id)
    values (
      v_student_rec.id,
      'drive_published',
      'New Drive: ' || v_drive_title,
      v_body,
      new.id
    )
    returning id into v_notification_id;

    v_students_notified := v_students_notified + 1;
  end loop;

  raise notice 'Drive % went live: notified % eligible students', new.id, v_students_notified;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS notify_eligible_students_on_drive_live ON drives;
CREATE TRIGGER notify_eligible_students_on_drive_live
  AFTER INSERT OR UPDATE OF status ON drives
  FOR EACH ROW
  EXECUTE FUNCTION notify_eligible_students_on_drive_live();
