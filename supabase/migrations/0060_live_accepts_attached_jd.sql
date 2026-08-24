-- A drive whose JD is the recruiter's attached PDF may go live.
--
-- J1 (2026-08-18, answer 2) made the typed job description optional — the
-- attached PDF is the document of record. The 2026-08-24 morning fix taught
-- `missingBeforeGoLive` exactly that, and missed this constraint: 0004's
-- `live_requires_complete_record` still said `job_description is not null`.
-- So the live Infosys drive passed every checklist tick and the publish
-- PATCH died on a refusal the screen then swallowed ("Could not publish the
-- drive. Please try again.").
--
-- The rule, stated once more: a domain rule and its database twin change
-- together or not at all.
--
-- Restated VERBATIM from 0004 (the 0054 lesson: copy, diff, then change the
-- one clause) with a single edit: the JD requirement is satisfied by EITHER
-- the typed text OR the attached PDF — mirroring DriveReadiness.
--
-- Re-adding the constraint validates every existing row; all current live
-- rows carry typed text (they predate J1's optionality), so nothing fails.

alter table drives
  drop constraint live_requires_complete_record,
  add constraint live_requires_complete_record check (
    status in ('draft', 'submitted', 'approved', 'rejected')
    or (
      not on_hold
      and role_title is not null
      and (job_description is not null or jd_storage_path is not null)
      and work_locations is not null and ctc_min_lpa is not null
      and role_category is not null and drive_type is not null
      and (drive_type = 'internship' or offer_category is not null)
      and application_start is not null and application_end is not null
    )
  );
