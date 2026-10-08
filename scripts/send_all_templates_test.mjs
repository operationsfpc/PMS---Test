const apiKey = "re_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp";
const recipient = "operationsfpc@faceprep.in";

// Canonical PMS Base URL:
// In production: https://faceprepcampus.com or Cloudflare staging https://fpc-pms.faceprep.workers.dev
const BASE_URL = "https://pms.faceprepcampus.com";

function formatBody(bodyText) {
  // Convert markdown **bold** to <strong> tags for email clients
  return bodyText
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color: #0F172A;">$1</strong>')
    .replace(/\n/g, "<br>");
}

function formatHtml(title, body, actionUrl = null, buttonLabel = "View on PMS Portal", name = "Asha Devi", subtitle = null) {
  const btn = actionUrl
    ? `<table border="0" cellpadding="0" cellspacing="0" style="margin-top: 24px; margin-bottom: 8px;">
        <tr>
          <td align="center" bgcolor="#3D3777" style="border-radius: 6px;">
            <a href="${actionUrl}" target="_blank" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; display: inline-block; padding: 13px 28px; letter-spacing: 0.2px;">
              ${buttonLabel} &rarr;
            </a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #0F172A;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F1F5F9; padding: 32px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card (600px) -->
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #E2E8F0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); max-width: 100%;">
          <!-- Top Vibrant Brand Stripe -->
          <tr>
            <td height="4" style="background: linear-gradient(90deg, #3D3777 0%, #A46AFC 50%, #FFB800 100%); line-height: 4px; font-size: 4px;">&nbsp;</td>
          </tr>
          <!-- Header with Logo -->
          <tr>
            <td style="background-color: #3D3777; padding: 24px 32px;">
              <table border="0" cellpadding="0" cellspacing="0" style="width: 170px; max-width: 100%;">
                <tr>
                  <td align="left" valign="middle">
                    <img src="${BASE_URL}/brand/faceprep-campus-light.png" alt="FACE Prep Campus" width="170" height="34" style="width: 170px; height: 34px; max-width: 100%; display: block; border: 0;" />
                    <div style="font-size: 11px; font-weight: 600; color: #E0E7FF; letter-spacing: 0.2px; width: 170px; margin-top: 6px; line-height: 1.2;">Placement Management System</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Main Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h1 style="margin: 0 0 6px 0; font-size: 20px; color: #1E1B4B; font-weight: 700; line-height: 1.3;">${title}</h1>
              ${subtitle ? `<p style="font-size: 14.5px; line-height: 1.5; color: #64748B; margin: 0 0 18px 0;">${subtitle}</p>` : ''}
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 18px 0;">Dear <strong style="color: #0F172A;">${name}</strong>,</p>
              
              <!-- Styled Message Box -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 4px solid #3D3777; border-radius: 6px; margin: 18px 0 24px 0;">
                <tr>
                  <td style="padding: 18px 20px; font-size: 14.5px; line-height: 1.65; color: #334155;">
${formatBody(body)}
                  </td>
                </tr>
              </table>

              ${btn}

              <p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 24px 0 0 0;">
                Warm regards,<br>
                <strong style="color: #1E1B4B;">Placement Cell,</strong><br>
                <strong style="color: #1E1B4B;">FACE Prep Campus</strong>
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
</body></html>`;
}


async function sendMail(subject, body, actionUrl = null, buttonLabel = "View on PMS Portal", name = "Asha Devi", subtitle = null) {
  const html = formatHtml(subject, body, actionUrl, buttonLabel, name, subtitle);
  const text = `${subject}\n\n${body}\n\n${actionUrl ? `${buttonLabel}: ${actionUrl}` : ""}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "onboarding@resend.dev",
      to: [recipient],
      reply_to: "pms@faceprepcampus.com",
      subject,
      text,
      html,
    }),
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// AD1 — Rich staff invitation template (mirrors composeStaffInviteEmail in email-delivery.ts)
function buildStaffInviteHtml({ fullName, roleName, campuses, email, loginUrl }) {
  const campusesText =
    campuses && campuses.length > 0
      ? campuses.join(", ")
      : "All Campuses (Organisation-wide)";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invitation to FACE Prep Campus PMS as ${roleName}</title></head>
<body style="margin:0;padding:0;background-color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F1F5F9;padding:32px 12px;"><tr><td align="center">
    <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color:#ffffff;border-radius:10px;border:1px solid #E2E8F0;max-width:100%;">
      <tr><td height="4" style="background:linear-gradient(90deg,#3D3777 0%,#A46AFC 50%,#FFB800 100%);line-height:4px;font-size:4px;">&nbsp;</td></tr>
      <tr><td style="background-color:#3D3777;padding:24px 32px;">
        <img src="https://pms.faceprepcampus.com/brand/faceprep-campus-light.png" alt="FACE Prep Campus" width="170" height="34" style="display:block;border:0;"/>
        <div style="font-size:11px;font-weight:600;color:#E0E7FF;margin-top:6px;">Staff Onboarding</div>
      </td></tr>
      <tr><td style="padding:36px 32px;">
        <h1 style="margin:0 0 16px 0;font-size:20px;color:#1E1B4B;font-weight:700;">Welcome to the Team, ${fullName}</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 20px 0;">You have been invited to join the FACE Prep Campus Placement Management System (PMS). Your role-based permissions have been provisioned as follows:</p>
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;margin-bottom:24px;">
          <tr><td style="padding:12px 16px;font-size:13.5px;font-weight:600;color:#3D3777;width:140px;border-bottom:1px solid #E2E8F0;">Assigned Role:</td><td style="padding:12px 16px;font-size:14px;font-weight:600;color:#0F172A;border-bottom:1px solid #E2E8F0;">${roleName}</td></tr>
          <tr><td style="padding:12px 16px;font-size:13.5px;font-weight:600;color:#3D3777;border-bottom:1px solid #E2E8F0;">Campus Scope:</td><td style="padding:12px 16px;font-size:14px;color:#334155;border-bottom:1px solid #E2E8F0;">${campusesText}</td></tr>
          <tr><td style="padding:12px 16px;font-size:13.5px;font-weight:600;color:#3D3777;">Authorized Email:</td><td style="padding:12px 16px;font-size:14px;color:#334155;">${email}</td></tr>
        </table>
        <table border="0" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#3D3777" style="border-radius:6px;">
          <a href="${loginUrl}" target="_blank" style="font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;display:inline-block;padding:13px 28px;">Sign In to PMS &rarr;</a>
        </td></tr></table>
        <p style="font-size:13.5px;line-height:1.6;color:#64748B;margin:20px 0 0 0;">Use your <strong style="color:#0F172A;">Google account registered to ${email}</strong> to sign in.</p>
        <p style="font-size:14px;line-height:1.6;color:#334155;margin:24px 0 0 0;">Warm regards,<br><strong style="color:#1E1B4B;">Placement Cell,</strong><br><strong style="color:#1E1B4B;">FACE Prep Campus</strong></p>
      </td></tr>
      <tr><td style="background-color:#F8FAFC;padding:22px 32px;border-top:1px solid #E2E8F0;font-size:12px;color:#64748B;">
        <p style="margin:0 0 4px 0;font-weight:600;color:#334155;">FACE Prep Campus &bull; Focus 4D Career Education Pvt Ltd</p>
        <p style="margin:0;">For questions, write to <a href="mailto:pms@faceprepcampus.com" style="color:#3D3777;font-weight:600;">pms@faceprepcampus.com</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

async function run() {
  console.log(`Starting live template dispatch to: ${recipient}\n`);

  const tests = [
    {
      code: "S1",
      name: "Welcome & SRF Registration",
      subject: "Welcome to FACE Prep Campus — Complete Your Profile",
      title: "Complete Your Placement Profile",
      subtitle: "Please fill in all the required details to complete your placement profile.",
      body: "Your placement account for **Kamaraj College** is active on the FACE Prep Campus PMS.\n\nTo participate in upcoming campus recruitment drives, please submit your Student Registration Form (SRF) with verified academic details and semester marksheets.\n\n**Record Details:**\n• **Roll Number:** 2026CS101\n• **Degree & Branch:** B.E. Computer Science & Engineering\n• **Passing Year:** 2026",
      buttonLabel: "Complete Registration Form",
      url: `${BASE_URL}/srf`,
    },
    {
      code: "S2",
      name: "Drive Published",
      subject: "[S2] New Placement Drive: Zoho Corporation",
      body: "A new campus placement drive is open for applications:\n\n• **Company:** Zoho Corporation\n• **Role:** Software Development Engineer\n• **Drive Type:** Placement (Super Dream)\n• **Compensation:** ₹8.50 LPA\n• **Application Deadline:** 10 Sep 2026, 06:00 PM IST\n\n**Eligibility:**\n• **Minimum CGPA:** 7.50\n• **Standing Backlogs:** 0",
      buttonLabel: "View Drive & Apply",
      url: `${BASE_URL}/student/drives`,
    },
    {
      code: "S3",
      name: "Shortlist Announcement",
      subject: "[S3] Shortlisted: Zoho Corporation — Software Development Engineer",
      body: "Congratulations! Your application for **Zoho Corporation** (**Software Development Engineer**) has been shortlisted.\n\n**Round 1 is next.** Attendance in every scheduled round is mandatory. Details regarding date, time, and venue or meeting links will be updated on your dashboard shortly.",
      buttonLabel: "View Shortlist Status",
      url: `${BASE_URL}/student/drives`,
    },
    {
      code: "S4",
      name: "Round Schedule & Venue",
      subject: "[S4] Schedule: Zoho Corporation — Technical Assessment (Round 1)",
      body: "The schedule for Round 1 has been confirmed:\n\n• **Drive:** Zoho Corporation (Software Development Engineer)\n• **Round:** Technical Assessment (Round 1)\n• **Date & Time:** 12 Sep 2026, 10:00 AM IST\n• **Mode:** In person\n• **Venue:** Main Academic Block, Computer Lab 3",
      buttonLabel: "View Schedule Details",
      url: `${BASE_URL}/student/drives`,
    },
    {
      code: "S8",
      name: "Offer Letter Declared",
      subject: "[S8] Congratulations — Offer Extended by Zoho Corporation",
      body: "Heartiest congratulations!\n\n**Zoho Corporation** has extended you an offer for the position of **Software Development Engineer** (**Super Dream** category, **₹8.50 LPA**).\n\nYour formal offer letter has been uploaded to your PMS account and is ready for download.",
      buttonLabel: "Download Offer Letter",
      url: `${BASE_URL}/student/notifications`,
    },
    {
      code: "S9",
      name: "Attendance Warning",
      subject: "[S9] Attendance Notice: Zoho Corporation Drive (Round 1)",
      body: "You were recorded as **ABSENT** for Round 1 of the **Zoho Corporation** drive held on 12 Sep 2026.\n\n**Policy Notice:** Attendance in all scheduled rounds is mandatory once shortlisted. Repeated unexcused absences trigger placement disbarment review. Contact your coordinator if this was an error.",
      buttonLabel: "View Attendance Record",
      url: `${BASE_URL}/student/dashboard`,
    },
    {
      code: "M1",
      name: "Staff Onboarding Invite",
      subject: "[M1] Invitation to FACE Prep Campus PMS",
      body: "Hello Dr. K. Ramanathan,\n\nYou have been invited to join the FACE Prep Campus Placement Management System (PMS):\n\n• **Assigned Role:** Campus Placement Coordinator\n• **Assigned Campus:** Kamaraj College\n• **Login Email:** cpc@kamarajcollege.edu\n\nPlease sign in with your registered Google account to manage student verifications and placement operations.",
      buttonLabel: "Sign In to PMS Portal",
      url: `${BASE_URL}/login`,
      recipient: "Dr. K. Ramanathan (Campus Placement Coordinator)",
    },
    {
      code: "C1",
      name: "Campus Drive Alert",
      subject: "[C1] New Drive Live for Kamaraj College: Zoho Corporation (Software Development Engineer)",
      title: "New Campus Placement Drive Active",
      body: "A new placement drive has been published that targets eligible candidates from **Kamaraj College**.\n\n**Drive Overview**\n• **Company:** Zoho Corporation\n• **Role:** Software Development Engineer\n• **Compensation:** ₹8.50 LPA (Super Dream)\n• **Eligible Cohort:** B.E. CSE, ECE (2026 Batch)\n• **Eligible Campus Count:** 84 students\n\nPlease encourage eligible candidates on your campus to review the terms and apply before the application deadline.",
      buttonLabel: "View Drive Cohort",
      url: `${BASE_URL}/cpc/drives`,
      recipient: "Dr. K. Ramanathan (Campus Placement Coordinator)",
    },
    {
      code: "C2",
      name: "Campus Shortlist Ready",
      subject: "[C2] Shortlist Published: 28 Students from Kamaraj College Selected for Zoho Corporation",
      title: "Campus Candidate Shortlist Released",
      body: "The candidate shortlist for **Zoho Corporation** (**Software Development Engineer**) has been finalized and locked by Central Placements.\n\n**Shortlist Summary**\n• **Campus:** Kamaraj College\n• **Shortlisted Count:** 28 students\n• **Next Stage:** Round 1 — Technical Assessment\n\nPlease coordinate local venue preparations and ensure shortlisted candidates are informed.",
      buttonLabel: "View Shortlisted Roster",
      url: `${BASE_URL}/cpc/drives`,
      recipient: "Dr. K. Ramanathan (Campus Placement Coordinator)",
    },
    {
      code: "C3",
      name: "Verification Queue Digest",
      subject: "[C3] Verification Queue: 22 Student Profiles Awaiting Approval",
      title: "Student Profiles Pending Verification",
      body: "There are currently student registration forms awaiting academic verification on your campus portal.\n\n• **Campus:** Kamaraj College\n• **Pending Profiles:** 22 students\n• **Pending Checks:** 10th/12th marks, semester CGPA, and marksheet uploads\n\nPrompt verification ensures these students become eligible for recruitment drives.",
      buttonLabel: "Open Verification Queue",
      url: `${BASE_URL}/cpc/verification`,
      recipient: "Dr. K. Ramanathan (Campus Placement Coordinator)",
    },
    {
      code: "C4",
      name: "Semester Pending Verification",
      subject: "[C4] New Semester Added: Keerthana S (E24AI020) Pending Verification",
      title: "Semester Record Pending Verification",
      body: "A student has uploaded a new semester academic record and marksheet for verification.\n\n• **Student Name:** Keerthana S\n• **Roll Number:** E24AI020\n• **Semester:** Semester 4\n• **Declared CGPA:** 8.32\n\nPlease verify the declared score against the uploaded marksheet document.",
      buttonLabel: "Verify Semester Record",
      url: `${BASE_URL}/cpc/semesters`,
      recipient: "Dr. K. Ramanathan (Campus Placement Coordinator)",
    },
    {
      code: "C6",
      name: "Campus Student Placed",
      subject: "[C6] Placement Success: Keerthana S Placed at Zoho Corporation (₹8.50 LPA)",
      title: "Campus Student Placement",
      body: "Congratulations! A candidate from your campus has secured a placement offer.\n\n**Placement Summary**\n• **Student:** Keerthana S (E24AI020)\n• **Degree & Branch:** B.Sc Computer Science with AI\n• **Company:** Zoho Corporation\n• **Role:** Software Development Engineer\n• **Offer Category:** Super Dream (₹8.50 LPA)",
      buttonLabel: "View Drive Progress",
      url: `${BASE_URL}/cpc/drives`,
      recipient: "Dr. K. Ramanathan (Campus Placement Coordinator)",
    },
    {
      code: "C7",
      name: "Off-Campus Offer Proof",
      subject: "[C7] Action Required: Off-Campus Placement Proof Submitted by Asha Devi",
      title: "Off-Campus Offer Verification Required",
      body: "A student has submitted an external off-campus placement offer letter for institutional verification.\n\n• **Student:** Asha Devi (2026CS101)\n• **Company:** Freshworks Inc\n• **Declared Role:** Product Operations Associate\n• **Declared CTC:** ₹6.50 LPA\n\nPlease inspect the uploaded offer letter and complete submission.",
      buttonLabel: "Review Off-Campus Queue",
      url: `${BASE_URL}/cpc/off-campus`,
      recipient: "Dr. K. Ramanathan (Campus Placement Coordinator)",
    },
    {
      code: "CP2",
      name: "Applications Closed",
      subject: "[CP2] Applications Closed: Zoho Corporation — 148 Candidates Ready for Shortlisting",
      title: "Drive Applications Closed",
      body: "The student application deadline for **Zoho Corporation** (**Software Development Engineer**) has passed.\n\n**Application Summary**\n• **Total Applicants:** 148 candidates\n• **Campus Breakdown:**\n  – Kamaraj College: 84 applicants\n  – SDNB Vaishnav College: 64 applicants\n• **Drive Category:** Super Dream (₹8.50 LPA)\n• **Next Step:** Review criteria, filter candidates, and lock shortlist\n\nPlease proceed to candidate screening to generate the verified shortlist.",
      buttonLabel: "Open Shortlisting Console",
      url: `${BASE_URL}/central/shortlisting`,
      recipient: "Central Placement Coordinator",
    },
    {
      code: "CP4",
      name: "All Rounds Completed",
      subject: "[CP4] All Rounds Concluded: Zoho Corporation — Ready for Offer Issuance",
      title: "Placement Drive Completed",
      body: "All scheduled interview rounds for **Zoho Corporation** (**Software Development Engineer**) have concluded.\n\n**Selection Summary**\n• **Total Rounds Completed:** 3 rounds\n• **Selected Candidates:** 6 candidates\n• **Next Step:** Upload formal offer letters and release offers to students\n\nPlease review the final select list and issue offers.",
      buttonLabel: "Issue Placement Offers",
      url: `${BASE_URL}/central/offers`,
      recipient: "Central Placement Coordinator",
    },
    {
      code: "A1",
      name: "PIF Approved",
      subject: "[A1] Good News: PIF for Zoho Corporation Approved as Super Dream",
      title: "Placement Initiation Form Approved",
      body: "The Placement Initiation Form (PIF) you drafted for **Zoho Corporation** has been reviewed and approved by the Delivery Head.\n\n**Approved Details**\n• **Company:** Zoho Corporation\n• **Role:** Software Development Engineer\n• **Category Assigned:** Super Dream (₹8.50 LPA)\n• **Next Stage:** Central CPC is configuring rounds and targeting\n\nThe account is progressing to live candidate sourcing.",
      buttonLabel: "View Sourced Drives",
      url: `${BASE_URL}/my-drives`,
      recipient: "Anil Kumar (Account Executive)",
    },
    {
      code: "A2",
      name: "PIF Revision Requested",
      subject: "[A2] Action Required: PIF Revision Requested for Zoho Corporation",
      title: "PIF Requires Changes",
      body: "The Delivery Head has reviewed the Placement Initiation Form (PIF) for **Zoho Corporation** and requested clarifications before approval.\n\n• **Company:** Zoho Corporation\n• **Role:** Software Development Engineer\n• **Feedback Remarks:** Clarify service bond period and confirm internship stipend terms.\n\nPlease update the submission with required details and resubmit for approval.",
      buttonLabel: "Revise PIF Details",
      url: `${BASE_URL}/ae/pif`,
      recipient: "Anil Kumar (Account Executive)",
    },
    {
      code: "A3",
      name: "Drive Live to Students",
      subject: "[A3] Your Account is Live: Zoho Corporation Published to 320 Eligible Candidates",
      title: "Placement Drive Published",
      body: "The recruitment drive for **Zoho Corporation** (**Software Development Engineer**) is now live across campuses.\n\n• **Eligible Cohort:** 320 candidates across 2 institutions\n• **Application Window:** Closes 10 Sep 2026, 6:00 PM IST\n\nYou can track applicant inflow and corporate milestones from your AE Overview.",
      buttonLabel: "View Account Overview",
      url: `${BASE_URL}/ae/overview`,
      recipient: "Anil Kumar (Account Executive)",
    },
    {
      code: "DH1",
      name: "PIF Submitted",
      subject: "[DH1] Action Required: PIF Submitted for Zoho Corporation by Anil Kumar",
      title: "Placement Initiation Form Under Review",
      body: "A new Placement Initiation Form (PIF) has been submitted and is ready for governance review.\n\n• **Company:** Zoho Corporation\n• **Role:** Software Development Engineer\n• **Drive Type:** Full-time Placement\n• **Declared CTC:** ₹8.50 LPA\n• **Submitted By:** Anil Kumar\n\nPlease inspect recruiter terms, compensation structure, and job description to approve or return the PIF.",
      buttonLabel: "Open PIF Approvals",
      url: `${BASE_URL}/delivery-head/pif-approvals`,
      recipient: "Delivery Head",
    },
    {
      code: "DH2",
      name: "Policy Override Alert",
      subject: "[DH2] Governance Alert: Placement Policy Override Requested for Zoho Corporation",
      title: "Placement Policy Override Request",
      body: "A placement policy override has been requested for candidate eligibility.\n\n• **Drive:** Zoho Corporation (Software Development Engineer)\n• **Requested By:** Central Placement Coordinator\n• **Override Type:** Open-to-all override / Category ladder exemption\n• **Justification:** Specialized niche skills assessment required by employer.\n\nPlease review and approve or decline the policy override.",
      buttonLabel: "Review Policy Override",
      url: `${BASE_URL}/delivery-head/pif-approvals`,
      recipient: "Delivery Head",
    },
    {
      code: "DH3",
      name: "Weekly Operations Digest",
      subject: "[DH3] Weekly Placement Operations Summary: 12 Active Drives, 42 Offers Extended",
      title: "Weekly Placement Operations Summary",
      body: "Here is the weekly executive operations summary across all institutions for the week ending 15 Sep 2026.\n\n**Key Operational Metrics**\n• **Active Sourcing Drives:** 12 drives live\n• **Drives in Assessment:** 5 drives conducting interview rounds\n• **Offers Extended This Week:** 42 confirmed offers\n• **Average Realized CTC:** ₹6.40 LPA\n\nDetailed operational metrics and campus distributions are available on your executive cockpit.",
      buttonLabel: "Open Operations Cockpit",
      url: `${BASE_URL}/dashboard`,
      recipient: "Delivery Head",
    },
  ];

  for (const t of tests) {
    console.log(`Dispatching [${t.code}] ${t.name}...`);
    const res = await sendMail(t.title || t.subject, t.body, t.url, t.buttonLabel, t.recipient || "Asha Devi", t.subtitle);
    if (res.ok) {
      console.log(`  -> SUCCESS! Delivered | Resend ID: ${res.data.id}`);
    } else {
      console.log(`  -> FAILED: HTTP ${res.status} |`, res.data);
    }
    // 600ms pacing to respect Resend rate limit
    await new Promise((r) => setTimeout(r, 650));
  }

  console.log(`\nAll ${tests.length} main templates dispatched.`);

  // ── AD1: Staff Invitation (dedicated rich template) ──
  console.log("\nDispatching [AD1] Staff Invitation (rich staff-invite template)...");
  const ad1Subject = "[AD1] Invitation to FACE Prep Campus PMS as Campus Placement Coordinator";
  const ad1Html = buildStaffInviteHtml({
    fullName: "Dr. K. Ramanathan",
    roleName: "Campus Placement Coordinator",
    campuses: ["Kamaraj College"],
    email: "cpc@kamarajcollege.edu",
    loginUrl: `${BASE_URL}/login`,
  });
  const ad1Text = `${ad1Subject}\n\nYou have been invited to join the FACE Prep Campus Placement Management System (PMS).\n\nAssigned Role: Campus Placement Coordinator\nCampus Scope: Kamaraj College\nAuthorized Email: cpc@kamarajcollege.edu\n\nSign in at: ${BASE_URL}/login`;
  const ad1Res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "onboarding@resend.dev",
      to: [recipient],
      reply_to: "pms@faceprepcampus.com",
      subject: ad1Subject,
      text: ad1Text,
      html: ad1Html,
    }),
  });
  const ad1Data = await ad1Res.json().catch(() => ({}));
  if (ad1Res.ok) {
    console.log(`  -> SUCCESS! Delivered | Resend ID: ${ad1Data.id}`);
  } else {
    console.log(`  -> FAILED: HTTP ${ad1Res.status} |`, ad1Data);
  }

  console.log(`\n✅ All ${tests.length + 1} templates dispatched to ${recipient}!`);
}

run().catch(console.error);
