import { describe, expect, it } from "vitest";
import {
  canReleasePlacementHold,
  HOLD_KIND_DESCRIPTIONS,
  HOLD_KIND_LABELS,
  HOLD_ORDER_MAX_BYTES,
  HOLD_READER_ROLES,
  type HoldDraft,
  type HoldWindow,
  holdDraftProblem,
  holdStanding,
  holdWindowLine,
} from "./holds";
import { APP_ROLES, HOLD_KINDS } from "./types";

/**
 * The college's temporary block on one student's placements (0125).
 *
 * These are the rules the screens repeat, so they are where the two can be
 * proven to agree — most of all the one decision the product made deliberately:
 * `ends_at` is a review date and NEVER a switch. A function that returned
 * "released" past that date would put a student back into placements nobody
 * approved, and nothing downstream would notice.
 */

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

const windowOf = (over: Partial<HoldWindow> = {}): HoldWindow => ({
  kind: "fees",
  startsAt: "2026-10-29",
  endsAt: "2026-12-15",
  releasedAt: null,
  ...over,
});

describe("HOLD_KIND_LABELS", () => {
  it("names every kind the database can store", () => {
    expect(Object.keys(HOLD_KIND_LABELS).sort()).toEqual([...HOLD_KINDS].sort());
    expect(Object.keys(HOLD_KIND_DESCRIPTIONS).sort()).toEqual([...HOLD_KINDS].sort());
  });

  /** "idle" was the user's own word for it ("students not even tried to apply"). */
  it("says idle as not applying, never as idle", () => {
    expect(HOLD_KIND_LABELS.idle).toMatch(/not applying/i);
    expect(HOLD_KIND_LABELS.idle).not.toMatch(/idle/i);
  });

  it("describes each kind as what happens to the student", () => {
    expect(HOLD_KIND_DESCRIPTIONS.fees).toMatch(/dues|accounts/i);
    expect(HOLD_KIND_DESCRIPTIONS.self_placed).toMatch(/closed/i);
    expect(HOLD_KIND_DESCRIPTIONS.idle).toMatch(/not applying/i);
  });
});

describe("HOLD_READER_ROLES", () => {
  /** The near-side mirror of 0125: campus_manager's own-college policy + is_org_reader(). */
  it("is every org reader plus the campus manager, and nobody else", () => {
    expect([...HOLD_READER_ROLES].sort()).toEqual(
      [
        "admin",
        "central_placement_coordinator",
        "delivery_head",
        "ceo",
        "er_head",
        "enterprise_relations",
        "campus_manager",
      ].sort(),
    );
  });

  it("keeps the student and the company roles out", () => {
    for (const role of ["student", "key_account_manager", "account_executive"] as const) {
      expect(HOLD_READER_ROLES.includes(role)).toBe(false);
    }
  });

  it("holds nothing but roles the enum actually has", () => {
    for (const role of HOLD_READER_ROLES) expect(APP_ROLES.includes(role)).toBe(true);
  });
});

describe("canReleasePlacementHold", () => {
  it("is the campus manager alone, across every role", () => {
    expect(APP_ROLES.filter(canReleasePlacementHold)).toEqual(["campus_manager"]);
  });

  /** A fee hold is cleared by the college that raised it, never by HQ. */
  it("refuses admin, who can read every hold", () => {
    expect(HOLD_READER_ROLES.includes("admin")).toBe(true);
    expect(canReleasePlacementHold("admin")).toBe(false);
  });
});

describe("holdStanding", () => {
  const today = day("2026-11-10");

  it("reads a past review date as still held", () => {
    expect(holdStanding(windowOf({ endsAt: "2026-11-01" }), today)).toBe("overdue");
  });

  it("does not release anything on a date", () => {
    const late = holdStanding(windowOf({ endsAt: "2020-01-01" }), today);
    expect(late).not.toBe("released");
  });

  /** `ends_at` is a day, and a day is not over until the whole of it has passed. */
  it("keeps today's review date open until the day itself has gone", () => {
    expect(holdStanding(windowOf({ endsAt: "2026-11-10" }), day("2026-11-10"))).toBe("open");
    expect(holdStanding(windowOf({ endsAt: "2026-11-10" }), day("2026-11-11"))).toBe("overdue");
  });

  it("prefers the release a person actually did over any date on the window", () => {
    expect(
      holdStanding(windowOf({ endsAt: "2026-11-01", releasedAt: "2026-11-05T09:00:00Z" }), today),
    ).toBe("released");
    expect(
      holdStanding(windowOf({ endsAt: "2026-12-31", releasedAt: "2026-11-05T09:00:00Z" }), today),
    ).toBe("released");
  });
});

describe("holdWindowLine", () => {
  it("gives the review date while it still lies ahead", () => {
    expect(holdWindowLine(windowOf(), day("2026-11-10"))).toBe(
      "from 29 Oct 2026, review by 15 Dec 2026",
    );
  });

  it("changes the tense once it has gone by, without changing the standing", () => {
    expect(holdWindowLine(windowOf({ endsAt: "2026-11-01" }), day("2026-11-10"))).toBe(
      "from 29 Oct 2026, review was due 01 Nov 2026",
    );
  });

  it("quotes the release day and stops quoting the window", () => {
    expect(
      holdWindowLine(windowOf({ releasedAt: "2026-11-08T22:30:00Z" }), day("2026-11-10")),
    ).toBe("released 08 Nov 2026");
  });

  /**
   * A `date` column reads as midnight UTC and a `timestamptz` as a moment in
   * someone's local time. Both must print the day the manager typed, so the
   * day comes from the leading ten characters and never from a shifted Date.
   */
  it("prints the same day for a date column and for a local evening timestamp", () => {
    expect(holdWindowLine(windowOf({ startsAt: "2026-10-29" }), day("2026-11-10"))).toContain(
      "from 29 Oct 2026",
    );
    expect(
      holdWindowLine(windowOf({ releasedAt: "2026-10-29T23:30:00+05:30" }), day("2026-11-10")),
    ).toBe("released 29 Oct 2026");
  });
});

describe("holdDraftProblem", () => {
  const draft = (over: Partial<HoldDraft> = {}): HoldDraft => ({
    kind: "fees",
    reason: "Two semesters of fees unpaid.",
    startsAt: "2026-10-29",
    endsAt: "2026-12-15",
    ...over,
  });

  it("accepts what the database accepts", () => {
    expect(holdDraftProblem(draft())).toBeNull();
    expect(holdDraftProblem(draft({ endsAt: "2026-10-29" }))).toBeNull();
  });

  /** 0130: both ends of the window are named, so nobody leaves the review to fate. */
  it("refuses a hold with no review date", () => {
    expect(holdDraftProblem(draft({ endsAt: "" }))).toMatch(/should be reviewed/i);
  });

  it("asks for the kind before anything else", () => {
    expect(holdDraftProblem(draft({ kind: null, reason: "" }))).toMatch(/choose what/i);
  });

  /** The reason is what the student is told — 0125 checks `trim(reason) <> ''`. */
  it("refuses a reason that is only whitespace", () => {
    expect(holdDraftProblem(draft({ reason: "   " }))).toMatch(/give the reason/i);
  });

  it("asks when the hold starts, since nothing else can place it", () => {
    expect(holdDraftProblem(draft({ startsAt: "" }))).toMatch(/when the hold starts/i);
  });

  /** 0125's `hold_window_is_ordered`, asked before an upload is wasted. */
  it("refuses a review date before the hold begins", () => {
    expect(holdDraftProblem(draft({ startsAt: "2026-12-15", endsAt: "2026-12-01" }))).toMatch(
      /cannot fall before/i,
    );
  });

  it("opens the dialog with nothing placeable", () => {
    expect(holdDraftProblem({ kind: null, reason: "", startsAt: "", endsAt: "" })).toMatch(
      /choose what/i,
    );
  });
});

describe("HOLD_ORDER_MAX_BYTES", () => {
  /** Asked before the file is read, so it matches the bucket's own ceiling (0125). */
  it("is the 5 MiB the hold-orders bucket enforces", () => {
    expect(HOLD_ORDER_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
