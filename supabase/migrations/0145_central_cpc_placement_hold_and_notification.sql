-- 0145_central_cpc_placement_hold_and_notification.sql
--
-- Only Central Placement Coordinator (and admin) may place, confirm, and release placement holds.
-- When a student is placed on hold or released, an in-app notification and email are dispatched to them.

-- 1. place_student_hold (Central Placement Coordinator directly places hold)
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

  if current_app_role() not in ('central_placement_coordinator', 'admin') then
    raise exception 'Only the Central Placement Coordinator may place a placement hold.'
      using errcode = '42501';
  end if;

  select campus_id, participation_status, full_name
    into campus, state, v_name
    from students where id = p_student_id;

  if campus is null then
    raise exception 'No such student.';
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

  -- Central CPC hold is directly confirmed upon placement
  insert into student_holds (
    student_id, kind, reason, starts_at, ends_at, document_id, held_by, confirmed_at, confirmed_by
  )
  values (
    p_student_id, p_kind, trim(p_reason), coalesce(p_starts_at, current_date),
    p_ends_at, p_document_id, actor, now(), actor
  )
  returning id into hold;

  update students
     set participation_status = 'on_hold'
   where id = p_student_id
     and participation_status = 'active';

  -- Dispatch in-app notification (which enqueues student email)
  insert into notifications (student_id, kind, title, body)
  values (
    p_student_id,
    'placement_hold',
    'Placement Participation on Hold',
    'Your placement participation has been put on hold (' || coalesce(p_kind::text, 'hold') || '). Reason: ' || trim(p_reason) || case when p_ends_at is not null then '. Review date: ' || to_char(p_ends_at, 'DD Mon YYYY') else '' end || '. Please contact your central placement coordinator for details.'
  );

  return hold;
end;
$$;

-- 2. confirm_student_hold (Central Placement Coordinator or Admin)
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

  if current_app_role() not in ('central_placement_coordinator', 'admin') then
    raise exception 'Only the Central Placement Coordinator may confirm a placement hold.'
      using errcode = '42501';
  end if;

  select * into h from student_holds where id = p_hold_id for update;

  if h.id is null then
    raise exception 'No such hold.';
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

  insert into notifications (student_id, kind, title, body)
  values (
    h.student_id,
    'placement_hold',
    'Placement Participation on Hold',
    'Your placement participation has been put on hold (' || coalesce(h.kind::text, 'hold') || '). Reason: ' || trim(h.reason) || case when h.ends_at is not null then '. Review date: ' || to_char(h.ends_at, 'DD Mon YYYY') else '' end || '. Please contact your central placement coordinator for details.'
  );

  return h.student_id;
end;
$$;

-- 3. release_student_hold (Central Placement Coordinator or Admin)
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

  if current_app_role() not in ('central_placement_coordinator', 'admin') then
    raise exception 'Only the Central Placement Coordinator may release a placement hold.'
      using errcode = '42501';
  end if;

  select * into h from student_holds where id = p_hold_id for update;

  if h.id is null then
    raise exception 'No such hold.';
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

  insert into notifications (student_id, kind, title, body)
  values (
    h.student_id,
    'placement_hold_released',
    'Placement Hold Released',
    'Your placement hold has been released. You are now active in campus placements.' || case when p_release_note is not null and length(trim(p_release_note)) > 0 then ' Note: ' || trim(p_release_note) else '' end
  );

  return h.student_id;
end;
$$;

-- 4. enqueue_notification_email (allow placement hold and release notifications through to email)
create or replace function enqueue_notification_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email  text;
  v_active boolean;
  v_campus_id uuid;
  v_cc_emails text[];
begin
  SELECT email, (participation_status = 'active'), campus_id
    INTO v_email, v_active, v_campus_id
    FROM students WHERE id = NEW.student_id;

  -- Allow placement_hold and placement_hold_released notifications even if participation_status is not active
  IF (not coalesce(v_active, false) AND NEW.kind NOT IN ('placement_hold', 'placement_hold_released'))
     OR v_email IS NULL
     OR trim(v_email) = '' THEN
    RETURN NEW;
  END IF;

  v_cc_emails := resolve_cc_recipients(NEW.kind, v_campus_id, NEW.drive_id);

  INSERT INTO email_deliveries (notification_id, recipient_email, cc_emails, status)
  VALUES (NEW.id, lower(trim(v_email)), v_cc_emails, 'queued');

  RETURN NEW;
end;
$$;

-- 5. Storage policies for hold-orders bucket
do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    return;
  end if;

  execute $p$ drop policy if exists "campus managers upload hold orders" on storage.objects $p$;
  execute $p$ drop policy if exists "operators and campus staff upload hold orders" on storage.objects $p$;
  execute $p$
    create policy "operators and campus staff upload hold orders" on storage.objects for insert
      with check (
        bucket_id = 'hold-orders'
        and (
          public.is_operator()
          or (
            public.current_app_role() = 'campus_manager'
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
