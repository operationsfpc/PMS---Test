-- 0154_fix_drive_deadline_reminders_eligibility.sql
-- Fixes send_drive_deadline_reminders() to enforce the full drive eligibility criteria:
--   1. Target campuses, eligible degrees, and eligible branches (with degree scoping)
--   2. Eligible passing years (batch)
--   3. Academic cutoffs: 10th %, 12th %, verified CGPA, and arrears policy (standing & history)
--   4. Student role category preferences (student_role_preferences)
--   5. Student drive type preferences (drive_type_preferences)
--   6. Placement ladder & internship cap (bypassed if open_to_all_override is true)
--   7. Sibling role application guard (0147)
-- Prevents sending deadline reminder emails to students who are not eligible for the drive.

CREATE OR REPLACE FUNCTION public.send_drive_deadline_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_drive RECORD;
  v_student RECORD;
  v_notification_id UUID;
BEGIN
  -- Find live drives closing in the next 24 hours
  FOR v_drive IN
    SELECT d.id, d.company_name, d.role_title, d.application_end, d.ctc_max_lpa,
           d.ctc_min_lpa, d.role_category, d.drive_type, d.offer_category,
           d.open_to_all_override, d.min_overall_cgpa, d.min_tenth_percentage,
           d.min_twelfth_percentage, d.arrears_policy, d.eligible_passing_years,
           d.company_drive_id, d.tentative_date
    FROM drives d
    WHERE d.status = 'live'
      AND d.application_end BETWEEN now() AND now() + interval '24 hours'
  LOOP
    -- Send only to genuinely eligible students who have not applied yet
    FOR v_student IN
      SELECT s.id, s.email, s.full_name
      FROM students s
      LEFT JOIN LATERAL (
        SELECT m.cgpa, m.current_arrears
        FROM student_semesters m
        WHERE m.student_id = s.id AND m.status = 'verified'
        ORDER BY m.semester_number DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT max(m.history_of_arrears) as history_of_arrears
        FROM student_semesters m
        WHERE m.student_id = s.id AND m.status = 'verified'
      ) hist ON true
      WHERE s.srf_status = 'srf_approved'
        AND s.participation_status = 'active'

        -- Campus targeting
        AND (
          NOT EXISTS (SELECT 1 FROM drive_target_campuses dtc WHERE dtc.drive_id = v_drive.id)
          OR EXISTS (
            SELECT 1 FROM drive_target_campuses dtc
            WHERE dtc.drive_id = v_drive.id AND dtc.campus_id = s.campus_id
          )
        )

        -- Degree targeting
        AND (
          NOT EXISTS (SELECT 1 FROM drive_eligible_degrees ded WHERE ded.drive_id = v_drive.id)
          OR EXISTS (
            SELECT 1 FROM drive_eligible_degrees ded
            WHERE ded.drive_id = v_drive.id AND ded.degree_id = s.degree_id
          )
        )

        -- Branch targeting (0137: degree-scoped branches)
        AND (
          NOT EXISTS (SELECT 1 FROM drive_eligible_branches deb WHERE deb.drive_id = v_drive.id)
          OR (
            EXISTS (SELECT 1 FROM drive_eligible_degrees ded WHERE ded.drive_id = v_drive.id)
            AND NOT EXISTS (
              SELECT 1 FROM drive_eligible_branches deb
              JOIN branches br ON br.id = deb.branch_id
              WHERE deb.drive_id = v_drive.id AND br.degree_id = s.degree_id
            )
          )
          OR EXISTS (
            SELECT 1 FROM drive_eligible_branches deb
            WHERE deb.drive_id = v_drive.id AND deb.branch_id = s.branch_id
          )
        )

        -- Passing year targeting
        AND (
          array_length(v_drive.eligible_passing_years, 1) IS NULL
          OR s.passing_year = ANY(v_drive.eligible_passing_years)
        )

        -- Academic marks criteria (10th / 12th)
        AND (
          v_drive.min_tenth_percentage IS NULL
          OR (s.tenth_percentage IS NOT NULL AND s.tenth_percentage >= v_drive.min_tenth_percentage)
        )
        AND (
          v_drive.min_twelfth_percentage IS NULL
          OR (s.twelfth_percentage IS NOT NULL AND s.twelfth_percentage >= v_drive.min_twelfth_percentage)
        )

        -- Academic CGPA and arrears criteria (verified semesters with declared fallback)
        AND (
          v_drive.min_overall_cgpa IS NULL
          OR COALESCE(latest.cgpa, s.overall_cgpa, 0) >= v_drive.min_overall_cgpa
        )
        AND (
          v_drive.arrears_policy = 'flexible'
          OR COALESCE(latest.current_arrears, s.current_arrears, 0) = 0
        )
        AND (
          v_drive.arrears_policy <> 'no_history'
          OR CASE WHEN latest.cgpa IS NOT NULL
                  THEN COALESCE(hist.history_of_arrears, 0)
                  ELSE COALESCE(s.history_of_arrears, 0)
             END = 0
        )

        -- Student Role Category Preference (ALWAYS ENFORCED)
        AND (
          v_drive.role_category IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM student_role_preferences p WHERE p.student_id = s.id
          )
          OR EXISTS (
            SELECT 1 FROM student_role_preferences p
            WHERE p.student_id = s.id AND p.category = v_drive.role_category
          )
        )

        -- Student Drive Type Preference (ALWAYS ENFORCED)
        AND (
          v_drive.drive_type IS NULL
          OR COALESCE(cardinality(s.drive_type_preferences), 0) = 0
          OR v_drive.drive_type = ANY(s.drive_type_preferences)
        )

        -- Placement Ladder & Internship Cap
        AND (
          v_drive.open_to_all_override
          OR (
            -- Plain internship cap
            (
              v_drive.drive_type <> 'internship'
              OR NOT EXISTS (
                SELECT 1 FROM offers o
                WHERE o.student_id = s.id
                  AND o.drive_type in ('internship', 'internship_convertible')
              )
            )
            -- Offer category ladder
            AND (
              v_drive.drive_type NOT IN ('placement', 'internship_convertible')
              OR v_drive.offer_category IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM offers o
                WHERE o.student_id = s.id
                  AND o.drive_type in ('placement', 'internship_convertible')
                  AND o.offer_category IS NOT NULL
                  AND CASE o.offer_category
                        WHEN 'regular' THEN 1 WHEN 'dream' THEN 2 WHEN 'super_dream' THEN 3
                      END
                    >= CASE v_drive.offer_category
                        WHEN 'regular' THEN 1 WHEN 'dream' THEN 2 WHEN 'super_dream' THEN 3
                      END
              )
            )
          )
        )

        -- Has NOT applied to this drive
        AND NOT EXISTS (
          SELECT 1 FROM applications a
          WHERE a.drive_id = v_drive.id AND a.student_id = s.id
        )

        -- Has NOT applied to a sibling role under same company drive event (0147)
        AND NOT EXISTS (
          SELECT 1
          FROM applications a
          JOIN drives sibling ON sibling.id = a.drive_id
          WHERE a.student_id = s.id
            AND a.drive_id <> v_drive.id
            AND (
              (v_drive.company_drive_id IS NOT NULL AND sibling.company_drive_id = v_drive.company_drive_id)
              OR (
                v_drive.company_name IS NOT NULL
                AND v_drive.tentative_date IS NOT NULL
                AND sibling.tentative_date = v_drive.tentative_date
                AND lower(trim(regexp_replace(sibling.company_name, '\s+', ' ', 'g'))) = lower(trim(regexp_replace(v_drive.company_name, '\s+', ' ', 'g')))
              )
            )
        )

        -- Dedup guard: skip students already reminded about this drive's deadline
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.drive_id = v_drive.id
            AND n.student_id = s.id
            AND n.kind = 'drive_deadline_reminder'
        )
    LOOP
      -- Insert notification
      INSERT INTO notifications (student_id, kind, title, body, drive_id)
      VALUES (
        v_student.id,
        'drive_deadline_reminder',
        'Closing Soon: Applications for ' || v_drive.company_name || ' Close in 24 Hours',
        'This is a reminder that applications for **' || v_drive.company_name || '** (' || COALESCE(v_drive.role_title, 'Placement Opportunity') || ') will close tomorrow at **' || TO_CHAR(v_drive.application_end, 'DD Mon YYYY, HH24:MI') || '**.' || E'\n\n' ||
        '**Drive Highlights**' || E'\n' ||
        '• **Role:** ' || COALESCE(v_drive.role_title, 'Placement Opportunity') || E'\n' ||
        '• **Compensation:** ₹' || COALESCE(v_drive.ctc_max_lpa::text, v_drive.ctc_min_lpa::text, 'N/A') || ' LPA' || E'\n' ||
        '• **Application Deadline:** ' || TO_CHAR(v_drive.application_end, 'DD Mon YYYY, HH24:MI') || E'\n\n' ||
        'If you meet the eligibility criteria and wish to participate, please complete your application before the window closes.',
        v_drive.id
      ) RETURNING id INTO v_notification_id;

      -- Ensure email outbox row exists if notification trigger is skipped
      IF v_student.email IS NOT NULL AND trim(v_student.email) <> '' THEN
        INSERT INTO email_deliveries (notification_id, recipient_email, status)
        VALUES (v_notification_id, lower(trim(v_student.email)), 'queued')
        ON CONFLICT (notification_id, recipient_email) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.send_drive_deadline_reminders() IS
  'S12: Hourly cron that reminds eligible students about drives closing in 24 hours. Respects career preferences, academics, and offer ladder.';
