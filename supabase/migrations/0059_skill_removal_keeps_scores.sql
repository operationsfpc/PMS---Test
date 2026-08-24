-- Skills assessed (2026-08-24, answer 1a): remove only while no scores exist.
--
-- 0037 made student_skill_scores.skill_area_id ON DELETE CASCADE — right for
-- an admin-corrective delete that happened over SQL with eyes open, wrong the
-- moment a Remove button exists: one click would silently destroy every
-- evaluation recorded under that skill. RESTRICT makes the database refuse
-- what canRemoveSkillArea refuses, so the rule holds even against direct SQL.
--
-- Renaming stays free — scores reference the id, so they follow the name.

alter table student_skill_scores
  drop constraint student_skill_scores_skill_area_id_fkey,
  add constraint student_skill_scores_skill_area_id_fkey
    foreign key (skill_area_id) references skill_areas(id) on delete restrict;
