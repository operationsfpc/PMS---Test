// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { CockpitPage, type CockpitView, type DriveSummary } from "./cockpit-page";

/**
 * The Central CPC's cockpit.
 *
 * This is the hub: shortlisting, results and final selection all need a drive
 * or a round in the URL, so without this screen they are only reachable by
 * typing a URL by hand. It is organised as a work queue - what needs me, and
 * what is it blocked on - rather than as an inventory.
 */
const APPROVED: DriveSummary = {
  driveId: "d1",
  companyName: "Zoho",
  roleTitle: "MTS",
  status: "approved",
  onHold: false,
  applicationCount: 0,
  rounds: [],
};

const LIVE: DriveSummary = {
  driveId: "d2",
  companyName: "Freshworks",
  roleTitle: "SDE",
  status: "live",
  onHold: false,
  applicationCount: 42,
  rounds: [],
};

const IN_ROUNDS: DriveSummary = {
  driveId: "d3",
  companyName: "Zoho Two",
  roleTitle: "QA",
  status: "in_rounds",
  onHold: false,
  applicationCount: 30,
  rounds: [
    { roundId: "r1", sequence: 1, name: "Aptitude" },
    { roundId: "r2", sequence: 2, name: "Technical" },
  ],
};

const routed = (view: CockpitView) =>
  render(
    <MemoryRouter>
      <CockpitPage view={view} />
    </MemoryRouter>,
  );

const routed2 = (view: CockpitView, filter: "yet-to-publish" | "published") =>
  render(
    <MemoryRouter>
      <CockpitPage view={view} filter={filter} />
    </MemoryRouter>,
  );

const view = (drives: readonly DriveSummary[]): CockpitView => ({
  drives: async () => drives,
  reviews: async () => [],
});

/**
 * D2 (2026-08-12): the Central CPC sees yet-to-publish and published drives
 * SEPARATELY. The cockpit takes a filter; each nav entry is one of them.
 */
describe("the pipeline split", () => {
  const REJECTED: DriveSummary = {
    ...APPROVED,
    driveId: "d9",
    companyName: "Rejected Co",
    status: "rejected",
  };

  it("yet-to-publish shows what awaits the coordinator, not what already ran", async () => {
    routed2(view([APPROVED, LIVE, IN_ROUNDS, REJECTED]), "yet-to-publish");

    expect(screen.getByRole("heading", { name: /yet to publish/i })).toBeDefined();
    expect(await screen.findByText("Zoho")).toBeDefined();
    expect(screen.queryByText("Freshworks")).toBeNull();
    expect(screen.queryByText("Zoho Two")).toBeNull();
    // A rejected drive is nobody's work queue: it is terminal.
    expect(screen.queryByText("Rejected Co")).toBeNull();
  });

  it("published shows live and later, not the queue", async () => {
    routed2(view([APPROVED, LIVE, IN_ROUNDS, REJECTED]), "published");

    expect(screen.getByRole("heading", { name: /published/i })).toBeDefined();
    expect(await screen.findByText("Freshworks")).toBeDefined();
    expect(screen.getByText("Zoho Two")).toBeDefined();
    expect(screen.queryByText("Zoho")).toBeNull();
  });

  it("says which half is empty rather than looking like no drives exist", async () => {
    routed2(view([LIVE]), "yet-to-publish");
    expect(await screen.findByText(/nothing is waiting to be published/i)).toBeDefined();
  });
});

describe("CockpitPage", () => {
  it("lists every drive with its status", async () => {
    routed(view([APPROVED, LIVE]));

    expect(await screen.findByText("Zoho")).toBeDefined();
    expect(screen.getByText("Freshworks")).toBeDefined();
  });

  it("links an approved drive to publishing, which is what it is waiting for", async () => {
    routed(view([APPROVED]));

    const row = (await screen.findByText("Zoho")).closest("li");
    if (row === null) throw new Error("row not found");
    const link = within(row).getByRole("link", { name: /publish/i });
    expect(link.getAttribute("href")).toBe("/central/publish?drive=d1");
  });

  it("links a live drive to shortlisting, carrying the drive id", async () => {
    routed(view([LIVE]));

    const row = (await screen.findByText("Freshworks")).closest("li");
    if (row === null) throw new Error("row not found");
    const link = within(row).getByRole("link", { name: /shortlist/i });
    expect(link.getAttribute("href")).toBe("/central/shortlisting?drive=d2");
  });

  it("links each round to its results, carrying the round id", async () => {
    routed(view([IN_ROUNDS]));

    const link = await screen.findByRole("link", { name: /technical/i });
    expect(link.getAttribute("href")).toBe("/central/results?round=r2");
  });

  it("links a drive in rounds to final selection", async () => {
    routed(view([IN_ROUNDS]));

    const link = await screen.findByRole("link", { name: /final selection/i });
    expect(link.getAttribute("href")).toBe("/central/offers?drive=d3");
  });

  it("flags a held drive, because it cannot go live until released", async () => {
    routed(view([{ ...APPROVED, onHold: true }]));

    expect(await screen.findByText(/on hold/i)).toBeDefined();
  });

  it("shows how many have applied, so an empty drive is obvious", async () => {
    routed(view([LIVE]));

    expect(await screen.findByText(/42 applicants/i)).toBeDefined();
  });

  it("says so plainly when there are no drives", async () => {
    routed(view([]));

    expect(await screen.findByText(/no drives yet/i)).toBeDefined();
  });
});

/**
 * R8. Three absences across the whole tenure raises a REVIEW, never an
 * automatic disbarment - the decision is the Central CPC's and must be made
 * by a person. The cockpit is where that alert surfaces.
 */
describe("disbarment reviews", () => {
  it("surfaces students who have reached the absence limit", async () => {
    render(
      <MemoryRouter>
        <CockpitPage
          view={{
            drives: async () => [],
            reviews: async () => [
              { studentId: "s1", studentName: "Arjun Menon", rollNumber: "21CSE9001", absences: 3 },
            ],
          }}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Arjun Menon/)).toBeDefined();
    expect(screen.getByText(/3 absences/i)).toBeDefined();
  });

  it("says a review is required, never that the student is disbarred", async () => {
    render(
      <MemoryRouter>
        <CockpitPage
          view={{
            drives: async () => [],
            reviews: async () => [
              { studentId: "s1", studentName: "Arjun Menon", rollNumber: "21CSE9001", absences: 4 },
            ],
          }}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/needs review/i)).toBeDefined();
    expect(screen.queryByText(/disbarred/i)).toBeNull();
  });

  it("shows nothing when nobody has reached the limit", async () => {
    render(
      <MemoryRouter>
        <CockpitPage view={{ drives: async () => [], reviews: async () => [] }} />
      </MemoryRouter>,
    );

    await screen.findByText(/no drives yet/i);
    expect(screen.queryByText(/needs review/i)).toBeNull();
  });
});
