import { JOB_DESCRIPTION_BUCKET } from "@domain/attachments";
import { decidePif, type PifDecision } from "@domain/drive-lifecycle";
import { describeJoining } from "@domain/joining";
import { describeShift } from "@domain/shift";
import type { DriveStatus, DriveType } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class ApprovalError extends Error {}

export interface PendingDriveEventContact {
  readonly name: string | null;
  readonly designation: string | null;
  readonly email: string | null;
  readonly phone: string | null;
}

/** The recruitment event a pending role belongs to, when it has one. */
export interface PendingDriveEvent {
  readonly id: string;
  readonly companyName: string;
  readonly tentativeDate: string | null;
  readonly driveMode: string | null;
  readonly venue: string | null;
  readonly contacts: readonly PendingDriveEventContact[];
}

export interface PendingPif {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly ctcMinLpa: number | null;
  readonly ctcMaxLpa: number | null;
  /**
   * 2026-08-27: an internship pays a monthly stipend and has no CTC. The
   * Delivery Head was approving the commercials of a role without being shown
   * the only number it had.
   */
  readonly stipendMinMonthly: number | null;
  readonly stipendMaxMonthly: number | null;
  readonly driveType: DriveType | null;
  readonly onHold: boolean;
  readonly createdAt: string | null;
  /**
   * J1 (answer 10): the recruiter's own JD, behind a short-lived signed link.
   * Null when none was attached, and null when the link could not be signed —
   * a queue that refuses to load over one unreachable file would stop every
   * approval in the organisation.
   */
  readonly jobDescriptionUrl: string | null;
  readonly jobDescriptionName: string | null;
  /** J2/J3, already worded by the domain so no screen re-words them. */
  readonly shift: string;
  readonly joining: string;
  /** Set when this role was raised under a recruitment event (multi-role PIF). */
  readonly companyDriveId: string | null;
  readonly event: PendingDriveEvent | null;
}

export interface ApprovalRepository {
  pending(): Promise<readonly PendingPif[]>;
  decide(
    driveId: string,
    current: DriveStatus,
    decision: PifDecision,
    driveType?: DriveType | null,
  ): Promise<void>;
}

export type GetActorId = () => Promise<string | null>;

// One string literal, deliberately: PostgREST infers the row type from the
// literal, and a concatenation types every column as an error object.
export const COLUMNS =
  "id, company_name, role_title, ctc_min_lpa, ctc_max_lpa, stipend_min_monthly, stipend_max_monthly, drive_type, on_hold, created_at, jd_storage_path, jd_file_name, shift_type, shift_night_timing, joining_timeline, joining_immediate_notes, joining_later_notes, timeline_notes";

/** Long enough to open and read the PDF, short enough not to be forwardable. */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

/**
 * The Delivery Head's queue.
 *
 * The decision itself belongs to `decidePif`: approving without an offer
 * category, or touching anything that is not awaiting approval, is refused
 * before it can reach the network. The database enforces the same rules again
 * (0004 has a check constraint requiring a reason on rejection) - this is the
 * near side of that pair, not a replacement for it.
 */
export function createSupabaseApprovalRepository(
  client: SupabaseClient,
  getActorId: GetActorId = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
): ApprovalRepository {
  return {
    async pending() {
      const { data, error } = await client
        .from("drives")
        .select(COLUMNS)
        .eq("status", "submitted")
        .order("created_at", { ascending: true });

      if (error !== null) throw new ApprovalError("Could not load the approval queue.");

      const rows = data ?? [];

      /**
       * One batch call for the whole queue rather than one per card, and no
       * call at all when nothing is attached.
       *
       * A failure here is deliberately swallowed: the JD is evidence beside
       * the decision, not the decision. Losing the queue because one object
       * cannot be signed would stop every approval in the organisation.
       */
      const paths = rows
        .map((row) => row.jd_storage_path as string | null)
        .filter((path): path is string => typeof path === "string" && path !== "");

      const signed = new Map<string, string>();
      if (paths.length > 0) {
        const { data: links } = await client.storage
          .from(JOB_DESCRIPTION_BUCKET)
          .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

        for (const link of links ?? []) {
          if (link.path !== null && link.signedUrl !== null && link.signedUrl !== undefined) {
            signed.set(link.path, link.signedUrl);
          }
        }
      }

      /**
       * Event context for multi-role submissions: one batch for the events and
       * one for their contacts, never one per card. Like the JD links, a
       * failure here is degraded rather than fatal — the queue falls back to
       * standalone cards, because losing every approval over presentation
       * context would stop the organisation.
       */
      const eventIds = [
        ...new Set(
          rows
            .map((row) => (row as Record<string, unknown>).company_drive_id as string | null)
            .filter((id): id is string => typeof id === "string" && id !== ""),
        ),
      ];

      const events = new Map<string, PendingDriveEvent>();
      if (eventIds.length > 0) {
        const [{ data: eventRows, error: eventError }, { data: contactRows, error: contactError }] =
          await Promise.all([
            client
              .from("company_drives")
              .select("id, company_name, drive_mode, venue, tentative_date")
              .in("id", eventIds),
            client
              .from("company_drive_contacts")
              .select("company_drive_id, sequence, name, designation, email, phone")
              .in("company_drive_id", eventIds)
              .order("sequence", { ascending: true }),
          ]);

        if (eventError === null && contactError === null) {
          const contactsByEvent = new Map<string, PendingDriveEventContact[]>();
          for (const contact of (contactRows ?? []) as readonly {
            company_drive_id: string;
            name: string | null;
            designation: string | null;
            email: string | null;
            phone: string | null;
          }[]) {
            const list = contactsByEvent.get(contact.company_drive_id) ?? [];
            list.push({
              name: contact.name,
              designation: contact.designation,
              email: contact.email,
              phone: contact.phone,
            });
            contactsByEvent.set(contact.company_drive_id, list);
          }

          for (const event of (eventRows ?? []) as readonly {
            id: string;
            company_name: string;
            drive_mode: string | null;
            venue: string | null;
            tentative_date: string | null;
          }[]) {
            events.set(event.id, {
              id: event.id,
              companyName: event.company_name,
              tentativeDate: event.tentative_date,
              driveMode: event.drive_mode,
              venue: event.venue,
              contacts: contactsByEvent.get(event.id) ?? [],
            });
          }
        }
      }

      return rows.map((row) => ({
        id: row.id as string,
        companyName: row.company_name as string,
        roleTitle: (row.role_title as string | null) ?? null,
        ctcMinLpa: (row.ctc_min_lpa as number | null) ?? null,
        ctcMaxLpa: (row.ctc_max_lpa as number | null) ?? null,
        stipendMinMonthly: (row.stipend_min_monthly as number | null) ?? null,
        stipendMaxMonthly: (row.stipend_max_monthly as number | null) ?? null,
        driveType: (row.drive_type as DriveType | null) ?? null,
        onHold: Boolean(row.on_hold),
        createdAt: (row.created_at as string | null) ?? null,
        jobDescriptionUrl: signed.get((row.jd_storage_path as string | null) ?? "") ?? null,
        jobDescriptionName: (row.jd_file_name as string | null) ?? null,
        companyDriveId:
          ((row as Record<string, unknown>).company_drive_id as string | null) ?? null,
        event:
          events.get(((row as Record<string, unknown>).company_drive_id as string | null) ?? "") ??
          null,
        shift: describeShift(
          row.shift_type as string | null,
          row.shift_night_timing as string | null,
        ),
        // The legacy prose is the fallback: a drive raised before the radio
        // existed keeps its whole joining story in `timeline_notes`.
        joining: describeJoining(
          row.joining_timeline as string | null,
          ((row.joining_immediate_notes ?? row.joining_later_notes) as string | null) ??
            (row.timeline_notes as string | null),
        ),
      }));
    },

    async decide(driveId, current, decision, driveType) {
      const outcome = decidePif(current, decision, driveType);
      if (!outcome.ok) throw new ApprovalError(outcome.error);

      const actorId = await getActorId();
      if (actorId === null) {
        throw new ApprovalError("Your session has expired. Please sign in again.");
      }

      const patch =
        decision.decision === "approve"
          ? {
              status: outcome.next,
              // Set here and never again: §3.3 makes it immutable.
              offer_category: decision.offerCategory,
              approved_by: actorId,
              approved_at: new Date().toISOString(),
            }
          : {
              status: outcome.next,
              rejection_reason: decision.reason,
              approved_by: actorId,
              approved_at: new Date().toISOString(),
            };

      const { data, error } = await client
        .from("drives")
        .update(patch)
        .eq("id", driveId)
        .eq("status", current)
        .select("id, status")
        .maybeSingle();

      if (error !== null) {
        throw new ApprovalError("Could not save the decision. Please try again.");
      }

      if (data === null || data === undefined) {
        throw new ApprovalError(
          "Someone else has already made a decision on this drive. Refresh the page and try again.",
        );
      }
    },
  };
}
