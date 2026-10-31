-- 0134 — Withdrawing an offer puts the student back in the funnel, and the
-- withdrawal keeps a name, a date and a reason the student can read.
--
-- WHY THIS EXISTS
--   A placement is a row in `offers` (0006:3-32) and nothing else, so "this
--   student is no longer placed" has to mean "that row is gone". Today it can
--   be made gone by any coordinator, campus manager or operator with an
--   ordinary DELETE: 0018:79-82 leaves `offers_write_staff` as a `for all`
--   policy. Nothing is asked for, nothing is kept except the audit before-image
--   (0007:64, staff-only), and the student finds their placement vanished with no
--   explanation. The request was that a placed student be put back to normal by
--   a CAM, a KAM or the CPC "with reason", and that the history be shown to
--   them — which for a placed student is exactly this act.
--
-- WHY ARCHIVE-AND-DELETE, NOT A withdrawn_at COLUMN
--   Every reader of "placed" is a query over `offers`: the apply gates
--   (0041:95, 0119:222, 0126:662), the placement totals (0064:77-89), the drive
--   caps, the round notifiers, the statistics, and the student's own placements
--   screen. A flag would require each of them to remember
--   `where withdrawn_at is null`, and a missed one is a wrong count that reports
--   itself as fine. Deleting the row makes all of them correct at the same
--   instant, and `offer_withdrawals` is what makes the deletion accountable
--   rather than destructive.
--
-- WHO MAY DO IT
--   The three roles the request named — campus_placement_coordinator,
--   campus_manager, key_account_manager — scoped to my_student_ids(), plus
--   is_operator() (admin, central_placement_coordinator).
--   NOTE THE DIFFERENCE FROM 0133, which refused the operators: those roles can
--   DELETE an offer today, so refusing them here would take a working action
--   away rather than putting one back. What they lose is the silence.
--   The KAM keeps the same single write it was given in 0133, and the same
--   deviation from 0018:20's "KAM reads, campus staff writes" is disclosed there.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   It changes no participation_status. A placed student is already 'active' —
--   placement lives in `offers`, not in the enum — and the two status moves this
--   project now has are restore_participation (0133, opted_out -> active) and
--   release_student_hold (0125:169-224, on_hold -> active). This adds no third.
--   It releases no hold. A student confirmed onto a self_placed hold (0130:253)
--   keeps it when their offer is withdrawn, because a hold is closed by
--   release_student_hold and nothing else; the record screen has to offer both
--   actions, and says so.
--   No notification, no mail, for the same reason as 0133: the history is
--   shown, not broadcast.
--
-- DISCLOSED SIDE EFFECTS
--   1. placement_record_overrides.offer_id cascades (0006:37-43), and 0007 does
--      not audit that table, so a Central "this is their reported record" choice
--      would vanish unrecorded. The RPC therefore copies the override row into
--      the archive (record_override) before deleting the offer.
--   2. The offer letter object stays in Storage. 0051's order is object-then-row
--      and an orphan object is invisible and cheap; the archive keeps
--      attachment_path, so the letter a withdrawal is written against is still
--      reachable by the staff and the student who can read it.
--   3. A self-placed offer's approval lives in `self_placement_requests`, which
--      has no link to the `offers` row it produced (0014, 0130:236). That request
--      stays 'approved' after the withdrawal. Nothing re-approves it — the queue
--      reads pending rows — but it is history, not a live claim, and the
--      withdrawal is the row that says what the placement is now.
--   4. `delete on offers` is revoked from `authenticated` (0008:149 granted only
--      select/insert/update, but Supabase's own default privileges grant DELETE
--      on public tables, so the door was open in the project and shut only by
--      policy). `service_role` is untouched: a server-side import can still
--      remove a row, as it can for every table here.

-- ---------------------------------------------------------------------------
-- The archive. One row per offer removed, and the student reads their own.
-- ---------------------------------------------------------------------------
create table offer_withdrawals (
  id           uuid primary key default gen_random_uuid(),
  -- Not a FK: the row it describes is the one this function deletes. The
  -- snapshot below is the evidence; this is the key that says what it was.
  offer_id     uuid not null,
  student_id   uuid not null references students(id) on delete cascade,

  -- The handful of columns the screens show without parsing the snapshot.
  drive_id     uuid,
  source       offer_source not null,
  company_name text not null,
  role_title   text,
  ctc_lpa      numeric(6,2) not null,

  reason       text not null check (char_length(trim(reason)) between 1 and 1000),

  withdrawn_by uuid not null references profiles(id),
  withdrawn_at timestamptz not null default now(),

  -- The offer exactly as it was, so a withdrawn placement can be reconstructed
  -- and the totals run that dropped it can be argued with.
  offer           jsonb not null,
  record_override jsonb,

  -- A withdrawal that archives somebody else's offer is a mis-keyed insert.
  constraint withdrawal_archives_the_offer_it_names
    check (offer_id = ((offer ->> 'id')::uuid))
);

create index offer_withdrawals_student_idx
  on offer_withdrawals (student_id, withdrawn_at desc);

-- ---------------------------------------------------------------------------
-- Read. No insert/update/delete policy: withdraw_offer is the only way in, and
-- it runs as its owner — the shape 0133 sets for participation_status_changes.
-- The record is kept after the fact rather than expiring with it, because a
-- placement that was taken back is the kind of thing a college is asked about
-- a year later.
-- ---------------------------------------------------------------------------
alter table offer_withdrawals enable row level security;
alter table offer_withdrawals force row level security;

create policy student_reads_own_offer_withdrawals
  on offer_withdrawals for select
  using (student_id = current_student_id());

create policy campus_readers_see_their_own_colleges_withdrawals
  on offer_withdrawals for select
  using (
    is_campus_reader()
    and student_id in (select my_student_ids())
  );

create policy org_readers_see_every_offer_withdrawal
  on offer_withdrawals for select
  using (is_org_reader());

grant select on offer_withdrawals to authenticated;

-- PRD 19. audit_row (0007:18-57) reads `id`/`student_id` and a generic `reason`
-- column, both of which this table has.
create trigger audit_offer_withdrawals
  after insert on offer_withdrawals
  for each row execute function audit_row();

-- ---------------------------------------------------------------------------
-- The silent door, shut. `for all` made every writer a deleter; a placement is
-- now removed by a function that asks why. Two policies, because one policy
-- covers one command.
-- ---------------------------------------------------------------------------
drop policy if exists offers_write_staff on offers;

create policy offers_write_staff_insert on offers for insert to authenticated
  with check (
    is_operator() or (is_campus_staff() and student_id in (select my_student_ids()))
  );

create policy offers_write_staff_update on offers for update to authenticated
  using (
    is_operator() or (is_campus_staff() and student_id in (select my_student_ids()))
  )
  with check (
    is_operator() or (is_campus_staff() and student_id in (select my_student_ids()))
  );

revoke delete on table offers from authenticated;

-- ---------------------------------------------------------------------------
-- The write.
-- ---------------------------------------------------------------------------
create or replace function withdraw_offer(p_offer_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor        uuid;
  v_offer      offers%ROWTYPE;
  v_override   jsonb;
  v_withdrawal uuid;
begin
  -- Repeated here rather than trusted to the caller: this function holds rights
  -- the caller does not, so a refusal must be a sentence, not zero rows.
  select id into actor from profiles where id = auth.uid() and is_active;
  if actor is null then
    raise exception 'An offer is withdrawn by a signed-in staff member.'
      using errcode = '42501';
  end if;

  if not (
    is_operator()
    or current_app_role() in (
      'campus_placement_coordinator', 'campus_manager', 'key_account_manager'
    )
  ) then
    raise exception
      'Only a campus placement coordinator, a campus manager, a key account manager or a central operator may withdraw an offer.'
      using errcode = '42501';
  end if;

  -- The reason is what makes this a decision rather than a DELETE. The student
  -- reads it, so it is demanded here, in the same 1000 characters 0133 gives the
  -- restore and the opt-out shares.
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Say why the offer is being withdrawn. The student is shown this.';
  end if;
  if char_length(trim(p_reason)) > 1000 then
    raise exception 'The reason must fit in 1000 characters.';
  end if;

  select * into v_offer from offers where id = p_offer_id;
  if v_offer.id is null then
    raise exception 'No such offer.';
  end if;

  if not (is_operator() or v_offer.student_id in (select my_student_ids())) then
    raise exception 'You may only withdraw an offer of a student at a college you are assigned to.'
      using errcode = '42501';
  end if;

  select to_jsonb(o) into v_override
    from placement_record_overrides o where o.offer_id = v_offer.id;

  insert into offer_withdrawals (
    offer_id, student_id, drive_id, source, company_name, role_title, ctc_lpa,
    reason, withdrawn_by, offer, record_override
  )
  values (
    v_offer.id, v_offer.student_id, v_offer.drive_id, v_offer.source,
    v_offer.company_name, v_offer.role_title, v_offer.ctc_lpa,
    trim(p_reason), actor, to_jsonb(v_offer), v_override
  )
  returning id into v_withdrawal;

  delete from offers where id = p_offer_id;

  return v_withdrawal;
end;
$$;

grant execute on function withdraw_offer to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK (paste-ready, and it only undoes what this file did):
--
--   revoke execute on function withdraw_offer(uuid, text) from authenticated;
--   drop function withdraw_offer(uuid, text);
--   drop trigger if exists audit_offer_withdrawals on offer_withdrawals;
--   drop table offer_withdrawals;
--
--   grant delete on table offers to authenticated;
--   drop policy if exists offers_write_staff_insert on offers;
--   drop policy if exists offers_write_staff_update on offers;
--   create policy offers_write_staff on offers for all
--     using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
--     with check (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())));
-- ---------------------------------------------------------------------------
--
-- CHECK IT LANDED (read-only, safe to paste after applying):
--   select polname, polcmd from pg_policy where polrelid = 'offers'::regclass order by polname;
--     -- offers_read_self (S), offers_read_staff (S), offers_read_drive_owner (S),
--     --    offers_write_staff_insert (I), offers_write_staff_update (U).
--     -- There must be no `D` row and no policy still called offers_write_staff.
--   select relacl from pg_class where relname = 'offers';
--     -- the authenticated entry must read /arwd=... with no D:
--     --    {authenticated=arwd/...} becomes {authenticated=arw/...}
--   select count(*) from offer_withdrawals;
--     -- 0 before anyone withdraws anything, then one row per offer removed.
-- ---------------------------------------------------------------------------
