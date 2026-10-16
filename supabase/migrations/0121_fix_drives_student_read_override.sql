-- 0121 — Fix drives_student_read RLS Policy for open_to_all_override
--
-- Background:
-- When a drive has open_to_all_override = true, the domain logic (src/domain/visibility.ts)
-- explicitly bypasses the student role category and drive type preference filters so that
-- all eligible students at targeted campuses can view and apply to the drive.
--
-- However, the database SELECT RLS policy 'drives_student_read' (from migration 0050)
-- was missing an 'open_to_all_override = true' clause:
--   and (
--     role_category is null
--     or not exists (select 1 from student_role_preferences p where p.student_id = current_student_id())
--     or exists (select 1 from student_role_preferences p where p.student_id = current_student_id() and p.category = drives.role_category)
--   )
--
-- This caused PostgreSQL to hide open-to-all drives from any student who had selected
-- different role categories on their registration form.
--
-- This migration updates 'drives_student_read' to allow students to read drives
-- when open_to_all_override is true.

DROP POLICY IF EXISTS drives_student_read ON public.drives;

CREATE POLICY drives_student_read ON public.drives FOR SELECT
  USING (
    current_student_id() IS NOT NULL
    AND status IN ('live', 'applications_closed', 'in_rounds', 'completed')
    AND (
      NOT EXISTS (SELECT 1 FROM drive_target_campuses t WHERE t.drive_id = drives.id)
      OR EXISTS (
        SELECT 1 FROM drive_target_campuses t
        JOIN students me ON me.id = current_student_id()
        WHERE t.drive_id = drives.id AND t.campus_id = me.campus_id
      )
    )
    AND (
      open_to_all_override = true
      OR role_category IS NULL
      OR NOT EXISTS (SELECT 1 FROM student_role_preferences p WHERE p.student_id = current_student_id())
      OR EXISTS (
        SELECT 1 FROM student_role_preferences p
        WHERE p.student_id = current_student_id() AND p.category = drives.role_category
      )
    )
  );

COMMENT ON POLICY drives_student_read ON public.drives IS
  'Allows students to view published drives matching their campus, role preferences, or open-to-all override';
