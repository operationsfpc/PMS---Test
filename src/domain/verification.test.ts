import { describe, expect, it } from "vitest";
import { describeUncheckedClaims, evidenceProblem } from "./verification";

/**
 * The wording three coordinator queues share.
 *
 * Two screens describing the same missing file must not be able to disagree
 * about what is missing, so the sentences are tested here rather than being
 * re-derived on each screen.
 */
describe("evidenceProblem", () => {
  it("says nothing is wrong when the document is there", () => {
    expect(evidenceProblem(true)).toBeNull();
  });

  it("refuses a verification with nothing to check against", () => {
    expect(evidenceProblem(false)).toMatch(/no document to check against/i);
  });
});

const claims = (label: string, hasDocument: boolean) => ({ label, hasDocument });

describe("describeUncheckedClaims", () => {
  it("says nothing when every claim has its document", () => {
    expect(
      describeUncheckedClaims([claims("Semester 1 marksheet", true), claims("AWS", true)]),
    ).toBeNull();
  });

  it("names the one claim that has nothing behind it", () => {
    expect(
      describeUncheckedClaims([claims("Semester 3 marksheet", true), claims("AWS", false)]),
    ).toMatch(/^Nothing to check against: AWS\./);
  });

  /** Approving a form writes verified onto every semester and certificate it declares. */
  it("says that approving would confirm a single missing file on typing alone", () => {
    expect(describeUncheckedClaims([claims("AWS", false)])).toMatch(
      /approving would confirm it on the student's own typing/i,
    );
  });

  it("lists each missing file, and pluralises the consequence", () => {
    const sentence = describeUncheckedClaims([
      claims("Semester 2 marksheet", false),
      claims("NPTEL Data Structures", false),
      claims("Semester 1 marksheet", true),
    ]);

    expect(sentence).toContain("Semester 2 marksheet, NPTEL Data Structures");
    expect(sentence).toMatch(/approving would confirm them/i);
  });

  /** A blank label would print a hole in the sentence, not a name. */
  it("ignores a claim with nothing to call it", () => {
    expect(describeUncheckedClaims([claims("   ", false)])).toBeNull();
  });
});
