-- 0052 — skill scores move to the 1–5 scale.
--
-- A35 ANSWERED (Karthik, 2026-08-19): "1-5 SCALE". The 0–100 scale was an
-- assumption from the day the repository shipped (0037); the client has now
-- named the real one. Whole numbers only — a 5-point scale with fractions is
-- a 50-point scale wearing a costume, and a coordinator's 3.5 silently
-- rounded is a number nobody typed.
--
-- Safe to swap outright: student_skill_scores holds 0 rows in production
-- (read live 2026-08-19, not remembered). No backfill, no conversion — there
-- is nothing to convert, which is exactly why this lands now rather than
-- after the first assessment is imported on the wrong scale.
--
-- A36 was answered the same day ("Students do not see their scores") and
-- needs NO migration: 0037's read policy already gives students nothing.

alter table student_skill_scores
  drop constraint score_within_scale;

alter table student_skill_scores
  add constraint score_within_scale
  check (score >= 1 and score <= 5 and score = round(score));
