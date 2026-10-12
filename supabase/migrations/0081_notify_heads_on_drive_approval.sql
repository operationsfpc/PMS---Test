-- 0081_notify_heads_on_drive_approval.sql
--
-- Ensure Delivery Head, ER Head, and Leadership roles are notified when:
--   1. PIF is Submitted (status -> 'submitted'): notify delivery_head and er_head
--   2. PIF is Approved (status -> 'approved'): notify AE, Central CPC, AND delivery_head / er_head
--   3. Drive goes Live (status -> 'live'): notify AE, Campus CPCs, AND delivery_head / er_head

create or replace function notify_drive_lifecycle_roles()
returns trigger language plpgsql security definer set search_path = public as $$
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

  -- A. PIF SUBMITTED -> Notify Delivery Head & ER Head (DH1)
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

  -- B. PIF APPROVED -> Notify AE (A1), Central CPC (CP1), and Heads (Delivery Head & ER Head)
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    -- 1. Notify Sourcing AE (A1)
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

    -- 2. Notify Central CPC (CP1)
    v_subject := 'Drive Approved: Ready for Round Setup & Publishing — ' || new.company_name;
    v_title := 'Placement Drive Approved';
    v_subtitle := 'New approved drive ready for campus targeting and schedule setup.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**Category:** ' || coalesce(new.offer_category::text, 'Standard') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
              'Delivery Head has approved the Placement Initiation Form. Please configure the round schedule, target campuses, and publish the drive live.';

    for v_staff_rec in
      select email, full_name from profiles where role = 'central_placement_coordinator' and is_active = true
      union
      select email, full_name from staff_invitations where role = 'central_placement_coordinator' and accepted_at is null
    loop
      perform enqueue_direct_email(
        v_staff_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_staff_rec.full_name, 'Central Placement Coordinator'),
        v_body,
        'Configure & Publish',
        'https://pms.faceprepcampus.com/central/drives/yet-to-publish'
      );
    end loop;

    -- 3. Notify Delivery Head & ER Head (Drive Transferred to Central CPC)
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
        'View Sourced Drives',
        'https://pms.faceprepcampus.com/delivery-head/pif-approvals'
      );
    end loop;
  end if;

  -- C. PIF REJECTED / REVISION REQUESTED -> Notify AE (A2)
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

  -- D. DRIVE LIVE -> Notify AE (A3), Target Campus CPCs (C1), and Leadership Heads
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    -- 1. Notify Sourcing AE (A3)
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

    -- 2. Notify Campus CPCs assigned to targeted campuses (C1)
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
$$;

drop trigger if exists notify_drive_lifecycle_roles on drives;
create trigger notify_drive_lifecycle_roles
  after insert or update of status on drives
  for each row execute function notify_drive_lifecycle_roles();
