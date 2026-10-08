// @ts-nocheck
// Supabase Edge Function: email-dispatch
// Dispatches queued email_deliveries via Resend API using the canonical HTML template
// defined in docs/email-templates-preview.html.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "re_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "FACE Prep Campus <pms@faceprepcampus.com>";
const EMAIL_OVERRIDE_RECIPIENT = Deno.env.get("EMAIL_OVERRIDE_RECIPIENT") || "";
const PORTAL_URL = Deno.env.get("PORTAL_URL") || "https://pms.faceprepcampus.com";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

function formatRoleName(role?: string | null): string {
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
  return roleMap[normalized] || normalized.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function resolveDisplayName(recipientName?: string | null, roleName?: string | null): string {
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

function buildCanonicalHtml(item: {
  subject: string;
  title: string;
  subtitle?: string;
  recipient: string;
  body: string;
  button?: string;
  url?: string;
  routingNotice?: string;
}): string {
  const safeSubject = escapeHtml(item.subject);
  const safeTitle = escapeHtml(item.title);
  const safeSubtitle = item.subtitle?.trim() ? escapeHtml(item.subtitle.trim()) : "";
  const safeRecipient = escapeHtml(item.recipient);
  const safeUrl = item.url ? escapeHtml(item.url) : "";
  const safeButton = item.button ? escapeHtml(item.button) : "View on PMS Portal";

  const subtitleHtml = safeSubtitle
    ? `<p style="margin:0 0 18px;color:#64748b;font-size:14.5px;line-height:1.5;">${safeSubtitle}</p>`
    : "";

  const buttonHtml = item.url
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px;"><tr><td bgcolor="#3d3777" style="border-radius:6px;"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 22px;color:#fff;font-size:15px;font-weight:bold;line-height:1;text-decoration:none;">${safeButton} &rarr;</a></td></tr></table>`
    : "";

  const routingNoticeHtml = item.routingNotice
    ? `<div style="background:#fffbeb;border:1px solid #fcd34d;color:#92400e;padding:10px 14px;border-radius:6px;font-size:12px;margin-bottom:20px;"><strong>Development Routing:</strong> Intended recipient was <code>${escapeHtml(item.routingNotice)}</code></div>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>${safeSubject}</title><style>@media screen and (max-width:620px){.email-shell{width:100%!important}.email-padding{padding-left:22px!important;padding-right:22px!important}}</style></head><body style="margin:0;padding:0;background:#f7f6fb;color:#151228;font-family:Arial,Helvetica,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeTitle} — view this update in your FACE Prep Campus portal.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f6fb;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:100%;background:#fff;border:1px solid #e2e0ea;border-radius:10px;overflow:hidden;"><tr><td style="height:4px;background:#ffb800;font-size:4px;line-height:4px;">&nbsp;</td></tr><tr><td class="email-padding" style="padding:24px 32px;background:#3d3777;"><div style="width:170px;max-width:100%;"><img src="https://pms.faceprepcampus.com/brand/faceprep-campus-light.png" width="170" alt="FACE Prep Campus" style="display:block;width:170px;max-width:100%;height:auto;border:0;"><p style="margin:8px 0 0;color:#ddd8f0;font-size:11px;font-weight:600;width:170px;letter-spacing:0.2px;line-height:1.2;text-transform:none;">Placement Management System</p></div></td></tr><tr><td class="email-padding" style="padding:34px 32px 28px;">${routingNoticeHtml}<h1 style="margin:0 0 6px;color:#151228;font-size:22px;font-weight:700;line-height:1.3;">${safeTitle}</h1>${subtitleHtml}<p style="margin:0 0 18px;color:#3f3d56;font-size:16px;line-height:1.55;">Dear <strong style="color:#151228;">${safeRecipient}</strong>,</p><p style="margin:0;color:#3f3d56;font-size:15px;line-height:1.65;">${formatBodyHtml(item.body)}</p>${buttonHtml}<p style="margin:28px 0 0;color:#3f3d56;font-size:15px;line-height:1.55;">Warm regards,<br><strong style="color:#151228;">Placement Cell,</strong><br><strong style="color:#151228;">FACE Prep Campus</strong></p></td></tr><tr><td class="email-padding" style="padding:22px 32px;background:#f8fafc;border-top:1px solid #e2e0ea;font-size:12px;color:#64748b;line-height:1.6;"><p style="margin:0 0 4px 0;font-weight:600;color:#334155;">FACE Prep Campus &bull; Focus 4D Career Education Pvt Ltd</p><p style="margin:0;">For questions, contact your coordinator or write to <a href="mailto:hello@faceprep.in" style="color:#3d3777;font-weight:600;text-decoration:underline;">hello@faceprep.in</a></p></td></tr></table></td></tr></table></body></html>`;
}

serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Fetch up to 100 queued email_deliveries joining notifications
  const { data: deliveries, error: fetchError } = await supabase
    .from("email_deliveries")
    .select(`
      id,
      recipient_email,
      notification:notifications(
        id,
        kind,
        title,
        body,
        drive_id,
        student:students(full_name)
      )
    `)
    .eq("status", "queued")
    .limit(100);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!deliveries || deliveries.length === 0) {
    return new Response(JSON.stringify({ message: "No queued deliveries to process." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Batch lookup profile data for any recipients not in students table (e.g. coordinators/staff)
  const pendingEmails = [
    ...new Set(
      deliveries
        .filter((d: any) => !d.notification?.student?.full_name && d.recipient_email)
        .map((d: any) => d.recipient_email.trim().toLowerCase()),
    ),
  ];

  const profileMap = new Map<string, { full_name: string; role: string }>();
  if (pendingEmails.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("email, full_name, role")
      .in("email", pendingEmails);

    if (profiles) {
      for (const p of profiles) {
        if (p.email) {
          profileMap.set(p.email.trim().toLowerCase(), p);
        }
      }
    }
  }

  const results = [];

  // 2. Dispatch each delivery via Resend
  for (const delivery of deliveries) {
    const notif = delivery.notification as {
      id?: string;
      kind?: string;
      title?: string;
      body?: string;
      drive_id?: string;
      student?: { full_name?: string } | null;
    } | null;

    const originalEmail = delivery.recipient_email?.trim() || "";
    let recipientDisplayName = notif?.student?.full_name?.trim();
    if (!recipientDisplayName && originalEmail) {
      const profile = profileMap.get(originalEmail.toLowerCase());
      if (profile) {
        recipientDisplayName = resolveDisplayName(profile.full_name, profile.role);
      }
    }
    if (!recipientDisplayName) {
      recipientDisplayName = "Candidate";
    }

    const rawKind = (notif?.kind || "").trim().toLowerCase();
    const notificationTitle = notif?.title || "Placement Notification";
    const notificationBody = notif?.body || "";

    // Map notification kind to canonical template attributes
    let subject = notificationTitle;
    let templateTitle = notificationTitle;
    let subtitle: string | undefined;
    let buttonLabel = "View on PMS Portal";
    let targetUrl = `${PORTAL_URL}/student`;

    switch (rawKind) {
      // S1: Welcome
      case "welcome":
        subject = notificationTitle || "Welcome to FACE Prep Campus Placements — Complete Your Profile";
        templateTitle = "Complete Your Placement Profile";
        subtitle = "Please fill in all the required details to complete your placement profile.";
        buttonLabel = "Complete Registration";
        targetUrl = `${PORTAL_URL}/srf`;
        break;
      // S2: Drive Published
      case "drive_published":
        templateTitle = "New Placement Drive Announced";
        buttonLabel = "View Drive & Apply";
        targetUrl = `${PORTAL_URL}/student/drives`;
        break;
      // S3: Shortlisted
      case "shortlisted":
        templateTitle = "You Are Shortlisted";
        buttonLabel = "View Application Status";
        targetUrl = `${PORTAL_URL}/student/drives`;
        break;
      // S4: Round Scheduled
      case "round_scheduled":
        templateTitle = "Round Schedule Released";
        buttonLabel = "View Drive Dashboard";
        targetUrl = `${PORTAL_URL}/student/drives`;
        break;
      // S5: Meeting Link
      case "meeting_link": {
        templateTitle = "Interview Slot Scheduled";
        buttonLabel = "Join Interview Room";
        const match = notificationBody.match(/https?:\/\/[^\s]+/);
        targetUrl = match ? match[0].replace(/[.,]+$/, "") : `${PORTAL_URL}/student/drives`;
        break;
      }
      // S6: Round Cleared
      case "round_cleared":
        templateTitle = "Round Cleared";
        buttonLabel = "View Drive Progress";
        targetUrl = `${PORTAL_URL}/student/drives`;
        break;
      // S7: Round Not Selected
      case "round_not_selected":
        templateTitle = "Application Status Update";
        buttonLabel = "Explore Open Drives";
        targetUrl = `${PORTAL_URL}/student/drives`;
        break;
      // S8: Offer Extended
      case "offer":
        templateTitle = "Placement Offer Extended";
        buttonLabel = "View Offer & Letter";
        targetUrl = `${PORTAL_URL}/student/notifications`;
        break;
      // S9: Absent
      case "absent":
        templateTitle = "Absence Recorded";
        buttonLabel = "View Attendance Record";
        targetUrl = `${PORTAL_URL}/student`;
        break;
      // S10: SRF Rejected / Changes Requested
      case "srf_rejected":
        templateTitle = "Registration Form Requires Changes";
        buttonLabel = "Open Registration Form";
        targetUrl = `${PORTAL_URL}/srf`;
        break;
      // S11: Application Confirmed
      case "application_confirmed":
      case "application_submitted":
        subject = notificationTitle || "Application Confirmed";
        templateTitle = "Application Successfully Submitted";
        buttonLabel = "View Application Status";
        targetUrl = `${PORTAL_URL}/student/drives`;
        break;
      // S12: Drive Deadline Reminder
      case "drive_deadline_reminder":
        subject = notificationTitle || "Placement Drive Closing Soon";
        templateTitle = "Placement Drive Closing Soon";
        buttonLabel = "Apply to Drive";
        targetUrl = `${PORTAL_URL}/student/drives`;
        break;
      // S13: Interview Day Reminder
      case "interview_day_reminder":
        subject = notificationTitle || "Interview Day Reminder";
        templateTitle = "Interview Day Reminder";
        buttonLabel = "View Drive Details";
        targetUrl = `${PORTAL_URL}/student/drives`;
        break;
      // S14: SRF Approved
      case "srf_approved":
        subject = notificationTitle || "Profile Verified: You Are Now Eligible for Placement Drives";
        templateTitle = "Placement Profile Approved";
        buttonLabel = "Explore Open Drives";
        targetUrl = `${PORTAL_URL}/student/drives`;
        break;
      // S15: Offer Decision Recorded
      case "offer_decision_recorded":
      case "offer_accepted":
      case "offer_declined":
        subject = notificationTitle || "Offer Decision Recorded";
        templateTitle = "Offer Decision Recorded";
        buttonLabel = "View Placement Record";
        targetUrl = `${PORTAL_URL}/student/notifications`;
        break;
      // S16: Opt-Out Confirmed
      case "opt_out_confirmed":
        subject = notificationTitle || "Placement Opt-Out Confirmed — FACE Prep Campus";
        templateTitle = "Placement Opt-Out Acknowledged";
        buttonLabel = "View Profile";
        targetUrl = `${PORTAL_URL}/student/profile`;
        break;
      // C1: Campus Drive Alert
      case "campus_drive_alert":
      case "cpc_drive_alert":
        subject = notificationTitle || "New Campus Placement Drive Active";
        templateTitle = "New Campus Placement Drive Active";
        buttonLabel = "View Drive Cohort";
        targetUrl = `${PORTAL_URL}/cpc/drives`;
        break;
      // C2: Campus Shortlist Ready
      case "campus_shortlist_ready":
      case "cpc_shortlist_ready":
        subject = notificationTitle || "Campus Candidate Shortlist Released";
        templateTitle = "Campus Candidate Shortlist Released";
        buttonLabel = "View Shortlisted Roster";
        targetUrl = `${PORTAL_URL}/cpc/drives`;
        break;
      // C3: Verification Queue Digest
      case "verification_queue_digest":
      case "verification_digest":
      case "cpc_verification":
        subject = notificationTitle || "Verification Queue: Student Profiles Awaiting Approval";
        templateTitle = "Student Profiles Pending Verification";
        buttonLabel = "Open Verification Queue";
        targetUrl = `${PORTAL_URL}/cpc/verification`;
        break;
      // C4: Semester Pending Verification
      case "semester_pending_verification":
      case "cpc_semester_verification":
      case "semester_verification":
        subject = notificationTitle || "New Semester Added: Pending Verification";
        templateTitle = "Semester Record Pending Verification";
        buttonLabel = "Verify Semester Record";
        targetUrl = `${PORTAL_URL}/cpc/semesters`;
        break;
      // C5: Attendance Pending
      case "attendance_pending":
      case "cpc_attendance_pending":
        subject = notificationTitle || "Action Required: Mark Attendance for Placement Drive";
        templateTitle = "Round Attendance Pending Submission";
        buttonLabel = "Mark Round Attendance";
        targetUrl = `${PORTAL_URL}/cpc/attendance`;
        break;
      // C6: Campus Student Placed
      case "campus_student_placed":
      case "cpc_student_placed":
        subject = notificationTitle || "Placement Success: Candidate Placed";
        templateTitle = "Campus Student Placement";
        buttonLabel = "View Drive Progress";
        targetUrl = `${PORTAL_URL}/cpc/drives`;
        break;
      // C7: Off-Campus Offer Proof
      case "off_campus_offer_proof":
      case "cpc_off_campus_verification":
        subject = notificationTitle || "Action Required: Off-Campus Placement Proof Submitted";
        templateTitle = "Off-Campus Offer Verification Required";
        buttonLabel = "Review Off-Campus Queue";
        targetUrl = `${PORTAL_URL}/cpc/off-campus`;
        break;
      // CP1: Central Placement Coordinator — Drive Approved
      case "drive_approved":
      case "central_drive_approved":
      case "cp_drive_publish_ready":
        subject = notificationTitle || "Drive Approved: Ready for Round Setup & Publishing";
        templateTitle = "Placement Drive Approved";
        buttonLabel = "Configure & Publish";
        targetUrl = `${PORTAL_URL}/central/drives/yet-to-publish`;
        break;
      // CP2: Central Placement Coordinator — Applications Closed
      case "applications_closed":
      case "central_applications_closed":
      case "cp_applications_closed":
        subject = notificationTitle || "Applications Closed: Candidates Ready for Shortlisting";
        templateTitle = "Drive Applications Closed";
        buttonLabel = "Open Shortlisting Console";
        targetUrl = `${PORTAL_URL}/central/shortlisting`;
        break;
      // CP3: Central Placement Coordinator — Round Attendance Finalized
      case "round_attendance_finalized":
      case "attendance_finalized":
      case "central_attendance_finalized":
        subject = notificationTitle || "Attendance Finalized: Round Ready for Results";
        templateTitle = "Round Attendance Finalized";
        buttonLabel = "Enter Round Results";
        targetUrl = `${PORTAL_URL}/central/results`;
        break;
      // CP4: Central Placement Coordinator — All Rounds Completed
      case "all_rounds_completed":
      case "central_rounds_completed":
      case "cp_offers_ready":
        subject = notificationTitle || "All Rounds Concluded: Ready for Offer Issuance";
        templateTitle = "Placement Drive Completed";
        buttonLabel = "Issue Placement Offers";
        targetUrl = `${PORTAL_URL}/central/offers`;
        break;
      // A1: Account Executive — PIF Approved
      case "pif_approved":
      case "ae_pif_approved":
        subject = notificationTitle || "Good News: PIF Approved as Super Dream";
        templateTitle = "Placement Initiation Form Approved";
        buttonLabel = "View Sourced Drives";
        targetUrl = `${PORTAL_URL}/my-drives`;
        break;
      // A2: Account Executive — PIF Revision Requested
      case "pif_revision_requested":
      case "ae_pif_revision":
      case "pif_returned":
        subject = notificationTitle || "Action Required: PIF Revision Requested";
        templateTitle = "PIF Requires Changes";
        buttonLabel = "Revise PIF Details";
        targetUrl = `${PORTAL_URL}/ae/pif`;
        break;
      // A3: Account Executive — Drive Live to Students
      case "drive_live_ae":
      case "ae_drive_live":
      case "account_live":
        subject = notificationTitle || "Your Account is Live: Placement Drive Published";
        templateTitle = "Placement Drive Published";
        buttonLabel = "View Account Overview";
        targetUrl = `${PORTAL_URL}/ae/overview`;
        break;
      default:
        templateTitle = notificationTitle;
        buttonLabel = "View on PMS Portal";
        targetUrl = `${PORTAL_URL}/student`;
        break;
    }

    // Direct all emails to override recipient in dev/test mode
    const isOverridden = Boolean(EMAIL_OVERRIDE_RECIPIENT && EMAIL_OVERRIDE_RECIPIENT !== originalEmail);
    const finalRecipient = isOverridden ? EMAIL_OVERRIDE_RECIPIENT : originalEmail;
    const routingNotice = isOverridden ? originalEmail : undefined;

    const htmlBody = buildCanonicalHtml({
      subject,
      title: templateTitle,
      subtitle,
      recipient: recipientDisplayName,
      body: notificationBody,
      button: buttonLabel,
      url: targetUrl,
      routingNotice,
    });

    const plainBody = notificationBody.replace(/\*\*(.*?)\*\*/g, "$1");
    const routingPrefix = isOverridden ? `[Dev Routing Note: Intended for ${originalEmail}]\n\n` : "";
    const textBody = `${routingPrefix}Dear ${recipientDisplayName},\n\n${plainBody}\n\n${buttonLabel}: ${targetUrl}\n\nWarm regards,\nPlacement Cell,\nFACE Prep Campus\n\nNeed help? Contact hello@faceprep.in`;

    const emailPayload = {
      from: RESEND_FROM_EMAIL,
      to: [finalRecipient],
      reply_to: "placements@faceprep.in",
      subject,
      text: textBody,
      html: htmlBody,
    };

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      const resData = await res.json().catch(() => ({}));

      if (res.ok && resData?.id) {
        await supabase
          .from("email_deliveries")
          .update({
            status: "sent",
            provider_message_id: resData.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", delivery.id);

        results.push({ id: delivery.id, status: "sent", messageId: resData.id, recipient: finalRecipient });
      } else {
        const errorMsg = resData?.message || `HTTP ${res.status}`;
        await supabase
          .from("email_deliveries")
          .update({
            status: "failed",
            error: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", delivery.id);

        results.push({ id: delivery.id, status: "failed", error: errorMsg, recipient: finalRecipient });
      }
    } catch (sendErr: unknown) {
      const errorMessage = sendErr instanceof Error ? sendErr.message : String(sendErr);
      await supabase
        .from("email_deliveries")
        .update({
          status: "failed",
          error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);

      results.push({ id: delivery.id, status: "failed", error: errorMessage, recipient: finalRecipient });
    }
  }

  return new Response(JSON.stringify({ processed: deliveries.length, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
