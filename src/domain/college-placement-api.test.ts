import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  aggregateCollegePlacements,
  createPlacementOffer,
  deletePlacementOffer,
  type RawApplicationRow,
  type RawAttendanceRow,
  type RawCampusRow,
  type RawOfferRow,
  type RawRoundResultRow,
  type RawStudentRow,
  updatePlacementOffer,
  updateStudentParticipationStatus,
} from "./college-placement-api";

/** A missing row must fail with what was looked for, not a TypeError on undefined. */
function mustFind<T>(found: T | null | undefined, what: string): T {
  if (found === null || found === undefined) throw new Error(`Missing ${what}`);
  return found;
}

describe("college placement data aggregation API (aggregateCollegePlacements)", () => {
  const campuses: RawCampusRow[] = [
    { id: "c-1", name: "Kamaraj College", city: "Virudhunagar" },
    { id: "c-2", name: "SDNB Vaishnav College", city: "Chennai" },
    { id: "c-empty", name: "New College", city: "Madurai" },
  ];

  const students: RawStudentRow[] = [
    // Kamaraj College: 3 students (2 placed, 1 opted out)
    {
      id: "s-1",
      full_name: "Keerthana S",
      roll_number: "2026CS101",
      email: "keerthana@kamaraj.edu",
      campus_id: "c-1",
      passing_year: 2026,
      participation_status: "active",
      degrees: { name: "B.E." },
      branches: { name: "CSE" },
    },
    {
      id: "s-2",
      full_name: "Arun Kumar",
      roll_number: "2026CS102",
      email: "arun@kamaraj.edu",
      campus_id: "c-1",
      passing_year: 2026,
      participation_status: "active",
      degrees: { name: "B.E." },
      branches: { name: "ECE" },
    },
    {
      id: "s-3",
      full_name: "Pooja M",
      roll_number: "2026CS103",
      email: "pooja@kamaraj.edu",
      campus_id: "c-1",
      passing_year: 2026,
      participation_status: "opted_out",
      degrees: { name: "B.E." },
      branches: { name: "IT" },
    },

    // SDNB Vaishnav: 2 students (1 self-placed, 1 unplaced)
    {
      id: "s-4",
      full_name: "Radhika R",
      roll_number: "2026VA01",
      email: "radhika@vaishnav.edu",
      campus_id: "c-2",
      passing_year: 2026,
      participation_status: "active",
      degrees: { name: "B.Sc" },
      branches: { name: "AI" },
    },
    {
      id: "s-5",
      full_name: "Meena K",
      roll_number: "2026VA02",
      email: "meena@vaishnav.edu",
      campus_id: "c-2",
      passing_year: 2026,
      participation_status: "active",
      degrees: { name: "B.Sc" },
      branches: { name: "Data Science" },
    },
  ];

  const offers: RawOfferRow[] = [
    // s-1 has 2 offers: Zoho (9 LPA) and TCS (4 LPA) -> double offer holder!
    {
      id: "o-1",
      student_id: "s-1",
      source: "on_campus",
      drive_type: "placement",
      ctc_lpa: 9,
      company_name: "Zoho Corporation",
      role_title: "MTS",
      declared_at: "2026-09-01T10:00:00Z",
    },
    {
      id: "o-2",
      student_id: "s-1",
      source: "on_campus",
      drive_type: "placement",
      ctc_lpa: 4,
      company_name: "Tata Consultancy Services",
      role_title: "Associate Software Engineer",
      declared_at: "2026-09-02T10:00:00Z",
    },
    // s-2 has 1 offer: Freshworks (6.5 LPA)
    {
      id: "o-3",
      student_id: "s-2",
      source: "on_campus",
      drive_type: "internship_convertible",
      ctc_lpa: 6.5,
      company_name: "Freshworks",
      role_title: "Product Engineer",
      declared_at: "2026-09-03T10:00:00Z",
    },
    // s-4 has self_placed offer: Infosys (5 LPA)
    {
      id: "o-4",
      student_id: "s-4",
      source: "self_placed",
      drive_type: "placement",
      ctc_lpa: 5,
      company_name: "Infosys",
      role_title: "Systems Engineer",
      declared_at: "2026-09-04T10:00:00Z",
    },
  ];

  it("calculates accurate college-by-college placement counts and rates", () => {
    const report = aggregateCollegePlacements(campuses, students, offers);

    expect(report.overallTotals.totalColleges).toBe(3);
    expect(report.overallTotals.totalStudents).toBe(5);
    // 5 total students - 1 opted_out = 4 eligible
    expect(report.overallTotals.totalEligible).toBe(4);
    // 2 placed on campus (s-1, s-2)
    expect(report.overallTotals.totalPlaced).toBe(2);
    // 1 self placed (s-4)
    expect(report.overallTotals.totalSelfPlaced).toBe(1);
    // Overall rate: 2 / 4 = 50%
    expect(report.overallTotals.overallPlacementRatePct).toBe(50);

    const kamaraj = mustFind(
      report.colleges.find((c) => c.campusId === "c-1"),
      "Kamaraj College summary",
    );
    expect(kamaraj.campusName).toBe("Kamaraj College");
    expect(kamaraj.totalStudents).toBe(3);
    expect(kamaraj.eligibleStudents).toBe(2); // excluding 1 opted_out
    expect(kamaraj.placedStudents).toBe(2); // s-1 and s-2
    expect(kamaraj.unplacedStudents).toBe(0);
    expect(kamaraj.optedOutStudents).toBe(1);
    expect(kamaraj.placementRatePct).toBe(100); // 2 / 2 = 100%

    // Double offers for s-1
    expect(kamaraj.totalOffers).toBe(3);
    expect(kamaraj.multipleOffersCount).toBe(1);

    // Package stats for Kamaraj (highest package per placed student: s-1 has 9 LPA, s-2 has 6.5 LPA)
    expect(kamaraj.highestCtcLpa).toBe(9);
    expect(kamaraj.lowestCtcLpa).toBe(6.5);
    expect(kamaraj.averageCtcLpa).toBe(7.75); // (9 + 6.5) / 2
    expect(kamaraj.medianCtcLpa).toBe(7.75);

    // SDNB Vaishnav
    const vaishnav = mustFind(
      report.colleges.find((c) => c.campusId === "c-2"),
      "Vaishnav College summary",
    );
    expect(vaishnav.totalStudents).toBe(2);
    expect(vaishnav.eligibleStudents).toBe(2);
    expect(vaishnav.placedStudents).toBe(0); // on_campus placed is 0
    expect(vaishnav.selfPlacedStudents).toBe(1); // s-4
    expect(vaishnav.unplacedStudents).toBe(2);

    // Empty college
    const empty = mustFind(
      report.colleges.find((c) => c.campusId === "c-empty"),
      "New College summary",
    );
    expect(empty.totalStudents).toBe(0);
    expect(empty.eligibleStudents).toBe(0);
    expect(empty.placedStudents).toBe(0);
    expect(empty.placementRatePct).toBe(0);
    expect(empty.highestCtcLpa).toBeNull();
    expect(empty.averageCtcLpa).toBeNull();
  });

  it("filters by campusId when specified", () => {
    const report = aggregateCollegePlacements(campuses, students, offers, { campusId: "c-1" });
    expect(report.colleges.length).toBe(1);
    expect(mustFind(report.colleges[0], "filtered college").campusName).toBe("Kamaraj College");
  });

  it("includes detailed student roster when requested", () => {
    const report = aggregateCollegePlacements(campuses, students, offers, {
      includeStudentRoster: true,
    });
    const kamaraj = mustFind(
      report.colleges.find((c) => c.campusId === "c-1"),
      "Kamaraj College summary",
    );
    const roster = mustFind(kamaraj.placedStudentsRoster, "placed students roster");
    expect(roster.length).toBe(3); // 2 for s-1, 1 for s-2

    const zohoOffer = mustFind(
      roster.find((r) => r.companyName === "Zoho Corporation"),
      "Zoho roster row",
    );
    expect(zohoOffer.fullName).toBe("Keerthana S");
    expect(zohoOffer.ctcLpa).toBe(9);
    expect(zohoOffer.degreeName).toBe("B.E.");
    expect(zohoOffer.branchName).toBe("CSE");
  });

  it("accurately tracks company recruitment insights, package tiers, and round dropouts (missed & rejected)", () => {
    const applications: RawApplicationRow[] = [
      { id: "app-1", student_id: "s-1", drive_id: "d-1" },
      { id: "app-2", student_id: "s-2", drive_id: "d-1" },
      { id: "app-3", student_id: "s-4", drive_id: "d-1" },
    ];

    const attendance: RawAttendanceRow[] = [
      { application_id: "app-1", status: "present" },
      { application_id: "app-2", status: "present" },
      { application_id: "app-3", status: "absent" }, // s-4 missed interview round!
    ];

    const roundResults: RawRoundResultRow[] = [
      { application_id: "app-1", result: "selected" },
      { application_id: "app-2", result: "rejected" }, // s-2 rejected in drive 1 round
      { application_id: "app-3", result: "rejected" },
    ];

    const report = aggregateCollegePlacements(
      campuses,
      students,
      offers,
      applications,
      attendance,
      roundResults,
    );

    // 1. Check funnel and dropouts
    // Overall totals
    expect(report.overallTotals.totalApplications).toBe(3);
    expect(report.overallTotals.totalMissedRounds).toBe(1); // app-3 (s-4) absent
    expect(report.overallTotals.totalRejectedRounds).toBe(2); // app-2, app-3 rejected

    // SDNB Vaishnav College (s-4)
    const vaishnav = mustFind(
      report.colleges.find((c) => c.campusId === "c-2"),
      "Vaishnav College summary",
    );
    expect(vaishnav.funnel.missedRounds).toBe(1);
    expect(vaishnav.funnel.rejectedRounds).toBe(1);
    expect(vaishnav.missedIncidents.length).toBe(1);
    const vaishnavMissed = mustFind(vaishnav.missedIncidents[0], "Vaishnav missed incident");
    expect(vaishnavMissed.fullName).toBe("Radhika R");
    expect(vaishnavMissed.reason).toBe("missed_attendance");

    // Kamaraj College (s-1, s-2)
    const kamaraj = mustFind(
      report.colleges.find((c) => c.campusId === "c-1"),
      "Kamaraj College summary",
    );
    expect(kamaraj.funnel.missedRounds).toBe(0);
    expect(kamaraj.funnel.rejectedRounds).toBe(1); // s-2 was rejected in round
    expect(kamaraj.rejectedIncidents.length).toBe(1);
    const kamarajRejection = mustFind(kamaraj.rejectedIncidents[0], "Kamaraj rejected incident");
    expect(kamarajRejection.fullName).toBe("Arun Kumar");

    // 2. Check "what they get" (Package tiers)
    // Kamaraj has offers: Zoho (9 LPA -> Super Dream), Freshworks (6.5 LPA -> Dream), TCS (4 LPA -> Regular)
    expect(kamaraj.packageTiers.superDreamCount).toBe(1);
    expect(kamaraj.packageTiers.dreamCount).toBe(1);
    expect(kamaraj.packageTiers.regularCount).toBe(1);

    // Overall package tiers
    // Total offers: 9, 4, 6.5, 5 -> Super Dream: 1, Dream: 2 (6.5 & 5), Regular: 1 (4)
    expect(report.overallTotals.packageTiers.superDreamCount).toBe(1);
    expect(report.overallTotals.packageTiers.dreamCount).toBe(2);
    expect(report.overallTotals.packageTiers.regularCount).toBe(1);

    // 3. Check "most which company" (Top recruiters)
    const { topCompaniesOverall } = report.overallTotals;
    expect(topCompaniesOverall.length).toBe(4); // Zoho, TCS, Freshworks, Infosys
    const topRecruiterOverall = mustFind(topCompaniesOverall[0], "top recruiter");
    expect(topRecruiterOverall.offersCount).toBe(1);

    const zohoInfo = mustFind(
      topCompaniesOverall.find((c) => c.companyName === "Zoho Corporation"),
      "Zoho recruiter stats",
    );
    expect(zohoInfo.maxCtcLpa).toBe(9);
    expect(zohoInfo.minCtcLpa).toBe(9);
    expect(zohoInfo.categoryBreakdown.superDream).toBe(1);

    // 4. Check detailed rosters ("who all that data")
    const { placedRoster, missedRoster, rejectedRoster, unplacedRoster, optedOutRoster } =
      report.overallTotals;

    // Placed roster
    expect(placedRoster.length).toBe(4);
    const keerthanaOffer = mustFind(
      placedRoster.find(
        (p) => p.fullName === "Keerthana S" && p.companyName === "Zoho Corporation",
      ),
      "Keerthana placed roster row",
    );
    expect(keerthanaOffer.ctcLpa).toBe(9);
    expect(keerthanaOffer.tier).toBe("super_dream");
    expect(keerthanaOffer.campusName).toBe("Kamaraj College");
    expect(keerthanaOffer.degreeName).toBe("B.E.");
    expect(keerthanaOffer.branchName).toBe("CSE");

    // Missed roster
    expect(missedRoster.length).toBe(1);
    const radhikaMissed = mustFind(missedRoster[0], "Radhika missed roster row");
    expect(radhikaMissed.fullName).toBe("Radhika R");
    expect(radhikaMissed.status).toBe("absent");

    // Rejected roster
    expect(rejectedRoster.length).toBe(2);
    const arunRejection = mustFind(
      rejectedRoster.find((r) => r.fullName === "Arun Kumar"),
      "Arun rejected roster row",
    );
    expect(arunRejection.result).toBe("rejected");

    // Unplaced roster
    // s-5 (Meena K) is active, has 0 offers -> unplaced
    expect(unplacedRoster.length).toBe(1);
    expect(mustFind(unplacedRoster[0], "unplaced roster row").fullName).toBe("Meena K");

    // Opted out roster
    // s-3 (Pooja M) is opted_out
    expect(optedOutRoster.length).toBe(1);
    expect(mustFind(optedOutRoster[0], "opted out roster row").fullName).toBe("Pooja M");
  });

  it("updates placement offers and student participation status cleanly", async () => {
    // Mock Supabase client for update and mutation functions
    const mockClient = {
      from: (table: string) => {
        if (table === "offers") {
          return {
            update: (patch: Record<string, unknown>) => ({
              eq: (_col: string, val: string) => ({
                select: () => ({
                  single: async () => ({
                    data: { id: val, ...patch },
                    error: null,
                  }),
                }),
              }),
            }),
            insert: (data: Record<string, unknown>) => ({
              select: () => ({
                single: async () => ({
                  data: { id: "new-offer-123", ...data },
                  error: null,
                }),
              }),
            }),
            delete: () => ({
              eq: (_col: string, _val: string) => Promise.resolve({ error: null }),
            }),
          };
        }
        if (table === "students") {
          return {
            update: (patch: Record<string, unknown>) => ({
              eq: (_col: string, val: string) => ({
                select: () => ({
                  single: async () => ({
                    data: { id: val, ...patch },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    } as unknown as SupabaseClient;

    // Test offer update
    const updateRes = await updatePlacementOffer(mockClient, "o-1", {
      ctcLpa: 12,
      roleTitle: "Senior MTS",
      companyName: "Zoho Corporation",
    });
    expect(updateRes.success).toBe(true);
    const updatedOffer = mustFind(updateRes.data, "updated offer row");
    expect(updatedOffer.ctc_lpa).toBe(12);
    expect(updatedOffer.role_title).toBe("Senior MTS");

    // Test create offer
    const createRes = await createPlacementOffer(mockClient, {
      studentId: "s-5",
      companyName: "Google",
      roleTitle: "Software Engineer",
      ctcLpa: 24,
      driveType: "placement",
      offerCategory: "super_dream",
      source: "on_campus",
    });
    expect(createRes.success).toBe(true);
    const createdOffer = mustFind(createRes.data, "created offer row");
    expect(createdOffer.company_name).toBe("Google");
    expect(createdOffer.ctc_lpa).toBe(24);

    // Test delete offer
    const delRes = await deletePlacementOffer(mockClient, "o-old");
    expect(delRes.success).toBe(true);

    // Test participation status update
    const statusRes = await updateStudentParticipationStatus(mockClient, "s-2", "opted_out");
    expect(statusRes.success).toBe(true);
    const updatedStudent = mustFind(statusRes.data, "updated student row");
    expect(updatedStudent.participation_status).toBe("opted_out");
  });
});
