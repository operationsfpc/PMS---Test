import { OFFER_LETTER_BUCKET } from "@domain/attachments";
import type { OfferCategory } from "@domain/offer-category";
import type { AppRole, DriveStatus, DriveType } from "@domain/types";
import { readAllRows } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfferCandidate, OfferDrive, OfferView } from "./offer-page";
import { createSupabaseOffersRepository, OffersError } from "./offers-repository";

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/**
 * Feeds the final-selection screen.
 *
 * Candidates are the students `selected` in the drive's LAST round. That is
 * who may be declared - not everyone who applied, and not everyone still
 * un-rejected.
 */
export function createSupabaseOfferView(
  client: SupabaseClient,
  getActorId: () => Promise<string | null>,
  getActorRole: () => Promise<AppRole>,
): OfferView {
  const offers = createSupabaseOffersRepository(client, getActorId, getActorRole);

  return {
    async drive(driveId) {
      const { data, error } = await client
        .from("drives")
        .select(
          "id, company_name, role_title, drive_type, offer_category, status, ctc_min_lpa, ctc_max_lpa, stipend_min_monthly, stipend_max_monthly",
        )
        .eq("id", driveId)
        .single();

      /*
       * The fallbacks below are each reasonable on their own and a fatal set
       * together: a refused read claimed the drive was a `placement` (so an
       * internship was demanded a CTC), suggested ₹0 pay, and handed the screen
       * `status: null` — the one value that means "nothing forbids declaring".
       */
      if (error !== null) throw new OffersError("Could not read this drive.");

      const row = (data ?? {}) as Record<string, unknown>;

      return {
        driveId,
        companyName: (row.company_name as string | null) ?? "This drive",
        roleTitle: (row.role_title as string | null) ?? null,
        driveType: (row.drive_type as DriveType | null) ?? "placement",
        offerCategory: (row.offer_category as OfferCategory | null) ?? null,
        // The screen refuses to declare against a closed record, and can only
        // do that with the status itself.
        status: (row.status as DriveStatus | null) ?? null,
        // A16: pre-fill only. The per-student figure is what R9 reads.
        suggestedCtcLpa:
          (row.ctc_max_lpa as number | null) ?? (row.ctc_min_lpa as number | null) ?? 0,
        // 0070: the same courtesy for an internship, which has no CTC to
        // suggest and whose declare box used to insist on one anyway.
        suggestedStipendMonthly:
          (row.stipend_max_monthly as number | null) ??
          (row.stipend_min_monthly as number | null) ??
          null,
      } satisfies OfferDrive;
    },

    async candidates(driveId) {
      const { data: rounds, error: roundsError } = await client
        .from("drive_rounds")
        .select("id, sequence")
        .eq("drive_id", driveId)
        .order("sequence", { ascending: false })
        .limit(1);

      // "This drive has no rounds yet" is a fact the screen may show; a read
      // that was refused is not that fact, and used to be reported as it.
      if (roundsError !== null) throw new OffersError("Could not read this drive's rounds.");

      const lastRoundId = (rounds ?? [])[0]?.id as string | undefined;
      if (lastRoundId === undefined) return [];

      /*
       * Paged, and either half failing stops the whole read. The offers list is
       * what marks a student already declared: truncated at a thousand, or
       * refused, it shows the Declare button again on students who already have
       * an offer — and double-declaring is how one student ends up with two
       * placement records.
       */
      const [results, declared] = await Promise.all([
        readAllRows((from, to) =>
          client
            .from("round_results")
            .select(
              "application_id, result, applications(student_id, students(full_name, roll_number, campuses(name)))",
            )
            .eq("round_id", lastRoundId)
            .eq("result", "selected")
            .range(from, to),
        ).catch(() => {
          throw new OffersError("Could not read the students who reached the final round.");
        }),
        readAllRows((from, to) =>
          client
            .from("offers")
            .select("student_id, attachment_path, attachment_name")
            .eq("drive_id", driveId)
            .range(from, to),
        ).catch(() => {
          throw new OffersError("Could not read the offers already declared on this drive.");
        }),
      ]);

      const offerByStudent = new Map(declared.map((o) => [o.student_id as string, o]));

      /*
       * Spec B: sign every filed letter in one round trip. A refused bucket
       * read is deliberately NOT raised: it costs the clickable link and
       * nothing else — the letter is still named, and `declared` still comes
       * from the database above, so no candidate looks undeclared because
       * Storage did not answer.
       */
      const paths = [...offerByStudent.values()].flatMap((o) =>
        typeof o.attachment_path === "string" && o.attachment_path !== ""
          ? [o.attachment_path]
          : [],
      );
      const { data: signed } =
        paths.length === 0
          ? { data: [] }
          : await client.storage.from(OFFER_LETTER_BUCKET).createSignedUrls(paths, 600);
      const urlByPath = new Map(
        (signed ?? []).flatMap((entry) =>
          entry?.path === undefined || entry.signedUrl === null
            ? []
            : [[entry.path, entry.signedUrl]],
        ),
      );

      return results
        .map((row): OfferCandidate => {
          const application = one<{ student_id?: string; students: unknown }>(row.applications);
          const student = one<{
            full_name?: string;
            roll_number?: string;
            campuses?: unknown;
          }>(application?.students);
          const studentId = application?.student_id ?? "";
          const offer = offerByStudent.get(studentId);
          const path = (offer?.attachment_path as string | null) ?? null;

          return {
            applicationId: row.application_id as string,
            studentId,
            studentName: student?.full_name ?? "Unknown student",
            rollNumber: student?.roll_number ?? "—",
            college: one<{ name?: string }>(student?.campuses)?.name ?? null,
            declared: offer !== undefined,
            letterName: (offer?.attachment_name as string | null) ?? null,
            letterUrl: path === null ? null : (urlByPath.get(path) ?? null),
          };
        })
        .sort((a, b) => a.studentName.localeCompare(b.studentName));
    },

    declare: (offer) => offers.declareOffer(offer),
    attachLetter: (studentId, driveId, letter) => offers.attachLetter(studentId, driveId, letter),
  };
}
