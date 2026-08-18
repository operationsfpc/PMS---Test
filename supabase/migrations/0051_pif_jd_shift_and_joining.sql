-- 0051 — the recruiter's own JD, the shift as a value, and the joining timeline
-- as a decision rather than as prose.
--
-- 2026-08-18 (Karthik):
--   "in the PIF, add an option to ATTACH a JD (job description) as PDF FILE."
--   "Shift time, instead of a text box, change to radio button - Day and Night
--    as options with time to be filled as text for night box."
--   "in offer rollout and joining timeline, instead of a large text box, have
--    radio button for immediate joining and joining later. Have a comments box
--    also for both the options."
--
-- Approved answers 1-10 (docs/specs/2026-08-18-pif-jd-attachment-shift-and-joining.md):
-- the PDF sits BESIDE the typed description and neither is mandatory; every
-- staff role AND the students who can see the drive may download it; the shift
-- gains Rotational and Flexible; one comment box PER joining option; the
-- joining choice is required at submit and its comment is not; the four live
-- drives are left exactly as they are.
--
-- ⚠️ NOTHING IS BACKFILLED. The live drives hold `shift_type = 'General'`,
-- which is what an AE typed into a free-text box. Deciding that it means "day"
-- would invent a fact no recruiter ever stated, and it would be shown to a
-- student as if somebody had checked it. `describeShift` repeats an
-- unrecognised value verbatim instead.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'joining_timeline') then
    create type joining_timeline as enum ('immediate', 'later');
  end if;
end $$;

alter table drives
  -- J1. Three columns, not one: a storage path is not a file name and neither
  -- is a size, and the AE, the Delivery Head and the student are all shown the
  -- NAME the recruiter gave it, never the timestamped path.
  add column if not exists jd_storage_path text,
  add column if not exists jd_file_name    text,
  add column if not exists jd_size_bytes   bigint,
  -- J2. `shift_type` keeps its column; only its vocabulary is new.
  add column if not exists shift_night_timing text,
  -- J3. `timeline_notes` is untouched — it is where the live drives keep their
  -- whole joining story, and answer 9 leaves them alone.
  add column if not exists joining_timeline        joining_timeline,
  add column if not exists joining_immediate_notes text,
  add column if not exists joining_later_notes     text;

-- ---------------------------------------------------------------------------
-- 2. The rules
-- ---------------------------------------------------------------------------

do $$
begin
  -- A path with no name, or a name with no path, is a link that opens nothing.
  -- The size bound mirrors the bucket's own limit, so a row can never claim an
  -- object the bucket would have refused.
  if not exists (select 1 from pg_constraint where conname = 'jd_attachment_is_whole') then
    alter table drives add constraint jd_attachment_is_whole check (
      (jd_storage_path is null and jd_file_name is null and jd_size_bytes is null)
      or (
        jd_storage_path is not null
        and jd_file_name is not null
        and jd_size_bytes between 1 and 5242880
      )
    );
  end if;

  -- NOT VALID, deliberately, and for the same reason 0022's evidence
  -- constraints were: four live drives say 'General'. The rule governs every
  -- new and updated row from today; it does not refuse to deploy over history
  -- it was never asked to judge.
  if not exists (select 1 from pg_constraint where conname = 'shift_type_is_a_known_shift') then
    alter table drives add constraint shift_type_is_a_known_shift check (
      shift_type is null or shift_type in ('day', 'night', 'rotational', 'flexible')
    ) not valid;
  end if;

  -- The hours belong to a night shift and to nothing else. A timing left behind
  -- by a switch back to Day would be read beside "Day shift" as a fact.
  --
  -- One direction only: a night shift with NO hours is refused at submission by
  -- `pifSubmitSchema`, not here, because a DRAFT is allowed to be incomplete
  -- and a draft is a row like any other.
  --
  -- 🔴 `is not distinct from`, not `=`. A check constraint passes on NULL, so
  -- `shift_type = 'night'` is NULL when no shift was chosen at all, and the
  -- whole expression evaluates to NULL — which Postgres accepts. The test that
  -- caught it puts hours on a drive with no shift; the obvious spelling of
  -- this rule let that row straight through.
  if not exists (select 1 from pg_constraint where conname = 'night_timing_belongs_to_night') then
    alter table drives add constraint night_timing_belongs_to_night check (
      shift_night_timing is null or shift_type is not distinct from 'night'
    );
  end if;

  -- Same shape, both directions (0048's board/state rule): a comment about
  -- joining next July, surviving on a drive that now says immediate, is worse
  -- than no comment at all.
  -- `is not distinct from` for the same reason as above: a comment on a drive
  -- that has chosen NOTHING must not slip through on a NULL comparison.
  if not exists (select 1 from pg_constraint where conname = 'joining_notes_match_the_choice') then
    alter table drives add constraint joining_notes_match_the_choice check (
      (joining_immediate_notes is null or joining_timeline is not distinct from 'immediate')
      and (joining_later_notes is null or joining_timeline is not distinct from 'later')
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Storage — a bucket owned by drives, not by students
-- ---------------------------------------------------------------------------
--
-- Every bucket until now has been namespaced by STUDENT id, and every policy
-- says so. A JD belongs to a drive, so this one is namespaced by DRIVE id and
-- the read rule is delegated, deliberately:
--
--   you may read the JD if you may read the drive it belongs to.
--
-- The subquery runs as the caller, so `drives`' own RLS decides — 0030 for the
-- student (a live drive targeted at them), 0008/0044 for staff. That is one
-- rule rather than two, and it cannot drift away from who can see the drive.
--
-- Guarded exactly like 0010, so the PGlite harness (which has no storage
-- schema) can still run every other migration.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('job-descriptions', 'job-descriptions', false, 5242880, array['application/pdf'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  execute $p$ drop policy if exists "read a job description with its drive" on storage.objects $p$;
  execute $p$
    create policy "read a job description with its drive" on storage.objects for select
      using (
        bucket_id = 'job-descriptions'
        and exists (
          select 1 from public.drives d
          where d.id::text = (storage.foldername(name))[1]
        )
      )
  $p$;

  -- Only staff attach one. The AE raises the PIF; nobody else needs to write
  -- here, and a student must never be able to put a document in front of a
  -- recruiter under a drive's name.
  execute $p$ drop policy if exists "staff attach a job description" on storage.objects $p$;
  execute $p$
    create policy "staff attach a job description" on storage.objects for insert
      with check (
        bucket_id = 'job-descriptions'
        and public.current_app_role() is not null
      )
  $p$;
end $$;
