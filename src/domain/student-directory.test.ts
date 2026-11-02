import { describe, expect, it } from "vitest";
import {
  type DirectoryFilter,
  type DirectoryStudent,
  filterDirectory,
  summariseDirectory,
} from "./student-directory";

/**
 * 2026-08-17 (Karthik), two asks that turn out to be one screen:
 *
 *  - "Add one more page to display details of all students part of the
 *    placement process."
 *  - "Hyperlink the Placed count to open or export a detailed breakdown (e.g.
 *    student name, company, package, role)."
 *
 * The breakdown IS the directory, filtered to the placed. Building them
 * separately would be two screens that have to agree about who counts as
 * placed, and they would eventually stop agreeing.
 *
 * The placement shown here is R9's - `resolvePlacementRecord` - so a student
 * holding three offers appears once, at the one that is their record. The
 * dashboard counts the same way, which is the whole reason this list is
 * reachable from that number.
 */
const PLACED: DirectoryStudent = {
  studentId: "s1",
  fullName: "Anjali Subramanian",
  rollNumber: "21CSE1042",
  campusName: "SDNB Vaishnav College",
  degree: "B.E.",
  branch: "CSE",
  passingYear: 2026,
  cgpa: 8.6,
  srfStatus: "srf_approved",
  participationStatus: "active",
  applications: 3,
  hasSelfPlacement: false,
  placement: {
    companyName: "Zoho Corporation",
    roleTitle: "Member Technical Staff",
    ctcLpa: 6.5,
    offerCategory: "dream",
    source: "on_campus",
  },
};

const UNPLACED: DirectoryStudent = {
  studentId: "s2",
  fullName: "Rahul Nair",
  rollNumber: "21CSE1099",
  campusName: "SDNB Vaishnav College",
  degree: "B.E.",
  branch: "ECE",
  passingYear: 2026,
  cgpa: 7.2,
  srfStatus: "srf_submitted",
  participationStatus: "active",
  applications: 1,
  hasSelfPlacement: false,
  placement: null,
};

const OPTED_OUT: DirectoryStudent = {
  ...UNPLACED,
  studentId: "s3",
  fullName: "Meera Iyer",
  rollNumber: "21CSE1100",
  // Her own branch, so the "matches on branch" test is testing the match and
  // not quietly inheriting ECE from the row above.
  branch: "IT",
  participationStatus: "opted_out",
  // Her roster carries no overall figure: absence is a fact of its own.
  cgpa: null,
  applications: 0,
};

const ALL = [PLACED, UNPLACED, OPTED_OUT];

const names = (rows: readonly DirectoryStudent[]) => rows.map((r) => r.fullName);

describe("filterDirectory", () => {
  it.each([
    ["all", ["Anjali Subramanian", "Rahul Nair", "Meera Iyer"]],
    ["placed", ["Anjali Subramanian"]],
    ["not_placed", ["Rahul Nair", "Meera Iyer"]],
    ["opted_out", ["Meera Iyer"]],
  ] as [DirectoryFilter, string[]][])(
    "filter %s returns the right students",
    (filter, expected) => {
      expect(names(filterDirectory(ALL, { filter, query: "" }))).toEqual(expected);
    },
  );

  /** The coordinator's first instinct is to type a name or a roll number. */
  it.each(["anjali", "ANJALI", "21CSE1042", "zoho", "Member Technical"])(
    "matches on %s",
    (query) => {
      expect(names(filterDirectory(ALL, { filter: "all", query }))).toEqual(["Anjali Subramanian"]);
    },
  );

  it("matches on campus, degree and branch too", () => {
    expect(names(filterDirectory(ALL, { filter: "all", query: "ECE" }))).toEqual(["Rahul Nair"]);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(names(filterDirectory(ALL, { filter: "all", query: "  rahul  " }))).toEqual([
      "Rahul Nair",
    ]);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    expect(filterDirectory(ALL, { filter: "all", query: "nobody" })).toEqual([]);
  });

  /** Filter and query compose: a search inside the placed stays inside the placed. */
  it("applies the query within the filter, not instead of it", () => {
    expect(filterDirectory(ALL, { filter: "placed", query: "rahul" })).toEqual([]);
  });

  it("handles an empty roster", () => {
    expect(filterDirectory([], { filter: "placed", query: "" })).toEqual([]);
  });

  /**
   * An opted-out student who was already placed is still placed. Participation
   * and placement are different questions, and letting one answer the other is
   * how a placed student disappears from a report.
   */
  it("does not let opting out erase a placement", () => {
    const placedThenOptedOut = {
      ...PLACED,
      studentId: "s4",
      participationStatus: "opted_out" as const,
    };
    expect(names(filterDirectory([placedThenOptedOut], { filter: "placed", query: "" }))).toEqual([
      "Anjali Subramanian",
    ]);
  });
});

describe("summariseDirectory", () => {
  it("counts the roster, the placed and the opted out", () => {
    expect(summariseDirectory(ALL)).toEqual({
      total: 3,
      placed: 1,
      notPlaced: 2,
      optedOut: 1,
    });
  });

  it("is all zeroes for an empty roster rather than throwing", () => {
    expect(summariseDirectory([])).toEqual({ total: 0, placed: 0, notPlaced: 0, optedOut: 0 });
  });

  /** placed + notPlaced must always be the total, or the screen contradicts itself. */
  it("splits the roster exactly", () => {
    const summary = summariseDirectory(ALL);
    expect(summary.placed + summary.notPlaced).toBe(summary.total);
  });
});

/**
 * 2026-10-29: a held student is neither opted out nor disbarred — they are
 * temporarily blocked by their own college (0125) and are expected back. Kept
 * out of ALL so the counts above it stay the counts they claim to be.
 */
const HELD: DirectoryStudent = {
  ...UNPLACED,
  studentId: "s7",
  fullName: "Kavya Reddy",
  branch: "CSE",
  participationStatus: "on_hold",
};

describe("filterDirectory — the held", () => {
  const ROSTER = [PLACED, UNPLACED, OPTED_OUT, HELD];

  it("lists them by on_hold, and not by the filter that means opting out", () => {
    expect(names(filterDirectory(ROSTER, { filter: "on_hold", query: "" }))).toEqual([
      "Kavya Reddy",
    ]);
    expect(names(filterDirectory(ROSTER, { filter: "opted_out", query: "" }))).toEqual([
      "Meera Iyer",
    ]);
  });

  /** A hold is not a withdrawal: they are still on the roster, still unplaced. */
  it("keeps them in the roster and the unplaced", () => {
    expect(names(filterDirectory(ROSTER, { filter: "all", query: "" }))).toHaveLength(4);
    expect(names(filterDirectory(ROSTER, { filter: "not_placed", query: "" }))).toContain(
      "Kavya Reddy",
    );
  });

  /**
   * The summary still counts only the opted out on their own line, and says
   * nothing about holds — the honest reading. An `onHold` figure belongs to the
   * day a card prints it and opens exactly the students behind it.
   */
  it("does not move the opted-out count", () => {
    expect(summariseDirectory(ROSTER).optedOut).toBe(1);
  });
});

/**
 * 2026-10-29: the student who has not tried — the population the `idle` hold
 * kind (0130) is placed on. "Never applied" is narrower than "not placed":
 * it also asks whether they are still in placements at all, and whether they
 * have put in a single application.
 */
const IDLE: DirectoryStudent = {
  ...UNPLACED,
  studentId: "s8",
  fullName: "Farhan Ali",
  branch: "CSE",
  applications: 0,
};

describe("filterDirectory — the never-applied", () => {
  const ROSTER = [PLACED, UNPLACED, OPTED_OUT, HELD, IDLE];

  it("lists a student in placements with no application at all", () => {
    expect(names(filterDirectory(ROSTER, { filter: "never_applied", query: "" }))).toEqual([
      "Farhan Ali",
    ]);
  });

  it("leaves out the opted out, the placed, and anyone who did apply", () => {
    const rows = names(filterDirectory(ROSTER, { filter: "never_applied", query: "" }));
    // Meera has zero applications too, but she has already left placements.
    expect(rows).not.toContain("Meera Iyer");
    expect(rows).not.toContain("Anjali Subramanian");
    // Kavya is held and has applied; idleness is not her story.
    expect(rows).not.toContain("Kavya Reddy");
  });
});

/**
 * 2026-08-26 (answer 3): the overview's "Placed on campus" counts
 * `hasOnCampusPlacement` — self-placed excluded, PRD §16.2 — while `placed`
 * here counts any placement record, self-placed INCLUDED (C1, deliberate).
 * The card linked to `placed` and therefore opened a longer list than the
 * number it was printed on. These two filters are the exact populations.
 */
const SELF_PLACED: DirectoryStudent = {
  ...UNPLACED,
  studentId: "s5",
  fullName: "Thanush Krishna",
  campusName: "Alliance University",
  hasSelfPlacement: true,
  placement: {
    companyName: "Freshworks",
    roleTitle: null,
    ctcLpa: 4.8,
    offerCategory: "regular",
    source: "self_placed",
  },
};

/** Holds BOTH. The on-campus record is displayed; the self-placed one is still a fact. */
const BOTH: DirectoryStudent = {
  ...PLACED,
  studentId: "s6",
  fullName: "Divya Ramesh",
  hasSelfPlacement: true,
};

const WIDER = [PLACED, UNPLACED, OPTED_OUT, SELF_PLACED, BOTH];

describe("filterDirectory — the overview's populations", () => {
  it.each([
    ["on_campus", ["Anjali Subramanian", "Divya Ramesh"]],
    ["self_placed", ["Thanush Krishna", "Divya Ramesh"]],
    ["placed", ["Anjali Subramanian", "Thanush Krishna", "Divya Ramesh"]],
  ] as [DirectoryFilter, string[]][])(
    "filter %s returns exactly that population",
    (filter, expected) => {
      expect(names(filterDirectory(WIDER, { filter, query: "" }))).toEqual(expected);
    },
  );

  /**
   * A student holding both offers is counted by the Self-placed card, so they
   * must appear in the list that card opens — displaying their on-campus
   * record does not undo the self-placed one.
   */
  it("does not lose a doubly-placed student from the self-placed list", () => {
    expect(names(filterDirectory([BOTH], { filter: "self_placed", query: "" }))).toEqual([
      "Divya Ramesh",
    ]);
  });

  /** The funnel rows, filtered by the funnel's own predicates. */
  it.each([
    [
      "submitted",
      ["Anjali Subramanian", "Rahul Nair", "Meera Iyer", "Thanush Krishna", "Divya Ramesh"],
    ],
    // Rahul has applied to one drive, which is why he is verified whatever
    // his status column says. That is the funnel's rule, not an accident.
    ["verified", ["Anjali Subramanian", "Rahul Nair", "Thanush Krishna", "Divya Ramesh"]],
  ] as [DirectoryFilter, string[]][])("filter %s matches the funnel row", (filter, expected) => {
    expect(names(filterDirectory(WIDER, { filter, query: "" }))).toEqual(expected);
  });

  it("counts an application as evidence of verification, as the funnel does", () => {
    const applied = {
      ...UNPLACED,
      studentId: "s7",
      fullName: "Kavya Raj",
      srfStatus: "registered" as const,
      applications: 2,
    };
    expect(names(filterDirectory([applied], { filter: "verified", query: "" }))).toEqual([
      "Kavya Raj",
    ]);
  });

  it("does not count a student who has applied to nothing and been approved by nobody", () => {
    const idle = {
      ...UNPLACED,
      studentId: "s8",
      fullName: "Idle Student",
      srfStatus: "registered" as const,
      applications: 0,
    };
    expect(filterDirectory([idle], { filter: "verified", query: "" })).toEqual([]);
    expect(filterDirectory([idle], { filter: "submitted", query: "" })).toEqual([]);
  });
});

describe("filterDirectory — campus, package and category", () => {
  it("narrows to one campus, by name", () => {
    expect(
      names(filterDirectory(WIDER, { filter: "all", query: "", campus: "Alliance University" })),
    ).toEqual(["Thanush Krishna"]);
  });

  it("does not care about the case or padding of a campus name", () => {
    expect(
      names(filterDirectory(WIDER, { filter: "all", query: "", campus: "  alliance university " })),
    ).toEqual(["Thanush Krishna"]);
  });

  it("returns nothing for a campus nobody is on", () => {
    expect(filterDirectory(WIDER, { filter: "all", query: "", campus: "Nowhere College" })).toEqual(
      [],
    );
  });

  /** CLAUDE.md: money is never compared with `===`. */
  it("narrows to the students holding exactly one package figure", () => {
    expect(names(filterDirectory(WIDER, { filter: "placed", query: "", ctc: 6.5 }))).toEqual([
      "Anjali Subramanian",
      "Divya Ramesh",
    ]);
  });

  it("matches a package figure a float has mangled", () => {
    expect(names(filterDirectory(WIDER, { filter: "placed", query: "", ctc: 2.4 * 2 }))).toEqual([
      "Thanush Krishna",
    ]);
  });

  it("never matches an unplaced student on a package", () => {
    expect(filterDirectory([UNPLACED], { filter: "all", query: "", ctc: 6.5 })).toEqual([]);
  });

  it("narrows to an offer category", () => {
    expect(
      names(filterDirectory(WIDER, { filter: "all", query: "", category: "regular" })),
    ).toEqual(["Thanush Krishna"]);
  });

  /** Every dimension composes; none of them silently widens another. */
  it("composes filter, campus, package, category and query", () => {
    expect(
      names(
        filterDirectory(WIDER, {
          filter: "on_campus",
          query: "anjali",
          campus: "SDNB Vaishnav College",
          ctc: 6.5,
          category: "dream",
        }),
      ),
    ).toEqual(["Anjali Subramanian"]);

    expect(
      filterDirectory(WIDER, { filter: "on_campus", query: "", campus: "Alliance University" }),
    ).toEqual([]);
  });
});

/**
 * 2026-11-02: the students screen grew dropdowns for the facts its table has
 * no column for — degree, branch, passing year, registration and
 * participation. Each one is the same question (narrow to the rows holding
 * this fact), so they are tested as one family, including the rule that a
 * blank choice is no filter rather than a match on emptiness.
 */
describe("filterDirectory — the facts the table does not print", () => {
  /** A second degree and year, so each choice is one a reader could pick. */
  const PG: DirectoryStudent = {
    ...UNPLACED,
    studentId: "s9",
    fullName: "Nithya Balan",
    degree: "M.Tech.",
    branch: "CSE",
    passingYear: 2027,
  };

  const ROSTER = [...ALL, PG];

  it("narrows to one degree", () => {
    expect(names(filterDirectory(ROSTER, { filter: "all", query: "", degree: "M.Tech." }))).toEqual(
      ["Nithya Balan"],
    );
  });

  it("does not care about the case or padding of a degree", () => {
    expect(
      names(filterDirectory(ROSTER, { filter: "all", query: "", degree: "  m.tech. " })),
    ).toEqual(["Nithya Balan"]);
  });

  it("narrows to one branch", () => {
    expect(names(filterDirectory(ROSTER, { filter: "all", query: "", branch: "ECE" }))).toEqual([
      "Rahul Nair",
    ]);
  });

  it("narrows to one passing year", () => {
    expect(names(filterDirectory(ROSTER, { filter: "all", query: "", passingYear: 2026 }))).toEqual(
      ["Anjali Subramanian", "Rahul Nair", "Meera Iyer"],
    );
    expect(names(filterDirectory(ROSTER, { filter: "all", query: "", passingYear: 2027 }))).toEqual(
      ["Nithya Balan"],
    );
  });

  it("narrows to one registration status", () => {
    expect(
      names(filterDirectory(ROSTER, { filter: "all", query: "", srfStatus: "srf_approved" })),
    ).toEqual(["Anjali Subramanian"]);
    expect(
      names(filterDirectory(ROSTER, { filter: "all", query: "", srfStatus: "srf_submitted" })),
    ).toEqual(["Rahul Nair", "Meera Iyer", "Nithya Balan"]);
  });

  it("narrows to one participation status", () => {
    expect(
      names(
        filterDirectory(ROSTER, { filter: "all", query: "", participationStatus: "opted_out" }),
      ),
    ).toEqual(["Meera Iyer"]);
  });

  /** The selects send "" for their all option; that must widen, not empty, the list. */
  it("treats a blank choice as no filter rather than a match on emptiness", () => {
    expect(filterDirectory(ROSTER, { filter: "all", query: "", degree: "   " })).toEqual(ROSTER);
  });

  it("never matches a value nobody in the roster holds", () => {
    expect(filterDirectory(ROSTER, { filter: "all", query: "", branch: "Mech" })).toEqual([]);
  });

  /**
   * The dropdowns are not alternatives to the chip — they narrow inside it.
   * Every one of them at once still answers with the one student who satisfies
   * all of them.
   */
  it("composes with the chip, the search, the campus and each other", () => {
    expect(
      names(
        filterDirectory(ROSTER, {
          filter: "submitted",
          query: "rahul",
          campus: "SDNB Vaishnav College",
          branch: "ECE",
          passingYear: 2026,
          srfStatus: "srf_submitted",
          participationStatus: "active",
        }),
      ),
    ).toEqual(["Rahul Nair"]);

    // The same branch inside "placed" is nobody: Rahul holds no offer.
    expect(filterDirectory(ROSTER, { filter: "placed", query: "", branch: "ECE" })).toEqual([]);
  });

  it("supports multi-selection of SRF statuses", () => {
    expect(
      names(
        filterDirectory(ROSTER, {
          query: "",
          srfStatuses: ["srf_approved", "srf_submitted"],
        }),
      ),
    ).toEqual(["Anjali Subramanian", "Rahul Nair", "Meera Iyer", "Nithya Balan"]);
  });

  it("supports multi-selection of filters", () => {
    expect(
      names(
        filterDirectory(ROSTER, {
          query: "",
          filters: ["on_campus", "opted_out"],
        }),
      ),
    ).toEqual(["Anjali Subramanian", "Meera Iyer"]);
  });
});
