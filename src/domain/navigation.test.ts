import { describe, expect, it } from "vitest";
import { type NavGroupShape, openGroupHeadings } from "./navigation";

/**
 * 2026-08-17 (Karthik): "Can you collapse the sub headings that are not in
 * use? Only the sub heading of the headings in use has to be expanded."
 *
 * The sidebar showed every group of every role at once - eleven links for the
 * Central CPC before any of them had been read. Only the group the reader is
 * actually inside stays open.
 *
 * This is a pure decision about a list of headings and a path, so it is
 * decided here rather than in a component: "which group am I in?" is the sort
 * of question that gets answered subtly differently in two places.
 */
const GROUPS: readonly NavGroupShape[] = [
  { heading: "Overview", items: [{ to: "/dashboard" }] },
  {
    heading: "Drives",
    items: [{ to: "/central/drives/yet-to-publish" }, { to: "/central/drives/published" }],
  },
  {
    heading: "Publish a drive",
    items: [{ to: "/central/publish" }, { to: "/central/skills" }],
  },
  {
    heading: "Drives in progress",
    items: [{ to: "/central/shortlisting" }, { to: "/central/results" }],
  },
];

describe("openGroupHeadings", () => {
  it("opens the group holding the current path, and only that one", () => {
    expect(openGroupHeadings(GROUPS, "/central/shortlisting")).toEqual(["Drives in progress"]);
  });

  it("opens the overview when that is where the reader is", () => {
    expect(openGroupHeadings(GROUPS, "/dashboard")).toEqual(["Overview"]);
  });

  /**
   * A link is "current" for its sub-paths too, otherwise opening a drive from
   * a list would collapse the group that got you there.
   */
  it("counts a sub-path as being inside the group", () => {
    expect(openGroupHeadings(GROUPS, "/central/results/round-2")).toEqual(["Drives in progress"]);
  });

  /**
   * `/central/drives` is a prefix of `/central/drives/published` but also a
   * route of its own. The LONGEST match wins, so a shared prefix cannot open
   * the wrong group.
   */
  it("prefers the longest matching link when routes share a prefix", () => {
    const groups: readonly NavGroupShape[] = [
      { heading: "Cockpit", items: [{ to: "/central/drives" }] },
      { heading: "Pipeline", items: [{ to: "/central/drives/published" }] },
    ];
    expect(openGroupHeadings(groups, "/central/drives/published")).toEqual(["Pipeline"]);
    expect(openGroupHeadings(groups, "/central/drives")).toEqual(["Cockpit"]);
  });

  /** A prefix must end at a segment boundary: /central/drives is not inside /central/dr. */
  it("does not treat a partial segment as a match", () => {
    const groups: readonly NavGroupShape[] = [{ heading: "A", items: [{ to: "/central/dr" }] }];
    expect(openGroupHeadings(groups, "/central/drives")).toEqual([]);
  });

  /**
   * Falling back to "open the first group" would be a guess that hides the
   * reader's real location. An unrecognised path opens nothing, and every
   * heading stays reachable.
   */
  it("opens nothing when the path belongs to no group", () => {
    expect(openGroupHeadings(GROUPS, "/somewhere-else")).toEqual([]);
  });

  it("opens nothing for an empty sidebar", () => {
    expect(openGroupHeadings([], "/dashboard")).toEqual([]);
  });

  /** Trailing slashes come from real links and must not change the answer. */
  it("ignores a trailing slash", () => {
    expect(openGroupHeadings(GROUPS, "/central/publish/")).toEqual(["Publish a drive"]);
  });

  /** The root path is every route's prefix; it must not open everything. */
  it("does not let the root path open a group it is not in", () => {
    const groups: readonly NavGroupShape[] = [{ heading: "Home", items: [{ to: "/" }] }];
    expect(openGroupHeadings(groups, "/")).toEqual(["Home"]);
    expect(openGroupHeadings(groups, "/dashboard")).toEqual([]);
  });

  /**
   * Two groups can legitimately hold the same link - the Central CPC reaches
   * attendance from more than one place. Both open, because collapsing one of
   * them would hide a heading whose link is genuinely current.
   */
  it("opens every group that holds the winning link", () => {
    const groups: readonly NavGroupShape[] = [
      { heading: "In progress", items: [{ to: "/cpc/attendance" }] },
      { heading: "Requests", items: [{ to: "/cpc/attendance" }] },
    ];
    expect(openGroupHeadings(groups, "/cpc/attendance")).toEqual(["In progress", "Requests"]);
  });
});
