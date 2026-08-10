-- The Central Student Skill Repository (PRD §5). Asked for on 2026-08-06:
-- "add some skillsets to respective students on areas such as Aptitude,
-- Communication skills, Fundamentals of Programming, Data Structures and
-- Algorithms, GIT Hub strength, Programming skills, AI skills, AI assisted
-- Full stack development etc., more can be added. Central PC should be able
-- to add these fields and edit them."
--
-- Two tables, not columns on students: the areas are a catalogue the Central
-- CPC extends at will ("more can be added"), and a catalogue-as-columns needs
-- a migration per skill. These scores later feed shortlisting (R11), which is
-- why every write is audited and why a student can never read them — an
-- internal assessment that leaks is an internal shortlist that leaks.
--
-- ⚠️ ASSUMPTION — UNCONFIRMED (A35, refines A12): a score is 0–100 with at
-- most two decimals. Mirrored by parseSkillScore in src/domain/skills.ts.
-- ⚠️ ASSUMPTION — UNCONFIRMED (A36): students do not see their own scores.

-- 0003's placeholder dies with this migration. It said so itself: "the exact
-- score schema is still pending from the business" — this request IS that
-- schema arriving. Nothing has ever written a row to it (there is no write
-- path in the app and none in production), and only the shortlisting view
-- read it; that view now reads the tables below. Two parallel skill tables
-- would drift, and a drifted score decides a shortlist.
drop table skill_scores;

create table skill_areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),

  constraint skill_area_has_a_name check (btrim(name) <> '')
);

-- One area per name, compared the way a human would: case and spacing are
-- not the difference between two skills. Mirrors skillAreaKey() in
-- src/domain/skills.ts — the two must not drift.
create unique index one_skill_area_per_name
  on skill_areas (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

-- The areas asked for, verbatim (spelling normalised). Seeds, not a limit.
insert into skill_areas (name) values
  ('Aptitude'),
  ('Communication skills'),
  ('Fundamentals of Programming'),
  ('Data Structures and Algorithms'),
  ('GitHub strength'),
  ('Programming skills'),
  ('AI skills'),
  ('AI-assisted Full Stack Development');

create table student_skill_scores (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  -- Removing an area removes its scores: a score with no area is a number
  -- with no meaning, and keeping it would feed a ghost into shortlisting.
  skill_area_id uuid not null references skill_areas(id) on delete cascade,
  score         numeric(5,2) not null,
  recorded_by   uuid references profiles(id),
  recorded_at   timestamptz not null default now(),

  constraint score_within_scale check (score >= 0 and score <= 100),
  -- One score per student per area: a re-assessment REPLACES, it never
  -- accumulates. The history lives in the audit log, where it belongs.
  constraint one_score_per_student_per_area unique (student_id, skill_area_id)
);

create index student_skill_scores_student_idx on student_skill_scores (student_id);
create index student_skill_scores_area_idx    on student_skill_scores (skill_area_id);

alter table skill_areas          enable row level security;
alter table skill_areas          force  row level security;
alter table student_skill_scores enable row level security;
alter table student_skill_scores force  row level security;

-- The catalogue: staff-wide read (a campus CPC discussing a student's scores
-- must see the same column names the Central CPC scored under); writes are
-- the operator's (admin + Central CPC — is_operator(), 0008).
create policy skill_areas_staff_read on skill_areas for select
  using (is_org_reader() or is_campus_reader());

create policy skill_areas_operator_insert on skill_areas for insert
  with check (is_operator());
create policy skill_areas_operator_update on skill_areas for update
  using (is_operator()) with check (is_operator());
create policy skill_areas_operator_delete on skill_areas for delete
  using (is_operator());

-- Scores: org-wide roles read everything; campus roles read their own
-- students only (the 0018 pattern — an unscoped read here would un-scope the
-- campus scoping of students, exactly the hole 0018 closed). Students read
-- NOTHING: A36, these are internal assessments feeding an internal shortlist.
create policy skill_scores_staff_read on student_skill_scores for select
  using (is_org_reader() or (is_campus_reader() and student_id in (select my_student_ids())));

create policy skill_scores_operator_insert on student_skill_scores for insert
  with check (is_operator());
create policy skill_scores_operator_update on student_skill_scores for update
  using (is_operator()) with check (is_operator());
create policy skill_scores_operator_delete on student_skill_scores for delete
  using (is_operator());

grant select, insert, update, delete on skill_areas          to authenticated;
grant select, insert, update, delete on student_skill_scores to authenticated;

-- Every write audited (PRD §19): these numbers decide who reaches a
-- recruiter, so "who changed this score, from what, to what, when" must be
-- answerable. audit_row() reads new/old 'id' generically.
create trigger audit_skill_scores
  after insert or update or delete on student_skill_scores
  for each row execute function audit_row();

comment on table skill_areas is
  'PRD §5: the catalogue of institutional skill areas. Seeded; Central CPC extends it.';
comment on table student_skill_scores is
  'PRD §5: one institutional score per student per area, 0-100 (A35). Feeds R11 shortlisting. Internal-only (A36).';
