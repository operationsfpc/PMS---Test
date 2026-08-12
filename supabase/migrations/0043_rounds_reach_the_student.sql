-- 0043 — the shortlist reaches the student; the round tables are locked down.
-- D7/D8/D9, confirmed 2026-08-12.
--
-- Three things in one migration because they are one story:
--
-- 1. round_participants, round_results, attendance, recruiter_exports and
--    email_deliveries had NO RLS AT ALL, while 0008 grants insert/update on
--    every table to authenticated — any signed-in student could write
--    themselves a 'selected' result. Same class of hole 0030 closed.
-- 2. "After shortlisting ... data not reflecting in panel. Data not
--    reflecting to student." Nothing connected the shortlist to Round 1, so
--    the student dashboard and the results screen read from empty tables.
--    Saving the shortlist now schedules Round 1 and notifies; results notify
--    (selected AND rejected — the client asked for both); an offer notifies.
--    Recruiters are not users (D8): the Central CPC's entry is final and IS
--    the communication.
-- 3. An opted-out student cannot be shortlisted without an explicit override
--    reason (D7), and is never notified of anything.

-- ------------------------------------------------------------ 1. lockdown

alter table round_participants enable row level security;
alter table round_participants force  row level security;
alter table round_results      enable row level security;
alter table round_results      force  row level security;
alter table attendance         enable row level security;
alter table attendance         force  row level security;
alter table recruiter_exports  enable row level security;
alter table recruiter_exports  force  row level security;
alter table email_deliveries   enable row level security;
alter table email_deliveries   force  row level security;

-- A student reads their own rows: the dashboard's round progress ran only
-- because RLS was off. Staff read by scope; the drive's AE reads their own
-- drive's rows (0019's argument). Writes stay with the operators — and the
-- campus CPC for attendance, which they mark (domain rule R8's marking).

create policy rounds_self_read on round_participants for select
  using (application_id in (select id from applications where student_id = current_student_id()));
create policy results_self_read on round_results for select
  using (application_id in (select id from applications where student_id = current_student_id()));
create policy attendance_self_read on attendance for select
  using (application_id in (select id from applications where student_id = current_student_id()));

create policy rounds_staff_read on round_participants for select
  using (is_org_reader()
         or (is_campus_reader() and application_id in
             (select id from applications where student_id in (select my_student_ids()))));
create policy results_staff_read on round_results for select
  using (is_org_reader()
         or (is_campus_reader() and application_id in
             (select id from applications where student_id in (select my_student_ids()))));
create policy attendance_staff_read on attendance for select
  using (is_org_reader()
         or (is_campus_reader() and application_id in
             (select id from applications where student_id in (select my_student_ids()))));

create policy rounds_ae_read on round_participants for select
  using (current_app_role() = 'account_executive'
         and application_id in (select a.id from applications a
              where a.drive_id in (select id from drives where created_by = auth.uid())));
create policy results_ae_read on round_results for select
  using (current_app_role() = 'account_executive'
         and application_id in (select a.id from applications a
              where a.drive_id in (select id from drives where created_by = auth.uid())));
create policy attendance_ae_read on attendance for select
  using (current_app_role() = 'account_executive'
         and application_id in (select a.id from applications a
              where a.drive_id in (select id from drives where created_by = auth.uid())));

create policy rounds_operator_write on round_participants for all
  using (is_operator()) with check (is_operator());
create policy results_operator_write on round_results for all
  using (is_operator()) with check (is_operator());
-- Attendance is marked at the venue: the campus CPC for their own students,
-- or the operators.
create policy attendance_staff_write on attendance for all
  using (is_operator()
         or (is_campus_staff() and application_id in
             (select id from applications where student_id in (select my_student_ids()))))
  with check (is_operator()
         or (is_campus_staff() and application_id in
             (select id from applications where student_id in (select my_student_ids()))));

create policy exports_staff_read on recruiter_exports for select using (is_org_reader());
create policy exports_operator_insert on recruiter_exports for insert with check (is_operator());

-- Delivery status is read by staff; only the server (service role) writes it.
create policy deliveries_staff_read on email_deliveries for select using (is_org_reader());

-- ------------------------------------------------- 2. the opt-out override

alter table shortlist_entries add column opt_out_override_reason text;

create or replace function shortlist_respects_opt_out() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.included
     and (tg_op = 'INSERT' or old.included is distinct from new.included
          or old.opt_out_override_reason is distinct from new.opt_out_override_reason)
     and exists (
       select 1 from applications a
         join students s on s.id = a.student_id
        where a.id = new.application_id
          and s.participation_status = 'opted_out'
     )
     and (new.opt_out_override_reason is null
          or length(trim(new.opt_out_override_reason)) = 0) then
    raise exception
      'This student has opted out and cannot be shortlisted. Overriding needs an explicit reason.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger shortlist_respects_opt_out
  before insert or update on shortlist_entries
  for each row execute function shortlist_respects_opt_out();

-- --------------------------------- 3. inclusion schedules Round 1, and tells

create or replace function shortlist_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first_round uuid;
  v_company     text;
  v_student     uuid;
  v_opted_out   boolean;
begin
  select a.student_id, d.company_name, s.participation_status = 'opted_out'
    into v_student, v_company, v_opted_out
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select dr.id into v_first_round
    from drive_rounds dr
    join applications a on a.drive_id = dr.drive_id
   where a.id = new.application_id
   order by dr.sequence
   limit 1;

  if new.included and (tg_op = 'INSERT' or not old.included) then
    -- Schedule Round 1. A drive published before rounds existed has none;
    -- the notification still goes, and scheduling happens on the attendance
    -- screen as before.
    if v_first_round is not null then
      insert into round_participants (round_id, application_id, added_by)
      values (v_first_round, new.application_id, new.decided_by)
      on conflict (round_id, application_id) do nothing;

      insert into attendance (round_id, application_id, status)
      values (v_first_round, new.application_id, 'scheduled')
      on conflict (round_id, application_id) do nothing;
    end if;

    -- D7: an opted-out student gets NO notification, overridden or not.
    if not v_opted_out then
      insert into notifications (student_id, kind, title, body)
      values (
        v_student,
        'shortlisted',
        'You are shortlisted for ' || v_company,
        'You are on the shortlist for ' || v_company ||
        '. Round 1 is next — you are expected to attend every round.'
      );
    end if;
  end if;

  -- Un-including takes back an untouched Round 1 slot. Anything already
  -- marked or decided stays: history is not rewritten by a checkbox.
  if not new.included and tg_op = 'UPDATE' and old.included and v_first_round is not null then
    delete from attendance
     where round_id = v_first_round
       and application_id = new.application_id
       and status = 'scheduled'
       and marked_by is null
       and not exists (select 1 from round_results r
                        where r.round_id = v_first_round
                          and r.application_id = new.application_id);
    delete from round_participants rp
     where rp.round_id = v_first_round
       and rp.application_id = new.application_id
       and not exists (select 1 from attendance att
                        where att.round_id = v_first_round
                          and att.application_id = new.application_id);
  end if;

  return new;
end;
$$;

create trigger shortlist_reaches_student
  after insert or update on shortlist_entries
  for each row execute function shortlist_reaches_student();

-- ------------------------------------------------- 4. results notify, both ways

create or replace function round_result_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student  uuid;
  v_company  text;
  v_sequence integer;
  v_opted    boolean;
begin
  if new.result not in ('selected', 'rejected') then
    return new;  -- waitlisted / on_hold are interim states, not outcomes
  end if;
  if tg_op = 'UPDATE' and old.result = new.result then
    return new;  -- re-saving the same result is not news
  end if;

  select a.student_id, d.company_name, s.participation_status = 'opted_out'
    into v_student, v_company, v_opted
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select sequence into v_sequence from drive_rounds where id = new.round_id;

  if v_opted then
    return new;
  end if;

  if new.result = 'selected' then
    insert into notifications (student_id, kind, title, body)
    values (
      v_student,
      'round_cleared',
      'You cleared Round ' || v_sequence || ' of ' || v_company,
      'Well done — you advance from Round ' || v_sequence || ' of ' || v_company || '.'
    );
  else
    insert into notifications (student_id, kind, title, body)
    values (
      v_student,
      'round_not_selected',
      'Round ' || v_sequence || ' of ' || v_company || ': not selected',
      'You were not selected in Round ' || v_sequence || ' of ' || v_company || '.'
    );
  end if;

  return new;
end;
$$;

create trigger round_result_reaches_student
  after insert or update on round_results
  for each row execute function round_result_reaches_student();

-- --------------------------------------------------------- 5. offers notify

create or replace function offer_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_opted boolean;
begin
  if new.source <> 'on_campus' then
    return new;  -- a self-placed offer is the student's own news
  end if;

  select participation_status = 'opted_out' into v_opted
    from students where id = new.student_id;
  if v_opted then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (
    new.student_id,
    'offer',
    'Offer from ' || new.company_name,
    'Congratulations — ' || new.company_name || ' has made you an offer'
      || case when new.offer_category is not null
              then ' (' || replace(new.offer_category::text, '_', ' ') || ')' else '' end
      || '.'
  );

  return new;
end;
$$;

create trigger offer_reaches_student
  after insert on offers
  for each row execute function offer_reaches_student();
