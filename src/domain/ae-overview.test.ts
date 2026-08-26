import { describe, expect, it } from "vitest";
import { type AeDrive, summariseAeDrives } from "./ae-overview";

/**
 * The Account Executive's own work, as their landing page reports it.
 * Approved 2026-08-26 (mockup + option A).
 *
 * Every figure here is about DRIVES THEY RAISED. Which drives those are is
 * RLS's answer, never this function's — an AE is returned only their own, and
 * re-filtering here would be a second, weaker copy of a rule the database
 * already enforces.
 */
const drive = (over: Partial<AeDrive> = {}): AeDrive => ({
  status: "live",
  applicants: [],
  ...over,
});

const applicant = (over: { shortlisted?: boolean; hasOffer?: boolean } = {}) => ({
  shortlisted: false,
  hasOffer: false,
  ...over,
});

describe("summariseAeDrives", () => {
  it("counts every drive they raised, whatever became of it", () => {
    const totals = summariseAeDrives([
      drive({ status: "draft" }),
      drive({ status: "submitted" }),
      drive({ status: "live" }),
      drive({ status: "completed" }),
      drive({ status: "rejected" }),
    ]);

    expect(totals.broughtIn).toBe(5);
  });

  /** "Live now" is the published, still-open ones — not everything unfinished. */
  it("counts only live drives as live now", () => {
    const totals = summariseAeDrives([
      drive({ status: "live" }),
      drive({ status: "live" }),
      drive({ status: "in_rounds" }),
      drive({ status: "approved" }),
    ]);

    expect(totals.liveNow).toBe(2);
  });

  it("counts completed drives on their own line", () => {
    const totals = summariseAeDrives([
      drive({ status: "completed" }),
      drive({ status: "completed" }),
      drive({ status: "in_rounds" }),
    ]);

    expect(totals.completed).toBe(2);
  });

  it("adds up applicants, shortlists and offers across every drive", () => {
    const totals = summariseAeDrives([
      drive({
        applicants: [
          applicant({ shortlisted: true, hasOffer: true }),
          applicant({ shortlisted: true }),
          applicant(),
        ],
      }),
      drive({ applicants: [applicant({ shortlisted: true }), applicant()] }),
    ]);

    expect(totals.applicants).toBe(5);
    expect(totals.shortlisted).toBe(3);
    expect(totals.offers).toBe(1);
  });

  /**
   * A shortlisted applicant who is later offered stays counted in both — the
   * shortlist is what the recruiter was sent, and an offer does not un-send it.
   * The Live-drives cards count the same way (`summariseFunnel`).
   */
  it("keeps an offered applicant in the shortlist count", () => {
    const totals = summariseAeDrives([
      drive({ applicants: [applicant({ shortlisted: true, hasOffer: true })] }),
    ]);

    expect(totals.shortlisted).toBe(1);
    expect(totals.offers).toBe(1);
  });

  it("counts an offer to someone who was never shortlisted", () => {
    // Rare but real: a recruiter picks up a candidate outside the list we sent.
    const totals = summariseAeDrives([drive({ applicants: [applicant({ hasOffer: true })] })]);

    expect(totals.shortlisted).toBe(0);
    expect(totals.offers).toBe(1);
  });

  it("is all zeroes for an AE who has raised nothing", () => {
    expect(summariseAeDrives([])).toEqual({
      broughtIn: 0,
      liveNow: 0,
      applicants: 0,
      shortlisted: 0,
      offers: 0,
      completed: 0,
    });
  });

  it("handles a drive nobody has applied to without inventing a zero elsewhere", () => {
    const totals = summariseAeDrives([drive(), drive({ applicants: [applicant()] })]);

    expect(totals).toEqual({
      broughtIn: 2,
      liveNow: 2,
      applicants: 1,
      shortlisted: 0,
      offers: 0,
      completed: 0,
    });
  });
});
