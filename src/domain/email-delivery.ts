/**
 * Layer 0: Pure business rules for email delivery, status progression, and composition.
 * Zero external dependencies.
 */

export type EmailDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "delayed"
  | "bounced"
  | "complained"
  | "failed";

export type DeliveryEvent =
  | "sent"
  | "delivered"
  | "delayed"
  | "bounced"
  | "complained"
  | "failed";

/**
 * State machine governing transitions between email delivery statuses.
 *
 * Rules:
 * - Terminal states (`delivered`, `bounced`, `complained`) never regress to earlier or transient states.
 * - Idempotent for repeated identical events.
 */
export function applyDeliveryEvent(
  current: EmailDeliveryStatus,
  event: DeliveryEvent,
): EmailDeliveryStatus {
  if (current === event) {
    return current;
  }

  // Once delivered, late or duplicate warnings/errors do not revoke the verified delivery.
  if (current === "delivered") {
    return "delivered";
  }

  // Terminal failures never regress to transient or success states.
  if (current === "bounced" || current === "complained") {
    return current;
  }

  return event;
}

/**
 * Splits an array of items into batches adhering to provider batch limits.
 * Resend enforces a limit of 100 emails per batch.
 */
export function toEmailBatches<T>(
  items: readonly T[],
  batchSize = 100,
): readonly (readonly T[])[] {
  const size = batchSize > 0 ? Math.floor(batchSize) : 100;
  if (items.length === 0) return [];

  const batches: (readonly T[])[] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Safety rail check for non-production environments.
 * When an allowlist is configured, dispatches are blocked for any recipient not on the list.
 */
export function isRecipientAllowed(
  email: string,
  allowlist?: readonly string[] | null,
): boolean {
  if (!allowlist || allowlist.length === 0) {
    return true;
  }

  const normalised = email.trim().toLowerCase();
  return allowlist.some((allowed) => allowed.trim().toLowerCase() === normalised);
}

export interface ResolvedRecipient {
  readonly to: string;
  readonly originalRecipient: string;
  readonly isOverridden: boolean;
}

/**
 * Resolves the final destination address for an email.
 * When overrideEmail is specified (e.g. dev/staging routing all emails to a single tester),
 * the email is routed to that address while preserving the original recipient for headers/logs.
 */
export function resolveRecipient(
  intendedRecipient: string,
  overrideEmail?: string | null,
): ResolvedRecipient {
  const trimmedOverride = overrideEmail?.trim();
  if (trimmedOverride && trimmedOverride.length > 0) {
    return {
      to: trimmedOverride,
      originalRecipient: intendedRecipient,
      isOverridden: true,
    };
  }

  return {
    to: intendedRecipient,
    originalRecipient: intendedRecipient,
    isOverridden: false,
  };
}


export function formatRoleName(role?: string | null | undefined): string {
  if (!role) return "";
  const roleMap: Record<string, string> = {
    admin: "System Administrator",
    student: "Student",
    campus_placement_coordinator: "Campus Placement Coordinator",
    campus_manager: "Campus Manager",
    account_executive: "Account Executive",
    delivery_head: "Delivery Head",
    central_placement_coordinator: "Central Placement Coordinator",
    key_account_manager: "Key Account Manager",
    enterprise_relations: "Enterprise Relations",
    er_head: "ER Head",
    ceo: "CEO",
  };
  const normalized = role.trim().toLowerCase();
  return roleMap[normalized] || normalized.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function resolveDisplayName(
  recipientName?: string | null | undefined,
  roleName?: string | null | undefined,
): string {
  const cleanName = recipientName?.trim();
  const cleanRole = roleName?.trim().toLowerCase();

  if (cleanName && cleanRole && cleanRole !== "student") {
    return `${cleanName} (${formatRoleName(cleanRole)})`;
  }
  if (cleanName) {
    return cleanName;
  }
  if (cleanRole && cleanRole !== "student") {
    return formatRoleName(cleanRole);
  }
  return "Candidate";
}

export interface TemplateRoutingInfo {
  readonly templateCode: string;
  readonly targetRole: string;
  readonly ccRoles: readonly string[];
}

export interface ComposedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly templateCode?: string | undefined;
  readonly targetRole?: string | undefined;
  readonly ccRoles?: readonly string[] | undefined;
}

export interface NotificationEmailInput {
  readonly subject?: string | undefined;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly body: string;
  readonly recipientName?: string | undefined;
  readonly roleName?: string | undefined;
  readonly actionUrl?: string | undefined;
  readonly actionButtonText?: string | undefined;
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;")
    .replaceAll('"', "&quot;");
}

function formatBodyHtml(body: string): string {
  return escapeHtml(body)
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color: #151228;">$1</strong>')
    .replace(/\n/g, "<br>");
}

/**
 * Composes a standard transactional notification email strictly adhering to
 * the canonical FACE Prep Campus template defined in docs/email-templates-preview.html.
 */
export function composeNotificationEmail(input: NotificationEmailInput): ComposedEmail {
  const name = resolveDisplayName(input.recipientName, input.roleName);
  const subject = input.subject?.trim() || input.title;
  const buttonText = input.actionButtonText?.trim() || "View on PMS Portal";

  const actionButton = input.actionUrl
    ? `\n\n${buttonText}: ${input.actionUrl}`
    : "";

  const plainBody = input.body.replace(/\*\*(.*?)\*\*/g, "$1");
  const text = `Dear ${name},\n\n${plainBody}${actionButton}\n\nWarm regards,\nPlacement Cell,\nFACE Prep Campus\n\nNeed help? Contact hello@faceprep.in`;

  const safeSubject = escapeHtml(subject);
  const safeTitle = escapeHtml(input.title);
  const safeSubtitle = input.subtitle?.trim() ? escapeHtml(input.subtitle.trim()) : "";
  const safeRecipient = escapeHtml(name);
  const safeUrl = input.actionUrl ? escapeHtml(input.actionUrl) : "";
  const safeButton = escapeHtml(buttonText);

  const subtitleHtml = safeSubtitle
    ? `<p style="margin:0 0 18px;color:#64748b;font-size:14.5px;line-height:1.5;">${safeSubtitle}</p>`
    : "";

  const buttonHtml = input.actionUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px;"><tr><td bgcolor="#3d3777" style="border-radius:6px;"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 22px;color:#fff;font-size:15px;font-weight:bold;line-height:1;text-decoration:none;">${safeButton} &rarr;</a></td></tr></table>`
    : "";

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>${safeSubject}</title><style>@media screen and (max-width:620px){.email-shell{width:100%!important}.email-padding{padding-left:22px!important;padding-right:22px!important}}</style></head><body style="margin:0;padding:0;background:#f7f6fb;color:#151228;font-family:Arial,Helvetica,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeTitle} — view this update in your FACE Prep Campus portal.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f6fb;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:100%;background:#fff;border:1px solid #e2e0ea;border-radius:10px;overflow:hidden;"><tr><td style="height:4px;background:#ffb800;font-size:4px;line-height:4px;">&nbsp;</td></tr><tr><td class="email-padding" style="padding:24px 32px;background:#3d3777;"><div style="width:170px;max-width:100%;"><img src="https://pms.faceprepcampus.com/brand/faceprep-campus-light.png" width="170" alt="FACE Prep Campus" style="display:block;width:170px;max-width:100%;height:auto;border:0;"><p style="margin:8px 0 0;color:#ddd8f0;font-size:11px;font-weight:600;width:170px;letter-spacing:0.2px;line-height:1.2;text-transform:none;">Placement Management System</p></div></td></tr><tr><td class="email-padding" style="padding:34px 32px 28px;"><h1 style="margin:0 0 6px;color:#151228;font-size:22px;font-weight:700;line-height:1.3;">${safeTitle}</h1>${subtitleHtml}<p style="margin:0 0 18px;color:#3f3d56;font-size:16px;line-height:1.55;">Dear <strong style="color:#151228;">${safeRecipient}</strong>,</p><p style="margin:0;color:#3f3d56;font-size:15px;line-height:1.65;">${formatBodyHtml(input.body)}</p>${buttonHtml}<p style="margin:28px 0 0;color:#3f3d56;font-size:15px;line-height:1.55;">Warm regards,<br><strong style="color:#151228;">Placement Cell,</strong><br><strong style="color:#151228;">FACE Prep Campus</strong></p></td></tr><tr><td class="email-padding" style="padding:22px 32px;background:#f8fafc;border-top:1px solid #e2e0ea;font-size:12px;color:#64748b;line-height:1.6;"><p style="margin:0 0 4px 0;font-weight:600;color:#334155;">FACE Prep Campus &bull; Focus 4D Career Education Pvt Ltd</p><p style="margin:0;">For questions, contact your coordinator or write to <a href="mailto:hello@faceprep.in" style="color:#3d3777;font-weight:600;text-decoration:underline;">hello@faceprep.in</a></p></td></tr></table></td></tr></table></body></html>`;

  return {
    subject,
    text,
    html,
  };
}

export interface StudentNotificationData {
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly recipientName?: string | undefined;
  readonly roleName?: string | undefined;
  readonly driveId?: string | null | undefined;
  readonly companyName?: string | null | undefined;
  readonly roleTitle?: string | null | undefined;
}

export function resolveTemplateRouting(kind: string): TemplateRoutingInfo {
  const normalized = kind.trim().toLowerCase();
  switch (normalized) {
    // S1: Student Welcome & Registration
    case "welcome":
      return { templateCode: "S1", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S2: New Drive Announced
    case "drive_published":
      return { templateCode: "S2", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S3: Shortlisted Candidates
    case "shortlisted":
      return { templateCode: "S3", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S4: Round Schedule
    case "round_scheduled":
      return { templateCode: "S4", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S5: Interview Slot
    case "meeting_link":
      return { templateCode: "S5", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S6: Round Cleared
    case "round_cleared":
      return { templateCode: "S6", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S7: Round Outcome / Not Selected
    case "round_not_selected":
      return { templateCode: "S7", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S8: Offer Declared
    case "offer":
      return { templateCode: "S8", targetRole: "student", ccRoles: ["campus_placement_coordinator", "central_placement_coordinator"] };
    // S9: Attendance Notice
    case "absent":
      return { templateCode: "S9", targetRole: "student", ccRoles: ["campus_placement_coordinator", "delivery_head"] };
    // S10: Registration Feedback
    case "srf_rejected":
      return { templateCode: "S10", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S11: Application Confirmed
    case "application_confirmed":
    case "application_submitted":
      return { templateCode: "S11", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S12: Deadline Reminder
    case "drive_deadline_reminder":
      return { templateCode: "S12", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S13: Interview Day Reminder
    case "interview_day_reminder":
      return { templateCode: "S13", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S14: Profile Approved
    case "srf_approved":
      return { templateCode: "S14", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
    // S15: Offer Decision Recorded
    case "offer_decision_recorded":
    case "offer_accepted":
    case "offer_declined":
      return { templateCode: "S15", targetRole: "student", ccRoles: ["campus_placement_coordinator", "central_placement_coordinator"] };
    // S16: Opt-Out Confirmed
    case "opt_out_confirmed":
      return { templateCode: "S16", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };

    // C1: Campus Placement Coordinator — Campus Drive Alert
    case "campus_drive_alert":
    case "cpc_drive_alert":
      return { templateCode: "C1", targetRole: "campus_placement_coordinator", ccRoles: ["central_placement_coordinator"] };
    // C2: Campus Placement Coordinator — Campus Shortlist Ready
    case "campus_shortlist_ready":
    case "cpc_shortlist_ready":
      return { templateCode: "C2", targetRole: "campus_placement_coordinator", ccRoles: ["delivery_head"] };
    // C3: Campus Placement Coordinator — Verification Queue Digest
    case "verification_queue_digest":
    case "verification_digest":
    case "cpc_verification":
      return { templateCode: "C3", targetRole: "campus_placement_coordinator", ccRoles: [] };
    // C4: Campus Placement Coordinator — Semester Pending Verification
    case "semester_pending_verification":
    case "cpc_semester_verification":
    case "semester_verification":
      return { templateCode: "C4", targetRole: "campus_placement_coordinator", ccRoles: [] };
    // C5: Campus Placement Coordinator — Attendance Pending Submission
    case "attendance_pending":
    case "cpc_attendance_pending":
      return { templateCode: "C5", targetRole: "campus_placement_coordinator", ccRoles: ["central_placement_coordinator"] };
    // C6: Campus Placement Coordinator — Campus Student Placed
    case "campus_student_placed":
    case "cpc_student_placed":
      return { templateCode: "C6", targetRole: "campus_placement_coordinator", ccRoles: ["delivery_head"] };
    // C7: Campus Placement Coordinator — Off-Campus Offer Proof
    case "off_campus_offer_proof":
    case "cpc_off_campus_verification":
      return { templateCode: "C7", targetRole: "campus_placement_coordinator", ccRoles: ["central_placement_coordinator"] };

    // CP1: Central Placement Coordinator — Drive Approved / Ready to Publish
    case "drive_approved":
    case "central_drive_approved":
    case "cp_drive_publish_ready":
      return { templateCode: "CP1", targetRole: "central_placement_coordinator", ccRoles: ["account_executive"] };
    // CP2: Central Placement Coordinator — Applications Closed
    case "applications_closed":
    case "central_applications_closed":
    case "cp_applications_closed":
      return { templateCode: "CP2", targetRole: "central_placement_coordinator", ccRoles: ["account_executive"] };
    // CP3: Central Placement Coordinator — Attendance Finalized
    case "round_attendance_finalized":
    case "attendance_finalized":
    case "central_attendance_finalized":
      return { templateCode: "CP3", targetRole: "central_placement_coordinator", ccRoles: ["campus_placement_coordinator"] };
    // CP4: Central Placement Coordinator — All Rounds Completed
    case "all_rounds_completed":
    case "central_rounds_completed":
    case "cp_offers_ready":
      return { templateCode: "CP4", targetRole: "central_placement_coordinator", ccRoles: ["delivery_head", "account_executive", "campus_placement_coordinator"] };

    // A1: Account Executive — PIF Approved
    case "pif_approved":
    case "ae_pif_approved":
      return { templateCode: "A1", targetRole: "account_executive", ccRoles: ["delivery_head", "central_placement_coordinator"] };
    // A2: Account Executive — PIF Revision Requested
    case "pif_revision_requested":
    case "ae_pif_revision":
    case "pif_returned":
      return { templateCode: "A2", targetRole: "account_executive", ccRoles: ["delivery_head"] };
    // A3: Account Executive — Drive Live to Students
    case "drive_live_ae":
    case "ae_drive_live":
    case "account_live":
      return { templateCode: "A3", targetRole: "account_executive", ccRoles: ["delivery_head"] };

    // DH1: Delivery Head — PIF Submitted
    case "pif_submitted":
    case "dh_pif_submitted":
    case "pif_under_review":
      return { templateCode: "DH1", targetRole: "delivery_head", ccRoles: ["account_executive"] };
    // DH2: Delivery Head — Policy Override Alert
    case "policy_override_requested":
    case "policy_override":
    case "dh_policy_override":
      return { templateCode: "DH2", targetRole: "delivery_head", ccRoles: ["central_placement_coordinator", "account_executive"] };
    // DH3: Delivery Head — Weekly Operations Digest
    case "weekly_operations_digest":
    case "dh_weekly_digest":
    case "operations_digest":
      return { templateCode: "DH3", targetRole: "delivery_head", ccRoles: [] };

    default:
      return { templateCode: "GENERIC", targetRole: "student", ccRoles: ["campus_placement_coordinator"] };
  }
}

/**
 * Composes a placement notification email (S1 through C3) based on notification data,
 * mapping the kind to the precise title, CTA button label, and destination URL.
 */
export function composeStudentNotificationEmail(
  data: StudentNotificationData,
  portalUrl = "https://pms.faceprepcampus.com",
): ComposedEmail {
  const normalizedKind = data.kind.trim().toLowerCase();
  let subject = data.title;
  let title = data.title;
  let subtitle: string | undefined;
  let button = "View on PMS Portal";
  let url = `${portalUrl}/student`;

  switch (normalizedKind) {
    // S1: Student Welcome & Registration
    case "welcome": {
      subject = data.title || "Welcome to FACE Prep Campus Placements — Complete Your Profile";
      title = "Complete Your Placement Profile";
      subtitle = "Please fill in all the required details to complete your placement profile.";
      button = "Complete Registration";
      url = `${portalUrl}/srf`;
      break;
    }
    // S2: New Drive Announced
    case "drive_published": {
      subject = data.title;
      title = "New Placement Drive Announced";
      button = "View Drive & Apply";
      url = `${portalUrl}/student/drives`;
      break;
    }
    // S3: Shortlisted Candidates
    case "shortlisted": {
      subject = data.title;
      title = "You Are Shortlisted";
      button = "View Application Status";
      url = `${portalUrl}/student/drives`;
      break;
    }
    // S4: Round Schedule
    case "round_scheduled": {
      subject = data.title;
      title = "Round Schedule Released";
      button = "View Drive Dashboard";
      url = `${portalUrl}/student/drives`;
      break;
    }
    // S5: Interview Slot
    case "meeting_link": {
      subject = data.title;
      title = "Interview Slot Scheduled";
      button = "Join Interview Room";
      const match = data.body.match(/https?:\/\/[^\s]+/);
      url = match ? match[0].replace(/[.,]+$/, "") : `${portalUrl}/student/drives`;
      break;
    }
    // S6: Round Cleared
    case "round_cleared": {
      subject = data.title;
      title = "Round Cleared";
      button = "View Drive Progress";
      url = `${portalUrl}/student/drives`;
      break;
    }
    // S7: Round Outcome / Not Selected
    case "round_not_selected": {
      subject = data.title;
      title = "Application Status Update";
      button = "Explore Open Drives";
      url = `${portalUrl}/student/drives`;
      break;
    }
    // S8: Offer Declared
    case "offer": {
      subject = data.title;
      title = "Placement Offer Extended";
      button = "View Offer & Letter";
      url = `${portalUrl}/student/notifications`;
      break;
    }
    // S9: Attendance Notice
    case "absent": {
      subject = data.title;
      title = "Absence Recorded";
      button = "View Attendance Record";
      url = `${portalUrl}/student`;
      break;
    }
    // S10: Registration Feedback
    case "srf_rejected": {
      subject = data.title;
      title = "Registration Form Requires Changes";
      button = "Open Registration Form";
      url = `${portalUrl}/srf`;
      break;
    }
    // S11: Application Confirmed
    case "application_confirmed":
    case "application_submitted": {
      subject = data.title || "Application Confirmed";
      title = "Application Successfully Submitted";
      button = "View Application Status";
      url = `${portalUrl}/student/drives`;
      break;
    }
    // S12: Deadline Reminder
    case "drive_deadline_reminder": {
      subject = data.title || "Placement Drive Closing Soon";
      title = "Placement Drive Closing Soon";
      button = "Apply to Drive";
      url = `${portalUrl}/student/drives`;
      break;
    }
    // S13: Interview Day Reminder
    case "interview_day_reminder": {
      subject = data.title || "Interview Day Reminder";
      title = "Interview Day Reminder";
      button = "View Drive Details";
      url = `${portalUrl}/student/drives`;
      break;
    }
    // S14: Profile Approved
    case "srf_approved": {
      subject = data.title || "Profile Verified: You Are Now Eligible for Placement Drives";
      title = "Placement Profile Approved";
      button = "Explore Open Drives";
      url = `${portalUrl}/student/drives`;
      break;
    }
    // S15: Offer Decision Recorded
    case "offer_decision_recorded":
    case "offer_accepted":
    case "offer_declined": {
      subject = data.title || "Offer Decision Recorded";
      title = "Offer Decision Recorded";
      button = "View Placement Record";
      url = `${portalUrl}/student/notifications`;
      break;
    }
    // S16: Opt-Out Confirmed
    case "opt_out_confirmed": {
      subject = data.title || "Placement Opt-Out Confirmed — FACE Prep Campus";
      title = "Placement Opt-Out Acknowledged";
      button = "View Profile";
      url = `${portalUrl}/student/profile`;
      break;
    }
    // C1: Campus Placement Coordinator — Campus Drive Alert
    case "campus_drive_alert":
    case "cpc_drive_alert": {
      subject = data.title || "New Campus Placement Drive Active";
      title = "New Campus Placement Drive Active";
      button = "View Drive Cohort";
      url = `${portalUrl}/cpc/drives`;
      break;
    }
    // C2: Campus Placement Coordinator — Campus Shortlist Ready
    case "campus_shortlist_ready":
    case "cpc_shortlist_ready": {
      subject = data.title || "Campus Candidate Shortlist Released";
      title = "Campus Candidate Shortlist Released";
      button = "View Shortlisted Roster";
      url = `${portalUrl}/cpc/drives`;
      break;
    }
    // C3: Campus Placement Coordinator — Verification Queue Digest
    case "verification_queue_digest":
    case "verification_digest":
    case "cpc_verification": {
      subject = data.title || "Verification Queue: Student Profiles Awaiting Approval";
      title = "Student Profiles Pending Verification";
      button = "Open Verification Queue";
      url = `${portalUrl}/cpc/verification`;
      break;
    }
    // C4: Campus Placement Coordinator — Semester Pending Verification
    case "semester_pending_verification":
    case "cpc_semester_verification":
    case "semester_verification": {
      subject = data.title || "New Semester Added: Pending Verification";
      title = "Semester Record Pending Verification";
      button = "Verify Semester Record";
      url = `${portalUrl}/cpc/semesters`;
      break;
    }
    // C5: Campus Placement Coordinator — Attendance Pending Submission
    case "attendance_pending":
    case "cpc_attendance_pending": {
      subject = data.title || "Action Required: Mark Attendance for Placement Drive";
      title = "Round Attendance Pending Submission";
      button = "Mark Round Attendance";
      url = `${portalUrl}/cpc/attendance`;
      break;
    }
    // C6: Campus Placement Coordinator — Campus Student Placed
    case "campus_student_placed":
    case "cpc_student_placed": {
      subject = data.title || "Placement Success: Candidate Placed";
      title = "Campus Student Placement";
      button = "View Drive Progress";
      url = `${portalUrl}/cpc/drives`;
      break;
    }
    // C7: Campus Placement Coordinator — Off-Campus Offer Proof
    case "off_campus_offer_proof":
    case "cpc_off_campus_verification": {
      subject = data.title || "Action Required: Off-Campus Placement Proof Submitted";
      title = "Off-Campus Offer Verification Required";
      button = "Review Off-Campus Queue";
      url = `${portalUrl}/cpc/off-campus`;
      break;
    }
    // CP1: Central Placement Coordinator — Drive Approved / Ready to Publish
    case "drive_approved":
    case "central_drive_approved":
    case "cp_drive_publish_ready": {
      subject = data.title || "Drive Approved: Ready for Round Setup & Publishing";
      title = "Placement Drive Approved";
      button = "Configure & Publish";
      url = `${portalUrl}/central/drives/yet-to-publish`;
      break;
    }
    // CP2: Central Placement Coordinator — Applications Closed
    case "applications_closed":
    case "central_applications_closed":
    case "cp_applications_closed": {
      subject = data.title || "Applications Closed: Candidates Ready for Shortlisting";
      title = "Drive Applications Closed";
      button = "Open Shortlisting Console";
      url = `${portalUrl}/central/shortlisting`;
      break;
    }
    // CP3: Central Placement Coordinator — Attendance Finalized
    case "round_attendance_finalized":
    case "attendance_finalized":
    case "central_attendance_finalized": {
      subject = data.title || "Attendance Finalized: Round Ready for Results";
      title = "Round Attendance Finalized";
      button = "Enter Round Results";
      url = `${portalUrl}/central/results`;
      break;
    }
    // CP4: Central Placement Coordinator — All Rounds Completed
    case "all_rounds_completed":
    case "central_rounds_completed":
    case "cp_offers_ready": {
      subject = data.title || "All Rounds Concluded: Ready for Offer Issuance";
      title = "Placement Drive Completed";
      button = "Issue Placement Offers";
      url = `${portalUrl}/central/offers`;
      break;
    }
    // A1: Account Executive — PIF Approved
    case "pif_approved":
    case "ae_pif_approved": {
      subject = data.title || "Good News: PIF Approved as Super Dream";
      title = "Placement Initiation Form Approved";
      button = "View Sourced Drives";
      url = `${portalUrl}/my-drives`;
      break;
    }
    // A2: Account Executive — PIF Revision Requested
    case "pif_revision_requested":
    case "ae_pif_revision":
    case "pif_returned": {
      subject = data.title || "Action Required: PIF Revision Requested";
      title = "PIF Requires Changes";
      button = "Revise PIF Details";
      url = `${portalUrl}/ae/pif`;
      break;
    }
    // A3: Account Executive — Drive Live to Students
    case "drive_live_ae":
    case "ae_drive_live":
    case "account_live": {
      subject = data.title || "Your Account is Live: Placement Drive Published";
      title = "Placement Drive Published";
      button = "View Account Overview";
      url = `${portalUrl}/ae/overview`;
      break;
    }
    // DH1: Delivery Head — PIF Submitted
    case "pif_submitted":
    case "dh_pif_submitted":
    case "pif_under_review": {
      subject = data.title || "Action Required: PIF Submitted for Review";
      title = "Placement Initiation Form Under Review";
      button = "Open PIF Approvals";
      url = `${portalUrl}/delivery-head/pif-approvals`;
      break;
    }
    // DH2: Delivery Head — Policy Override Alert
    case "policy_override_requested":
    case "policy_override":
    case "dh_policy_override": {
      subject = data.title || "Governance Alert: Placement Policy Override Requested";
      title = "Placement Policy Override Request";
      button = "Review Policy Override";
      url = `${portalUrl}/delivery-head/pif-approvals`;
      break;
    }
    // DH3: Delivery Head — Weekly Operations Digest
    case "weekly_operations_digest":
    case "dh_weekly_digest":
    case "operations_digest": {
      subject = data.title || "Weekly Placement Operations Summary";
      title = "Weekly Placement Operations Summary";
      button = "Open Operations Cockpit";
      url = `${portalUrl}/dashboard`;
      break;
    }
    default: {
      subject = data.title;
      title = data.title;
      button = "View on PMS Portal";
      url = `${portalUrl}/student`;
      break;
    }
  }

  const routing = resolveTemplateRouting(data.kind);
  const email = composeNotificationEmail({
    subject,
    title,
    subtitle,
    body: data.body,
    recipientName: data.recipientName,
    roleName: data.roleName,
    actionUrl: url,
    actionButtonText: button,
  });

  return {
    ...email,
    templateCode: routing.templateCode,
    targetRole: routing.targetRole,
    ccRoles: routing.ccRoles,
  };
}



export interface StaffInviteEmailInput {
  readonly email: string;
  readonly fullName: string;
  readonly roleName: string;
  readonly campuses?: readonly string[];
  readonly loginUrl?: string;
}

/**
 * Composes a staff invitation and onboarding email.
 */
export function composeStaffInviteEmail(input: StaffInviteEmailInput): ComposedEmail {
  const loginUrl = input.loginUrl || "https://pms.faceprepcampus.com/login";
  const campusesText =
    input.campuses && input.campuses.length > 0
      ? input.campuses.join(", ")
      : "All Campuses (Organisation-wide)";

  const subject = `Invitation to FACE Prep Campus PMS as ${input.roleName}`;

  const text = `Hello ${input.fullName},\n\nYou have been invited to join the FACE Prep Campus Placement Management System (PMS).\n\nAssigned Role: ${input.roleName}\nAssigned Campus(es): ${campusesText}\nAccount Email: ${input.email}\n\nTo sign in, visit:\n${loginUrl}\n\nPlease use your registered Google account to complete your sign-in.\n\nWarm regards,\nFACE Prep Campus Administration`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #0F172A;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F1F5F9; padding: 32px 12px;">
    <tr>
      <td align="center">
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #E2E8F0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); max-width: 100%;">
          <!-- Top Gradient Accent -->
          <tr>
            <td height="4" style="background: linear-gradient(90deg, #3D3777 0%, #A46AFC 50%, #FFB800 100%); line-height: 4px; font-size: 4px;">&nbsp;</td>
          </tr>
          <!-- Header with Logo -->
          <tr>
            <td style="background-color: #3D3777; padding: 24px 32px;">
              <table border="0" cellpadding="0" cellspacing="0" style="width: 170px; max-width: 100%;">
                <tr>
                  <td align="left" valign="middle">
                    <img src="https://pms.faceprepcampus.com/brand/faceprep-campus-light.png" alt="FACE Prep Campus" width="170" height="34" style="width: 170px; height: 34px; max-width: 100%; display: block; border: 0;" />
                    <div style="font-size: 11px; font-weight: 600; color: #E0E7FF; letter-spacing: 0.2px; width: 170px; margin-top: 6px; line-height: 1.2;">Staff Onboarding</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 20px; color: #1E1B4B; font-weight: 700; line-height: 1.3;">Welcome to the Team, ${input.fullName}</h1>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 20px 0;">
                You have been invited to join the FACE Prep Campus Placement Management System (PMS). Your role-based permissions have been provisioned as follows:
              </p>
              
              <!-- Role Details Grid -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 12px 16px; font-size: 13.5px; font-weight: 600; color: #3D3777; width: 140px; border-bottom: 1px solid #E2E8F0;">Assigned Role:</td>
                  <td style="padding: 12px 16px; font-size: 14px; font-weight: 600; color: #0F172A; border-bottom: 1px solid #E2E8F0;">${input.roleName}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; font-size: 13.5px; font-weight: 600; color: #3D3777; border-bottom: 1px solid #E2E8F0;">Campus Scope:</td>
                  <td style="padding: 12px 16px; font-size: 14px; color: #334155; border-bottom: 1px solid #E2E8F0;">${campusesText}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; font-size: 13.5px; font-weight: 600; color: #3D3777;">Authorized Email:</td>
                  <td style="padding: 12px 16px; font-size: 14px; color: #334155;">${input.email}</td>
                </tr>
              </table>

              <table border="0" cellpadding="0" cellspacing="0" style="margin-top: 8px; margin-bottom: 8px;">
                <tr>
                  <td align="center" bgcolor="#3D3777" style="border-radius: 6px;">
                    <a href="${loginUrl}" target="_blank" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; display: inline-block; padding: 13px 28px; letter-spacing: 0.2px;">
                      Sign In with Google &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 24px 0 0 0;">
                Please ensure you sign in with the Google account registered to <code>${input.email}</code>.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #F8FAFC; padding: 22px 32px; border-top: 1px solid #E2E8F0; font-size: 12px; color: #64748B; line-height: 1.6;">
              <p style="margin: 0 0 4px 0; font-weight: 600; color: #334155;">FACE Prep Campus &bull; Focus 4D Career Education Pvt Ltd</p>
              <p style="margin: 0;">For questions, contact your coordinator or write to <a href="mailto:hello@faceprep.in" style="color: #3D3777; font-weight: 600; text-decoration: underline;">hello@faceprep.in</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject,
    text,
    html,
    templateCode: "AD1",
    targetRole: input.roleName,
    ccRoles: ["admin"],
  };
}
