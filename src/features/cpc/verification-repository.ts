import { decideSrf, type SrfDecision } from "@domain/srf-decision";
import type { SrfStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class VerificationError extends Error {}

/** A marksheet the coordinator must check the figures against (PRD §4.2). */
export interface StudentDocument {
  readonly kind: string;
  readonly label: string;
  /** Short-lived signed URL. Buckets are private; nothing is ever public. */
  readonly url: string;
}

export interface PendingSrf {
  readonly id: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly overallCgpa: number | null;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  readonly tenthPercentage: number | null;
  readonly twelfthPercentage: number | null;
  readonly submittedAt: string | null;
  readonly documents: readonly StudentDocument[];
}

const DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  tenth_marksheet: "10th marksheet",
  twelfth_marksheet: "12th marksheet",
  semester_marksheet: "Semester marksheet",
};

/** Signed URLs expire; 10 minutes is ample for a verification pass. */
const SIGNED_URL_TTL_SECONDS = 600;

export interface VerificationRepository {
  pending(): Promise<readonly PendingSrf[]>;
  decide(studentId: string, current: SrfStatus, decision: SrfDecision): Promise<void>;
}

export type GetActorId = () => Promise<string | null>;

const COLUMNS =
  "id, full_name, roll_number, overall_cgpa, current_arrears, history_of_arrears, tenth_percentage, twelfth_percentage, srf_submitted_at, student_documents(kind, storage_path)";

/**
 * Reads and decides the SRF verification queue.
 *
 * No campus filter: RLS already scopes a coordinator to their own campuses.
 * Re-filtering here would be a weaker duplicate of a rule the database owns,
 * and would quietly diverge the day the policy changes.
 *
 * The transition itself is decided by `decideSrf` in the domain layer, never
 * here - an invalid transition must not reach the network at all.
 */
async function signDocuments(
  client: SupabaseClient,
  rows: Array<{ kind: string; storage_path: string }>,
): Promise<readonly StudentDocument[]> {
  const marksheets = rows.filter((d) => d.kind !== "resume");
  if (marksheets.length === 0) return [];

  const { data } = await client.storage.from("marksheets").createSignedUrls(
    marksheets.map((d) => d.storage_path),
    SIGNED_URL_TTL_SECONDS,
  );

  return marksheets.flatMap((doc, index) => {
    const url = data?.[index]?.signedUrl;
    // A document we cannot sign is omitted rather than rendered as a dead
    // link: a coordinator must never think they have checked something.
    if (!url) return [];
    return [{ kind: doc.kind, label: DOCUMENT_LABELS[doc.kind] ?? "Marksheet", url }];
  });
}

export function createSupabaseVerificationRepository(
  client: SupabaseClient,
  getActorId: GetActorId = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
): VerificationRepository {
  return {
    async pending() {
      const { data, error } = await client
        .from("students")
        .select(COLUMNS)
        .eq("srf_status", "srf_submitted")
        .order("srf_submitted_at", { ascending: true });

      if (error !== null) {
        throw new VerificationError("Could not load the verification queue.");
      }

      return await Promise.all(
        (data ?? []).map(async (row) => ({
          id: row.id as string,
          fullName: row.full_name as string,
          rollNumber: row.roll_number as string,
          overallCgpa: (row.overall_cgpa as number | null) ?? null,
          currentArrears: (row.current_arrears as number | null) ?? 0,
          historyOfArrears: (row.history_of_arrears as number | null) ?? 0,
          tenthPercentage: (row.tenth_percentage as number | null) ?? null,
          twelfthPercentage: (row.twelfth_percentage as number | null) ?? null,
          submittedAt: (row.srf_submitted_at as string | null) ?? null,
          documents: await signDocuments(
            client,
            (row.student_documents ?? []) as Array<{ kind: string; storage_path: string }>,
          ),
        })),
      );
    },

    async decide(studentId, current, decision) {
      const outcome = decideSrf(current, decision);
      if (!outcome.ok) throw new VerificationError(outcome.error);

      const actorId = await getActorId();
      if (actorId === null) {
        throw new VerificationError("Your session has expired. Please sign in again.");
      }

      const { error } = await client
        .from("students")
        .update({
          srf_status: outcome.next,
          srf_decided_at: new Date().toISOString(),
          srf_decided_by: actorId,
          srf_rejection_reason: decision.decision === "reject" ? decision.reason : null,
        })
        .eq("id", studentId)
        .select("id, srf_status")
        .single();

      if (error !== null) {
        throw new VerificationError("Could not save the decision. Please try again.");
      }
    },
  };
}
