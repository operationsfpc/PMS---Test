-- 0130_hold_pause_and_self_placed_requests.sql
--
-- Three decisions taken 2026-10-29, after the hold reached the Campus Manager:
--
--   1. Every hold names both ends of its window. `ends_at` stops being optional
--      — but it is STILL a review date, not a switch. Nothing in this file
--      releases a hold; a date passing only changes the word on the screen
--      (holdStanding's 'overdue'). 0125:30-37 explains why, and it has not
--      changed.
--   2. A fourth kind, `pause`, for a break that is neither fees, an off-campus
--      offer, nor idleness. Same mechanics, same release.
--   3. A student may ask for a self-placed hold themselves, with two documents
--      (offer letter + handwritten declaration). It closes nothing until a
--      Campus Manager confirms it: a self-report that shut a student's own
--      drives the moment they typed it would be an escape hatch, not a record.
--
-- WHY THE NEW ENUM LABELS ARE NOT USED BELOW: Postgres refuses to use a label
-- added in the same transaction, measured in 0124:6-19. 'self_placed' and
-- 'offer_letter' are old labels and are used freely; 'pause' and
-- 'self_placement_declaration' are added here and referenced only from the
-- client. That is also why the declaration's document_kind is not validated in
-- the function below — ownership is what the function can check safely.

alter type hold_kind add value if not exists 'pause';

alter type document_kind add value if not exists 'self_placement_declaration';

-- ---------------------------------------------------------------------------
-- Every hold names its review date.
--
-- The 0124/0125 tables have only ever been written by this effort, so a null
-- `ends_at` can only be a row placed before this rule existed. Thirty days is
-- the form's own default; it is written here rather than guessed at read time,
-- and it is a review date like any other — the hold is still released by hand.
-- ---------------------------------------------------------------------------
update student_holds set ends_at = starts_at + 30 where ends_at is null;

alter table student_holds alter column ends_at set not null;

alter table student_holds drop constraint hold_window_is_ordered;
alter table student_holds
  add constraint hold_window_is_ordered check (ends_at >= starts_at);

-- ---------------------------------------------------------------------------
-- A student-filed request: same table, same release, plus the two documents and
-- the confirmation that separates "asked for" from "in force".
-- ---------------------------------------------------------------------------
alter table student_holds
  add column if not exists declaration_id uuid references student_documents(id) on delete set null,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references profiles(id);

-- Nobody placed a request but the student, so the author is no longer required.
-- A staff-placed hold still stamps held_by, and confirm_student_hold is what
-- puts a name on a request.
alter table student_holds alter column held_by drop not null;

-- Confirmation, like release, is attributed or absent — never half.
alter table student_holds
  add constraint hold_confirmation_is_attributed
  check ((confirmed_at is null) = (confirmed_by is null));

-- An unconfirmed row is exactly a student's request: self_placed, no held_by,
-- both documents filed. Enforced here so the screen never has to guess.
alter table student_holds
  add constraint hold_request_has_evidence
  check (
    confirmed_at is not null
    or (kind = 'self_placed' and held_by is null
        and document_id is not null and declaration_id is not null)
  );

-- ---------------------------------------------------------------------------
-- Place (staff). Same function as 0125, now with a review date to name and a
-- confirmation stamped at insert — the manager already made the decision, so a
-- staff row is born confirmed.
-- ---------------------------------------------------------------------------
create or replace function place_student_hold(
  p_student_id  uuid,
  p_kind        hold_kind,
  p_reason      text,
  p_starts_at   date default current_date,
  p_ends_at     date default null,
  p_document_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor  uuid;
  campus uuid;
  state  participation_status;
  v_name text;
  hold   uuid;
begin
  select id into actor from profiles where id = auth.uid() and is_active;
  if actor is null then
    raise exception 'A hold is placed by a signed-in staff member.'
      using errcode = '42501';
  end if;

  if current_app_role() <> 'campus_manager' then
    raise exception 'Only a Campus Manager may place a placement hold.'
      using errcode = '42501';
  end if;

  select campus_id, participation_status, full_name
    into campus, state, v_name
    from students where id = p_student_id;

  if campus is null then
    raise exception 'No such student.';
  end if;

  if not (campus in (select my_campus_ids())) then
    raise exception 'You may only hold a student at a college you are assigned to.'
      using errcode = '42501';
  end if;

  if state <> 'active' then
    raise exception '% is not in placements right now (status: %), so there is nothing to hold.',
      v_name, state;
  end if;

  if p_ends_at is null then
    raise exception 'Say when the hold should be reviewed.';
  end if;

  if p_ends_at < coalesce(p_starts_at, current_date) then
    raise exception 'The review date cannot fall before the hold starts.';
  end if;

  -- The unique index would refuse this anyway; asking first is what turns a
  -- unique violation into a sentence the dialog can show.
  if exists (select 1 from student_holds where student_id = p_student_id and released_at is null) then
    raise exception '% already has a hold, or a request waiting on them.', v_name;
  end if;

  insert into student_holds (
    student_id, kind, reason, starts_at, ends_at, document_id, held_by, confirmed_at, confirmed_by
  )
  values (
    p_student_id, p_kind, trim(p_reason), coalesce(p_starts_at, current_date),
    p_ends_at, p_document_id, actor, now(), actor
  )
  returning id into hold;

  update students set participation_status = 'on_hold' where id = p_student_id;

  return hold;
end;
$$;

-- ---------------------------------------------------------------------------
-- Request (student). Files the pending row and touches nothing else: the drives
-- stay open and the mail keeps arriving until a Campus Manager confirms.
--
-- One submission, two rows, one transaction: the offer request 0014 already
-- owns (so the coordinator can verify it and it reaches the statistic) and the
-- hold request this file adds. Written together because a student who is told
-- "sent" must not end up with one of them missing — the client cannot wrap
-- two calls in a transaction, so the database does.
-- ---------------------------------------------------------------------------
create or replace function request_self_placed_hold(
  p_offer_document_id uuid,
  p_declaration_id    uuid,
  p_reason            text,
  p_starts_at         date,
  p_ends_at           date,
  p_company_name      text,
  p_role_title        text,
  p_ctc_lpa           numeric
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid;
  state participation_status;
  hold  uuid;
begin
  actor := current_student_id();
  if actor is null then
    raise exception 'A self-placed request is filed by the student themselves.'
      using errcode = '42501';
  end if;

  select participation_status into state from students where id = actor;
  if state is null then
    raise exception 'No such student.';
  end if;
  if state <> 'active' then
    raise exception 'You are not in placements right now (status: %), so this request would change nothing.',
      state;
  end if;

  if p_company_name is null or trim(p_company_name) = '' then
    raise exception 'Name the company you have joined.';
  end if;
  if p_ctc_lpa is null or p_ctc_lpa <= 0 then
    raise exception 'Say the CTC in LPA.';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Say what the request is for.';
  end if;
  if p_ends_at is null then
    raise exception 'Say when the pause should be reviewed.';
  end if;
  if p_ends_at < coalesce(p_starts_at, current_date) then
    raise exception 'The review date cannot fall before the pause starts.';
  end if;

  -- The kind is checked for the letter because 'offer_letter' predates this
  -- file. The declaration's kind is not checked here — its label is created
  -- above, and Postgres refuses a new label in the same transaction (0124).
  if not exists (
    select 1 from student_documents
     where id = p_offer_document_id and student_id = actor and kind = 'offer_letter'
  ) then
    raise exception 'File your offer letter first.';
  end if;
  if not exists (
    select 1 from student_documents where id = p_declaration_id and student_id = actor
  ) then
    raise exception 'File the handwritten declaration first.';
  end if;

  if exists (select 1 from student_holds where student_id = actor and released_at is null) then
    raise exception 'There is already a hold, or a request waiting, on your placements.';
  end if;

  insert into student_holds (
    student_id, kind, reason, starts_at, ends_at, document_id, declaration_id, held_by
  )
  values (
    actor, 'self_placed', trim(p_reason), coalesce(p_starts_at, current_date),
    p_ends_at, p_offer_document_id, p_declaration_id, null
  )
  returning id into hold;

  insert into self_placement_requests (
    student_id, company_name, role_title, ctc_lpa, offer_letter_id
  )
  values (
    actor, trim(p_company_name), nullif(trim(coalesce(p_role_title, '')), ''), p_ctc_lpa,
    p_offer_document_id
  );

  return hold;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirm (Campus Manager). The request becomes the hold it asked to be: this
-- is the one statement that closes the student's drives.
-- ---------------------------------------------------------------------------
create or replace function confirm_student_hold(p_hold_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor  uuid;
  h      student_holds;
  state  participation_status;
  v_name text;
begin
  select id into actor from profiles where id = auth.uid() and is_active;
  if actor is null then
    raise exception 'A hold is confirmed by a signed-in staff member.'
      using errcode = '42501';
  end if;

  if current_app_role() <> 'campus_manager' then
    raise exception 'Only a Campus Manager may confirm a placement hold.'
      using errcode = '42501';
  end if;

  select * into h from student_holds where id = p_hold_id for update;

  if h.id is null then
    raise exception 'No such hold.';
  end if;

  if not (h.student_id in (
        select s.id from students s where s.campus_id in (select my_campus_ids()))) then
    raise exception 'You may only confirm a hold at a college you are assigned to.'
      using errcode = '42501';
  end if;

  if h.released_at is not null then
    raise exception 'This request was already declined on %.', h.released_at::date;
  end if;

  if h.confirmed_at is not null then
    raise exception 'This hold was already confirmed on %.', h.confirmed_at::date;
  end if;

  select participation_status, full_name into state, v_name
    from students where id = h.student_id;

  if state <> 'active' then
    raise exception '% is not in placements right now (status: %), so the hold cannot be confirmed.',
      v_name, state;
  end if;

  update student_holds
     set confirmed_at = now(),
         confirmed_by = actor
   where id = p_hold_id;

  update students
     set participation_status = 'on_hold'
   where id = h.student_id
     and participation_status = 'active';

  return h.student_id;
end;
$$;

grant execute on function request_self_placed_hold to authenticated;
grant execute on function confirm_student_hold     to authenticated;
