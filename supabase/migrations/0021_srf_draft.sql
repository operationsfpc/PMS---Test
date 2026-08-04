-- Save the registration form as a draft.
--
-- UAT 2026-08-05: "the registration form does not save the student's progress
-- as a draft. An auto-save or Save as Draft feature should be implemented so
-- students can continue the registration later without losing their data."
--
-- The draft is the student's own working copy of a form they have not sent
-- yet, so it lives on their row and inherits the policies that already protect
-- it: theirs to write, nobody else's to read, and visible to the coordinator
-- who has to help when they get stuck.
--
-- It carries NO authority. Eligibility never reads it, verification never
-- reads it, and `protect_verified_academics` still governs every column that
-- matters - a student cannot smuggle an approval or a mark into a draft,
-- because the draft is one opaque jsonb column and the guarded columns are not
-- in it. Submitting remains the only thing that moves the form forward.

alter table students
  add column if not exists srf_draft          jsonb,
  add column if not exists srf_draft_saved_at timestamptz;

comment on column students.srf_draft is
  'The student''s unsent registration form. No authority: never read by '
  'eligibility or verification. Cleared when the form is submitted.';
