import { type CertificateDecision, decideCertificate } from "@domain/certificates";
import type { VerificationStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class CertificateQueueError extends Error {}

/**
 * One certificate awaiting a coordinator's decision.
 *
 * The signed link is the whole point of the screen: verifying a certificate
 * means opening the document and agreeing it says what the name says. Without
 * it, "verified" is a signature on the student's own typing - the same hole
 * that made semester verification meaningless before 0023.
 */
export interface PendingCertificate {
  readonly id: string;
  readonly studentName: string;
  readonly rollNumber: string;
  /** The certificate's name, as the student gave it. */
  readonly name: string;
  readonly uploadedAt: string | null;
  /** Short-lived signed URL. Null when one could not be produced. */
  readonly url: string | null;
}

export interface CertificateQueueRepository {
  pending(): Promise<readonly PendingCertificate[]>;
  decide(id: string, current: VerificationStatus, decision: CertificateDecision): Promise<void>;
}

/** Exported so src/db/query-contract.test.ts can prove it against the schema. */
export const CERTIFICATE_QUEUE_COLUMNS =
  "id, name, created_at, status, students(full_name, roll_number), student_documents(storage_path)";

/** Certificates live in the marksheets bucket (0034); it is private (0010). */
const CERTIFICATE_BUCKET = "marksheets";

/** Long enough to read the certificate, short enough not to be a shared copy. */
const SIGNED_URL_TTL_SECONDS = 600;

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/**
 * The certificate queue.
 *
 * No campus filter here: RLS scopes a coordinator to their own students
 * already, and re-filtering would be a weaker duplicate of a rule the
 * database owns - one that would quietly diverge the day the policy changes.
 *
 * The transition is decided by `decideCertificate` in the domain layer, never
 * here, so an invalid decision never reaches the network.
 */
export function createSupabaseCertificateQueueRepository(
  client: SupabaseClient,
  getActorId: () => Promise<string | null> = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
): CertificateQueueRepository {
  return {
    async pending() {
      const { data, error } = await client
        .from("student_certificates")
        .select(CERTIFICATE_QUEUE_COLUMNS)
        .eq("status", "pending")
        .order("created_at", { ascending: true });

      if (error !== null) {
        throw new CertificateQueueError("Could not load the certificate queue.");
      }

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const paths = rows.flatMap((row) => {
        const document = one<{ storage_path?: string }>(row.student_documents);
        return document?.storage_path === undefined ? [] : [document.storage_path];
      });

      const { data: signed } =
        paths.length === 0
          ? { data: [] }
          : await client.storage
              .from(CERTIFICATE_BUCKET)
              .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

      const urlByPath = new Map(
        (signed ?? []).flatMap((entry) =>
          entry?.path === undefined || entry.signedUrl === null
            ? []
            : [[entry.path, entry.signedUrl]],
        ),
      );

      return rows.map((row): PendingCertificate => {
        const student = one<{ full_name?: string; roll_number?: string }>(row.students);
        const document = one<{ storage_path?: string }>(row.student_documents);
        const path = document?.storage_path;

        return {
          id: row.id as string,
          studentName: student?.full_name ?? "Unknown student",
          rollNumber: student?.roll_number ?? "—",
          name: row.name as string,
          uploadedAt: (row.created_at as string | null) ?? null,
          url: path === undefined ? null : (urlByPath.get(path) ?? null),
        };
      });
    },

    async decide(id, current, decision) {
      const outcome = decideCertificate(current, decision);
      if (!outcome.ok) throw new CertificateQueueError(outcome.error);

      const actorId = await getActorId();
      if (actorId === null) {
        throw new CertificateQueueError("Your session has expired. Please sign in again.");
      }

      const { error } = await client
        .from("student_certificates")
        .update({
          status: outcome.next,
          verified_by: actorId,
          verified_at: new Date().toISOString(),
          rejection_reason: decision.decision === "reject" ? decision.reason.trim() : null,
        })
        .eq("id", id)
        .select("id")
        .single();

      if (error !== null) {
        throw new CertificateQueueError("Could not save the decision. Please try again.");
      }
    },
  };
}
