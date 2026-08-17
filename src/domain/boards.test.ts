import { describe, expect, it } from "vitest";
import {
  boardLabel,
  describeBoard,
  INDIAN_STATES,
  isSchoolBoard,
  SCHOOL_BOARDS,
  validateBoardSelection,
} from "./boards";

/**
 * The board a school figure came from (asked for 2026-08-18).
 *
 * A dropdown rather than free text, because "cbse", "C.B.S.E." and "Central
 * Board" are four boards to Postgres and one board to a human. The rules that
 * make the pair (board, state) coherent live here so the form, the database
 * check constraint and the coordinator's queue cannot disagree.
 */
describe("SCHOOL_BOARDS", () => {
  it("is the agreed vocabulary, in the order the dropdown offers it", () => {
    expect(SCHOOL_BOARDS).toEqual([
      "state_board",
      "cbse",
      "cisce",
      "nios",
      "ib",
      "cambridge",
      "other",
    ]);
  });

  it("recognises its own values and nothing else", () => {
    for (const board of SCHOOL_BOARDS) expect(isSchoolBoard(board)).toBe(true);
    expect(isSchoolBoard("CBSE")).toBe(false);
    expect(isSchoolBoard("")).toBe(false);
    expect(isSchoolBoard("icse")).toBe(false);
  });
});

describe("boardLabel", () => {
  /**
   * CISCE runs ICSE at class 10 and ISC at class 12. One stored value, two
   * labels - a second enum value would let a student pick "ISC" for their
   * tenth and nothing would catch it.
   */
  it("reads ICSE at class 10 and ISC at class 12, from one stored value", () => {
    expect(boardLabel("cisce", "tenth")).toBe("ICSE (CISCE)");
    expect(boardLabel("cisce", "twelfth")).toBe("ISC (CISCE)");
  });

  it("names Cambridge by the qualification each class sits", () => {
    expect(boardLabel("cambridge", "tenth")).toBe("Cambridge (IGCSE / O-Level)");
    expect(boardLabel("cambridge", "twelfth")).toBe("Cambridge (A-Level)");
  });

  it("labels every other board the same way at both levels", () => {
    for (const board of ["state_board", "cbse", "nios", "ib", "other"] as const) {
      expect(boardLabel(board, "tenth")).toBe(boardLabel(board, "twelfth"));
    }
    expect(boardLabel("state_board", "tenth")).toBe("State Board");
    expect(boardLabel("cbse", "tenth")).toBe("CBSE");
    expect(boardLabel("nios", "tenth")).toBe("NIOS");
    expect(boardLabel("ib", "tenth")).toBe("International Baccalaureate (IB)");
    expect(boardLabel("other", "tenth")).toBe("Other");
  });
});

describe("INDIAN_STATES", () => {
  it("covers all 28 states and 8 union territories", () => {
    expect(INDIAN_STATES).toHaveLength(36);
  });

  it("holds no duplicates and is alphabetical, so the dropdown is searchable", () => {
    expect(new Set(INDIAN_STATES).size).toBe(INDIAN_STATES.length);
    expect([...INDIAN_STATES]).toEqual([...INDIAN_STATES].sort((a, b) => a.localeCompare(b)));
  });

  it("names the states the client's campuses are in", () => {
    for (const state of ["Tamil Nadu", "Andhra Pradesh", "Telangana", "Karnataka", "Kerala"]) {
      expect(INDIAN_STATES).toContain(state);
    }
  });
});

describe("validateBoardSelection", () => {
  it("accepts a named board with neither extra answered", () => {
    expect(validateBoardSelection({ board: "cbse", state: null, other: null })).toEqual([]);
  });

  it("requires a board at all - it is mandatory for every student (answer 2)", () => {
    expect(validateBoardSelection({ board: null, state: null, other: null })).toEqual([
      "Select the board.",
    ]);
  });

  describe("State Board", () => {
    it("requires the state, because a state board is 36 different boards", () => {
      expect(validateBoardSelection({ board: "state_board", state: null, other: null })).toEqual([
        "Select which state's board it was.",
      ]);
    });

    it("accepts a state that is on the list", () => {
      expect(
        validateBoardSelection({ board: "state_board", state: "Tamil Nadu", other: null }),
      ).toEqual([]);
    });

    it("refuses a state that is not on the list, however it is spelled", () => {
      expect(
        validateBoardSelection({ board: "state_board", state: "Tamilnadu", other: null }),
      ).toEqual(["Select which state's board it was."]);
    });

    it("treats whitespace as unanswered", () => {
      expect(validateBoardSelection({ board: "state_board", state: "   ", other: null })).toEqual([
        "Select which state's board it was.",
      ]);
    });

    it("refuses a board name typed alongside it - only one of the two can apply", () => {
      expect(
        validateBoardSelection({ board: "state_board", state: "Kerala", other: "CBSE" }),
      ).toEqual(["Only name the board when you have selected Other."]);
    });
  });

  describe("Other", () => {
    it("requires the board to be named", () => {
      expect(validateBoardSelection({ board: "other", state: null, other: null })).toEqual([
        "Name the board.",
      ]);
      expect(validateBoardSelection({ board: "other", state: null, other: "  " })).toEqual([
        "Name the board.",
      ]);
    });

    it("accepts a named one", () => {
      expect(
        validateBoardSelection({ board: "other", state: null, other: "Jamia Milia board" }),
      ).toEqual([]);
    });

    it("refuses a state alongside it", () => {
      expect(
        validateBoardSelection({ board: "other", state: "Kerala", other: "Some board" }),
      ).toEqual(["Only select a state when you have selected State Board."]);
    });
  });

  it("refuses a state or a name against a board that needs neither", () => {
    expect(validateBoardSelection({ board: "cbse", state: "Kerala", other: null })).toEqual([
      "Only select a state when you have selected State Board.",
    ]);
    expect(validateBoardSelection({ board: "cbse", state: null, other: "CBSE" })).toEqual([
      "Only name the board when you have selected Other.",
    ]);
  });

  it("reports every problem at once, so the student fixes the pair in one pass", () => {
    expect(
      validateBoardSelection({ board: "state_board", state: null, other: "CBSE" }),
    ).toHaveLength(2);
  });
});

describe("describeBoard", () => {
  it("names the state, because 'State Board' alone does not identify one", () => {
    expect(describeBoard({ board: "state_board", state: "Tamil Nadu", other: null }, "tenth")).toBe(
      "State Board — Tamil Nadu",
    );
  });

  it("falls back to the plain label when the state is missing", () => {
    expect(describeBoard({ board: "state_board", state: null, other: null }, "tenth")).toBe(
      "State Board",
    );
  });

  it("uses what the student typed for Other", () => {
    expect(describeBoard({ board: "other", state: null, other: "Jamia board" }, "twelfth")).toBe(
      "Jamia board",
    );
    expect(describeBoard({ board: "other", state: null, other: "  " }, "twelfth")).toBe("Other");
  });

  it("uses the class-specific label for the rest", () => {
    expect(describeBoard({ board: "cisce", state: null, other: null }, "twelfth")).toBe(
      "ISC (CISCE)",
    );
  });

  /**
   * Five students registered before boards existed. A blank cell in the
   * coordinator's queue would read as "no board", which is a claim about the
   * student; "Not recorded" is a fact about the record.
   */
  it("says so plainly when nothing was ever recorded", () => {
    expect(describeBoard({ board: null, state: null, other: null }, "tenth")).toBe("Not recorded");
    expect(describeBoard(null, "tenth")).toBe("Not recorded");
  });

  /**
   * Undefined too, and this is not defensive noise: the coordinator's queue
   * renders this for every row, and an older caller that has not been given the
   * field yet must not take the WHOLE verification queue down with it. That is
   * exactly what happened when the field was added - the screen rendered empty.
   */
  it("survives a caller that does not know about boards yet", () => {
    expect(describeBoard(undefined, "tenth")).toBe("Not recorded");
    expect(describeBoard({ board: undefined, state: undefined, other: undefined }, "twelfth")).toBe(
      "Not recorded",
    );
  });
});
