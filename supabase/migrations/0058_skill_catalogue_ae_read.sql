-- The AE reads the assessed-skills catalogue.
--
-- Spec 2026-08-21 part A, approved 2026-08-24 (Karthik: "Only these skills
-- should be selectable by the account executive when raising the PIF.
-- Anything outside this list he has to call it out as other skills.").
--
-- The PIF's free-text mandatory skills produced a live drive that said
-- "Coding, Testing" while the repository's areas have other names — so every
-- applicant read "Scored on 0 of 2 required skills" no matter how strong they
-- were. The picker needs the catalogue NAMES; nothing more.
--
-- Deliberately narrow: SELECT on `skill_areas` alone. The AE still reads no
-- row of `student_skill_scores` (0037's policy untouched) — the scores are
-- the institution's private evaluation, and the AE is the person talking to
-- recruiters.

create policy skill_areas_ae_read on skill_areas for select
  using (current_app_role() = 'account_executive');
