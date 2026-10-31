-- 0133 — A coordinator, a campus manager or a KAM may return an opted-out
-- student to the pipeline, and the student reads who did it and why.
--
-- WHY THIS EXISTS
--   Opting out is written as a permanent act. 0006:45 calls it
--   "student-initiated only, CPC-approved, IRREVERSIBLE" and 0009:138-151 puts
--   that in the database as a BEFORE UPDATE trigger. In practice the decision
--   gets made on wrong information: a student opts out because they think they
--   are placed, or because a fee demand they were told about was never put in
--   front of them, and the only way back is for somebody with database access
--   to run SQL. This makes the way back a staff action with a name, a date and
--   a reason on it — and shows all three to the student, which is what the
--   request asked for ("cpc can change them to normal with reason and that
--   history should be shown for students").
--
-- THE GUARD, AND WHY IT IS NOT SIMPLY DROPPED
--   enforce_opt_out_irreversible is a plain BEFORE UPDATE trigger with no role
--   test in it. Triggers run whatever the row's writer is, so it refuses a
--   SECURITY DEFINER function just as surely as it refuses the student. Dropping
--   it to let the RPC through would also let every other path through, and the
--   irreversibility is the point of PRD 16.1 — a student who can flip the flag
--   to dodge one drive and back for the next makes the roster untrustworthy.
--   So the guard stays, and gains one narrow exception: the transition is
--   allowed when the transaction carries a marker that only restore_participation
--   sets, for that one student. A direct `update students set
--   participation_status = 'active'` — by the student, by any other role, by any
--   future screen that forgot the rule — is still refused with a sentence.
--   The marker is transaction-local (set_config(..., true)), so it cannot leak
--   into another request on the same connection.
--   The refusal keeps 0009's word "irreversible" in it on purpose: security
--   suite (src/db/security.test.ts:199) asserts on that sentence, and PRD 16.1's
--   promise is still exactly what it was — irreversible through every path a
--   client can take, reversible only by a named staff member giving a reason.
--
-- WHO MAY DO IT
--   campus_placement_coordinator, campus_manager, key_account_manager — the
--   three the request named. All three are already is_campus_reader() (0018:30)
--   and all three are scoped by my_student_ids(), so a KAM returns a student at
--   a college mapped to them and nobody else's. NOTE THE DEVIATION: 0018:20 sets
--   "KAM reads, campus staff writes", and this hands the KAM one write. It is
--   deliberate and it is the only write the KAM gets; everything else about
--   student standing still belongs to is_campus_staff().
--   central_placement_coordinator and admin are NOT granted here: the ask named
--   the campus trio, and an organisation-wide undo button on every student is a
--   bigger door than the one that was asked for.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   on_hold -> active is already release_student_hold's (0125:169-224) and this
--   refuses it aloud rather than leaving two buttons that do one job.
--   disbarred is a Central sanction (0006:60) and no campus role may lift it.
--   No notification, no mail (0123 and 0129 stopped staff mail, and the request
--   was for the history to be shown, not broadcast).
--
-- DISCLOSED SIDE EFFECTS
--   1. A restored student starts receiving drive mail again by itself:
--      enqueue_notification_email (0126:85-115) drops mail for any student who
--      is not 'active' at :102. That is the intent of the restore, but it does
--      mean the student's inbox is not quiet just because nothing was sent at
--      the moment of the change.
--   2. A student who is restored and opts out AGAIN used to be blocked by
--      one_approved_opt_out_per_student (0006:56), a unique partial index over
--      every 'verified' request they will ever have. opt_out_requests therefore
--      gains reversed_at/reversed_by, the index only counts unreversed
--      approvals, and restore_participation stamps the open approval. Their
--      first opt-out stays on record; it simply stops reserving the slot.
--      notify_student_of_opt_out_decision (0093:16) early-returns unless the
--      status itself moves, so the stamp sends nothing.
--   3. Every gate that 0126 widened from '= opted_out' to '<> active' flips back
--      with the status: the student is shortlistable, includable in a DAF and
--      able to apply again from the moment of the change. That is the feature.

-- ---------------------------------------------------------------------------
-- The history. Append-only, and the student reads it.
-- ---------------------------------------------------------------------------
create table participation_status_changes (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,

  from_status  participation_status not null,
  to_status    participation_status not null,

  -- The reason is what makes this a decision rather than a edit. It is demanded
  -- here, not in the browser, because this function is security definer and the
  -- browser is not the only caller.
  reason       text not null check (char_length(trim(reason)) between 1 and 1000),

  changed_by   uuid not null references profiles(id),
  changed_at   timestamptz not null default now(),

  -- A row that records no change is a lie in an audit table.
  constraint change_actually_changes check (from_status is distinct from to_status)
);

-- The student's own record page and the staff history block both ask "everything
-- that happened to this student's standing, newest first".
create index participation_changes_student_idx
  on participation_status_changes (student_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- Read. No insert/update/delete policy: restore_participation is the only way
-- in, and it runs as its owner — the shape 0125:230 sets for student_holds.
--
-- Unlike a hold, the history is NOT hidden once it is spent. 0125:236-238 shows
-- a student only their live hold; here the whole ledger is visible, because a
-- reason that vanishes when the decision is over is exactly the erasure this
-- table exists to prevent.
-- ---------------------------------------------------------------------------
alter table participation_status_changes enable row level security;
alter table participation_status_changes force row level security;

create policy student_reads_own_participation_changes
  on participation_status_changes for select
  using (student_id = current_student_id());

-- Campus roles see their own colleges' changes. is_campus_reader() rather than
-- is_campus_staff(), because a KAM who returns a student must be able to read
-- what a coordinator did to the same student a month later.
create policy campus_staff_reads_own_college_changes
  on participation_status_changes for select
  using (
    is_campus_reader()
    and student_id in (select my_student_ids())
  );

create policy org_readers_see_every_participation_change
  on participation_status_changes for select
  using (is_org_reader());

grant select on participation_status_changes to authenticated;

-- PRD 19. audit_row (0007:18-57) reads `id`/`student_id` and a generic `reason`
-- column, both of which this table has.
create trigger audit_participation_changes
  after insert on participation_status_changes
  for each row execute function audit_row();

-- ---------------------------------------------------------------------------
-- An approved opt-out that has been undone must stop reserving the student's
-- one slot (side effect 2 above). Attributed as a release is in 0125:77-78:
-- who and when move together, or neither happened.
-- ---------------------------------------------------------------------------
alter table opt_out_requests
  add column if not exists reversed_by uuid references profiles(id),
  add column if not exists reversed_at timestamptz;

alter table opt_out_requests
  drop constraint if exists opt_out_reversal_is_attributed;
alter table opt_out_requests
  add constraint opt_out_reversal_is_attributed
  check ((reversed_at is null) = (reversed_by is null));

drop index if exists one_approved_opt_out_per_student;
create unique index one_approved_opt_out_per_student
  on opt_out_requests (student_id)
  where status = 'verified' and reversed_at is null;

-- ---------------------------------------------------------------------------
-- The write.
-- ---------------------------------------------------------------------------
create or replace function restore_participation(
  p_student_id uuid,
  p_reason     text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor    uuid;
  state    participation_status;
  v_name   text;
  v_change uuid;
begin
  -- Repeated here rather than trusted to the caller, in the words 0125:115-118
  -- uses for the same reason: this function holds rights the caller does not,
  -- and a refusal here is a sentence instead of zero rows.
  select id into actor from profiles where id = auth.uid() and is_active;
  if actor is null then
    raise exception 'A participation status is restored by a signed-in staff member.'
      using errcode = '42501';
  end if;

  if current_app_role() not in
     ('campus_placement_coordinator', 'campus_manager', 'key_account_manager') then
    raise exception 'Only a Campus Placement Coordinator, a Campus Manager or a Key Account Manager may return a student to the pipeline.'
      using errcode = '42501';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Say why the student is coming back. The reason is shown to them.'
      using errcode = 'check_violation';
  end if;

  -- Same ceiling as the student's own opt-out reason (MAX_OPT_OUT_REASON), so
  -- neither side gets a field the other cannot fill.
  if char_length(trim(p_reason)) > 1000 then
    raise exception 'The reason must fit in 1000 characters.'
      using errcode = 'check_violation';
  end if;

  select participation_status, full_name
    into state, v_name
    from students where id = p_student_id;

  if not found then
    raise exception 'No such student.';
  end if;

  if p_student_id not in (select my_student_ids()) then
    raise exception 'You may only return a student at a college you are assigned to.'
      using errcode = '42501';
  end if;

  -- 'opted_out' only. A held student is released, not restored; a disbarred
  -- student is a Central decision; an active student has nothing to do.
  if state <> 'opted_out' then
    raise exception '% is not opted out (status: %), so there is nothing to return.',
      v_name, state;
  end if;

  -- The marker the amended guard looks for, set BEFORE the update it authorises
  -- and cleared after it. Transaction-local, so it cannot outlive this call.
  perform set_config('app.participation_restore', p_student_id::text, true);

  insert into participation_status_changes
    (student_id, from_status, to_status, reason, changed_by)
  values
    (p_student_id, 'opted_out', 'active', trim(p_reason), actor)
  returning id into v_change;

  update students
     set participation_status = 'active'
   where id = p_student_id;

  -- Free the slot, and leave the original decision readable.
  update opt_out_requests
     set reversed_at = now(),
         reversed_by = actor
   where student_id = p_student_id
     and status = 'verified'
     and reversed_at is null;

  perform set_config('app.participation_restore', '', true);

  return v_change;
end;
$$;

grant execute on function restore_participation to authenticated;

-- ---------------------------------------------------------------------------
-- The guard, amended. Same name, same trigger, same refusal — one exception,
-- and it is narrow: the student named in the marker, leaving opted_out, in a
-- transaction that marker opened.
-- ---------------------------------------------------------------------------
create or replace function enforce_opt_out_irreversible() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.participation_status = 'opted_out' and new.participation_status <> 'opted_out' then
    if coalesce(current_setting('app.participation_restore', true), '') <> new.id::text then
      raise exception
        'Opting out is irreversible except through restore_participation, which records who, why and which student.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run by hand if this migration is ever undone; nothing here is
-- applied for you)
--
--   drop trigger  if exists audit_participation_changes on participation_status_changes;
--   drop function if exists restore_participation(uuid, text);
--   drop table    if exists participation_status_changes cascade;
--
--   alter table opt_out_requests
--     drop constraint if exists opt_reversal_is_attributed,
--     drop constraint if exists opt_out_reversal_is_attributed;
--   alter table opt_out_requests
--     drop column if exists reversed_by,
--     drop column if exists reversed_at;
--   drop index if exists one_approved_opt_out_per_student;
--   create unique index one_approved_opt_out_per_student
--     on opt_out_requests (student_id) where status = 'verified';
--
--   -- then re-apply 0009:138-147's body verbatim:
--   create or replace function enforce_opt_out_irreversible() returns trigger
--   language plpgsql set search_path = public as $$
--   begin
--     if old.participation_status = 'opted_out' and new.participation_status <> 'opted_out' then
--       raise exception 'Opting out is irreversible; the student cannot rejoin placements.'
--         using errcode = 'check_violation';
--     end if;
--     return new;
--   end;
--   $$;
--
-- CHECK IT LANDED (read-only, safe to paste after applying):
--   select pg_get_indexdef('one_approved_opt_out_per_student'::regclass);
--     -- must end: WHERE ((status = 'verified') AND (reversed_at IS NULL))
--   select prosrc from pg_proc where proname = 'enforce_opt_out_irreversible';
--     -- must mention app.participation_restore: the amended guard, not 0009's
-- ---------------------------------------------------------------------------
