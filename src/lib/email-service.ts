import {
  resolveRecipient,
  toEmailBatches,
} from "@domain/email-delivery";

export interface SendEmailPayload {
  readonly to: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly from?: string;
  readonly replyTo?: string;
}

export interface SendEmailResult {
  readonly success: boolean;
  readonly id?: string;
  readonly error?: string;
  readonly recipient: string;
}

export interface EmailProvider {
  send(payload: SendEmailPayload): Promise<SendEmailResult>;
  sendBatch(payloads: readonly SendEmailPayload[]): Promise<readonly SendEmailResult[]>;
}

export interface ResendEmailProviderOptions {
  readonly apiKey: string;
  readonly from?: string | undefined;
  readonly replyTo?: string | undefined;
  readonly overrideRecipient?: string | null | undefined;
  readonly fetchFn?: typeof fetch | undefined;
}

export const DEFAULT_RESEND_FROM = "FACE Prep Campus <placements@email.faceprep.in>";
export const DEFAULT_RESEND_DEV_FROM = "onboarding@resend.dev";
export const DEFAULT_RESEND_REPLY_TO = "placements@faceprep.in";

/**
 * Resend Email Provider implementation.
 * Encapsulates single and batch email transmissions to Resend.
 */
export class ResendEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly replyTo: string;
  private readonly overrideRecipient: string | null;
  private readonly fetchFn: typeof fetch;

  constructor(options: ResendEmailProviderOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from ?? DEFAULT_RESEND_DEV_FROM;
    this.replyTo = options.replyTo ?? DEFAULT_RESEND_REPLY_TO;
    this.overrideRecipient = options.overrideRecipient ?? null;
    this.fetchFn = options.fetchFn ?? fetch;
  }


  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    const resolved = resolveRecipient(payload.to, this.overrideRecipient);

    let textBody = payload.text || "";
    let htmlBody = payload.html;

    if (resolved.isOverridden) {
      const notice = `[Dev Routing Note: Intended recipient was ${resolved.originalRecipient}]`;
      textBody = `${notice}\n\n${textBody}`;
      if (htmlBody) {
        htmlBody = `<div style="background: #FFFBEB; border: 1px solid #FCD34D; color: #92400E; padding: 10px; border-radius: 4px; font-size: 12px; margin-bottom: 12px;"><strong>Dev Routing:</strong> Intended recipient was <code>${resolved.originalRecipient}</code></div>${htmlBody}`;
      }
    }

    try {
      const response = await this.fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: payload.from || this.from,
          to: [resolved.to],
          reply_to: payload.replyTo || this.replyTo,
          subject: payload.subject,
          text: textBody,
          html: htmlBody,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMsg = data?.message || `HTTP ${response.status}: Failed to send email`;
        return {
          success: false,
          error: errorMsg,
          recipient: resolved.to,
        };
      }

      return {
        success: true,
        id: data?.id,
        recipient: resolved.to,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        recipient: resolved.to,
      };
    }
  }

  async sendBatch(payloads: readonly SendEmailPayload[]): Promise<readonly SendEmailResult[]> {
    if (payloads.length === 0) return [];

    const batches = toEmailBatches(payloads, 100);
    const results: SendEmailResult[] = [];

    for (const batch of batches) {
      const formattedBatch = batch.map((item) => {
        const resolved = resolveRecipient(item.to, this.overrideRecipient);
        let textBody = item.text || "";
        let htmlBody = item.html;

        if (resolved.isOverridden) {
          const notice = `[Dev Routing Note: Intended recipient was ${resolved.originalRecipient}]`;
          textBody = `${notice}\n\n${textBody}`;
          if (htmlBody) {
            htmlBody = `<div style="background: #FFFBEB; border: 1px solid #FCD34D; color: #92400E; padding: 10px; border-radius: 4px; font-size: 12px; margin-bottom: 12px;"><strong>Dev Routing:</strong> Intended recipient was <code>${resolved.originalRecipient}</code></div>${htmlBody}`;
          }
        }

        return {
          from: item.from || this.from,
          to: [resolved.to],
          reply_to: item.replyTo || this.replyTo,
          subject: item.subject,
          text: textBody,
          html: htmlBody,
          _resolvedRecipient: resolved.to,
        };
      });

      try {
        const response = await this.fetchFn("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            formattedBatch.map(({ _resolvedRecipient, ...cleanItem }) => cleanItem),
          ),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const err = data?.message || `HTTP ${response.status}: Failed batch send`;
          for (const item of formattedBatch) {
            results.push({
              success: false,
              error: err,
              recipient: item._resolvedRecipient,
            });
          }
        } else {
          const resData = Array.isArray(data?.data) ? data.data : [];
          for (let i = 0; i < formattedBatch.length; i++) {
            const item = formattedBatch[i]!;
            const itemRes = resData[i];
            results.push({
              success: true,
              id: itemRes?.id,
              recipient: item._resolvedRecipient,
            });
          }
        }
      } catch (err: any) {
        const errMsg = err instanceof Error ? err.message : String(err);
        for (const item of formattedBatch) {
          results.push({
            success: false,
            error: errMsg,
            recipient: item._resolvedRecipient,
          });
        }
      }
    }

    return results;
  }
}

/**
 * Creates the default configured EmailService instance.
 * Defaults all emails to Thanush (thanush@faceprep.in) for development safety.
 */
export function createEmailService(options?: ResendEmailProviderOptions): EmailProvider {
  const apiKey =
    options?.apiKey ??
    (typeof process !== "undefined" ? process.env?.RESEND_API_KEY : undefined) ??
    "re_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp";

  const overrideRecipient =
    options?.overrideRecipient !== undefined
      ? options.overrideRecipient
      : ((typeof process !== "undefined" ? process.env?.EMAIL_OVERRIDE_RECIPIENT : undefined) ??
        "thanush@faceprep.in");

  const from =
    options?.from ??
    (typeof process !== "undefined" ? process.env?.RESEND_FROM_EMAIL : undefined) ??
    DEFAULT_RESEND_DEV_FROM;

  return new ResendEmailProvider({
    apiKey,
    from,
    overrideRecipient,
    fetchFn: options?.fetchFn,
  });
}

