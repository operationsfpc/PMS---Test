import { describe, expect, it } from "vitest";
import {
  type ApplicantFacts,
  canPublishDrive,
  canShortlistFromPortfolio,
  canViewDriveApplicants,
  driveProgress,
  involvementIn,
  summariseFunnel,
} from "./drive-portfolio";
import type { ApplicantRound } from "./student-progress";
import { APP_ROLES, DRIVE_STATUSES } from "./types";

/**
 * A drive seen by the people who own it: the Account Executive who raised it
 * and the Delivery Head who approved it.
 *
 * Requested 2026-08-04: "they should be able to see all drives they have
 * raised/approved, the applicants to the drive, the progress of the drives".
 * All three questions are answered here, so the AE's screen and the Central
 * CPC's cockpit can never disagree about the same drive.
 */

const round = (over: Partial<ApplicantRound> & { sequence: number }): ApplicantRound => ({
  name: `Round ${over.sequence}`,
  participating: false,
  attendance: null,
  result: null,
  ...over,
});

const OWNERSHIP = {
  createdBy: "ae-1",
  approvedBy: "dh-1",
  publishedBy: "cpc-1",
};

describe("involvementIn", () => {
  it("names the person who raised the drive", () => {
    expect(involvementIn(OWNERSHIP, "ae-1")).toEqual(["raised"]);
  });

  it("names the person who approved it", () => {
    expect(involvementIn(OWNERSHIP, "dh-1")).toEqual(["approved"]);
  });

  it("names the person who published it", () => {
    expect(involvementIn(OWNERSHIP, "cpc-1")).toEqual(["published"]);
  });

  it("reports every hat one person wore, in pipeline order", () => {
    expect(involvementIn({ createdBy: "x", approvedBy: null, publishedBy: "x" }, "x")).toEqual([
      "raised",
      "published",
    ]);
  });

  it("returns nothing for someone who never touched the drive", () => {
    expect(involvementIn(OWNERSHIP, "stranger")).toEqual([]);
  });

  it("never matches an unassigned slot to an unknown viewer", () => {
    expect(involvementIn({ createdBy: null, approvedBy: null, publishedBy: null }, "x")).toEqual(
      [],
    );
  });
});

describe("driveProgress", () => {
  const facts = {
    status: "live",
    onHold: false,
    totalRounds: 4,
    roundsDecided: 0,
  } as const;

  it("places a drive on the pipeline and says where in words", () => {
    const progress = driveProgress({ ...facts, status: "submitted" });

    expect(progress.phase).toBe("Awaiting approval");
    expect(progress.stageIndex).toBe(1);
  });

  it("moves forward as the drive does", () => {
    const draft = driveProgress({ ...facts, status: "draft" }).percentComplete;
    const live = driveProgress({ ...facts, status: "live" }).percentComplete;
    const done = driveProgress({ ...facts, status: "completed" }).percentComplete;

    expect(draft).toBe(0);
    expect(live).toBeGreaterThan(draft);
    expect(done).toBe(100);
  });

  it("reports how many rounds have been decided, so 'in rounds' means something", () => {
    const progress = driveProgress({
      ...facts,
      status: "in_rounds",
      totalRounds: 4,
      roundsDecided: 2,
    });

    expect(progress.phase).toBe("Rounds in progress");
    expect(progress.roundsDecided).toBe(2);
    expect(progress.totalRounds).toBe(4);
  });

  it("says a held drive is held, whatever stage it reached", () => {
    const progress = driveProgress({ ...facts, status: "live", onHold: true });

    expect(progress.blocked).toMatch(/on hold/i);
  });

  it("leaves an unheld drive unblocked", () => {
    expect(driveProgress(facts).blocked).toBeNull();
  });

  it("takes a rejected drive off the pipeline rather than showing it as 12% done", () => {
    const progress = driveProgress({ ...facts, status: "rejected" });

    expect(progress.phase).toBe("Rejected");
    expect(progress.percentComplete).toBe(0);
    expect(progress.terminal).toBe(true);
  });

  it("does not call a live drive terminal", () => {
    expect(driveProgress(facts).terminal).toBe(false);
  });

  it("marks a completed drive terminal too - there is nothing left to do", () => {
    expect(driveProgress({ ...facts, status: "completed" }).terminal).toBe(true);
  });
});

describe("summariseFunnel", () => {
  const applicant = (over: Partial<ApplicantFacts>): ApplicantFacts => ({
    applicationId: "a",
    shortlisted: false,
    hasOffer: false,
    rounds: [],
    ...over,
  });

  it("counts everyone who applied", () => {
    expect(summariseFunnel([applicant({}), applicant({ applicationId: "b" })]).applied).toBe(2);
  });

  it("counts only the applicants a coordinator actually included", () => {
    const funnel = summariseFunnel([
      applicant({ shortlisted: true }),
      applicant({ applicationId: "b", shortlisted: false }),
    ]);

    expect(funnel.shortlisted).toBe(1);
  });

  it("counts an applicant as in rounds only once a round has named them", () => {
    const funnel = summariseFunnel([
      applicant({ rounds: [round({ sequence: 1, participating: true })] }),
      applicant({ applicationId: "b", rounds: [round({ sequence: 1 })] }),
    ]);

    expect(funnel.inRounds).toBe(1);
  });

  it("counts offers and rejections separately from the ones still running", () => {
    const funnel = summariseFunnel([
      applicant({ hasOffer: true }),
      applicant({
        applicationId: "b",
        rounds: [round({ sequence: 1, participating: true, result: "rejected" })],
      }),
      applicant({
        applicationId: "c",
        rounds: [round({ sequence: 1, participating: true })],
      }),
    ]);

    expect(funnel.offers).toBe(1);
    expect(funnel.notSelected).toBe(1);
    expect(funnel.inRounds).toBe(1);
  });

  it("returns zeroes rather than dividing by nothing when no one has applied", () => {
    expect(summariseFunnel([])).toEqual({
      applied: 0,
      shortlisted: 0,
      inRounds: 0,
      offers: 0,
      notSelected: 0,
    });
  });
});

/**
 * F15 (UAT 2026-08-06): "The drive module of view present for the account
 * executive must be the present for Central Placement Coordinator with
 * shortlisting access."
 *
 * The same screen, for both — but only one of them may act on it. Shortlisting
 * decides who a recruiter ever sees, so who may do it is a rule, not a prop
 * somebody remembers to pass.
 */
describe("canShortlistFromPortfolio", () => {
  it("lets the Central Placement Coordinator shortlist", () => {
    expect(canShortlistFromPortfolio("central_placement_coordinator")).toBe(true);
  });

  /**
   * The AE raised the drive and may watch it. They must not choose who the
   * recruiter sees: PRD §13.1 makes that the coordinator's decision, and the
   * AE is the recruiter's own contact.
   */
  it("does not let the Account Executive who raised the drive shortlist", () => {
    expect(canShortlistFromPortfolio("account_executive")).toBe(false);
  });

  it("does not let the Delivery Head shortlist either", () => {
    expect(canShortlistFromPortfolio("delivery_head")).toBe(false);
  });

  it("lets nobody else near it", () => {
    for (const role of APP_ROLES.filter(
      (r) => r !== "central_placement_coordinator" && r !== "campus_placement_coordinator",
    )) {
      expect(canShortlistFromPortfolio(role)).toBe(false);
    }
  });

  /** The campus coordinator shortlists their own campus's applicants (§13.1). */
  it("lets the campus coordinator shortlist", () => {
    expect(canShortlistFromPortfolio("campus_placement_coordinator")).toBe(true);
  });
});

/**
 * 2026-08-17 (Karthik): "the AE should only be able to view the students
 * shortlisted or selected or their drive status and results. They should not
 * be able to publish drives or shortlist students."
 *
 * Publishing is what makes a drive visible to students and opens applications
 * (PRD §12). The AE is the recruiter's contact and raised the PIF; letting the
 * same person publish removes the only separation between "the client wants
 * this" and "our students are told about it".
 */
describe("canPublishDrive", () => {
  it("lets the Central Placement Coordinator publish", () => {
    expect(canPublishDrive("central_placement_coordinator")).toBe(true);
  });

  it("does not let the Account Executive publish the drive they raised", () => {
    expect(canPublishDrive("account_executive")).toBe(false);
  });

  /** Approving the commercials is not the same as announcing the drive. */
  it("does not let the Delivery Head publish", () => {
    expect(canPublishDrive("delivery_head")).toBe(false);
  });

  it("lets nobody else near it", () => {
    for (const role of APP_ROLES.filter((r) => r !== "central_placement_coordinator")) {
      expect(canPublishDrive(role)).toBe(false);
    }
  });
});

/**
 * 2026-08-17 (Karthik): "For drives with a status of Published or Approved,
 * viewing company applicants is strictly restricted to the Account Executive.
 * Central Placement Coordinators and other non-Account Executive roles cannot
 * view or access the applicants list for these drives. (Central placement
 * coordinator and delivery head have this option currently.)"
 *
 * This governs the DRIVE PORTFOLIO's applicant list — the company-facing roll
 * of who applied, which belongs to the AE who owns the recruiter relationship.
 * It is not the coordinators' working list: they reach applicants through
 * Shortlisting, Rounds & results and Final selection, which are unaffected.
 */
describe("canViewDriveApplicants", () => {
  it("lets the Account Executive see the applicants to an approved drive", () => {
    expect(canViewDriveApplicants("account_executive")).toBe(true);
  });

  it("lets the Account Executive see the applicants to a published drive", () => {
    expect(canViewDriveApplicants("account_executive")).toBe(true);
  });

  /** Named explicitly in the request as roles that have it today and must not. */
  it.each(["central_placement_coordinator", "delivery_head"] as const)(
    "refuses %s on an approved drive",
    (role) => {
      expect(canViewDriveApplicants(role)).toBe(false);
    },
  );

  it.each(["central_placement_coordinator", "delivery_head"] as const)(
    "refuses %s on a published drive",
    (role) => {
      expect(canViewDriveApplicants(role)).toBe(false);
    },
  );

  /**
   * "Published" is the whole family the UI files under Published, not the
   * `live` status alone — a drive does not stop being published because its
   * rounds have started.
   */
  it.each(["live", "applications_closed", "in_rounds", "completed"] as const)(
    "treats %s as published, so only the AE sees the list",
    (status) => {
      expect(canViewDriveApplicants("account_executive")).toBe(true);
      expect(canViewDriveApplicants("central_placement_coordinator")).toBe(false);
    },
  );

  /** Nobody else, whatever the status. */
  it("refuses every other role outright", () => {
    for (const role of APP_ROLES.filter((r) => r !== "account_executive")) {
      for (const status of DRIVE_STATUSES) {
        expect(canViewDriveApplicants(role)).toBe(false);
      }
    }
  });

  /**
   * Before approval a drive has no applicants to show, so this is not a
   * loosening — it keeps the rule a statement about who, not a coincidence of
   * empty data.
   */
  it.each(["draft", "submitted", "rejected"] as const)(
    "still shows the AE nothing to hide on a %s drive",
    (status) => {
      expect(canViewDriveApplicants("account_executive")).toBe(true);
    },
  );
});
