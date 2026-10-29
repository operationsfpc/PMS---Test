import { objectKeyIn, sanitizeStorageFileName } from "@domain/storage-path";
import type { HoldKind } from "@domain/types";
import { describeReadFailure, readAllRows } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";

export class HoldsError extends Error {}

/**
 * A student's placement holds, against live data (0125).
 *
 * Written for the Campus Manager who places and releases a hold, and for the
 * student record that has to show what is currently done to one of their
 * students. Nothing here decides whether a hold is allowed:
 * `place_student_hold` and `release_student_hold` do, under RLS, and a browser
 * check would be a suggestion. What this file does is refuse quietly — the two
 * RPCs raise a sentence ("Only a Campus Manager may place a placement hold."),
 * and the screen gets to show it.
 */

/**
 * Both staff members are embedded because `student_holds` keys `profiles`
 * twice (`held_by`, `released_by`), and an unhinted `profiles(...)` is
 * ambiguous: PostgREST answers PGRST201 and the block goes missing. Registered
 * in src/db/query-contract.test.ts, which is the guard that knows.
 */
export const HOLD_COLUMNS =
  "id, student_id, kind, reason, starts_at, ends_at, held_at, released_at, release_note, " +
  "placed_by:profiles!student_holds_held_by_fkey(full_name), " +
  "lifted_by:profiles!student_holds_released_by_fkey(full_name), " +
  "student_documents(storage_path)";

/** One `student_holds` row, in the shape the screens read. */
export interface Hold {
  readonly id: string;
  readonly studentId: string;
  readonly kind: HoldKind;
  readonly reason: string;
  /** ISO `YYYY-MM-DD`. */
  readonly startsAt: string;
  /** The review date, never a switch — see `holdStanding`. */
  readonly endsAt: string | null;
  readonly heldAt: string;
  /** The manager who wrote the hold, once the row can be read at all. */
  readonly heldBy: string | null;
  readonly releasedAt: string | null;
  readonly releasedBy: string | null;
  readonly releaseNote: string | null;
  /** Path of the optional attachment, or null when none was filed. */
  readonly documentPath: string | null;
}

export interface PlaceHoldInput {
  readonly studentId: string;
  readonly kind: HoldKind;
  readonly reason: string;
  /** Null leaves the date to the database's `current_date`. */
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  /** The optional order the hold was raised over. Filed with the hold, or not at all. */
  readonly order: File | null;
}

export interface HoldsView {
  live(studentId: string): Promise<Hold | null>;
  history(studentId: string): Promise<Hold[]>;
  place(input: PlaceHoldInput): Promise<string>;
  release(holdId: string, note: string | null): Promise<void>;
  /**
   * A short-lived link to a filed order, for the staff record that shows it.
   * Null when the signing was refused — the screen then says the order is on
   * file without offering a link that would fail on tap (0051's rule).
   */
  orderUrl(documentPath: string): Promise<string | null>;
}

/** Supabase returns a to-one embed either as an object or a one-element array. */
const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

const rowsOf = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

const nameOf = (value: unknown) => one<{ full_name?: string }>(value)?.full_name ?? null;

const toHold = (row: Record<string, unknown>): Hold => ({
  id: row.id as string,
  studentId: row.student_id as string,
  kind: row.kind as HoldKind,
  reason: (row.reason as string | null) ?? "",
  startsAt: row.starts_at as string,
  endsAt: (row.ends_at as string | null) ?? null,
  heldAt: row.held_at as string,
  heldBy: nameOf(row.placed_by),
  releasedAt: (row.released_at as string | null) ?? null,
  releasedBy: nameOf(row.lifted_by),
  releaseNote: (row.release_note as string | null) ?? null,
  documentPath: one<{ storage_path?: string }>(row.student_documents)?.storage_path ?? null,
});

/**
 * A write the database refuses must say why (the rounds screens' lesson, and
 * what `place_student_hold`'s raised exceptions are for).
 */
const withDetail = (summary: string, error: { message?: string }): HoldsError =>
  new HoldsError(
    typeof error.message === "string" && error.message.trim() !== ""
      ? `${summary} (${error.message})`
      : summary,
  );

/** Private, 5 MB, pdf/jpeg/png — 0125's bucket. */
const HOLD_ORDER_BUCKET = "hold-orders";

/**
 * Stores the order and records it against the student, returning the row id the
 * hold is filed under.
 *
 * The key is bare (`<student>/<file>`), the way marksheets and certificates
 * store theirs, because one bucket is the only place a hold order can come from.
 * 0127 is what lets a Campus Manager write this row at all — before it, the
 * upload succeeded and the insert was refused, so the hold placed without its
 * attachment and nobody was told.
 */
async function fileOrder(client: SupabaseClient, studentId: string, file: File): Promise<string> {
  const path = `${studentId}/${Date.now()}-${sanitizeStorageFileName(file.name)}`;

  const { error: uploadError } = await client.storage
    .from(HOLD_ORDER_BUCKET)
    .upload(path, file, { contentType: file.type });

  if (uploadError !== null) {
    throw new HoldsError("Could not upload the attachment, so the hold was not placed.");
  }

  const { data, error } = await client
    .from("student_documents")
    .insert({
      student_id: studentId,
      kind: "hold_order",
      storage_path: path,
      size_bytes: file.size,
    })
    .select("id")
    .single();

  if (error !== null || data === null) {
    throw new HoldsError("Could not file the attachment, so the hold was not placed.");
  }

  return data.id as string;
}

/** Minutes a signed order link stays open: a staff member's tab, not an export. */
const HOLD_ORDER_LINK_SECONDS = 5 * 60;

export function createSupabaseHoldsView(client: SupabaseClient): HoldsView {
  return {
    async live(studentId) {
      const { data, error } = await client
        .from("student_holds")
        .select(HOLD_COLUMNS)
        .eq("student_id", studentId)
        .is("released_at", null)
        .limit(1);

      if (error !== null) {
        throw new HoldsError(
          describeReadFailure(error, "Could not read whether this student is on a hold."),
        );
      }
      // Zero rows means either no live hold or RLS kept it from this reader —
      // the same indistinguishable pair the student record accepts, so a
      // manager cannot learn that another college is holding someone.
      const [row] = rowsOf(data);
      return row === undefined ? null : toHold(row);
    },

    async history(studentId) {
      let rows: Array<Record<string, unknown>>;
      try {
        rows = await readAllRows((from, to) =>
          client
            .from("student_holds")
            .select(HOLD_COLUMNS)
            .eq("student_id", studentId)
            .order("held_at", { ascending: false })
            .range(from, to),
        );
      } catch (cause) {
        throw new HoldsError(
          describeReadFailure(cause, "Could not read this student's hold history."),
        );
      }
      return rows.map(toHold);
    },

    async place(input) {
      // The attachment first: a hold whose evidence did not file is the half-act
      // the manager cannot see, and the row is what 0125's `document_id` points at.
      const documentId =
        input.order === null ? null : await fileOrder(client, input.studentId, input.order);

      const { data, error } = await client.rpc("place_student_hold", {
        p_student_id: input.studentId,
        p_kind: input.kind,
        p_reason: input.reason.trim(),
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
        p_document_id: documentId,
      });

      if (error !== null || data === null) {
        throw withDetail("The hold was not placed.", error ?? { message: "" });
      }
      return data as string;
    },

    async release(holdId, note) {
      const { error } = await client.rpc("release_student_hold", {
        p_hold_id: holdId,
        p_release_note: note,
      });

      if (error !== null) throw withDetail("The hold was not released.", error);
    },

    async orderUrl(documentPath) {
      // The path is stored bare (`<student>/<file>`) but 0125's naming row lets
      // a bucket-prefixed one through, so both are read as the same object.
      const { data } = await client.storage
        .from(HOLD_ORDER_BUCKET)
        .createSignedUrl(objectKeyIn(HOLD_ORDER_BUCKET, documentPath), HOLD_ORDER_LINK_SECONDS);

      return data?.signedUrl ?? null;
    },
  };
}
