-- 0129 — Remove new drive / drive approval emails for Central Placement Coordinator.
--
-- Business requirement: Central Placement Coordinators configure, approve and publish
-- drives directly in the PMS portal, so automated email alerts for new/approved drives
-- are redundant and should not be dispatched to them.

CREATE OR REPLACE FUNCTION public.notify_drive_lifecycle_roles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ae_name       text;
  v_ae_email      text;
  v_staff_rec     record;
  v_cpc_rec       record;
  v_subject       text;
  v_title         text;
  v_subtitle      text;
  v_body          text;
  v_ctc_display   text;
begin
  -- Format CTC display
  if new.ctc_min_lpa is not null and new.ctc_max_lpa is not null then
    if new.ctc_min_lpa = new.ctc_max_lpa then
      v_ctc_display := new.ctc_min_lpa::text || ' LPA';
    else
      v_ctc_display := new.ctc_min_lpa::text || ' - ' || new.ctc_max_lpa::text || ' LPA';
    end if;
  else
    v_ctc_display := 'As per policy';
  end if;

  -- Lookup Sourcing AE details
  if new.created_by is not null then
    select full_name, email into v_ae_name, v_ae_email
      from profiles
     where id = new.created_by;
  end if;

  -- A. PIF SUBMITTED -> Notify Delivery Head & ER Head
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    v_subject := 'Action Required: PIF Submitted for Review — ' || new.company_name;
    v_title := 'Placement Initiation Form Under Review';
    v_subtitle := 'A new placement drive has been submitted for classification and review.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role Title:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n' ||
              '**Sourced By (AE):** ' || coalesce(v_ae_name, 'Account Executive') || E'\n\n' ||
              'Please review the compensation structure, eligibility criteria, and approve or request revisions.';

    for v_staff_rec in
      select email, full_name from profiles where role in ('delivery_head', 'er_head') and is_active = true
      union
      select email, full_name from staff_invitations where role in ('delivery_head', 'er_head') and accepted_at is null
    loop
      perform enqueue_direct_email(
        v_staff_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_staff_rec.full_name, 'Head of Placement / ER'),
        v_body,
        'Open PIF Approvals',
        'https://pms.faceprepcampus.com/delivery-head/pif-approvals'
      );
    end loop;
  end if;

  -- B. PIF APPROVED -> Notify AE and Delivery Head / ER Head (Central CPC email removed per 0129)
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    -- 1. Notify Sourcing AE
    if v_ae_email is not null then
      v_subject := 'Good News: PIF Approved — ' || new.company_name;
      v_title := 'Placement Initiation Form Approved';
      v_subtitle := 'Your sourced drive has been approved and moved to the publishing queue.';
      v_body := '**Company:** ' || new.company_name || E'\n' ||
                '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
                '**Category:** ' || coalesce(new.offer_category::text, 'Standard') || E'\n' ||
                '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
                'Your PIF has been approved by the Delivery Head and assigned to Central Placement Coordinators for drive scheduling and campus publishing.';

      perform enqueue_direct_email(
        v_ae_email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_ae_name, 'Account Executive'),
        v_body,
        'View Sourced Drives',
        'https://pms.faceprepcampus.com/my-drives'
      );
    end if;

    -- 2. Notify Delivery Head & ER Head (Drive Transferred to Central CPC)
    v_subject := 'Drive Approved: Transferred to Central CPC — ' || new.company_name;
    v_title := 'Placement Drive Approved';
    v_subtitle := 'The drive has been approved and moved to Central Placement Coordinator for campus scheduling.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**Category:** ' || coalesce(new.offer_category::text, 'Standard') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
              'Placement Initiation Form has been approved and assigned to Central Placement Coordinators to configure campus targeting and take the drive live.';

    for v_staff_rec in
      select email, full_name from profiles where role in ('delivery_head', 'er_head') and is_active = true
      union
      select email, full_name from staff_invitations where role in ('delivery_head', 'er_head') and accepted_at is null
    loop
      perform enqueue_direct_email(
        v_staff_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_staff_rec.full_name, 'Head of Placement / ER'),
        v_body,
        'View Placement Drives',
        'https://pms.faceprepcampus.com/delivery-head/pif-approvals'
      );
    end loop;
  end if;

  -- C. PIF REJECTED -> Notify AE
  if new.status = 'rejected' and (tg_op = 'INSERT' or old.status is distinct from 'rejected') then
    if v_ae_email is not null then
      v_subject := 'Action Required: PIF Revision Requested — ' || new.company_name;
      v_title := 'PIF Requires Changes';
      v_subtitle := 'Feedback has been provided on your submitted Placement Initiation Form.';
      v_body := '**Company:** ' || new.company_name || E'\n' ||
                '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
                '**Review Feedback:** ' || coalesce(new.rejection_reason, 'Please review the submitted parameters and consult with Delivery Head.') || E'\n\n' ||
                'Please update the PIF with the requested changes and resubmit for approval.';

      perform enqueue_direct_email(
        v_ae_email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_ae_name, 'Account Executive'),
        v_body,
        'Revise PIF Details',
        'https://pms.faceprepcampus.com/ae/pif'
      );
    end if;
  end if;

  -- D. DRIVE LIVE -> Notify AE and Target Campus CPCs
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    if v_ae_email is not null then
      v_subject := 'Your Account is Live: Placement Drive Published — ' || new.company_name;
      v_title := 'Placement Drive Published';
      v_subtitle := 'Your sourced drive is now actively accepting applications.';
      v_body := '**Company:** ' || new.company_name || E'\n' ||
                '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
                '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
                'Central CPC has published your drive live across targeted partner campuses. Eligible students can now submit their applications.';

      perform enqueue_direct_email(
        v_ae_email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_ae_name, 'Account Executive'),
        v_body,
        'View Account Overview',
        'https://pms.faceprepcampus.com/ae/overview'
      );
    end if;

    v_subject := 'New Campus Placement Drive Active — ' || new.company_name;
    v_title := 'New Campus Placement Drive Active';
    v_subtitle := 'A new placement drive has been published for eligible students at your campus.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
              'The drive is now active on the student portal. Please ensure eligible candidates complete their applications before the deadline.';

    for v_cpc_rec in
      select distinct u.email, u.full_name
        from (
          select p.email, p.full_name
            from staff_campus_assignments a
            join profiles p on p.id = a.profile_id
            join drive_target_campuses dtc on dtc.campus_id = a.campus_id
           where dtc.drive_id = new.id
             and p.role = 'campus_placement_coordinator'
             and p.is_active = true
          union
          select sci.email, coalesce(si.full_name, 'Campus Placement Coordinator') as full_name
            from staff_campus_invitations sci
            join staff_invitations si on lower(si.email) = lower(sci.email)
            join drive_target_campuses dtc on dtc.campus_id = sci.campus_id
           where dtc.drive_id = new.id
             and si.role = 'campus_placement_coordinator'
        ) u
    loop
      perform enqueue_direct_email(
        v_cpc_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_cpc_rec.full_name, 'Campus Placement Coordinator'),
        v_body,
        'View Drive Cohort',
        'https://pms.faceprepcampus.com/cpc/drives'
      );
    end loop;
  end if;

  return new;
end;
$function$;

-- Also remove central_placement_coordinator from CC on pif_submitted
CREATE OR REPLACE FUNCTION public.resolve_cc_recipients(
  p_notification_kind text,
  p_campus_id uuid DEFAULT NULL::uuid
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cc_emails TEXT[] := '{}';
BEGIN
  IF p_notification_kind IN ('campus_drive_alert', 'campus_shortlist_ready') THEN
    SELECT ARRAY_AGG(DISTINCT email) INTO v_cc_emails
    FROM profiles 
    WHERE role = 'central_placement_coordinator' 
      AND is_active = true
      AND email IS NOT NULL;
  
  ELSIF p_notification_kind = 'campus_student_placed' THEN
    SELECT ARRAY_AGG(DISTINCT email) INTO v_cc_emails
    FROM profiles 
    WHERE role IN ('account_executive', 'delivery_head') 
      AND is_active = true
      AND email IS NOT NULL;
  
  -- pif_submitted no longer CCs central_placement_coordinator
  ELSIF p_notification_kind = 'pif_submitted' THEN
    v_cc_emails := '{}';
  
  ELSIF p_notification_kind = 'drive_published' AND p_campus_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT p.email) INTO v_cc_emails
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = p_campus_id
      AND p.role IN ('key_account_manager', 'enterprise_relations', 'er_head')
      AND p.is_active = true
      AND p.email IS NOT NULL;
  END IF;
  
  RETURN COALESCE(v_cc_emails, '{}');
END;
$function$;

