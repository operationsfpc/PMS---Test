import { decideSemester, type SemesterDecision } from "@domain/academics";
import type { MarksScale } from "@domain/marks";
import type { VerificationStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class SemesterQueueError extends Error {}

/**
 * One declared semester awaiting the coordinator's decision, beside its
 * marksheet — the signed link is the whole point: verifying a CGPA means
 * opening the document and agreeing it says what the student typed.
 */
export interface PendingSemester {
  readonly id: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly semesterNumber: number;
  readonly cgpa: number;
  /** What the student actually typed, on the scale they typed it. */
  readonly declaredMarks: number | null;
  readonly marksScale: MarksScale | null;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  readonly uploadedAt: string | null;
  /** Short-lived signed URL. Null when one could not be produced. */
  readonly url: string | null;
}

export interface SemesterQueueRepository {
  pending(): Promise<readonly PendingSemester[]>;
  decide(id: string, current: VerificationStatus, decision: SemesterDecision): Promise<void>;
}

/** Exported so src/db/query-contract.test.ts can prove it against the schema. */
export const SEMESTER_QUEUE_COLUMNS =
  "id, semester_number, cgpa, declared_marks, marks_scale, current_arrears, history_of_arrears, created_at, status, students!inner(full_name, roll_number, srf_status), student_documents(storage_path)";

/** Marksheets live in the marksheets bucket (0010, private). */
const MARKSHEET_BUCKET = "marksheets";

const SIGNED_URL_TTL_SECONDS = 600;

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/**
 * The semester (CGPA) verification queue — 2026-08-24 UAT.
 *
 * Certificates had a queue (0038/0039); semesters only verified as a side
 * effect of SRF approval (0031), so every semester added later sat pending
 * forever and its student was judged at the previous verified line — or at
 * zero.
 *
 * SRF-SUBMITTED students are excluded: their declared semesters are decided
 * wholesale by approving the form. No campus filter: RLS scopes the
 * coordinator already, and a duplicate here would drift the day the policy
 * changes.
 */
export function createSupabaseSemesterQueueRepository(
  client: SupabaseClient,
  getActorId: () => Promise<string | null> = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
): SemesterQueueRepository {
  return {
    async pending() {
      const { data, error } = await client
        .from("student_semesters")
        .select(SEMESTER_QUEUE_COLUMNS)
        .eq("status", "pending")
        .eq("students.srf_status", "srf_approved")
        .order("created_at", { ascending: true });

      if (error !== null) {
        throw new SemesterQueueError("Could not load the CGPA verification queue.");
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
              .from(MARKSHEET_BUCKET)
              .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

      const urlByPath = new Map(
        (signed ?? []).flatMap((entry) =>
          entry?.path === undefined || entry.signedUrl === null
            ? []
            : [[entry.path, entry.signedUrl]],
        ),
      );

      return rows.map((row): PendingSemester => {
        const student = one<{ full_name?: string; roll_number?: string }>(row.students);
        const document = one<{ storage_path?: string }>(row.student_documents);
        const path = document?.storage_path;

        return {
          id: row.id as string,
          studentName: student?.full_name ?? "Unknown student",
          rollNumber: student?.roll_number ?? "—",
          semesterNumber: Number(row.semester_number),
          cgpa: Number(row.cgpa),
          declaredMarks: row.declared_marks === null ? null : Number(row.declared_marks),
          marksScale: (row.marks_scale as MarksScale | null) ?? null,
          currentArrears: Number(row.current_arrears ?? 0),
          historyOfArrears: Number(row.history_of_arrears ?? 0),
          uploadedAt: (row.created_at as string | null) ?? null,
          url: path === undefined ? null : (urlByPath.get(path) ?? null),
        };
      });
    },

    async decide(id, current, decision) {
      const outcome = decideSemester(current, decision);
      if (!outcome.ok) throw new SemesterQueueError(outcome.error);

      const actorId = await getActorId();
      if (actorId === null) {
        throw new SemesterQueueError("Your session has expired. Please sign in again.");
      }

      const { error } = await client
        .from("student_semesters")
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
        throw new SemesterQueueError("Could not save the decision. Please try again.");
      }
    },
  };
}
