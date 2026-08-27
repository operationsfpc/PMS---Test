// @vitest-environment jsdom

import type { AppRole } from "@domain/types";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
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
  ctcMinLpa: 6,
  ctcMaxLpa: 8,
  status: "approved",
  onHold: false,
  applicationCount: 0,
  rounds: [],
  createdAt: null,
  applicationEnd: null,
};

const LIVE: DriveSummary = {
  driveId: "d2",
  companyName: "Freshworks",
  roleTitle: "SDE",
  ctcMinLpa: 4.5,
  ctcMaxLpa: null,
  status: "live",
  onHold: false,
  applicationCount: 42,
  rounds: [],
  createdAt: null,
  applicationEnd: null,
};

const IN_ROUNDS: DriveSummary = {
  driveId: "d3",
  companyName: "Zoho Two",
  roleTitle: "QA",
  ctcMinLpa: null,
  ctcMaxLpa: null,
  status: "in_rounds",
  onHold: false,
  applicationCount: 30,
  rounds: [
    { roundId: "r1", sequence: 1, name: "Aptitude" },
    { roundId: "r2", sequence: 2, name: "Technical" },
  ],
  createdAt: null,
  applicationEnd: null,
};

/** Bound to a name so Biome does not read the prop as an ARIA `role` attribute. */
const CENTRAL_CPC: AppRole = "central_placement_coordinator";

const routed = (view: CockpitView, role: AppRole = CENTRAL_CPC) =>
  render(
    <MemoryRouter>
      <CockpitPage view={view} role={role} />
    </MemoryRouter>,
  );

const routed2 = (view: CockpitView, filter: "yet-to-publish" | "published") =>
  render(
    <MemoryRouter>
      <CockpitPage view={view} filter={filter} role={CENTRAL_CPC} />
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

  /** WS6 (2026-08-12): rounds open on the tabbed screen, which carries them all. */
  it("links each round to the drive's rounds screen", async () => {
    routed(view([IN_ROUNDS]));

    const link = await screen.findByRole("link", { name: /technical/i });
    expect(link.getAttribute("href")).toBe("/central/results?drive=d3");
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

  /**
   * B2 (UAT 2026-08-19): "Complete and Publish is currently the only clickable
   * action, and the only way to open a drive." A submitted drive waiting on
   * the Delivery Head had NO link at all — the card was a dead end. Every
   * card now opens the canonical /drives/:id record, whatever its status.
   */
  /**
   * C3 (UAT 2026-08-19): two drives from the same company are told apart by
   * role and CTC — so both sit on the card.
   */
  it("shows the CTC band beside the role, so same-company drives are distinct", async () => {
    routed(view([APPROVED, LIVE]));

    const zoho = (await screen.findByText("Zoho")).closest("li");
    if (zoho === null) throw new Error("row not found");
    expect(zoho.textContent).toMatch(/₹6–8 LPA/);

    const fresh = screen.getByText("Freshworks").closest("li");
    if (fresh === null) throw new Error("row not found");
    expect(fresh.textContent).toMatch(/₹4\.5 LPA/);
  });

  it("every drive card links to the canonical drive record", async () => {
    const SUBMITTED: DriveSummary = {
      ...APPROVED,
      driveId: "d7",
      companyName: "Waiting Co",
      status: "submitted",
    };
    routed(view([SUBMITTED, LIVE, IN_ROUNDS]));

    const waiting = (await screen.findByText("Waiting Co")).closest("li");
    if (waiting === null) throw new Error("row not found");
    expect(
      within(waiting)
        .getByRole("link", { name: /view drive/i })
        .getAttribute("href"),
    ).toBe("/drives/d7");

    const live = screen.getByText("Freshworks").closest("li");
    if (live === null) throw new Error("row not found");
    expect(
      within(live)
        .getByRole("link", { name: /view drive/i })
        .getAttribute("href"),
    ).toBe("/drives/d2");
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
          role={CENTRAL_CPC}
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
          role={CENTRAL_CPC}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/needs review/i)).toBeDefined();
    expect(screen.queryByText(/disbarred/i)).toBeNull();
  });

  it("shows nothing when nobody has reached the limit", async () => {
    render(
      <MemoryRouter>
        <CockpitPage
          view={{ drives: async () => [], reviews: async () => [] }}
          role={CENTRAL_CPC}
        />
      </MemoryRouter>,
    );

    await screen.findByText(/no drives yet/i);
    expect(screen.queryByText(/needs review/i)).toBeNull();
  });
});

/**
 * 2026-08-17 (Karthik): "the AE should only be able to view the students
 * shortlisted or selected or their drive status and results. They should not
 * be able to publish drives or shortlist students."
 *
 * The cockpit is defence in depth. The AE's sidebar no longer reaches it, but
 * a bookmark or a pasted URL still does, and a screen that renders the actions
 * anyway is a screen that invites the click. Who may act is the domain's
 * answer (`canPublishDrive` / `canShortlistFromPortfolio`), never a prop
 * somebody remembers to pass.
 */
describe("the cockpit's actions are role-gated", () => {
  it("offers the Central Placement Coordinator both actions", async () => {
    routed(view([APPROVED, LIVE]), "central_placement_coordinator");
    await screen.findByText("Zoho");
    expect(screen.getByRole("link", { name: /publish/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /shortlist/i })).toBeDefined();
  });

  it("offers an Account Executive neither", async () => {
    routed(view([APPROVED, LIVE]), "account_executive");
    await screen.findByText("Zoho");
    expect(screen.queryByRole("link", { name: /publish/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /shortlist/i })).toBeNull();
  });

  /** Read-only is not the same as blank: the drives, and their status, remain. */
  it("still shows an Account Executive the drives and their status", async () => {
    routed(view([APPROVED, LIVE]), "account_executive");
    expect(await screen.findByText("Zoho")).toBeDefined();
    expect(screen.getByText("Freshworks")).toBeDefined();
    expect(screen.getByText("live")).toBeDefined();
  });

  /** Approving the commercials is not publishing them. */
  it("offers the Delivery Head neither action", async () => {
    routed(view([APPROVED, LIVE]), "delivery_head");
    await screen.findByText("Zoho");
    expect(screen.queryByRole("link", { name: /publish/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /shortlist/i })).toBeNull();
  });
});

/**
 * UAT 2026-08-20, G1a/G1b: no date stamp on any drive — "can't tell how old a
 * submission is or how long it's been pending approval" — and no way to pull
 * up "oldest submitted first", which is the natural way to clear a backlog.
 */
describe("drive aging on the queue (G1)", () => {
  const NOW = new Date("2026-08-20T12:00:00+05:30");

  const SUBMITTED_OLD: DriveSummary = {
    ...APPROVED,
    driveId: "d20",
    companyName: "Aged Systems",
    status: "submitted",
    createdAt: "2026-08-10T09:00:00+05:30",
    applicationEnd: null,
  };

  const SUBMITTED_FRESH: DriveSummary = {
    ...APPROVED,
    driveId: "d21",
    companyName: "Fresh Labs",
    status: "submitted",
    createdAt: "2026-08-19T09:00:00+05:30",
    applicationEnd: null,
  };

  it("dates every drive and flags one pending too long (G1a)", async () => {
    render(
      <MemoryRouter>
        <CockpitPage
          view={view([SUBMITTED_OLD])}
          filter="yet-to-publish"
          role={CENTRAL_CPC}
          now={NOW}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/raised on 10 aug 2026/i)).toBeDefined();
    expect(screen.getByText(/pending 10 days/i)).toBeDefined();
  });

  it("does not reproach a fresh submission (G1a)", async () => {
    render(
      <MemoryRouter>
        <CockpitPage
          view={view([SUBMITTED_FRESH])}
          filter="yet-to-publish"
          role={CENTRAL_CPC}
          now={NOW}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/raised on 19 aug 2026/i)).toBeDefined();
    expect(screen.queryByText(/pending \d+ days/i)).toBeNull();
  });

  /**
   * 2026-08-26 (Karthik): "change the default sort order to Newest First
   * across all sections". A deliberate reversal of G1b's default - the queue
   * may still be cleared from the back, but that is now a choice the reader
   * makes rather than the order they are given.
   */
  it("orders the yet-to-publish queue newest first by default", async () => {
    render(
      <MemoryRouter>
        <CockpitPage
          view={view([SUBMITTED_OLD, SUBMITTED_FRESH])}
          filter="yet-to-publish"
          role={CENTRAL_CPC}
          now={NOW}
        />
      </MemoryRouter>,
    );

    const names = await screen.findAllByText(/aged systems|fresh labs/i);
    expect(names[0]?.textContent).toMatch(/fresh labs/i);
  });

  it("can still be switched to oldest first, to clear a backlog (G1b)", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CockpitPage
          view={view([SUBMITTED_FRESH, SUBMITTED_OLD])}
          filter="yet-to-publish"
          role={CENTRAL_CPC}
          now={NOW}
        />
      </MemoryRouter>,
    );

    await screen.findByText("Aged Systems");
    await user.selectOptions(screen.getByLabelText(/sort/i), "oldest");

    const names = screen.getAllByText(/aged systems|fresh labs/i);
    expect(names[0]?.textContent).toMatch(/aged systems/i);
  });

  /** An undated drive cannot claim to be the newest either. It sinks. */
  it("sinks an undated drive under the default order", async () => {
    const UNDATED: DriveSummary = {
      ...SUBMITTED_FRESH,
      driveId: "d22",
      companyName: "Undated Co",
      createdAt: null,
    };
    render(
      <MemoryRouter>
        <CockpitPage
          view={view([UNDATED, SUBMITTED_OLD, SUBMITTED_FRESH])}
          filter="yet-to-publish"
          role={CENTRAL_CPC}
          now={NOW}
        />
      </MemoryRouter>,
    );

    const names = await screen.findAllByText(/aged systems|fresh labs|undated co/i);
    expect(names.at(-1)?.textContent).toMatch(/undated co/i);
  });

  /** G1d (answer 1a): a collapsed section on the same list — nothing destroyed. */
  it("collapses drives past their application deadline into an Expired section (G1d)", async () => {
    const EXPIRED: DriveSummary = {
      ...LIVE,
      driveId: "d22",
      companyName: "Bygone Corp",
      applicationEnd: "2026-08-01T18:00:00+05:30",
    };
    const OPEN: DriveSummary = {
      ...LIVE,
      driveId: "d23",
      companyName: "Current Co",
      applicationEnd: "2026-08-25T18:00:00+05:30",
    };

    render(
      <MemoryRouter>
        <CockpitPage view={view([EXPIRED, OPEN])} filter="published" role={CENTRAL_CPC} now={NOW} />
      </MemoryRouter>,
    );

    await screen.findByText("Current Co");
    // The expired drive sits behind a summary, not in the active list.
    const expired = screen.getByText(/expired — application deadline passed \(1\)/i);
    expect(expired).toBeDefined();
    expect(screen.getByText("Bygone Corp")).toBeDefined();
  });
});

/**
 * UAT 2026-08-20, G1c: "every drive needs a click into View drive even for
 * the one action (approve) this whole screen exists for." The Delivery Head
 * decides from the list now — same rules as the approval queue (Q3 confirmed:
 * rejection demands a reason).
 */
describe("the Delivery Head decides from the list (G1c)", () => {
  /** Bound to a name so Biome does not read the prop as an ARIA `role` attribute. */
  const DELIVERY_HEAD: AppRole = "delivery_head";

  const SUBMITTED: DriveSummary = {
    ...APPROVED,
    driveId: "d30",
    companyName: "Deciso",
    status: "submitted",
    createdAt: "2026-08-19T09:00:00+05:30",
    applicationEnd: null,
  };

  const withDecide = (
    decide: (driveId: string, current: string, decision: unknown) => Promise<void>,
  ) =>
    render(
      <MemoryRouter>
        <CockpitPage
          view={view([SUBMITTED])}
          filter="yet-to-publish"
          role={DELIVERY_HEAD}
          decide={decide as never}
        />
      </MemoryRouter>,
    );

  it("approves from the list, with the offer category chosen in the dialog", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    withDecide(decide);

    await user.click(await screen.findByRole("button", { name: /approve/i }));

    const dialog = await screen.findByRole("alertdialog");
    await user.selectOptions(within(dialog).getByLabelText(/offer category/i), "dream");
    await user.click(within(dialog).getByRole("button", { name: /confirm — approve/i }));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("d30", "submitted", {
        decision: "approve",
        offerCategory: "dream",
      }),
    );
  });

  /**
   * UAT 2026-08-27 (live): the same throw that emptied the Delivery Head's
   * approval queue is reachable here too — a cap-only internship (0056) has
   * no CTC, and opening the approve dialog asked for a suggestion anyway.
   * There it broke the list; here it would break the click.
   */
  it("opens the approve dialog for a PIF with no CTC, suggesting nothing", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CockpitPage
          view={view([{ ...SUBMITTED, ctcMinLpa: null, ctcMaxLpa: null }])}
          filter="yet-to-publish"
          role={DELIVERY_HEAD}
          decide={decide as never}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /approve/i }));

    const dialog = await screen.findByRole("alertdialog");
    const select = within(dialog).getByLabelText(/offer category/i) as HTMLSelectElement;
    expect(select.value).toBe("");

    // Nothing chosen: the domain refuses before the network is asked, because
    // §3.3 makes the category immutable once written.
    await user.click(within(dialog).getByRole("button", { name: /confirm — approve/i }));
    expect(decide).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert").textContent).toMatch(/offer category must be set/i);
  });

  it("rejects from the list — with a required reason (Q3)", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    withDecide(decide);

    await user.click(await screen.findByRole("button", { name: /reject/i }));

    const dialog = await screen.findByRole("alertdialog");
    // No reason typed: the domain refuses before the network is asked.
    await user.click(within(dialog).getByRole("button", { name: /confirm — reject/i }));
    expect(decide).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/reason/i), "CTC below our floor");
    await user.click(within(dialog).getByRole("button", { name: /confirm — reject/i }));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("d30", "submitted", {
        decision: "reject",
        reason: "CTC below our floor",
      }),
    );
  });

  it("offers the Central CPC no approve/reject — approval is not their verb", async () => {
    render(
      <MemoryRouter>
        <CockpitPage view={view([SUBMITTED])} filter="yet-to-publish" role={CENTRAL_CPC} />
      </MemoryRouter>,
    );

    await screen.findByText("Deciso");
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject/i })).toBeNull();
  });
});

/**
 * UAT 2026-08-21, item 2: an off-campus drive's venue is often unknown at
 * PIF time. The Central CPC follows up with the company and records it here,
 * post-submission — and ONLY the Central CPC (answer Q5).
 */
describe("the off-campus venue on the cockpit", () => {
  /** An expression, not a literal — Biome reads a literal `role="…"` as ARIA. */
  const DELIVERY_HEAD: AppRole = "delivery_head";
  const OFF_CAMPUS: DriveSummary = {
    ...LIVE,
    driveId: "d40",
    companyName: "HCL Technologies",
    driveMode: "physical_outside_campus",
    venue: null,
  };

  it("admits the venue is still to be confirmed, and lets the Central CPC record it", async () => {
    const updateVenue = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CockpitPage
          view={{ drives: async () => [OFF_CAMPUS], reviews: async () => [], updateVenue }}
          filter="published"
          role={CENTRAL_CPC}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/venue to be confirmed/i)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /update venue/i }));
    await user.type(screen.getByLabelText(/^venue$/i), "HCL Campus, Sholinganallur");
    await user.click(screen.getByRole("button", { name: /save venue/i }));

    await waitFor(() =>
      expect(updateVenue).toHaveBeenCalledWith("d40", "HCL Campus, Sholinganallur"),
    );
  });

  it("shows a recorded venue on the card", async () => {
    render(
      <MemoryRouter>
        <CockpitPage
          view={{
            drives: async () => [{ ...OFF_CAMPUS, venue: "HCL Campus, Sholinganallur" }],
            reviews: async () => [],
          }}
          filter="published"
          role={CENTRAL_CPC}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/HCL Campus, Sholinganallur/)).toBeDefined();
  });

  it("offers no venue button to the Delivery Head — recording it is not their verb", async () => {
    render(
      <MemoryRouter>
        <CockpitPage
          view={{
            drives: async () => [OFF_CAMPUS],
            reviews: async () => [],
            updateVenue: vi.fn(),
          }}
          filter="published"
          role={DELIVERY_HEAD}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/venue to be confirmed/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /update venue/i })).toBeNull();
  });

  it("says nothing about venues for an on-campus drive", async () => {
    render(
      <MemoryRouter>
        <CockpitPage
          view={{
            drives: async () => [{ ...LIVE, driveMode: "on_campus", venue: null }],
            reviews: async () => [],
          }}
          filter="published"
          role={CENTRAL_CPC}
        />
      </MemoryRouter>,
    );

    await screen.findByText("Freshworks");
    expect(screen.queryByText(/venue/i)).toBeNull();
  });
});

/**
 * Karthik, 2026-08-27: the type filter and the type tag belong on every list
 * of ongoing drives — this is the Central CPC's "Yet to publish" queue.
 */
describe("CockpitPage — filtering and tagging by drive type", () => {
  const DELIVERY_HEAD: AppRole = "delivery_head";
  const base = APPROVED;
  const FULL_TIME = {
    ...base,
    driveId: "t1",
    companyName: "Zoho",
    driveType: "placement" as const,
  };
  const CONVERTIBLE = {
    ...base,
    driveId: "t2",
    companyName: "LTI Mindtree",
    driveType: "internship_convertible" as const,
  };
  const INTERNSHIP = {
    ...base,
    driveId: "t3",
    companyName: "ABCD Infosys",
    driveType: "internship" as const,
  };

  const showTypes = () =>
    render(
      <MemoryRouter>
        <CockpitPage view={view([FULL_TIME, CONVERTIBLE, INTERNSHIP])} role={DELIVERY_HEAD} />
      </MemoryRouter>,
    );

  it("tags each drive with its type", async () => {
    showTypes();
    await screen.findByText("ABCD Infosys");

    // The filter chips carry the same words, so the tags are looked for on
    // the list itself rather than anywhere on the page.
    const list = screen.getByRole("list");
    expect(within(list).getByText("Internship → Full time")).toBeDefined();
    expect(within(list).getByText("Full time")).toBeDefined();
    expect(within(list).getByText("Internship")).toBeDefined();
  });

  it("narrows to the chosen type", async () => {
    const user = userEvent.setup();
    showTypes();
    await screen.findByText("ABCD Infosys");

    const filter = screen.getByRole("group", { name: /drive type/i });
    await user.click(within(filter).getByRole("button", { name: /^Internship \d+$/ }));

    expect(screen.getByText("ABCD Infosys")).toBeDefined();
    expect(screen.queryByText("Zoho")).toBeNull();
    expect(screen.queryByText("LTI Mindtree")).toBeNull();
  });

  it("comes back to everything when All is clicked", async () => {
    const user = userEvent.setup();
    showTypes();
    await screen.findByText("ABCD Infosys");
    const filter = screen.getByRole("group", { name: /drive type/i });

    await user.click(within(filter).getByRole("button", { name: /^Internship \d+$/ }));
    await user.click(within(filter).getByRole("button", { name: /^All \d+$/ }));

    expect(screen.getByText("Zoho")).toBeDefined();
  });
});

/**
 * The stipend, on the surface where a Delivery Head approves from the list
 * (G1c) — the same gap Karthik reported on the approval queue.
 */
describe("CockpitPage — approving an internship", () => {
  const DELIVERY_HEAD: AppRole = "delivery_head";
  const INTERN: DriveSummary = {
    ...APPROVED,
    status: "submitted",
    driveId: "d-int",
    companyName: "ABCD Infosys",
    driveType: "internship" as const,
    ctcMinLpa: null,
    ctcMaxLpa: null,
    stipendMinMonthly: 15000,
    stipendMaxMonthly: 20000,
  };

  it("shows the stipend on the card, the only number it has", async () => {
    render(
      <MemoryRouter>
        <CockpitPage view={view([INTERN])} filter="yet-to-publish" role={DELIVERY_HEAD} />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/₹15,000–20,000 \/ month/)).toBeDefined();
  });

  it("approves it as an internship, offering no other category", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CockpitPage
          view={view([INTERN])}
          filter="yet-to-publish"
          role={DELIVERY_HEAD}
          decide={decide as never}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /approve/i }));
    const dialog = await screen.findByRole("alertdialog");

    const select = within(dialog).getByLabelText(/offer category/i) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "internship"]);
    expect(select.value).toBe("internship");

    await user.click(within(dialog).getByRole("button", { name: /confirm — approve/i }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("d-int", "submitted", {
        decision: "approve",
        offerCategory: "internship",
      }),
    );
  });
});
