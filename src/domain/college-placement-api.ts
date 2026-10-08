import type { SupabaseClient } from "@supabase/supabase-js";

export interface CollegePlacementFilter {
  readonly campusId?: string | undefined;
  readonly passingYear?: number | undefined;
  readonly includeStudentRoster?: boolean | undefined;
}

export interface CollegePlacedStudent {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly campusId: string;
  readonly campusName: string;
  readonly degreeName: string;
  readonly branchName: string;
  readonly passingYear: number;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly driveType: string;
  readonly offerCategory: string | null;
  readonly ctcLpa: number;
  readonly source: "on_campus" | "self_placed";
  readonly declaredAt: string;
}

export interface PlacedStudentDetail {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly campusId: string;
  readonly campusName: string;
  readonly city: string;
  readonly degreeName: string;
  readonly branchName: string;
  readonly passingYear: number;
  readonly offerId: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly driveType: string;
  readonly offerCategory: string | null;
  readonly ctcLpa: number;
  readonly tier: "super_dream" | "dream" | "regular";
  readonly source: "on_campus" | "self_placed";
  readonly declaredAt: string;
}

export interface MissedStudentDetail {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly campusId: string;
  readonly campusName: string;
  readonly city: string;
  readonly degreeName: string;
  readonly branchName: string;
  readonly passingYear: number;
  readonly applicationId: string;
  readonly driveId: string | null;
  readonly companyName: string;
  readonly roundId: string | null;
  readonly roundName: string;
  readonly status: "absent";
}

export interface RejectedStudentDetail {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly campusId: string;
  readonly campusName: string;
  readonly city: string;
  readonly degreeName: string;
  readonly branchName: string;
  readonly passingYear: number;
  readonly applicationId: string;
  readonly driveId: string | null;
  readonly companyName: string;
  readonly roundId: string | null;
  readonly roundName: string;
  readonly result: "rejected";
}

export interface UnplacedStudentDetail {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly campusId: string;
  readonly campusName: string;
  readonly city: string;
  readonly degreeName: string;
  readonly branchName: string;
  readonly passingYear: number;
  readonly overallCgpa: number | null;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  readonly participationStatus: string;
  readonly applicationsCount: number;
}

export interface OptedOutStudentDetail {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly campusId: string;
  readonly campusName: string;
  readonly city: string;
  readonly degreeName: string;
  readonly branchName: string;
  readonly passingYear: number;
}

export interface CompanyHiringInsight {
  readonly companyName: string;
  readonly offersCount: number;
  readonly applicantsCount: number;
  readonly minCtcLpa: number | null;
  readonly maxCtcLpa: number | null;
  readonly avgCtcLpa: number | null;
  readonly rolesOffered: readonly string[];
  readonly categoryBreakdown: {
    readonly superDream: number;
    readonly dream: number;
    readonly regular: number;
  };
}

export interface FunnelBreakdown {
  readonly appliedStudents: number;
  readonly totalApplications: number;
  readonly attendedRounds: number;
  readonly missedRounds: number; // absent
  readonly rejectedRounds: number; // eliminated
  readonly clearedRounds: number; // selected
  readonly placedStudents: number;
  readonly totalOffers: number;
}

export interface PackageTiers {
  readonly superDreamCount: number; // > 8 LPA
  readonly dreamCount: number; // 5 - 8 LPA
  readonly regularCount: number; // < 5 LPA
}

export interface StudentFunnelIncident {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly companyName?: string;
  readonly reason: "missed_attendance" | "rejected_in_round";
}

export interface CollegePlacementSummary {
  readonly campusId: string;
  readonly campusName: string;
  readonly city: string;
  readonly totalStudents: number;
  readonly eligibleStudents: number;
  readonly placedStudents: number;
  readonly selfPlacedStudents: number;
  readonly unplacedStudents: number;
  readonly optedOutStudents: number;
  readonly totalOffers: number;
  readonly multipleOffersCount: number;
  readonly placementRatePct: number;
  readonly highestCtcLpa: number | null;
  readonly lowestCtcLpa: number | null;
  readonly averageCtcLpa: number | null;
  readonly medianCtcLpa: number | null;

  // Detailed Analytics
  readonly funnel: FunnelBreakdown;
  readonly packageTiers: PackageTiers;
  readonly topCompanies: readonly CompanyHiringInsight[];
  readonly missedIncidents: readonly StudentFunnelIncident[];
  readonly rejectedIncidents: readonly StudentFunnelIncident[];
  readonly placedStudentsRoster?: readonly CollegePlacedStudent[] | undefined;

  // Complete Structured Rosters ("Who all that data")
  readonly placedRoster: readonly PlacedStudentDetail[];
  readonly missedRoster: readonly MissedStudentDetail[];
  readonly rejectedRoster: readonly RejectedStudentDetail[];
  readonly unplacedRoster: readonly UnplacedStudentDetail[];
  readonly optedOutRoster: readonly OptedOutStudentDetail[];
}

export interface CollegePlacementReport {
  readonly generatedAt: string;
  readonly filtersApplied: CollegePlacementFilter;
  readonly overallTotals: {
    readonly totalColleges: number;
    readonly totalStudents: number;
    readonly totalEligible: number;
    readonly totalPlaced: number;
    readonly totalSelfPlaced: number;
    readonly totalUnplaced: number;
    readonly totalOptedOut: number;
    readonly overallPlacementRatePct: number;
    readonly highestCtcLpa: number | null;
    readonly averageCtcLpa: number | null;
    readonly totalApplications: number;
    readonly totalMissedRounds: number;
    readonly totalRejectedRounds: number;
    readonly packageTiers: PackageTiers;
    readonly topCompaniesOverall: readonly CompanyHiringInsight[];

    // Global Detailed Student Rosters
    readonly placedRoster: readonly PlacedStudentDetail[];
    readonly missedRoster: readonly MissedStudentDetail[];
    readonly rejectedRoster: readonly RejectedStudentDetail[];
    readonly unplacedRoster: readonly UnplacedStudentDetail[];
    readonly optedOutRoster: readonly OptedOutStudentDetail[];
  };
  readonly colleges: readonly CollegePlacementSummary[];
}

export interface RawCampusRow {
  readonly id: string;
  readonly name: string;
  readonly code?: string | null | undefined;
  readonly city?: string | null | undefined;
  readonly cities?: { name?: string } | Array<{ name?: string }> | null | undefined;
}

export interface RawStudentRow {
  readonly id: string;
  readonly full_name: string;
  readonly roll_number: string;
  readonly email: string;
  readonly campus_id: string;
  readonly passing_year: number;
  readonly participation_status: string;
  readonly overall_cgpa?: number | null | undefined;
  readonly current_arrears?: number | null | undefined;
  readonly history_of_arrears?: number | null | undefined;
  readonly degrees?: { name?: string } | Array<{ name?: string }> | null | undefined;
  readonly branches?: { name?: string } | Array<{ name?: string }> | null | undefined;
}

export interface RawOfferRow {
  readonly id: string;
  readonly student_id: string;
  readonly drive_id?: string | null | undefined;
  readonly source: "on_campus" | "self_placed";
  readonly drive_type: string;
  readonly offer_category?: string | null | undefined;
  readonly ctc_lpa: number | string;
  readonly company_name: string;
  readonly role_title?: string | null | undefined;
  readonly declared_at: string;
}

export interface RawApplicationRow {
  readonly id: string;
  readonly student_id: string;
  readonly drive_id?: string | null | undefined;
  readonly applied_at?: string | null | undefined;
}

export interface RawAttendanceRow {
  readonly application_id: string;
  readonly status: string;
  readonly round_id?: string | null | undefined;
}

export interface RawRoundResultRow {
  readonly application_id: string;
  readonly result: string;
  readonly round_id?: string | null | undefined;
}

export interface RawDriveRow {
  readonly id: string;
  readonly company_name: string;
  readonly role_title?: string | null | undefined;
  readonly drive_type?: string | undefined;
}

export interface RawRoundRow {
  readonly id: string;
  readonly drive_id: string;
  readonly name: string;
  readonly sequence?: number | undefined;
}

export interface PlacementOfferPatch {
  readonly ctcLpa?: number | undefined;
  readonly roleTitle?: string | null | undefined;
  readonly offerCategory?: "super_dream" | "dream" | "regular" | null | undefined;
  readonly companyName?: string | undefined;
}

export interface CreatePlacementOfferInput {
  readonly studentId: string;
  readonly driveId?: string | null | undefined;
  readonly companyName: string;
  readonly roleTitle?: string | null | undefined;
  readonly driveType: "placement" | "internship" | "internship_convertible";
  readonly offerCategory?: "super_dream" | "dream" | "regular" | null | undefined;
  readonly ctcLpa: number;
  readonly source: "on_campus" | "self_placed";
  readonly declaredBy?: string | null | undefined;
  readonly approvedBy?: string | null | undefined;
  readonly approvedAt?: string | null | undefined;
}

export interface StudentPlacementProfile {
  readonly student: {
    readonly id: string;
    readonly fullName: string;
    readonly rollNumber: string;
    readonly email: string;
    readonly campusId: string;
    readonly campusName: string;
    readonly city: string;
    readonly degreeName: string;
    readonly branchName: string;
    readonly passingYear: number;
    readonly participationStatus: string;
    readonly overallCgpa: number | null;
    readonly currentArrears: number;
    readonly historyOfArrears: number;
  };
  readonly offers: readonly PlacedStudentDetail[];
  readonly applications: ReadonlyArray<{
    readonly id: string;
    readonly driveId: string | null;
    readonly companyName: string;
    readonly roleTitle: string;
    readonly driveType: string;
    readonly createdAt: string;
  }>;
  readonly roundAttendance: readonly MissedStudentDetail[];
  readonly roundResults: readonly RejectedStudentDetail[];
}

const PLACEMENT_DRIVE_TYPES = new Set(["placement", "internship_convertible"]);

function unwrapName(item: { name?: string } | Array<{ name?: string }> | null | undefined): string {
  if (!item) return "N/A";
  if (Array.isArray(item)) return item[0]?.name || "N/A";
  return item.name || "N/A";
}

function calculateMedian(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midVal = sorted[mid];
  if (midVal === undefined) return null;
  if (sorted.length % 2 !== 0) {
    return Math.round(midVal * 100) / 100;
  }
  const midPrevVal = sorted[mid - 1];
  if (midPrevVal === undefined) return Math.round(midVal * 100) / 100;
  return Math.round(((midPrevVal + midVal) / 2) * 100) / 100;
}

/**
 * Pure aggregation function calculating complete placement statistics and funnel analytics grouped by college.
 */
export function aggregateCollegePlacements(
  campuses: readonly RawCampusRow[],
  students: readonly RawStudentRow[],
  offers: readonly RawOfferRow[],
  applicationsOrFilters?: readonly RawApplicationRow[] | CollegePlacementFilter,
  attendance: readonly RawAttendanceRow[] = [],
  results: readonly RawRoundResultRow[] = [],
  drivesOrFilters: readonly RawDriveRow[] | CollegePlacementFilter = [],
  rounds: readonly RawRoundRow[] = [],
  filters: CollegePlacementFilter = {},
): CollegePlacementReport {
  let actualApplications: readonly RawApplicationRow[] = [];
  let actualAttendance: readonly RawAttendanceRow[] = [];
  let actualResults: readonly RawRoundResultRow[] = [];
  let actualDrives: readonly RawDriveRow[] = [];
  let actualRounds: readonly RawRoundRow[] = [];
  let actualFilters: CollegePlacementFilter = {};

  if (Array.isArray(applicationsOrFilters)) {
    actualApplications = applicationsOrFilters;
  } else if (applicationsOrFilters && typeof applicationsOrFilters === "object") {
    actualFilters = applicationsOrFilters as CollegePlacementFilter;
  }

  if (Array.isArray(attendance)) {
    actualAttendance = attendance;
  }

  if (Array.isArray(results)) {
    actualResults = results;
  }

  if (Array.isArray(drivesOrFilters)) {
    actualDrives = drivesOrFilters;
  } else if (drivesOrFilters && typeof drivesOrFilters === "object") {
    actualFilters = { ...actualFilters, ...(drivesOrFilters as CollegePlacementFilter) };
  }

  if (Array.isArray(rounds)) {
    actualRounds = rounds;
  }

  if (filters && typeof filters === "object") {
    actualFilters = { ...actualFilters, ...filters };
  }

  // 1. Group students by campus
  const campusesMap = new Map<string, RawCampusRow>();
  for (const c of campuses) {
    campusesMap.set(c.id, c);
  }

  const drivesMap = new Map<string, RawDriveRow>();
  for (const d of actualDrives) {
    drivesMap.set(d.id, d);
  }

  const roundsMap = new Map<string, RawRoundRow>();
  for (const r of actualRounds) {
    roundsMap.set(r.id, r);
  }

  const studentsByCampus = new Map<string, RawStudentRow[]>();
  const studentMap = new Map<string, RawStudentRow>();

  for (const s of students) {
    if (actualFilters.passingYear !== undefined && s.passing_year !== actualFilters.passingYear) {
      continue;
    }
    studentMap.set(s.id, s);
    const existing = studentsByCampus.get(s.campus_id) || [];
    existing.push(s);
    studentsByCampus.set(s.campus_id, existing);
  }

  // 2. Map applications to students
  const studentByAppId = new Map<string, RawStudentRow>();
  const appsById = new Map<string, RawApplicationRow>();
  const appsByStudent = new Map<string, RawApplicationRow[]>();

  for (const app of actualApplications) {
    appsById.set(app.id, app);
    const student = studentMap.get(app.student_id);
    if (!student) continue;
    studentByAppId.set(app.id, student);

    const existing = appsByStudent.get(app.student_id) || [];
    existing.push(app);
    appsByStudent.set(app.student_id, existing);
  }

  // 3. Group offers by student
  const offersByStudent = new Map<string, RawOfferRow[]>();
  for (const o of offers) {
    if (!studentMap.has(o.student_id)) continue;
    const existing = offersByStudent.get(o.student_id) || [];
    existing.push(o);
    offersByStudent.set(o.student_id, existing);
  }

  // 4. Map attendance (present, absent)
  const missedByStudent = new Map<string, number>();
  const presentByStudent = new Map<string, number>();
  const missedIncidentsByCampus = new Map<string, MissedStudentDetail[]>();

  for (const att of actualAttendance) {
    const student = studentByAppId.get(att.application_id);
    if (!student) continue;
    if (att.status === "absent") {
      missedByStudent.set(student.id, (missedByStudent.get(student.id) || 0) + 1);

      const app = appsById.get(att.application_id);
      const drive = app?.drive_id ? drivesMap.get(app.drive_id) : null;
      const round = att.round_id ? roundsMap.get(att.round_id) : null;
      const studentCampus = campusesMap.get(student.campus_id);
      const campusName = studentCampus?.name || "N/A";
      const city = studentCampus?.city || unwrapName(studentCampus?.cities);

      const detail: MissedStudentDetail = {
        studentId: student.id,
        fullName: student.full_name,
        rollNumber: student.roll_number,
        email: student.email,
        campusId: student.campus_id,
        campusName,
        city,
        degreeName: unwrapName(student.degrees),
        branchName: unwrapName(student.branches),
        passingYear: student.passing_year,
        applicationId: att.application_id,
        driveId: app?.drive_id || null,
        companyName: drive?.company_name || "Campus Drive",
        roundId: att.round_id || null,
        roundName: round?.name || "Interview/Assessment Round",
        status: "absent",
      };

      const existing = missedIncidentsByCampus.get(student.campus_id) || [];
      existing.push(detail);
      missedIncidentsByCampus.set(student.campus_id, existing);
    } else if (att.status === "present") {
      presentByStudent.set(student.id, (presentByStudent.get(student.id) || 0) + 1);
    }
  }

  // 5. Map round results (selected, rejected)
  const rejectedByStudent = new Map<string, number>();
  const selectedByStudent = new Map<string, number>();
  const rejectedIncidentsByCampus = new Map<string, RejectedStudentDetail[]>();

  for (const res of actualResults) {
    const student = studentByAppId.get(res.application_id);
    if (!student) continue;
    if (res.result === "rejected") {
      rejectedByStudent.set(student.id, (rejectedByStudent.get(student.id) || 0) + 1);

      const app = appsById.get(res.application_id);
      const drive = app?.drive_id ? drivesMap.get(app.drive_id) : null;
      const round = res.round_id ? roundsMap.get(res.round_id) : null;
      const studentCampus = campusesMap.get(student.campus_id);
      const campusName = studentCampus?.name || "N/A";
      const city = studentCampus?.city || unwrapName(studentCampus?.cities);

      const detail: RejectedStudentDetail = {
        studentId: student.id,
        fullName: student.full_name,
        rollNumber: student.roll_number,
        email: student.email,
        campusId: student.campus_id,
        campusName,
        city,
        degreeName: unwrapName(student.degrees),
        branchName: unwrapName(student.branches),
        passingYear: student.passing_year,
        applicationId: res.application_id,
        driveId: app?.drive_id || null,
        companyName: drive?.company_name || "Campus Drive",
        roundId: res.round_id || null,
        roundName: round?.name || "Elimination Round",
        result: "rejected",
      };

      const existing = rejectedIncidentsByCampus.get(student.campus_id) || [];
      existing.push(detail);
      rejectedIncidentsByCampus.set(student.campus_id, existing);
    } else if (res.result === "selected") {
      selectedByStudent.set(student.id, (selectedByStudent.get(student.id) || 0) + 1);
    }
  }

  // 6. Aggregate by college
  const collegeSummaries: CollegePlacementSummary[] = [];
  const allHighestPackages: number[] = [];
  const overallCompanyMap = new Map<
    string,
    {
      offers: number;
      applicants: number;
      packages: number[];
      roles: Set<string>;
      superDream: number;
      dream: number;
      regular: number;
    }
  >();

  let overallSuperDream = 0;
  let overallDream = 0;
  let overallRegular = 0;
  let overallTotalApps = 0;
  let overallTotalMissed = 0;
  let overallTotalRejected = 0;

  const allPlacedRoster: PlacedStudentDetail[] = [];
  const allMissedRoster: MissedStudentDetail[] = [];
  const allRejectedRoster: RejectedStudentDetail[] = [];
  const allUnplacedRoster: UnplacedStudentDetail[] = [];
  const allOptedOutRoster: OptedOutStudentDetail[] = [];

  for (const campus of campuses) {
    if (actualFilters.campusId && campus.id !== actualFilters.campusId) {
      continue;
    }

    const campusStudents = studentsByCampus.get(campus.id) || [];
    const totalStudents = campusStudents.length;

    let eligibleStudents = 0;
    let optedOutStudents = 0;
    let placedStudents = 0;
    let selfPlacedStudents = 0;
    let totalOffers = 0;
    let multipleOffersCount = 0;

    let collegeAppsCount = 0;
    let collegeAppliedStudents = 0;
    let collegeMissedCount = 0;
    let collegePresentCount = 0;
    let collegeRejectedCount = 0;
    let collegeClearedCount = 0;

    let collegeSuperDream = 0;
    let collegeDream = 0;
    let collegeRegular = 0;

    const studentHighestCtcList: number[] = [];
    const campusCompanyMap = new Map<
      string,
      {
        offers: number;
        applicants: number;
        packages: number[];
        roles: Set<string>;
        superDream: number;
        dream: number;
        regular: number;
      }
    >();

    const legacyMissedIncidents: StudentFunnelIncident[] = [];
    const legacyRejectedIncidents: StudentFunnelIncident[] = [];
    const legacyRoster: CollegePlacedStudent[] = [];

    const collegePlacedRoster: PlacedStudentDetail[] = [];
    const collegeUnplacedRoster: UnplacedStudentDetail[] = [];
    const collegeOptedOutRoster: OptedOutStudentDetail[] = [];

    const city = campus.city || unwrapName(campus.cities);

    for (const student of campusStudents) {
      const isOptedOut = student.participation_status === "opted_out";
      if (isOptedOut) {
        optedOutStudents += 1;
        const optedDetail: OptedOutStudentDetail = {
          studentId: student.id,
          fullName: student.full_name,
          rollNumber: student.roll_number,
          email: student.email,
          campusId: campus.id,
          campusName: campus.name,
          city,
          degreeName: unwrapName(student.degrees),
          branchName: unwrapName(student.branches),
          passingYear: student.passing_year,
        };
        collegeOptedOutRoster.push(optedDetail);
        allOptedOutRoster.push(optedDetail);
      } else {
        eligibleStudents += 1;
      }

      // Funnel tracking
      const studentApps = appsByStudent.get(student.id) || [];
      if (studentApps.length > 0) {
        collegeAppliedStudents += 1;
        collegeAppsCount += studentApps.length;
        overallTotalApps += studentApps.length;
      }

      const missed = missedByStudent.get(student.id) || 0;
      if (missed > 0) {
        collegeMissedCount += missed;
        overallTotalMissed += missed;
        legacyMissedIncidents.push({
          studentId: student.id,
          fullName: student.full_name,
          rollNumber: student.roll_number,
          reason: "missed_attendance",
        });
      }

      const pres = presentByStudent.get(student.id) || 0;
      if (pres > 0) collegePresentCount += pres;

      const rej = rejectedByStudent.get(student.id) || 0;
      if (rej > 0) {
        collegeRejectedCount += rej;
        overallTotalRejected += rej;
        legacyRejectedIncidents.push({
          studentId: student.id,
          fullName: student.full_name,
          rollNumber: student.roll_number,
          reason: "rejected_in_round",
        });
      }

      const sel = selectedByStudent.get(student.id) || 0;
      if (sel > 0) collegeClearedCount += sel;

      // Offers tracking
      const studentOffers = offersByStudent.get(student.id) || [];
      let isStudentPlaced = false;
      let isStudentSelfPlaced = false;
      let highestPackageForStudent: number | null = null;
      let placedOfferCount = 0;

      for (const off of studentOffers) {
        const ctc = Number(off.ctc_lpa) || 0;
        const isPlacementOffer =
          PLACEMENT_DRIVE_TYPES.has(off.drive_type) && off.source === "on_campus";
        const isSelfPlacedOffer = off.source === "self_placed";

        if (isPlacementOffer) {
          isStudentPlaced = true;
          placedOfferCount += 1;
          totalOffers += 1;

          if (highestPackageForStudent === null || ctc > highestPackageForStudent) {
            highestPackageForStudent = ctc;
          }
        } else if (isSelfPlacedOffer) {
          isStudentSelfPlaced = true;
          selfPlacedStudents += 1;
        }

        // Track salary tiers
        if (ctc >= 8) {
          collegeSuperDream += 1;
          overallSuperDream += 1;
        } else if (ctc >= 5) {
          collegeDream += 1;
          overallDream += 1;
        } else {
          collegeRegular += 1;
          overallRegular += 1;
        }

        // Company statistics
        const compName = off.company_name || "Unknown Company";
        const role = off.role_title || "Graduate Trainee";

        const existingCampus = campusCompanyMap.get(compName) || {
          offers: 0,
          applicants: 0,
          packages: [],
          roles: new Set<string>(),
          superDream: 0,
          dream: 0,
          regular: 0,
        };
        existingCampus.offers += 1;
        existingCampus.packages.push(ctc);
        existingCampus.roles.add(role);
        if (ctc >= 8) existingCampus.superDream += 1;
        else if (ctc >= 5) existingCampus.dream += 1;
        else existingCampus.regular += 1;
        campusCompanyMap.set(compName, existingCampus);

        const existingOver = overallCompanyMap.get(compName) || {
          offers: 0,
          applicants: 0,
          packages: [],
          roles: new Set<string>(),
          superDream: 0,
          dream: 0,
          regular: 0,
        };
        existingOver.offers += 1;
        existingOver.packages.push(ctc);
        existingOver.roles.add(role);
        if (ctc >= 8) existingOver.superDream += 1;
        else if (ctc >= 5) existingOver.dream += 1;
        else existingOver.regular += 1;
        overallCompanyMap.set(compName, existingOver);

        const tier: "super_dream" | "dream" | "regular" =
          ctc >= 8 ? "super_dream" : ctc >= 5 ? "dream" : "regular";

        const placedDetail: PlacedStudentDetail = {
          studentId: student.id,
          fullName: student.full_name,
          rollNumber: student.roll_number,
          email: student.email,
          campusId: campus.id,
          campusName: campus.name,
          city,
          degreeName: unwrapName(student.degrees),
          branchName: unwrapName(student.branches),
          passingYear: student.passing_year,
          offerId: off.id,
          companyName: off.company_name,
          roleTitle: role,
          driveType: off.drive_type,
          offerCategory: off.offer_category || null,
          ctcLpa: ctc,
          tier,
          source: off.source,
          declaredAt: off.declared_at,
        };

        collegePlacedRoster.push(placedDetail);
        allPlacedRoster.push(placedDetail);

        if (actualFilters.includeStudentRoster) {
          legacyRoster.push({
            studentId: student.id,
            fullName: student.full_name,
            rollNumber: student.roll_number,
            email: student.email,
            campusId: campus.id,
            campusName: campus.name,
            degreeName: unwrapName(student.degrees),
            branchName: unwrapName(student.branches),
            passingYear: student.passing_year,
            companyName: off.company_name,
            roleTitle: role,
            driveType: off.drive_type,
            offerCategory: off.offer_category || null,
            ctcLpa: ctc,
            source: off.source,
            declaredAt: off.declared_at,
          });
        }
      }

      if (isStudentPlaced) {
        placedStudents += 1;
        if (placedOfferCount > 1) {
          multipleOffersCount += 1;
        }
      } else if (!isOptedOut && !isStudentSelfPlaced) {
        const unplacedDetail: UnplacedStudentDetail = {
          studentId: student.id,
          fullName: student.full_name,
          rollNumber: student.roll_number,
          email: student.email,
          campusId: campus.id,
          campusName: campus.name,
          city,
          degreeName: unwrapName(student.degrees),
          branchName: unwrapName(student.branches),
          passingYear: student.passing_year,
          overallCgpa: student.overall_cgpa !== undefined ? student.overall_cgpa : null,
          currentArrears: student.current_arrears || 0,
          historyOfArrears: student.history_of_arrears || 0,
          participationStatus: student.participation_status,
          applicationsCount: studentApps.length,
        };
        collegeUnplacedRoster.push(unplacedDetail);
        allUnplacedRoster.push(unplacedDetail);
      }

      if (isStudentPlaced && highestPackageForStudent !== null && highestPackageForStudent > 0) {
        studentHighestCtcList.push(highestPackageForStudent);
        allHighestPackages.push(highestPackageForStudent);
      }
    }

    const unplacedStudents = Math.max(0, eligibleStudents - placedStudents);
    const placementRatePct =
      eligibleStudents > 0 ? Math.round((placedStudents / eligibleStudents) * 10000) / 100 : 0;

    const highestCtcLpa =
      studentHighestCtcList.length > 0 ? Math.max(...studentHighestCtcList) : null;
    const lowestCtcLpa =
      studentHighestCtcList.length > 0 ? Math.min(...studentHighestCtcList) : null;
    const averageCtcLpa =
      studentHighestCtcList.length > 0
        ? Math.round(
            (studentHighestCtcList.reduce((acc, v) => acc + v, 0) /
              studentHighestCtcList.length) *
              100,
          ) / 100
        : null;
    const medianCtcLpa = calculateMedian(studentHighestCtcList);

    const topCompanies: CompanyHiringInsight[] = Array.from(campusCompanyMap.entries())
      .map(([companyName, data]) => ({
        companyName,
        offersCount: data.offers,
        applicantsCount: data.applicants,
        minCtcLpa: data.packages.length > 0 ? Math.min(...data.packages) : null,
        maxCtcLpa: data.packages.length > 0 ? Math.max(...data.packages) : null,
        avgCtcLpa:
          data.packages.length > 0
            ? Math.round((data.packages.reduce((a, b) => a + b, 0) / data.packages.length) * 100) /
              100
            : null,
        rolesOffered: Array.from(data.roles),
        categoryBreakdown: {
          superDream: data.superDream,
          dream: data.dream,
          regular: data.regular,
        },
      }))
      .sort((a, b) => b.offersCount - a.offersCount);

    const collegeMissedRoster = missedIncidentsByCampus.get(campus.id) || [];
    const collegeRejectedRoster = rejectedIncidentsByCampus.get(campus.id) || [];

    allMissedRoster.push(...collegeMissedRoster);
    allRejectedRoster.push(...collegeRejectedRoster);

    collegeSummaries.push({
      campusId: campus.id,
      campusName: campus.name,
      city,
      totalStudents,
      eligibleStudents,
      placedStudents,
      selfPlacedStudents,
      unplacedStudents,
      optedOutStudents,
      totalOffers,
      multipleOffersCount,
      placementRatePct,
      highestCtcLpa,
      lowestCtcLpa,
      averageCtcLpa,
      medianCtcLpa,
      funnel: {
        appliedStudents: collegeAppliedStudents,
        totalApplications: collegeAppsCount,
        attendedRounds: collegePresentCount,
        missedRounds: collegeMissedCount,
        rejectedRounds: collegeRejectedCount,
        clearedRounds: collegeClearedCount,
        placedStudents,
        totalOffers,
      },
      packageTiers: {
        superDreamCount: collegeSuperDream,
        dreamCount: collegeDream,
        regularCount: collegeRegular,
      },
      topCompanies,
      missedIncidents: legacyMissedIncidents,
      rejectedIncidents: legacyRejectedIncidents,
      ...(actualFilters.includeStudentRoster ? { placedStudentsRoster: legacyRoster } : {}),

      placedRoster: collegePlacedRoster,
      missedRoster: collegeMissedRoster,
      rejectedRoster: collegeRejectedRoster,
      unplacedRoster: collegeUnplacedRoster,
      optedOutRoster: collegeOptedOutRoster,
    });
  }

  // Calculate Overall Totals
  const totalStudentsAll = collegeSummaries.reduce((acc, c) => acc + c.totalStudents, 0);
  const totalEligibleAll = collegeSummaries.reduce((acc, c) => acc + c.eligibleStudents, 0);
  const totalPlacedAll = collegeSummaries.reduce((acc, c) => acc + c.placedStudents, 0);
  const totalSelfPlacedAll = collegeSummaries.reduce((acc, c) => acc + c.selfPlacedStudents, 0);
  const totalUnplacedAll = collegeSummaries.reduce((acc, c) => acc + c.unplacedStudents, 0);
  const totalOptedOutAll = collegeSummaries.reduce((acc, c) => acc + c.optedOutStudents, 0);

  const overallPlacementRatePct =
    totalEligibleAll > 0 ? Math.round((totalPlacedAll / totalEligibleAll) * 10000) / 100 : 0;

  const highestCtcAll = allHighestPackages.length > 0 ? Math.max(...allHighestPackages) : null;
  const averageCtcAll =
    allHighestPackages.length > 0
      ? Math.round(
          (allHighestPackages.reduce((acc, v) => acc + v, 0) / allHighestPackages.length) * 100,
        ) / 100
      : null;

  const topCompaniesOverall: CompanyHiringInsight[] = Array.from(overallCompanyMap.entries())
    .map(([companyName, data]) => ({
      companyName,
      offersCount: data.offers,
      applicantsCount: data.applicants,
      minCtcLpa: data.packages.length > 0 ? Math.min(...data.packages) : null,
      maxCtcLpa: data.packages.length > 0 ? Math.max(...data.packages) : null,
      avgCtcLpa:
        data.packages.length > 0
          ? Math.round((data.packages.reduce((a, b) => a + b, 0) / data.packages.length) * 100) /
            100
          : null,
      rolesOffered: Array.from(data.roles),
      categoryBreakdown: {
        superDream: data.superDream,
        dream: data.dream,
        regular: data.regular,
      },
    }))
    .sort((a, b) => b.offersCount - a.offersCount);

  return {
    generatedAt: new Date().toISOString(),
    filtersApplied: actualFilters,
    overallTotals: {
      totalColleges: collegeSummaries.length,
      totalStudents: totalStudentsAll,
      totalEligible: totalEligibleAll,
      totalPlaced: totalPlacedAll,
      totalSelfPlaced: totalSelfPlacedAll,
      totalUnplaced: totalUnplacedAll,
      totalOptedOut: totalOptedOutAll,
      overallPlacementRatePct,
      highestCtcLpa: highestCtcAll,
      averageCtcLpa: averageCtcAll,
      totalApplications: overallTotalApps,
      totalMissedRounds: overallTotalMissed,
      totalRejectedRounds: overallTotalRejected,
      packageTiers: {
        superDreamCount: overallSuperDream,
        dreamCount: overallDream,
        regularCount: overallRegular,
      },
      topCompaniesOverall,

      placedRoster: allPlacedRoster,
      missedRoster: allMissedRoster,
      rejectedRoster: allRejectedRoster,
      unplacedRoster: allUnplacedRoster,
      optedOutRoster: allOptedOutRoster,
    },
    colleges: collegeSummaries,
  };
}

/**
 * Main API function fetching data directly from existing Supabase tables with ZERO DB changes.
 */
export async function fetchCollegePlacementData(
  client: SupabaseClient,
  filters: CollegePlacementFilter = {},
): Promise<CollegePlacementReport> {
  // Query campuses
  let campusQuery = client
    .from("campuses")
    .select("id, name, code, is_active, cities(name)")
    .order("name");
  if (filters.campusId) {
    campusQuery = campusQuery.eq("id", filters.campusId);
  }

  // Query students with joined degrees and branches
  let studentQuery = client
    .from("students")
    .select(
      "id, full_name, roll_number, email, campus_id, passing_year, participation_status, overall_cgpa, current_arrears, history_of_arrears, degrees(name), branches(name)",
    );
  if (filters.campusId) {
    studentQuery = studentQuery.eq("campus_id", filters.campusId);
  }
  if (filters.passingYear) {
    studentQuery = studentQuery.eq("passing_year", filters.passingYear);
  }

  const [
    { data: campuses, error: campusErr },
    { data: students, error: studentErr },
    { data: applications, error: appErr },
    { data: attendance, error: attErr },
    { data: results, error: resErr },
    { data: offers, error: offerErr },
    { data: drives, error: driveErr },
    { data: rounds, error: roundErr },
  ] = await Promise.all([
    campusQuery,
    studentQuery,
    client.from("applications").select("id, student_id, drive_id, applied_at"),
    client.from("attendance").select("application_id, status, round_id"),
    client.from("round_results").select("application_id, result, round_id"),
    client.from("offers").select(
      "id, student_id, drive_id, source, drive_type, offer_category, ctc_lpa, company_name, role_title, declared_at",
    ),
    client.from("drives").select("id, company_name, role_title, drive_type"),
    client.from("drive_rounds").select("id, drive_id, name, sequence"),
  ]);

  if (campusErr) throw new Error(`Failed to fetch campuses: ${campusErr.message}`);
  if (studentErr) throw new Error(`Failed to fetch students: ${studentErr.message}`);
  if (appErr) throw new Error(`Failed to fetch applications: ${appErr.message}`);
  if (attErr) throw new Error(`Failed to fetch attendance: ${attErr.message}`);
  if (resErr) throw new Error(`Failed to fetch results: ${resErr.message}`);
  if (offerErr) throw new Error(`Failed to fetch offers: ${offerErr.message}`);
  if (driveErr) throw new Error(`Failed to fetch drives: ${driveErr.message}`);
  if (roundErr) throw new Error(`Failed to fetch rounds: ${roundErr.message}`);

  return aggregateCollegePlacements(
    campuses || [],
    (students || []) as RawStudentRow[],
    (offers || []) as RawOfferRow[],
    (applications || []) as RawApplicationRow[],
    (attendance || []) as RawAttendanceRow[],
    (results || []) as RawRoundResultRow[],
    (drives || []) as RawDriveRow[],
    (rounds || []) as RawRoundRow[],
    filters,
  );
}

/**
 * Update an existing placement offer (CTC, Role, Category, Company)
 */
export async function updatePlacementOffer(
  client: SupabaseClient,
  offerId: string,
  patch: PlacementOfferPatch,
): Promise<{ success: boolean; data: any; error: string | null }> {
  const updateData: Record<string, any> = {};
  if (patch.ctcLpa !== undefined) updateData.ctc_lpa = patch.ctcLpa;
  if (patch.roleTitle !== undefined) updateData.role_title = patch.roleTitle;
  if (patch.offerCategory !== undefined) updateData.offer_category = patch.offerCategory;
  if (patch.companyName !== undefined) updateData.company_name = patch.companyName;

  const { data, error } = await client
    .from("offers")
    .update(updateData)
    .eq("id", offerId)
    .select()
    .single();

  if (error) {
    return { success: false, data: null, error: error.message };
  }
  return { success: true, data, error: null };
}

/**
 * Create/Record a newly confirmed placement offer (On-Campus or Self-Placed)
 */
export async function createPlacementOffer(
  client: SupabaseClient,
  input: CreatePlacementOfferInput,
): Promise<{ success: boolean; data: any; error: string | null }> {
  const insertPayload = {
    student_id: input.studentId,
    drive_id: input.driveId || null,
    company_name: input.companyName,
    role_title: input.roleTitle || null,
    drive_type: input.driveType,
    offer_category: input.offerCategory || null,
    ctc_lpa: input.ctcLpa,
    source: input.source,
    declared_by: input.declaredBy || null,
    ...(input.approvedBy
      ? {
          approved_by: input.approvedBy,
          approved_at: input.approvedAt || new Date().toISOString(),
        }
      : {}),
  };

  const { data, error } = await client
    .from("offers")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    return { success: false, data: null, error: error.message };
  }
  return { success: true, data, error: null };
}

/**
 * Safely delete an incorrect or revoked placement offer
 */
export async function deletePlacementOffer(
  client: SupabaseClient,
  offerId: string,
): Promise<{ success: boolean; error: string | null }> {
  const { error } = await client.from("offers").delete().eq("id", offerId);
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, error: null };
}

/**
 * Update a student's participation status (e.g. mark 'active' or 'opted_out')
 */
export async function updateStudentParticipationStatus(
  client: SupabaseClient,
  studentId: string,
  status: "active" | "opted_out",
): Promise<{ success: boolean; data: any; error: string | null }> {
  const { data, error } = await client
    .from("students")
    .update({ participation_status: status })
    .eq("id", studentId)
    .select("id, full_name, roll_number, email, participation_status")
    .single();

  if (error) {
    return { success: false, data: null, error: error.message };
  }
  return { success: true, data, error: null };
}

/**
 * Fetch complete student placement timeline & history
 */
export async function fetchStudentPlacementProfile(
  client: SupabaseClient,
  studentId: string,
): Promise<StudentPlacementProfile | null> {
  const { data: student, error: sErr } = await client
    .from("students")
    .select(
      "id, full_name, roll_number, email, campus_id, passing_year, participation_status, overall_cgpa, current_arrears, history_of_arrears, campuses(name, cities(name)), degrees(name), branches(name)",
    )
    .eq("id", studentId)
    .maybeSingle();

  if (sErr || !student) return null;

  const [
    { data: offers },
    { data: applications },
    { data: allDrives },
    { data: allRounds },
  ] = await Promise.all([
    client
      .from("offers")
      .select(
        "id, student_id, drive_id, source, drive_type, offer_category, ctc_lpa, company_name, role_title, declared_at",
      )
      .eq("student_id", studentId),
    client
      .from("applications")
      .select("id, drive_id, applied_at")
      .eq("student_id", studentId),
    client.from("drives").select("id, company_name, role_title, drive_type"),
    client.from("drive_rounds").select("id, drive_id, name, sequence"),
  ]);

  const drivesMap = new Map((allDrives || []).map((d: any) => [d.id, d]));
  const roundsMap = new Map((allRounds || []).map((r: any) => [r.id, r]));

  const appIds = (applications || []).map((a: any) => a.id);
  let attendanceList: any[] = [];
  let resultsList: any[] = [];

  if (appIds.length > 0) {
    const [attRes, roundRes] = await Promise.all([
      client.from("attendance").select("application_id, status, round_id").in("application_id", appIds),
      client.from("round_results").select("application_id, result, round_id").in("application_id", appIds),
    ]);
    attendanceList = attRes.data || [];
    resultsList = roundRes.data || [];
  }

  const campusData: any = student.campuses;
  const campusName = campusData?.name || "N/A";
  const city = campusData?.city || unwrapName(campusData?.cities);

  const placedOffers: PlacedStudentDetail[] = (offers || []).map((off: any) => {
    const ctc = Number(off.ctc_lpa) || 0;
    return {
      studentId: student.id,
      fullName: student.full_name,
      rollNumber: student.roll_number,
      email: student.email,
      campusId: student.campus_id,
      campusName,
      city,
      degreeName: unwrapName(student.degrees),
      branchName: unwrapName(student.branches),
      passingYear: student.passing_year,
      offerId: off.id,
      companyName: off.company_name,
      roleTitle: off.role_title || "Graduate Trainee",
      driveType: off.drive_type,
      offerCategory: off.offer_category || null,
      ctcLpa: ctc,
      tier: ctc >= 8 ? "super_dream" : ctc >= 5 ? "dream" : "regular",
      source: off.source,
      declaredAt: off.declared_at,
    };
  });

  const appsById = new Map((applications || []).map((a: any) => [a.id, a]));

  const missedRounds: MissedStudentDetail[] = attendanceList
    .filter((a) => a.status === "absent")
    .map((att) => {
      const app = appsById.get(att.application_id);
      const drive = app?.drive_id ? drivesMap.get(app.drive_id) : null;
      const round = att.round_id ? roundsMap.get(att.round_id) : null;
      return {
        studentId: student.id,
        fullName: student.full_name,
        rollNumber: student.roll_number,
        email: student.email,
        campusId: student.campus_id,
        campusName,
        city,
        degreeName: unwrapName(student.degrees),
        branchName: unwrapName(student.branches),
        passingYear: student.passing_year,
        applicationId: att.application_id,
        driveId: app?.drive_id || null,
        companyName: drive?.company_name || "Campus Drive",
        roundId: att.round_id || null,
        roundName: round?.name || "Interview/Assessment Round",
        status: "absent",
      };
    });

  const rejectedRounds: RejectedStudentDetail[] = resultsList
    .filter((r) => r.result === "rejected")
    .map((res) => {
      const app = appsById.get(res.application_id);
      const drive = app?.drive_id ? drivesMap.get(app.drive_id) : null;
      const round = res.round_id ? roundsMap.get(res.round_id) : null;
      return {
        studentId: student.id,
        fullName: student.full_name,
        rollNumber: student.roll_number,
        email: student.email,
        campusId: student.campus_id,
        campusName,
        city,
        degreeName: unwrapName(student.degrees),
        branchName: unwrapName(student.branches),
        passingYear: student.passing_year,
        applicationId: res.application_id,
        driveId: app?.drive_id || null,
        companyName: drive?.company_name || "Campus Drive",
        roundId: res.round_id || null,
        roundName: round?.name || "Elimination Round",
        result: "rejected",
      };
    });

  const appDetails = (applications || []).map((app: any) => {
    const drive = app.drive_id ? drivesMap.get(app.drive_id) : null;
    return {
      id: app.id,
      driveId: app.drive_id || null,
      companyName: drive?.company_name || "Campus Drive",
      roleTitle: drive?.role_title || "N/A",
      driveType: drive?.drive_type || "placement",
      createdAt: app.applied_at || new Date().toISOString(),
    };
  });

  return {
    student: {
      id: student.id,
      fullName: student.full_name,
      rollNumber: student.roll_number,
      email: student.email,
      campusId: student.campus_id,
      campusName,
      city,
      degreeName: unwrapName(student.degrees),
      branchName: unwrapName(student.branches),
      passingYear: student.passing_year,
      participationStatus: student.participation_status,
      overallCgpa: student.overall_cgpa ?? null,
      currentArrears: student.current_arrears ?? 0,
      historyOfArrears: student.history_of_arrears ?? 0,
    },
    offers: placedOffers,
    applications: appDetails,
    roundAttendance: missedRounds,
    roundResults: rejectedRounds,
  };
}
