const apiKey = "re_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp";
const recipient = "operationsfpc@faceprep.in";

function formatHtml(title, body, actionUrl = null, name = "Asha Devi") {
  const btn = actionUrl
    ? `<table border="0" cellpadding="0" cellspacing="0" style="margin-top: 24px; margin-bottom: 8px;">
        <tr>
          <td align="center" bgcolor="#3D3777" style="border-radius: 6px;">
            <a href="${actionUrl}" target="_blank" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; display: inline-block; padding: 13px 28px; letter-spacing: 0.2px;">
              View on PMS Portal &rarr;
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
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left" valign="middle">
                    <img src="https://fpc-pms.faceprep.workers.dev/brand/faceprep-campus-light.png" alt="FACE Prep Campus" height="34" style="height: 34px; width: auto; max-height: 34px; display: block; border: 0;" />
                    <div style="font-size: 11px; font-weight: 600; color: #E0E7FF; letter-spacing: 0.8px; text-transform: uppercase; margin-top: 6px;">Placement Management System</div>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display: inline-block; background-color: rgba(255, 255, 255, 0.12); color: #FFB800; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; padding: 4px 10px; border-radius: 12px; text-transform: uppercase; border: 1px solid rgba(255, 184, 0, 0.3);">Official Notice</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Main Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 20px; color: #1E1B4B; font-weight: 700; line-height: 1.3;">${title}</h1>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 18px 0;">Dear <strong style="color: #0F172A;">${name}</strong>,</p>
              
              <!-- Styled Message Box -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 4px solid #3D3777; border-radius: 6px; margin: 18px 0 24px 0;">
                <tr>
                  <td style="padding: 18px 20px; font-size: 14.5px; line-height: 1.65; color: #334155; white-space: pre-line;">
${body}
                  </td>
                </tr>
              </table>

              ${btn}

              <p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 24px 0 0 0;">
                Please ensure you review all drive requirements and schedules on your student dashboard.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #F8FAFC; padding: 22px 32px; border-top: 1px solid #E2E8F0; font-size: 12px; color: #64748B; line-height: 1.6;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left">
                    <p style="margin: 0 0 4px 0; font-weight: 600; color: #334155;">FACE Prep Campus &bull; Focus 4D Career Education Pvt Ltd</p>
                    <p style="margin: 0;">For questions, contact your coordinator or write to <a href="mailto:hello@faceprep.in" style="color: #3D3777; font-weight: 600; text-decoration: underline;">hello@faceprep.in</a></p>
                  </td>
                  <td align="right" valign="top">
                    <span style="font-size: 11px; color: #94A3B8;">Confidential</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`;
}


async function sendMail(subject, body, actionUrl = null) {
  const html = formatHtml(subject, body, actionUrl);
  const text = `${subject}\n\n${body}\n\n${actionUrl || ""}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "onboarding@resend.dev",
      to: [recipient],
      reply_to: "placements@faceprep.in",
      subject,
      text,
      html,
    }),
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function run() {
  console.log(`Starting live template dispatch to: ${recipient}\n`);

  const tests = [
    {
      code: "S1",
      name: "Welcome & SRF Registration",
      subject: "[S1] Welcome to FACE Prep Campus Placements — Complete Your Profile",
      body: "Your placement account for Kamaraj College is active. To participate in upcoming drives, please complete your Student Registration Form (SRF).\n\n• Roll Number: 2026CS101\n• Branch: Computer Science & Engineering\n• Passing Year: 2026",
      url: "https://faceprepcampus.com/student/srf",
    },
    {
      code: "S2",
      name: "Drive Published",
      subject: "[S2] New Drive: Zoho Corporation is hiring for Software Engineer",
      body: "A new placement drive has been announced for your cohort.\n\n• Company: Zoho Corporation\n• Role: Software Engineer\n• Package: 8.50 LPA (Super Dream)\n• Application Due: 10 Sep 2026, 06:00 PM IST",
      url: "https://faceprepcampus.com/student/drives/d1",
    },
    {
      code: "S3",
      name: "Shortlist Announcement",
      subject: "[S3] Shortlisted: You are shortlisted for Zoho Corporation",
      body: "Congratulations! You have been shortlisted for the Zoho Corporation placement drive. Round 1 is next — please check your dashboard for the upcoming schedule.",
      url: "https://faceprepcampus.com/student/drives/d1",
    },
    {
      code: "S4",
      name: "Round Schedule & Venue",
      subject: "[S4] Zoho Corporation — Technical Assessment Round 1 Schedule",
      body: "The schedule for Round 1 of Zoho Corporation is confirmed:\n\n• Date & Time: 12 Sep 2026, 10:00 AM IST\n• Mode: Physical (On Campus)\n• Venue: Main Academic Block, Lab 3\n• Instructions: Please bring your college ID card and resume.",
      url: "https://faceprepcampus.com/student/drives/d1",
    },
    {
      code: "S8",
      name: "Offer Letter Declared",
      subject: "[S8] Congratulations — Offer from Zoho Corporation (Super Dream)!",
      body: "Zoho Corporation has extended you an offer for the position of Software Development Engineer at ₹8.50 LPA. Your formal offer letter has been uploaded to the PMS portal.",
      url: "https://faceprepcampus.com/student/notifications",
    },
    {
      code: "S9",
      name: "Attendance Warning",
      subject: "[S9] Urgent: Attendance Notice for Zoho Corporation Drive",
      body: "You were recorded as absent for Round 1 of the Zoho Corporation drive. Attendance in all scheduled rounds is mandatory. Repeated absences trigger placement disbarment review. Contact your coordinator if this was an error.",
      url: "https://faceprepcampus.com/student/dashboard",
    },
    {
      code: "M1",
      name: "Staff Onboarding Invite",
      subject: "[M1] Invitation to FACE Prep Campus PMS as Campus Placement Coordinator",
      body: "Hello Dr. K. Ramanathan,\n\nYou have been invited to join the FACE Prep Campus Placement Management System.\n\n• Assigned Role: Campus Placement Coordinator\n• Assigned Campus: Kamaraj College\n• Login Email: cpc@kamarajcollege.edu\n\nPlease sign in using your Google account to access your account.",
      url: "https://faceprepcampus.com/login",
    },
  ];

  for (const t of tests) {
    console.log(`Dispatching [${t.code}] ${t.name}...`);
    const res = await sendMail(t.subject, t.body, t.url);
    if (res.ok) {
      console.log(`  -> SUCCESS! Delivered | Resend ID: ${res.data.id}`);
    } else {
      console.log(`  -> FAILED: HTTP ${res.status} |`, res.data);
    }
    // 600ms pacing to respect Resend rate limit
    await new Promise((r) => setTimeout(r, 650));
  }

  console.log(`\nAll 7 test templates dispatched successfully to ${recipient}!`);
}

run().catch(console.error);
