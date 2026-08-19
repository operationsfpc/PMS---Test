-- 0053 — UAT 2026-08-19: the stipend, the drive's contacts, the round's own
-- schedule, the per-student meeting slot, and the advance proof.
--
-- A2: an internship pays a monthly stipend, not an annual CTC. Two integer
--     columns (₹ per month), because "3.5" in a CTC box on an internship drive
--     is how a student plans a year around money that does not exist.
-- A4: contacts leave the four spoc_* columns for their own table — a drive can
--     carry several, and "no contact" is an honest state the UI explains (the
--     Central CPC becomes the point of contact, A5).
-- F4: a round carries its mode, its time and a shared interview link, editable
--     after creation.
-- F5: a participant can carry an INDIVIDUAL link and slot (online rounds with
--     per-student time slots).
-- F3: advancing can leave a proof of the company's instruction behind.

-- --------------------------------------------------------------- stipend (A2)

alter table drives
  add column if not exists stipend_min_monthly integer,
  add column if not exists stipend_max_monthly integer;

alter table drives
  add constraint stipend_is_positive check (
    (stipend_min_monthly is null or stipend_min_monthly > 0)
    and (stipend_max_monthly is null or stipend_max_monthly > 0)
  ),
  add constraint stipend_range_ascends check (
    stipend_min_monthly is null
    or stipend_max_monthly is null
    or stipend_max_monthly >= stipend_min_monthly
  );

-- --------------------------------------------------------- drive contacts (A4)

create table if not exists drive_contacts (
  drive_id    uuid not null references drives(id) on delete cascade,
  sequence    integer not null check (sequence > 0),
  name        text,
  designation text,
  email       text,
  phone       text,
  primary key (drive_id, sequence)
);

alter table drive_contacts enable row level security;

grant select, insert, update, delete on drive_contacts to authenticated;

-- Staff read them; a student never does. A recruiter's direct line handed to
-- six hundred students is a recruiter who stops answering the coordinator.
create policy drive_contacts_staff_read on drive_contacts for select
  using (current_app_role() is not null);

-- Writes follow the drive's own ownership: the AE while it is theirs, the
-- Delivery Head and the operators always — the same shape drive_rounds uses.
create policy drive_contacts_write on drive_contacts for all
  using (
    is_operator()
    or current_app_role() = 'delivery_head'
    or exists (
      select 1 from drives d
      where d.id = drive_contacts.drive_id
        and current_app_role() = 'account_executive'
        and d.created_by = auth.uid()
    )
  )
  with check (
    is_operator()
    or current_app_role() = 'delivery_head'
    or exists (
      select 1 from drives d
      where d.id = drive_contacts.drive_id
        and current_app_role() = 'account_executive'
        and d.created_by = auth.uid()
    )
  );

-- ------------------------------------------- the round's own details (F4, F3)

alter table drive_rounds
  add column if not exists round_mode text,
  add column if not exists round_scheduled_at timestamptz,
  add column if not exists round_interview_link text,
  add column if not exists advance_proof_path text;

alter table drive_rounds
  add constraint round_mode_is_known check (
    round_mode is null
    or round_mode in ('on_campus', 'virtual', 'physical_outside_campus')
  );

-- ------------------------------------------- the participant's own slot (F5)

alter table round_participants
  add column if not exists meeting_link text,
  add column if not exists participant_scheduled_at timestamptz;

-- ------------------------------------------------- the proof's bucket (F3)
--
-- Guarded exactly like 0051, so the PGlite harness (no storage schema) can
-- still run every other migration.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('advance-proofs', 'advance-proofs', false, 5242880,
          array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  -- Staff only, both ways: the proof is the company's instruction to move
  -- students, and no student has any business reading or writing it.
  execute $p$ drop policy if exists "staff read advance proofs" on storage.objects $p$;
  execute $p$
    create policy "staff read advance proofs" on storage.objects for select
      using (bucket_id = 'advance-proofs' and public.current_app_role() is not null)
  $p$;

  execute $p$ drop policy if exists "operators attach advance proofs" on storage.objects $p$;
  execute $p$
    create policy "operators attach advance proofs" on storage.objects for insert
      with check (bucket_id = 'advance-proofs' and public.is_operator())
  $p$;
end $$;
