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

  if (current === "queued") {
    return event === "sent" ? "sent" : event;
  }

  if (current === "sent" || current === "delayed" || current === "failed") {
    return event;
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


export interface ComposedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface NotificationEmailInput {
  readonly title: string;
  readonly body: string;
  readonly recipientName?: string;
  readonly actionUrl?: string;
}

/**
 * Composes a standard transactional notification email adhering to FACE Prep Campus styling.
 */
export function composeNotificationEmail(input: NotificationEmailInput): ComposedEmail {
  const name = input.recipientName?.trim() || "Candidate";
  const actionButton = input.actionUrl
    ? `\n\nView details: ${input.actionUrl}`
    : "";

  const text = `Dear ${name},\n\n${input.body}${actionButton}\n\nWarm regards,\nPlacement Cell, FACE Prep Campus\nNeed help? Contact hello@faceprep.in`;

  const buttonHtml = input.actionUrl
    ? `<table border="0" cellpadding="0" cellspacing="0" style="margin-top: 24px; margin-bottom: 8px;">
        <tr>
          <td align="center" bgcolor="#3D3777" style="border-radius: 6px;">
            <a href="${input.actionUrl}" target="_blank" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; display: inline-block; padding: 13px 28px; letter-spacing: 0.2px;">
              View on PMS Portal &rarr;
            </a>
          </td>
        </tr>
      </table>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${input.title}</title>
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
              <h1 style="margin: 0 0 16px 0; font-size: 20px; color: #1E1B4B; font-weight: 700; line-height: 1.3;">${input.title}</h1>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 18px 0;">Dear <strong style="color: #0F172A;">${name}</strong>,</p>
              
              <!-- Styled Message Box -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 4px solid #3D3777; border-radius: 6px; margin: 18px 0 24px 0;">
                <tr>
                  <td style="padding: 18px 20px; font-size: 14.5px; line-height: 1.65; color: #334155; white-space: pre-line;">
${input.body}
                  </td>
                </tr>
              </table>

              ${buttonHtml}

              <p style="font-size: 13.5px; line-height: 1.5; color: #64748B; margin: 24px 0 0 0;">
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
</body>
</html>`;

  return {
    subject: input.title,
    text,
    html,
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
  const loginUrl = input.loginUrl || "https://faceprepcampus.com/login";
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
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left" valign="middle">
                    <img src="https://fpc-pms.faceprep.workers.dev/brand/faceprep-campus-light.png" alt="FACE Prep Campus" height="34" style="height: 34px; width: auto; max-height: 34px; display: block; border: 0;" />
                    <div style="font-size: 11px; font-weight: 600; color: #E0E7FF; letter-spacing: 0.8px; text-transform: uppercase; margin-top: 6px;">Staff Onboarding</div>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display: inline-block; background-color: rgba(255, 255, 255, 0.12); color: #FFB800; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; padding: 4px 10px; border-radius: 12px; text-transform: uppercase; border: 1px solid rgba(255, 184, 0, 0.3);">Staff Invite</span>
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
              <p style="margin: 0 0 4px 0; font-weight: 600; color: #334155;">FACE Prep Campus Administration &bull; Focus 4D Career Education Pvt Ltd</p>
              <p style="margin: 0;">Automated account provisioning notice. For queries, contact <a href="mailto:hello@faceprep.in" style="color: #3D3777; font-weight: 600; text-decoration: underline;">hello@faceprep.in</a></p>
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
  };
}
