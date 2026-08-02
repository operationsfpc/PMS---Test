import type { OfferCategory } from "@domain/offer-category";
import type { AppRole, DriveType } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfferCandidate, OfferDrive, OfferView } from "./offer-page";
import { createSupabaseOffersRepository } from "./offers-repository";

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
      const { data } = await client
        .from("drives")
        .select(
          "id, company_name, role_title, drive_type, offer_category, ctc_min_lpa, ctc_max_lpa",
        )
        .eq("id", driveId)
        .single();

      const row = (data ?? {}) as Record<string, unknown>;

      return {
        driveId,
        companyName: (row.company_name as string | null) ?? "This drive",
        roleTitle: (row.role_title as string | null) ?? null,
        driveType: (row.drive_type as DriveType | null) ?? "placement",
        offerCategory: (row.offer_category as OfferCategory | null) ?? null,
        // A16: pre-fill only. The per-student figure is what R9 reads.
        suggestedCtcLpa:
          (row.ctc_max_lpa as number | null) ?? (row.ctc_min_lpa as number | null) ?? 0,
      } satisfies OfferDrive;
    },

    async candidates(driveId) {
      const { data: rounds } = await client
        .from("drive_rounds")
        .select("id, sequence")
        .eq("drive_id", driveId)
        .order("sequence", { ascending: false })
        .limit(1);

      const lastRoundId = (rounds ?? [])[0]?.id as string | undefined;
      if (lastRoundId === undefined) return [];

      const [{ data: results }, { data: declared }] = await Promise.all([
        client
          .from("round_results")
          .select(
            "application_id, result, applications(student_id, students(full_name, roll_number))",
          )
          .eq("round_id", lastRoundId)
          .eq("result", "selected"),
        client.from("offers").select("student_id").eq("drive_id", driveId),
      ]);

      const declaredStudents = new Set((declared ?? []).map((o) => o.student_id as string));

      return (results ?? [])
        .map((row): OfferCandidate => {
          const application = one<{ student_id?: string; students: unknown }>(row.applications);
          const student = one<{ full_name?: string; roll_number?: string }>(application?.students);
          const studentId = application?.student_id ?? "";

          return {
            applicationId: row.application_id as string,
            studentId,
            studentName: student?.full_name ?? "Unknown student",
            rollNumber: student?.roll_number ?? "—",
            declared: declaredStudents.has(studentId),
          };
        })
        .sort((a, b) => a.studentName.localeCompare(b.studentName));
    },

    declare: (offer) => offers.declareOffer(offer),
  };
}
