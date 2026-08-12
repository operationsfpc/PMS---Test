import { decideSrf, type SrfDecision } from "@domain/srf-decision";
import type { SrfStatus, VerificationStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class VerificationError extends Error {}

/** A marksheet the coordinator must check the figures against (PRD §4.2). */
export interface StudentDocument {
  readonly kind: string;
  readonly label: string;
  /** Short-lived signed URL. Buckets are private; nothing is ever public. */
  readonly url: string;
}

/**
 * One declared semester, beside the document that evidences it.
 *
 * This is the queue's whole purpose. Until the SRF actually stored the
 * uploads, a coordinator saw a CGPA and had nothing to check it against, so
 * "verified" was a signature on the student's own typing - and a verified
 * semester is what decides whether they may apply to a drive (R5).
 */
export interface DeclaredSemester {
  readonly semesterNumber: number;
  readonly cgpa: number;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  readonly status: string;
  /** Null when nothing was uploaded. Never a dead link. */
  readonly marksheetUrl: string | null;
}

/**
 * A certificate submitted with the form, beside the document it claims.
 *
 * On this screen because approving the form now verifies these too (0039).
 * That click may only mean anything if the coordinator was shown the document
 * first - the same reason the semester marksheets are here.
 */
export interface DeclaredCertificate {
  readonly id: string;
  readonly name: string;
  /** Null when nothing could be signed. Never a dead link. */
  readonly url: string | null;
  readonly status: VerificationStatus;
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
  /** The school marksheets, which belong to no single semester. */
  readonly documents: readonly StudentDocument[];
  readonly semesters: readonly DeclaredSemester[];
  /** 0039: approving the form confirms these. */
  readonly certificates: readonly DeclaredCertificate[];
}

const DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  tenth_marksheet: "10th marksheet",
  twelfth_marksheet: "12th marksheet",
  semester_marksheet: "Semester marksheet",
  ug_consolidated_marksheet: "Consolidated UG marksheet",
};

/** Signed URLs expire; 10 minutes is ample for a verification pass. */
const SIGNED_URL_TTL_SECONDS = 600;

export interface VerificationRepository {
  pending(): Promise<readonly PendingSrf[]>;
  decide(studentId: string, current: SrfStatus, decision: SrfDecision): Promise<void>;
}

export type GetActorId = () => Promise<string | null>;

/**
 * One query, not one per student: the queue can hold a whole cohort, and a
 * round trip per row would be N+1 against exactly the screen a coordinator
 * uses to work through a backlog.
 */
/**
 * Exported so src/db/query-contract.test.ts can prove it against the schema.
 *
 * `!student_documents_student_id_fkey` names the relationship deliberately.
 * `students` now has THREE keys joining it to `student_documents` - the
 * student's own documents, plus `ug_marksheet_id` (0023) and
 * `diploma_marksheet_id` (0024) - and PostgREST refuses an ambiguous embed
 * outright with PGRST201. This query was written when there was only one, and
 * a later migration broke it without touching it: the whole queue returned
 * "Could not load the verification queue" for every coordinator.
 *
 * We want the documents BELONGING to the student, which is the first key.
 */
export const VERIFICATION_QUEUE_COLUMNS =
  "id, full_name, roll_number, overall_cgpa, current_arrears, history_of_arrears, tenth_percentage, twelfth_percentage, srf_submitted_at, student_documents!student_documents_student_id_fkey(kind, storage_path), student_semesters(semester_number, cgpa, current_arrears, history_of_arrears, status, student_documents(storage_path)), student_certificates(id, name, status, student_documents(storage_path))";

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
/** Signs a batch of paths, in the order given. Buckets are private (0010). */
async function sign(
  client: SupabaseClient,
  paths: readonly string[],
): Promise<ReadonlyArray<string | undefined>> {
  if (paths.length === 0) return [];
  const { data } = await client.storage
    .from("marksheets")
    .createSignedUrls([...paths], SIGNED_URL_TTL_SECONDS);
  return (data ?? []).map((entry) => entry?.signedUrl ?? undefined);
}

/**
 * The semester lines, in degree order, each with its own signed marksheet.
 *
 * Sorted here rather than trusted from the query: PostgREST does not promise
 * an order on an embedded resource, and a coordinator reads a degree forwards.
 */
async function signSemesters(
  client: SupabaseClient,
  rows: Array<Record<string, unknown>>,
): Promise<readonly DeclaredSemester[]> {
  const ordered = [...rows].sort(
    (a, b) => Number(a.semester_number ?? 0) - Number(b.semester_number ?? 0),
  );

  const paths = ordered.map((row) => {
    const doc = row.student_documents as { storage_path?: string } | null | undefined;
    return doc?.storage_path;
  });

  const signed = await sign(
    client,
    paths.filter((path): path is string => path !== undefined),
  );

  let next = 0;
  return ordered.map((row, index) => ({
    semesterNumber: Number(row.semester_number ?? 0),
    cgpa: Number(row.cgpa ?? 0),
    currentArrears: Number(row.current_arrears ?? 0),
    historyOfArrears: Number(row.history_of_arrears ?? 0),
    status: (row.status as string | undefined) ?? "pending",
    // A path we cannot sign reads as no evidence rather than a dead link: a
    // coordinator must never think they have checked something they have not.
    marksheetUrl: paths[index] === undefined ? null : (signed[next++] ?? null),
  }));
}

/**
 * The certificates, each with its own signed document.
 *
 * Sorted here rather than trusted from the query: PostgREST promises no order
 * on an embedded resource, and a coordinator works down a stable list.
 */
async function signCertificates(
  client: SupabaseClient,
  rows: Array<Record<string, unknown>>,
): Promise<readonly DeclaredCertificate[]> {
  const ordered = [...rows].sort((a, b) =>
    String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );

  const paths = ordered.map((row) => {
    const doc = row.student_documents as { storage_path?: string } | null | undefined;
    return doc?.storage_path;
  });

  const signed = await sign(
    client,
    paths.filter((path): path is string => path !== undefined),
  );

  let next = 0;
  return ordered.map((row, index) => ({
    id: row.id as string,
    name: (row.name as string | null) ?? "",
    // A path we cannot sign reads as no evidence rather than a dead link.
    url: paths[index] === undefined ? null : (signed[next++] ?? null),
    status: ((row.status as string | null) ?? "pending") as VerificationStatus,
  }));
}

async function signDocuments(
  client: SupabaseClient,
  rows: Array<{ kind: string; storage_path: string }>,
): Promise<readonly StudentDocument[]> {
  // Semester marksheets are shown against their own line, not in this list.
  const marksheets = rows.filter((d) => d.kind !== "resume" && d.kind !== "semester_marksheet");
  if (marksheets.length === 0) return [];

  const data = await sign(
    client,
    marksheets.map((d) => d.storage_path),
  );

  return marksheets.flatMap((doc, index) => {
    const url = data[index];
    // A document we cannot sign is omitted rather than rendered as a dead
    // link: a coordinator must never think they have checked something.
    if (url === undefined) return [];
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
        .select(VERIFICATION_QUEUE_COLUMNS)
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
          semesters: await signSemesters(
            client,
            (row.student_semesters ?? []) as Array<Record<string, unknown>>,
          ),
          certificates: await signCertificates(
            client,
            (row.student_certificates ?? []) as Array<Record<string, unknown>>,
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
