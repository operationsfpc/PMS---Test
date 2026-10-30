-- 0132 — Staff Manage Student Preferences and Resumes
--
-- Enables staff (Central CPC, Campus Placement Coordinators, Campus Managers, Admins)
-- to manage student role category preferences, drive type preferences, and category resumes
-- directly from the individual student record page (/students/:studentId).

-- 1. Allow staff to write to student_role_preferences
DROP POLICY IF EXISTS role_preferences_write_staff ON public.student_role_preferences;
CREATE POLICY role_preferences_write_staff ON public.student_role_preferences
  FOR ALL
  USING (is_operator() OR (is_campus_staff() AND student_id IN (SELECT my_student_ids())))
  WITH CHECK (is_operator() OR (is_campus_staff() AND student_id IN (SELECT my_student_ids())));

-- 2. Allow staff to write to student_documents (for resumes and student documents)
DROP POLICY IF EXISTS documents_write_staff ON public.student_documents;
CREATE POLICY documents_write_staff ON public.student_documents
  FOR ALL
  USING (is_operator() OR (is_campus_staff() AND student_id IN (SELECT my_student_ids())))
  WITH CHECK (is_operator() OR (is_campus_staff() AND student_id IN (SELECT my_student_ids())));

-- 3. Allow staff to upload resumes to the storage bucket
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $p$ DROP POLICY IF EXISTS "staff upload resumes" ON storage.objects $p$;
  EXECUTE $p$
    CREATE POLICY "staff upload resumes" ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = 'resumes'
        AND current_app_role() IS NOT NULL
      )
  $p$;

  EXECUTE $p$ DROP POLICY IF EXISTS "staff update resumes" ON storage.objects $p$;
  EXECUTE $p$
    CREATE POLICY "staff update resumes" ON storage.objects
      FOR UPDATE
      USING (
        bucket_id = 'resumes'
        AND current_app_role() IS NOT NULL
      )
  $p$;
END $$;

-- 4. Atomic function to sync student role categories and drive type preferences
CREATE OR REPLACE FUNCTION public.staff_update_student_preferences(
  p_student_id UUID,
  p_role_categories text[],
  p_drive_type_preferences text[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT (is_operator() OR (is_campus_staff() AND p_student_id IN (SELECT my_student_ids()))) THEN
    RAISE EXCEPTION 'Not authorised to update preferences for this student';
  END IF;

  UPDATE public.students
  SET drive_type_preferences = p_drive_type_preferences::drive_type[],
      updated_at = NOW()
  WHERE id = p_student_id;

  DELETE FROM public.student_role_preferences WHERE student_id = p_student_id;

  IF p_role_categories IS NOT NULL AND array_length(p_role_categories, 1) > 0 THEN
    INSERT INTO public.student_role_preferences (student_id, category)
    SELECT p_student_id, unnest(p_role_categories)::role_category;
  END IF;
END;
$$;

-- 5. Helper function for staff to save or replace a student resume
CREATE OR REPLACE FUNCTION public.staff_save_student_resume(
  p_student_id UUID,
  p_role_category role_category,
  p_storage_path TEXT,
  p_size_bytes INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT (is_operator() OR (is_campus_staff() AND p_student_id IN (SELECT my_student_ids()))) THEN
    RAISE EXCEPTION 'Not authorised to save resume for this student';
  END IF;

  DELETE FROM public.student_documents
  WHERE student_id = p_student_id
    AND kind = 'resume'
    AND role_category = p_role_category
    AND drive_id IS NULL;

  INSERT INTO public.student_documents (student_id, kind, role_category, storage_path, size_bytes)
  VALUES (p_student_id, 'resume', p_role_category, p_storage_path, p_size_bytes);
END;
$$;
