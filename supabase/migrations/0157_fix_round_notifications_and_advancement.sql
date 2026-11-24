-- =============================================================================
-- Migration 0157: Fix round notifications, advancement dispatch, and de-duplication
-- =============================================================================
-- 1. schedule_round_participants():
--    When candidates advance to Round 2+ or are scheduled into a round, if the
--    round already has scheduled date, time, mode, venue, or meeting link,
--    immediately dispatch 'round_scheduled' notifications and queued emails.
--
-- 2. shortlist_reaches_student():
--    When candidates are shortlisted, if Round 1 is already scheduled, include
--    the actual schedule date, mode, venue, and link instead of a vague placeholder.
--
-- 3. round_details_reach_students():
--    Prevent duplicate notifications and emails if the exact same schedule notice
--    was already dispatched to the participant.
-- =============================================================================

-- 1. Update schedule_round_participants()
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
  v_round_rec record;
  v_body text;
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

  -- Dispatch schedule notification to newly scheduled participants if round is already scheduled
  SELECT r.sequence, r.name, r.round_scheduled_at, r.round_mode, r.round_interview_link, r.venue, d.company_name
    INTO v_round_rec
    FROM drive_rounds r
    JOIN drives d ON d.id = r.drive_id
   WHERE r.id = p_round_id;

  IF v_round_rec.round_scheduled_at IS NOT NULL OR v_round_rec.round_mode IS NOT NULL OR v_round_rec.venue IS NOT NULL OR v_round_rec.round_interview_link IS NOT NULL THEN
    v_body := 'Round ' || v_round_rec.sequence || ' (' || v_round_rec.name || ') of ' || v_round_rec.company_name
      || CASE WHEN v_round_rec.round_scheduled_at IS NOT NULL
              THEN ' is scheduled for '
                || TO_CHAR(v_round_rec.round_scheduled_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
                || ' IST'
              ELSE ' has updated schedule details' END
      || CASE WHEN v_round_rec.round_mode IS NOT NULL
              THEN '. Mode: ' || REPLACE(v_round_rec.round_mode, '_', ' ') ELSE '' END
      || CASE WHEN v_round_rec.round_mode = 'virtual' AND v_round_rec.round_interview_link IS NOT NULL AND LENGTH(TRIM(v_round_rec.round_interview_link)) > 0
              THEN '. Join at: ' || TRIM(v_round_rec.round_interview_link)
              WHEN v_round_rec.round_mode IN ('on_campus', 'physical_outside_campus') AND v_round_rec.venue IS NOT NULL AND LENGTH(TRIM(v_round_rec.venue)) > 0
              THEN '. Venue: ' || TRIM(v_round_rec.venue)
              ELSE '' END
      || '. Please report on time.';

    INSERT INTO notifications (student_id, kind, title, body)
    SELECT a.student_id, 'round_scheduled',
           v_round_rec.company_name || ' — Round ' || v_round_rec.sequence || ' schedule', v_body
      FROM applications a
      JOIN students s ON s.id = a.student_id
     WHERE a.id = ANY(p_application_ids)
       AND s.participation_status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.student_id = a.student_id
            AND n.kind = 'round_scheduled'
            AND n.body = v_body
       );
  END IF;
END;
$$;

-- 2. Update shortlist_reaches_student()
CREATE OR REPLACE FUNCTION shortlist_reaches_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_first_round uuid;
  v_company     text;
  v_student     uuid;
  v_out_of_placements boolean;
  v_round_rec   record;
  v_body        text;
begin
  select a.student_id, d.company_name, s.participation_status <> 'active'
    into v_student, v_company, v_out_of_placements
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select dr.id, dr.sequence, dr.name, dr.round_scheduled_at, dr.round_mode, dr.round_interview_link, dr.venue
    into v_round_rec
    from drive_rounds dr
    join applications a on a.drive_id = dr.drive_id
   where a.id = new.application_id
   order by dr.sequence
   limit 1;

  if new.included and (tg_op = 'INSERT' or not old.included) then
    if v_round_rec.id is not null then
      insert into round_participants (round_id, application_id, added_by)
      values (v_round_rec.id, new.application_id, new.decided_by)
      on conflict (round_id, application_id) do nothing;

      insert into attendance (round_id, application_id, status)
      values (v_round_rec.id, new.application_id, 'scheduled')
      on conflict (round_id, application_id) do nothing;
    end if;

    if not v_out_of_placements then
      if v_round_rec.id is not null and (v_round_rec.round_scheduled_at is not null or v_round_rec.round_mode is not null or v_round_rec.venue is not null or v_round_rec.round_interview_link is not null) then
        v_body := 'You are shortlisted for ' || v_company || '. Round ' || v_round_rec.sequence || ' (' || v_round_rec.name || ')'
          || case when v_round_rec.round_scheduled_at is not null
                  then ' is scheduled for '
                    || to_char(v_round_rec.round_scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
                    || ' IST'
                  else '' end
          || case when v_round_rec.round_mode is not null
                  then '. Mode: ' || replace(v_round_rec.round_mode, '_', ' ') else '' end
          || case when v_round_rec.round_mode = 'virtual' and v_round_rec.round_interview_link is not null and length(trim(v_round_rec.round_interview_link)) > 0
                  then '. Join at: ' || trim(v_round_rec.round_interview_link)
                  when v_round_rec.round_mode in ('on_campus', 'physical_outside_campus') and v_round_rec.venue is not null and length(trim(v_round_rec.venue)) > 0
                  then '. Venue: ' || trim(v_round_rec.venue)
                  else '' end
          || '. Please report on time.';
      else
        v_body := 'You are on the shortlist for ' || v_company || '. Soon you will get notified for round details. Please report on time.';
      end if;

      insert into notifications (student_id, kind, title, body)
      values (
        v_student,
        'shortlisted',
        'You are shortlisted for ' || v_company,
        v_body
      );
    end if;
  end if;

  if not new.included and tg_op = 'UPDATE' and old.included and v_round_rec.id is not null then
    delete from attendance
     where round_id = v_round_rec.id
       and application_id = new.application_id
       and status = 'scheduled'
       and marked_by is null
       and not exists (select 1 from round_results r
                        where r.round_id = v_round_rec.id
                          and r.application_id = new.application_id);
    delete from round_participants rp
     where rp.round_id = v_round_rec.id
       and rp.application_id = new.application_id
       and not exists (select 1 from attendance att
                        where att.round_id = v_round_rec.id
                          and att.application_id = new.application_id);
  end if;

  return new;
end;
$$;

-- 3. Update round_details_reach_students()
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
    RETURN NEW;
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
     AND EXISTS (
       SELECT 1 FROM shortlist_entries se
        WHERE se.application_id = a.id
          AND se.included = true
     )
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
     )
     AND NOT EXISTS (
       SELECT 1 FROM notifications n
        WHERE n.student_id = a.student_id
          AND n.kind = 'round_scheduled'
          AND n.body = v_body
     );

  RETURN NEW;
END;
$$;
