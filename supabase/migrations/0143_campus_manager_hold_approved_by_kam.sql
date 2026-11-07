-- 0143_campus_manager_hold_approved_by_kam.sql
--
-- Flow: Hold option handling is done by Campus Manager and approved by KAM (Key Account Manager).
--
-- 1. Campus Manager initiates/places the hold (fees, pause, idle, self_placed).
--    The hold is created in a pending state (confirmed_at is null, confirmed_by is null).
--    The student's status remains active and drives stay open until KAM approves.
--
-- 2. Key Account Manager (or admin) assigned to the student's campus approves the hold.
--    confirm_student_hold stamps confirmed_at, confirmed_by, and flips student's status to 'on_hold'.
--
-- 3. Release/decline: Campus Manager, Key Account Manager, or admin may release an active hold
--    or decline a pending request.
--
-- 4. RLS: Key Account Manager can read student_holds and hold-orders storage for their assigned campuses.

-- Relax constraint to permit staff-placed unconfirmed holds awaiting KAM approval:
alter table student_holds drop constraint if exists hold_request_has_evidence;
alter table student_holds
  add constraint hold_request_has_evidence
  check (
    confirmed_at is not null
    or (kind = 'self_placed' and held_by is null and document_id is not null and declaration_id is not null)
    or (held_by is not null)
  );

-- ---------------------------------------------------------------------------
-- 1. place_student_hold (Campus Manager initiates)
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

  if exists (select 1 from student_holds where student_id = p_student_id and released_at is null) then
    raise exception '% already has a hold, or a request waiting on them.', v_name;
  end if;

  -- Inserts unconfirmed row (pending KAM approval). Drives stay open until KAM confirms.
  insert into student_holds (
    student_id, kind, reason, starts_at, ends_at, document_id, held_by, confirmed_at, confirmed_by
  )
  values (
    p_student_id, p_kind, trim(p_reason), coalesce(p_starts_at, current_date),
    p_ends_at, p_document_id, actor, null, null
  )
  returning id into hold;

  return hold;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. confirm_student_hold (Approved by KAM for staff holds, KAM/CM for student requests)
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

  select * into h from student_holds where id = p_hold_id for update;

  if h.id is null then
    raise exception 'No such hold.';
  end if;

  -- Maker-checker enforcement:
  -- Staff-placed holds (held_by is not null) MUST be approved by KAM (or admin).
  -- Student-filed self-placement requests (held_by is null) may be confirmed by KAM, CM, or admin.
  if h.held_by is not null then
    if current_app_role() not in ('key_account_manager', 'admin') then
      raise exception 'Only a Key Account Manager may approve a placement hold.'
        using errcode = '42501';
    end if;
  else
    if current_app_role() not in ('key_account_manager', 'campus_manager', 'admin') then
      raise exception 'Only a Campus Manager may confirm a placement hold.'
        using errcode = '42501';
    end if;
  end if;

  if current_app_role() <> 'admin' and not (h.student_id in (
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

-- ---------------------------------------------------------------------------
-- 3. release_student_hold (Campus Manager, Key Account Manager, or Admin)
-- ---------------------------------------------------------------------------
create or replace function release_student_hold(
  p_hold_id      uuid,
  p_release_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid;
  h     student_holds;
begin
  select id into actor from profiles where id = auth.uid() and is_active;
  if actor is null then
    raise exception 'A hold is released by a signed-in staff member.'
      using errcode = '42501';
  end if;

  if current_app_role() not in ('campus_manager', 'key_account_manager', 'admin') then
    raise exception 'Only a Campus Manager or Key Account Manager may release a placement hold.'
      using errcode = '42501';
  end if;

  select * into h from student_holds where id = p_hold_id for update;

  if h.id is null then
    raise exception 'No such hold.';
  end if;

  if current_app_role() <> 'admin' and not (h.student_id in (
        select s.id from students s where s.campus_id in (select my_campus_ids()))) then
    raise exception 'You may only release a hold at a college you are assigned to.'
      using errcode = '42501';
  end if;

  if h.released_at is not null then
    raise exception 'This hold was already released on %.', h.released_at::date;
  end if;

  update student_holds
     set released_by  = actor,
         released_at  = now(),
         release_note = nullif(trim(coalesce(p_release_note, '')), '')
   where id = p_hold_id;

  if h.confirmed_at is not null then
    update students
       set participation_status = 'active'
     where id = h.student_id
       and participation_status = 'on_hold';
  end if;

  return h.student_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS for Key Account Manager to read student_holds and hold orders
-- ---------------------------------------------------------------------------
drop policy if exists kam_reads_assigned_college_holds on student_holds;
create policy kam_reads_assigned_college_holds
  on student_holds for select
  using (
    current_app_role() = 'key_account_manager'
    and student_id in (
      select s.id from students s where s.campus_id in (select my_campus_ids())
    )
  );

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    return;
  end if;

  execute $p$ drop policy if exists "college staff read hold orders" on storage.objects $p$;
  execute $p$
    create policy "college staff read hold orders" on storage.objects for select
      using (
        bucket_id = 'hold-orders'
        and (
          public.is_org_reader()
          or (
            public.current_app_role() in ('campus_manager', 'key_account_manager')
            and (storage.foldername(name))[1] in (
              select s.id::text from public.students s
               where s.campus_id in (select public.my_campus_ids())
            )
          )
        )
      )
  $p$;
end;
$$;

grant execute on function place_student_hold   to authenticated;
grant execute on function confirm_student_hold to authenticated;
grant execute on function release_student_hold to authenticated;

-- Tighten staff document writes so campus staff can only insert/update resumes and hold orders
drop policy if exists documents_write_staff on public.student_documents;
create policy documents_write_staff on public.student_documents
  for all
  using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
  with check (
    (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
    and (is_operator() or kind in ('resume', 'hold_order'))
  );
