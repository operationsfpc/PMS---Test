import { describe, expect, it } from "vitest";
import {
  MAX_OTHER_PROFILES,
  normaliseProfileLinks,
  type ProfileLink,
  validateProfileLinks,
} from "./profile-links";

/**
 * Profiles beyond the four the form names.
 *
 * Asked for 2026-08-06: "in professional profiles, have field to enter others
 * also. they can add fields, give a name and mention the url/user name."
 *
 * The form hard-coded LinkedIn, GitHub, LeetCode and HackerRank. A student
 * with a Kaggle profile, a Behance portfolio, a Codeforces handle or their own
 * site had nowhere to put it — and those are often the strongest evidence they
 * have.
 *
 * "url/user name" is load-bearing: a Codeforces handle is not a URL, and
 * demanding one would refuse exactly the entries this exists to capture.
 */

const link = (label: string, value: string): ProfileLink => ({ label, value });

describe("normaliseProfileLinks", () => {
  it("keeps a complete entry, trimmed", () => {
    expect(normaliseProfileLinks([link("  Kaggle  ", "  kaggle.com/asha  ")])).toEqual([
      { label: "Kaggle", value: "kaggle.com/asha" },
    ]);
  });

  /**
   * A student who clicks "add another" and changes their mind must not be
   * blocked from submitting by a row they never filled in.
   */
  it("drops a row left completely empty", () => {
    expect(normaliseProfileLinks([link("Kaggle", "asha"), link("", ""), link("  ", " ")])).toEqual([
      { label: "Kaggle", value: "asha" },
    ]);
  });

  it("keeps a half-filled row, so validation can complain about it", () => {
    // Dropping it silently would discard something the student typed.
    expect(normaliseProfileLinks([link("Kaggle", "")])).toEqual([{ label: "Kaggle", value: "" }]);
  });

  it("preserves the order the student entered them in", () => {
    const links = [link("Kaggle", "a"), link("Behance", "b"), link("Codeforces", "c")];

    expect(normaliseProfileLinks(links).map((l) => l.label)).toEqual([
      "Kaggle",
      "Behance",
      "Codeforces",
    ]);
  });

  it("has nothing to do when there are no entries", () => {
    expect(normaliseProfileLinks([])).toEqual([]);
  });
});

describe("validateProfileLinks", () => {
  it("accepts a complete set", () => {
    expect(validateProfileLinks([link("Kaggle", "kaggle.com/asha")])).toEqual([]);
  });

  it("accepts none at all — these are entirely optional", () => {
    expect(validateProfileLinks([])).toEqual([]);
  });

  /**
   * The point of the request. A username is not a URL and must be accepted as
   * one: refusing it would turn an optional field into an impossible one.
   */
  it("accepts a bare username as readily as a URL", () => {
    expect(validateProfileLinks([link("Codeforces", "asha_r")])).toEqual([]);
    expect(validateProfileLinks([link("Portfolio", "https://asha.dev")])).toEqual([]);
  });

  it("names the entry that has a name but nothing to point at", () => {
    const problems = validateProfileLinks([link("Kaggle", "")]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/kaggle/i);
  });

  /** An address with no name tells a recruiter nothing about what it is. */
  it("asks what an unnamed entry is", () => {
    const problems = validateProfileLinks([link("", "kaggle.com/asha")]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/name/i);
  });

  it("refuses two entries with the same name, which a recruiter cannot tell apart", () => {
    const problems = validateProfileLinks([link("Portfolio", "a.com"), link("portfolio", "b.com")]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/portfolio/i);
  });

  it("caps the list, so the profile stays readable", () => {
    const many = Array.from({ length: MAX_OTHER_PROFILES + 1 }, (_, i) =>
      link(`Site ${i}`, `site${i}.com`),
    );

    expect(validateProfileLinks(many)[0]).toMatch(new RegExp(`${MAX_OTHER_PROFILES}`));
  });

  it("allows exactly the cap", () => {
    const many = Array.from({ length: MAX_OTHER_PROFILES }, (_, i) =>
      link(`Site ${i}`, `site${i}.com`),
    );

    expect(validateProfileLinks(many)).toEqual([]);
  });

  it("reports every problem at once, so they are fixed in one pass", () => {
    expect(validateProfileLinks([link("Kaggle", ""), link("", "b.com")])).toHaveLength(2);
  });

  it("ignores a row the student left completely blank", () => {
    expect(validateProfileLinks([link("Kaggle", "asha"), link("", "")])).toEqual([]);
  });
});
