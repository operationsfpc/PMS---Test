-- 0125_student_placement_holds.sql
--
-- A Campus Manager bars one of their own students from drives: fees unpaid, a
-- offer taken off campus, or simply not trying. Dated, reasoned, releasable.
--
-- WHAT THIS IS NOT, stated first because the neighbours are close:
--   opt_out_requests (0006:45) is the STUDENT'S decision, and 0009:141 makes it
--     irreversible. A hold is the college's decision and 0009 does not touch it.
--   disbarment_decisions (0006:59) is a Central CPC sanction for absences.
--   drives.on_hold (0004:48) stops a DRIVE. This stops a STUDENT.
--   self_placement_requests (0014:13) is a student raising their own offer for
--     verification, which becomes an `offers` row. The 'self_placed' kind here is
--     the manager acting on what they already know, with no request and no offer.
--
-- WHY participation_status CARRIES THE BITE (0124 added the label):
--   The refusal is already stated as `participation_status <> 'active'` in
--   enforce_application_gates (0119:80) and as `= 'active'` in the drive-live
--   fan-out (0119:331) and the reminders (0114:47,118). A fourth state joins
--   those with no edit, so a held student cannot apply and is never mailed about
--   a new drive. 0126 widens the five places that test `= 'opted_out'` — the
--   email outbox and the round notices — which a new state would otherwise slip
--   past. The alternative, a predicate added to each gate, would have to be
--   remembered by every notifier written after this one.
--
--   So the status is the effect and this table is the cause. Neither is
--   authoritative alone: the hold says why, who and until when; the status is
--   what the gates read. place_student_hold and release_student_hold are the
--   only way to move either, which is why they are functions and not policies.
--
-- WHY THE WINDOW DOES NOT RELEASE ANYTHING:
--   ends_at is a review date, not a switch. The student stays on hold until a
--   Campus Manager presses Release, and the roster marks the date overdue. A
--   sweep that flipped participation_status on a timer would need pg_cron, which
--   this project has already been burned by once (0104 removed the cron email
--   dispatcher for marking mail sent without delivery), and a date crossing
--   inside a background job is a state change nobody signed. If the end date is
--   to bind, say so and this becomes a scheduled function on a timer.
--
-- WHY held_by HAS NO ON DELETE:
--   0015:16-20 is the precedent and it is deliberate — profiles.id is referenced
--   plainly by drives.created_by, approved_by and published_by, so Postgres
--   refuses to delete a staff member whose work is on record and the admin
--   screen turns that into "deactivate instead". Attribution (PRD 19) outranks
--   convenience. `on delete set null` would erase who barred a student.
--
-- WHAT THE STUDENT SEES:
--   Their own live hold — kind, reason, window — through
--   "student reads own live hold". Not the attachment: hold-orders is missing
--   from the student policies in 0022:79-101 on purpose, so a fee demand stays
--   with the college that wrote it. This is not a notification and sends no
--   mail. Without it, the drives screen is simply empty, which is the failure
--   this repo has spent a month fixing ("let every read refuse aloud").

create type hold_kind as enum ('fees', 'self_placed', 'idle');

create table student_holds (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  kind         hold_kind not null,
  reason       text not null check (trim(reason) <> ''),
  starts_at    date not null default current_date,
  ends_at      date,
  document_id  uuid references student_documents(id) on delete set null,

  held_by      uuid not null references profiles(id),
  held_at      timestamptz not null default now(),

  released_by  uuid references profiles(id),
  released_at  timestamptz,
  release_note text,

  -- A hold that ends before it starts is a typo in a date field.
  constraint hold_window_is_ordered check (ends_at is null or ends_at >= starts_at),

  -- released_at and released_by move together or not at all: a released hold
  -- with no name on it is the erased attribution 0015 refuses elsewhere.
  constraint hold_release_is_attributed
    check ((released_at is null) = (released_by is null)),

  -- A note without a release is nothing.
  constraint hold_note_needs_release
    check (release_note is null or released_at is not null)
);

-- One live hold per student. A second `fees` hold on top of an `idle` one would
-- leave the screen guessing which reason is the operative one, and the release
-- button unable to say what it is lifting.
create unique index one_live_hold_per_student
  on student_holds (student_id)
  where released_at is null;

-- The roster's "on hold" filter and the student record both ask this question
-- by student, and the partial index above answers it.
create index student_holds_history_idx on student_holds (student_id, held_at desc);

-- ---------------------------------------------------------------------------
-- Place
-- ---------------------------------------------------------------------------
create or replace function place_student_hold(
  p_student_id  uuid,
  p_kind        hold_kind,
  p_reason      text,
  p_starts_at   date default current_date,
  p_ends_at     date default null,
  p_document_id uuid  default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor  uuid;
  campus uuid;
  state  participation_status;
  v_name text;
  hold   uuid;
begin
  -- Every check below is repeated inside the function rather than trusted to
  -- the browser, because the function is security definer and therefore runs
  -- with rights the caller does not have. RLS would refuse the write anyway;
  -- refusing here is what gives the caller a sentence instead of zero rows.
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

  -- Their own college, by the seat on staff_campus_assignments — the same
  -- scoping 0008:63 and 0018:58 use. A Campus Manager with no seat holds nobody,
  -- which is correct and worth knowing before the screen is demoed.
  if not (campus in (select my_campus_ids())) then
    raise exception 'You may only hold a student at a college you are assigned to.'
      using errcode = '42501';
  end if;

  -- 'active' only. An opted-out student cannot be held, because releasing the
  -- hold would set them active and 0009:141 forbids leaving opted_out — the
  -- placement screen would look broken and the student would be stuck. A
  -- disbarred student is already barred by a stronger, Central decision.
  if state <> 'active' then
    raise exception '% is not in placements right now (status: %), so there is nothing to hold.',
      v_name, state;
  end if;

  insert into student_holds (student_id, kind, reason, starts_at, ends_at, document_id, held_by)
  values (p_student_id, p_kind, trim(p_reason), coalesce(p_starts_at, current_date),
          p_ends_at, p_document_id, actor)
  returning id into hold;

  update students set participation_status = 'on_hold' where id = p_student_id;

  return hold;
end;
$$;

-- ---------------------------------------------------------------------------
-- Release
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

  if current_app_role() <> 'campus_manager' then
    raise exception 'Only a Campus Manager may release a placement hold.'
      using errcode = '42501';
  end if;

  select * into h from student_holds where id = p_hold_id for update;

  if h.id is null then
    -- Not "no such hold": a manager reading another college's id must not learn
    -- it exists. student_holds has no select policy for them either, so this is
    -- the same answer they would get from a list.
    raise exception 'No such hold.';
  end if;

  if not (h.student_id in (
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

  -- `and participation_status = 'on_hold'` is the whole point of this line.
  -- If the student was disbarred, or opted out on their own way, while the hold
  -- was on, lifting the hold must not silently undo the stronger decision.
  update students
     set participation_status = 'active'
   where id = h.student_id
     and participation_status = 'on_hold';

  return h.student_id;
end;
$$;

grant execute on function place_student_hold   to authenticated;
grant execute on function release_student_hold to authenticated;

-- ---------------------------------------------------------------------------
-- Read. No insert/update/delete policy: the two functions above are the only
-- way in, and they run as their owner.
-- ---------------------------------------------------------------------------
alter table student_holds enable row level security;
alter table student_holds force  row level security;

create policy student_reads_own_live_hold
  on student_holds for select
  using (student_id = current_student_id() and released_at is null);

create policy campus_manager_reads_own_college_holds
  on student_holds for select
  using (
    current_app_role() = 'campus_manager'
    and student_id in (
      select s.id from students s where s.campus_id in (select my_campus_ids())
    )
  );

-- Central roles, admin, delivery head, CEO: the escalation path for a fee hold
-- runs through them, and a hold nobody above the college can see is a rumour.
create policy org_readers_see_every_hold
  on student_holds for select
  using (is_org_reader());

grant select on student_holds to authenticated;

-- ---------------------------------------------------------------------------
-- Audit (PRD 19). 0007's generic trigger reads a `reason` column, which this
-- table has, so both the placement and the release land in audit_log with the
-- actor taken from auth.uid(). The `students` flip is already covered by
-- audit_students. Note what the log's reason column holds for a release row:
-- the original reason they were held, not the note that lifted it — that lives
-- on the row in release_note, where the screen can show both.
-- ---------------------------------------------------------------------------
create trigger audit_holds
  after insert or update on student_holds
  for each row execute function audit_row();

-- ---------------------------------------------------------------------------
-- The optional attachment. Private, and named by the student whose hold it is.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hold-orders', 'hold-orders', false, 5242880,
          array['application/pdf','image/jpeg','image/png'])
  on conflict (id) do update
    set file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public             = false;

  execute $p$ drop policy if exists "campus managers upload hold orders" on storage.objects $p$;
  execute $p$
    create policy "campus managers upload hold orders" on storage.objects for insert
      with check (
        bucket_id = 'hold-orders'
        and public.current_app_role() = 'campus_manager'
        and (storage.foldername(name))[1] in (
          select s.id::text from public.students s
           where s.campus_id in (select public.my_campus_ids())
        )
      )
  $p$;

  execute $p$ drop policy if exists "college staff read hold orders" on storage.objects $p$;
  execute $p$
    create policy "college staff read hold orders" on storage.objects for select
      using (
        bucket_id = 'hold-orders'
        and (
          public.is_org_reader()
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
end $$;
