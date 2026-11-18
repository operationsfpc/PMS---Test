-- =============================================================================
-- Migration 0152: Harden round notifications and participant scheduling to shortlisted candidates only
-- =============================================================================
-- Issue: When rounds are scheduled or candidates are moved to subsequent rounds,
-- notifications and emails must NEVER be sent to students who were not shortlisted
-- (shortlist_entries.included = false or missing), or who did not clear previous rounds.
--
-- 1. round_details_reach_students():
--    Enforces that only active students whose applications:
--    a) Are in round_participants for the round being scheduled,
--    b) Have an explicit shortlist entry with included = true, AND
--    c) For sequence > 1, were marked 'selected' in the preceding round,
--    receive the 'round_scheduled' notification.
--
-- 2. schedule_round_participants():
--    Enforces that only applications belonging to the target round's drive,
--    with shortlist_entries.included = true, and (for sequence > 1) with
--    round_results.result = 'selected' in the preceding round, can be inserted
--    into round_participants and attendance.
--
-- 3. meeting_slot_reaches_student():
--    Enforces that candidates must be shortlisted (included = true) to receive
--    meeting link / slot updates.
-- =============================================================================

-- 1. Update round_details_reach_students()
CREATE OR REPLACE FUNCTION round_details_reach_students()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company text;
  v_body text;
BEGIN
  IF NEW.round_mode IS NOT DISTINCT FROM OLD.round_mode
     AND NEW.round_scheduled_at IS NOT DISTINCT FROM OLD.round_scheduled_at
     AND NEW.round_interview_link IS NOT DISTINCT FROM OLD.round_interview_link
     AND NEW.venue IS NOT DISTINCT FROM OLD.venue THEN
    RETURN NEW;  -- renames and proofs are not schedule news
  END IF;

  SELECT company_name INTO v_company FROM drives WHERE id = NEW.drive_id;

  v_body := 'Round ' || NEW.sequence || ' (' || NEW.name || ') of ' || v_company
    || CASE WHEN NEW.round_scheduled_at IS NOT NULL
            THEN ' is scheduled for '
              || TO_CHAR(NEW.round_scheduled_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
              || ' IST'
            ELSE ' has updated details' END
    || CASE WHEN NEW.round_mode IS NOT NULL
            THEN '. Mode: ' || REPLACE(NEW.round_mode, '_', ' ') ELSE '' END
    || CASE WHEN NEW.round_mode = 'virtual' AND NEW.round_interview_link IS NOT NULL AND LENGTH(TRIM(NEW.round_interview_link)) > 0
            THEN '. Join at: ' || TRIM(NEW.round_interview_link)
            WHEN NEW.round_mode IN ('on_campus', 'physical_outside_campus') AND NEW.venue IS NOT NULL AND LENGTH(TRIM(NEW.venue)) > 0
            THEN '. Venue: ' || TRIM(NEW.venue)
            ELSE '' END
    || '. Please report on time.';

  INSERT INTO notifications (student_id, kind, title, body)
  SELECT a.student_id, 'round_scheduled',
         v_company || ' — Round ' || NEW.sequence || ' schedule', v_body
    FROM round_participants rp
    JOIN applications a ON a.id = rp.application_id
    JOIN students s ON s.id = a.student_id
   WHERE rp.round_id = NEW.id
     AND s.participation_status = 'active'
     -- Rule 1: MUST be explicitly shortlisted for this drive
     AND EXISTS (
       SELECT 1 FROM shortlist_entries se
        WHERE se.application_id = a.id
          AND se.included = true
     )
     -- Rule 2: If sequence > 1, MUST have cleared the previous round
     AND (
       NEW.sequence = 1
       OR EXISTS (
         SELECT 1 FROM round_results rr
         JOIN drive_rounds prior ON prior.id = rr.round_id
         WHERE rr.application_id = a.id
           AND prior.drive_id = NEW.drive_id
           AND prior.sequence = NEW.sequence - 1
           AND rr.result = 'selected'
       )
     );

  RETURN NEW;
END;
$$;

-- 2. Update schedule_round_participants()
CREATE OR REPLACE FUNCTION schedule_round_participants(
  p_round_id uuid,
  p_application_ids uuid[],
  p_added_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold text;
  v_target_drive uuid;
  v_target_seq int;
BEGIN
  -- Date gate check from migration 0139
  SELECT
    target.drive_id,
    target.sequence,
    FORMAT(
      'Round %s (%s) is scheduled for %s and has not been held yet — advance it once that time has passed.',
      prior.sequence,
      prior.name,
      TO_CHAR(
        prior.round_scheduled_at AT TIME ZONE 'Asia/Kolkata',
        'DD Mon YYYY, FMHH12:MI AM'
      )
    )
    INTO v_target_drive, v_target_seq, v_hold
  FROM drive_rounds target
  LEFT JOIN drive_rounds prior
    ON prior.drive_id = target.drive_id
   AND prior.sequence = target.sequence - 1
  WHERE target.id = p_round_id
    AND prior.round_scheduled_at IS NOT NULL
    AND prior.round_scheduled_at > now();

  IF v_hold IS NOT NULL THEN
    RAISE EXCEPTION '%', v_hold USING errcode = 'check_violation';
  END IF;

  -- Only schedule applications that:
  -- 1. Belong to this drive
  -- 2. Are included in the shortlist
  -- 3. If target sequence > 1, have 'selected' result in the prior round
  INSERT INTO round_participants (round_id, application_id, added_by)
  SELECT p_round_id, a.id, p_added_by
  FROM unnest(p_application_ids) aid
  JOIN applications a ON a.id = aid
  JOIN shortlist_entries se ON se.application_id = a.id AND se.included = true
  WHERE a.drive_id = (SELECT drive_id FROM drive_rounds WHERE id = p_round_id)
    AND (
      (SELECT sequence FROM drive_rounds WHERE id = p_round_id) = 1
      OR EXISTS (
        SELECT 1 FROM round_results rr
        JOIN drive_rounds prior ON prior.id = rr.round_id
        WHERE rr.application_id = a.id
          AND prior.drive_id = a.drive_id
          AND prior.sequence = (SELECT sequence - 1 FROM drive_rounds WHERE id = p_round_id)
          AND rr.result = 'selected'
      )
    )
  ON CONFLICT (round_id, application_id) DO NOTHING;

  INSERT INTO attendance (round_id, application_id, status)
  SELECT p_round_id, rp.application_id, 'scheduled'::attendance_status
  FROM round_participants rp
  WHERE rp.round_id = p_round_id
    AND rp.application_id = ANY(p_application_ids)
  ON CONFLICT (round_id, application_id) DO NOTHING;
END;
$$;

-- 3. Update meeting_slot_reaches_student()
CREATE OR REPLACE FUNCTION meeting_slot_reaches_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student           uuid;
  v_company           text;
  v_sequence          integer;
  v_out_of_placements boolean;
  v_is_shortlisted    boolean;
  v_has_url           boolean;
  v_has_time          boolean;
  v_title             text;
  v_body              text;
BEGIN
  IF NEW.meeting_link IS NOT DISTINCT FROM OLD.meeting_link
     AND NEW.participant_scheduled_at IS NOT DISTINCT FROM OLD.participant_scheduled_at THEN
    RETURN NEW;
  END IF;
  IF NEW.meeting_link IS NULL AND NEW.participant_scheduled_at IS NULL THEN
    RETURN NEW;  -- clearing a slot is housekeeping, not news
  END IF;

  SELECT a.student_id, d.company_name, r.sequence,
         s.participation_status <> 'active',
         EXISTS (SELECT 1 FROM shortlist_entries se WHERE se.application_id = a.id AND se.included = true)
    INTO v_student, v_company, v_sequence, v_out_of_placements, v_is_shortlisted
    FROM applications a
    JOIN drives d ON d.id = a.drive_id
    JOIN students s ON s.id = a.student_id
    JOIN drive_rounds r ON r.id = NEW.round_id
   WHERE a.id = NEW.application_id;

  IF v_out_of_placements OR NOT v_is_shortlisted THEN
    RETURN NEW;
  END IF;

  v_has_url  := NEW.meeting_link IS NOT NULL AND NEW.meeting_link ~* '^https?://';
  v_has_time := NEW.participant_scheduled_at IS NOT NULL;

  IF v_has_time OR v_has_url THEN
    v_title := v_company || ' — your Round ' || v_sequence || ' slot';
  ELSE
    v_title := v_company || ' — Round ' || v_sequence || ' update';
  END IF;

  v_body := 'Your Round ' || v_sequence || ' of ' || v_company
    || CASE WHEN v_has_time
            THEN ' is at '
              || TO_CHAR(NEW.participant_scheduled_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
              || ' IST'
            ELSE '' END
    || CASE WHEN v_has_url
            THEN '. Your meeting link: ' || NEW.meeting_link
            WHEN NEW.meeting_link IS NOT NULL AND LENGTH(TRIM(NEW.meeting_link)) > 0
            THEN '. Note: ' || TRIM(NEW.meeting_link)
            ELSE '' END
    || CASE WHEN v_has_time OR v_has_url
            THEN '. Please report on time.'
            ELSE '' END;

  INSERT INTO notifications (student_id, kind, title, body)
  VALUES (
    v_student,
    'meeting_link',
    v_title,
    v_body
  );

  RETURN NEW;
END;
$$;
