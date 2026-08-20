// @vitest-environment jsdom

import type { AppRole } from "@domain/types";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DrivePortfolioPage, type PortfolioDrive, type PortfolioView } from "./portfolio-page";

/**
 * The Delivery Head's and Account Executive's own drives.
 *
 * Requested 2026-08-04: "they should be able to see all drives they have
 * raised/approved, applicants to the drive, the progress of the drives".
 * Before this screen, approving a PIF was the last a Delivery Head ever saw of
 * it, and an AE could raise a drive and never learn whether anyone applied.
 *
 * Every judgement is imported: involvementIn says whose drive it is,
 * driveProgress says how far along it is, and summariseFunnel counts the
 * applicants using the same stages the students themselves are shown.
 */

const DRIVE: PortfolioDrive = {
  driveId: "d1",
  companyName: "Zoho Corporation",
  roleTitle: "Member Technical Staff",
  status: "in_rounds",
  onHold: false,
  ctcMinLpa: null,
  ctcMaxLpa: null,
  createdBy: "ae-1",
  approvedBy: "dh-1",
  publishedBy: "cpc-1",
  totalRounds: 4,
  roundsDecided: 2,
  applicationStart: "2026-09-01T00:00:00.000Z",
  applicationEnd: "2026-09-10T00:00:00.000Z",
  applicants: [
    {
      applicationId: "a1",
      studentName: "Anjali Subramanian",
      rollNumber: "21CSE1042",
      campus: "Alliance University",
      shortlisted: true,
      hasOffer: false,
      rounds: [
        {
          sequence: 1,
          name: "Online test",
          participating: true,
          attendance: "present",
          result: "selected",
        },
        {
          sequence: 2,
          name: "Technical interview",
          participating: true,
          attendance: null,
          result: null,
        },
      ],
    },
    {
      applicationId: "a2",
      studentName: "Rahul Nair",
      rollNumber: "21CSE1099",
      campus: "VIT Bangalore",
      shortlisted: false,
      hasOffer: false,
      rounds: [],
    },
  ],
};

const OTHERS: PortfolioDrive = {
  ...DRIVE,
  driveId: "d2",
  companyName: "Freshworks",
  roleTitle: "Associate Software Engineer",
  status: "submitted",
  createdBy: "someone-else",
  approvedBy: null,
  publishedBy: null,
  totalRounds: 0,
  roundsDecided: 0,
  applicationStart: null,
  applicationEnd: null,
  applicants: [],
};

const view = (drives: readonly PortfolioDrive[] = [DRIVE, OTHERS]): PortfolioView => ({
  drives: async () => drives,
});

const show = (
  overrides: {
    view?: PortfolioView;
    profileId?: string;
    title?: string;
    role?: AppRole;
    /** The clock is injected so "4 days left" is exact, not relative to today. */
    now?: string;
  } = {},
) =>
  render(
    <MemoryRouter>
      <DrivePortfolioPage
        view={overrides.view ?? view()}
        profileId={overrides.profileId ?? "ae-1"}
        title={overrides.title ?? "My drives"}
        role={overrides.role ?? "account_executive"}
        now={new Date(overrides.now ?? "2026-09-05T10:00:00.000Z")}
      />
    </MemoryRouter>,
  );

describe("DrivePortfolioPage", () => {
  it("uses the title it is given, so each role can label its own view", async () => {
    show({ title: "Drives I have approved" });

    expect(
      await screen.findByRole("heading", { level: 1, name: /drives i have approved/i }),
    ).toBeDefined();
  });

  it("says which hat the viewer wore on each drive", async () => {
    show({ profileId: "ae-1" });

    const drive = await screen.findByRole("region", { name: "Zoho Corporation" });
    expect(within(drive).getByText(/raised by you/i)).toBeDefined();
  });

  it("says 'approved by you' to the Delivery Head who approved it", async () => {
    show({ profileId: "dh-1" });

    const drive = await screen.findByRole("region", { name: "Zoho Corporation" });
    expect(within(drive).getByText(/approved by you/i)).toBeDefined();
  });

  it("shows how far along the drive is, in words and in rounds", async () => {
    show();

    const drive = await screen.findByRole("region", { name: "Zoho Corporation" });
    expect(within(drive).getByText(/rounds in progress/i)).toBeDefined();
    expect(within(drive).getByText(/2 of 4 rounds decided/i)).toBeDefined();
  });

  it("flags a drive that is on hold", async () => {
    show({ view: view([{ ...DRIVE, onHold: true }]) });

    const drive = await screen.findByRole("region", { name: "Zoho Corporation" });
    expect(within(drive).getByText(/on hold/i)).toBeDefined();
  });

  it("counts the funnel from the applicants, not from a separate guess", async () => {
    show();

    const funnel = await screen.findByRole("region", { name: "Zoho Corporation applicants" });
    // 2 applied, 1 shortlisted, 1 named by a round, 0 offers.
    expect(within(funnel).getByText("2")).toBeDefined();
    expect(within(funnel).getByText(/applied/i)).toBeDefined();
    expect(within(funnel).getByText(/shortlisted/i)).toBeDefined();
  });

  it("lists the applicants with where each of them has got to", async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("button", { name: /applicants to zoho/i }));

    const list = screen.getByRole("region", { name: "Zoho Corporation applicant list" });
    expect(within(list).getByText("Anjali Subramanian")).toBeDefined();
    expect(within(list).getByText("21CSE1042")).toBeDefined();
    expect(within(list).getByText("Round 2 of 2 — Technical interview")).toBeDefined();
    expect(within(list).getByText(/awaiting shortlist/i)).toBeDefined();
  });

  it("keeps the applicant list closed until it is asked for", async () => {
    show();
    await screen.findByRole("region", { name: "Zoho Corporation" });

    expect(screen.queryByText("Anjali Subramanian")).toBeNull();
  });

  /**
   * SPEC CHANGE 2026-08-18: the three chips are gone, so the two tests that
   * clicked them are gone with them. "just remove the three select options at
   * the top of the page." They filtered a list to itself - every drive an AE can
   * see is one they raised - and their replacement, a search box, is covered
   * below. `involvementIn` is still proved by the badge test above and by its
   * own domain tests.
   */

  it("shows everything the viewer can see when no filter is applied", async () => {
    show();

    expect(await screen.findByRole("region", { name: "Zoho Corporation" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Freshworks" })).toBeDefined();
  });

  it("says so when there are no drives at all", async () => {
    show({ view: view([]) });

    expect(await screen.findByText(/no drives yet/i)).toBeDefined();
  });

  it("says so when a drive has no applicants yet, instead of an empty count", async () => {
    const user = userEvent.setup();
    show({ view: view([{ ...DRIVE, applicants: [] }]) });

    await user.click(await screen.findByRole("button", { name: /applicants to zoho/i }));

    expect(screen.getByText(/nobody has applied yet/i)).toBeDefined();
  });

  it("announces that it is loading", () => {
    show({ view: { drives: () => new Promise(() => {}) } });

    expect(screen.getByRole("status")).toBeDefined();
  });

  it("says something useful when the drives cannot be loaded", async () => {
    const drives = vi.fn().mockRejectedValue(new Error("network"));
    show({ view: { drives } });

    expect(await screen.findByRole("alert")).toBeDefined();
  });
});

/**
 * The application window, on the screen of the people who own the drive.
 *
 * An AE is asked by their client "how many applied, and how long is left?".
 * The clock comes from src/domain/drive-analytics.ts and `now` is passed in,
 * so the answer is the same one the student's drive list is working to.
 */
describe("the application window", () => {
  it("shows how long is left to apply", async () => {
    show();

    const drive = await screen.findByRole("region", { name: "Zoho Corporation" });
    expect(within(drive).getByText("4 days left")).toBeDefined();
  });

  it("flags a drive closing within two days", async () => {
    show({ now: "2026-09-09T10:00:00.000Z" });

    const drive = await screen.findByRole("region", { name: "Zoho Corporation" });
    expect(within(drive).getByText(/closing soon/i)).toBeDefined();
  });

  it("says a closed drive is closed", async () => {
    show({ now: "2026-09-20T10:00:00.000Z" });

    const drive = await screen.findByRole("region", { name: "Zoho Corporation" });
    expect(within(drive).getByText("Closed")).toBeDefined();
  });

  it("says a drive with no window set is unscheduled, not closed", async () => {
    show();

    const drive = await screen.findByRole("region", { name: "Freshworks" });
    expect(within(drive).getByText(/no application window set/i)).toBeDefined();
  });
});

/**
 * F15 (UAT 2026-08-06): "The drive module of view present for the account
 * executive must be the present for Central Placement Coordinator with
 * shortlisting access."
 *
 * Same screen, one extra power - and only for the role the domain allows it
 * for. Whether the link is offered is `canShortlistFromPortfolio`'s decision,
 * not this component's.
 */
describe("DrivePortfolioPage \u2014 shortlisting access", () => {
  it("offers the Central Placement Coordinator a way into shortlisting", async () => {
    show({ role: "central_placement_coordinator", title: "All drives" });

    const link = await screen.findByRole("link", { name: /shortlist applicants/i });
    expect(link.getAttribute("href")).toContain("/central/shortlisting?drive=");
  });

  it("does not offer it to the Account Executive who raised the drive", async () => {
    show({ role: "account_executive" });

    await screen.findByText("Zoho Corporation");
    expect(screen.queryByRole("link", { name: /shortlist applicants/i })).toBeNull();
  });

  it("does not offer it to the Delivery Head", async () => {
    show({ role: "delivery_head" });

    await screen.findByText("Zoho Corporation");
    expect(screen.queryByRole("link", { name: /shortlist applicants/i })).toBeNull();
  });
});

/**
 * 2026-08-17 (Karthik), two changes to this screen.
 *
 * The blurb claimed the reader publishes drives. Since publishing became the
 * Central CPC's alone, that was false for both roles this screen serves.
 *
 * And the applicant list — the company-facing roll of who applied — is the
 * AE's. The Delivery Head and the Central CPC could open it here; they no
 * longer can. Their route to applicants is Shortlisting and Rounds & results,
 * which carry their own rules.
 */
describe("the applicant list belongs to the Account Executive", () => {
  it("offers the AE the applicants to their own drive", async () => {
    show({ role: "account_executive" });
    expect(await screen.findByRole("button", { name: /applicants to zoho/i })).toBeDefined();
  });

  it.each(["central_placement_coordinator", "delivery_head"] as const)(
    "does not offer %s a way into the applicant list",
    async (role) => {
      show({ role });
      await screen.findByText(/zoho corporation/i);
      expect(screen.queryByRole("button", { name: /applicants to zoho/i })).toBeNull();
    },
  );

  /**
   * Withholding the roll of names is not the same as withholding the numbers.
   * A coordinator still needs to know a drive has 2 applicants and 1 offer.
   */
  it("still shows a coordinator the funnel, just not the names", async () => {
    show({ role: "central_placement_coordinator" });
    await screen.findByText(/zoho corporation/i);

    expect(screen.getAllByText(/applied/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/anjali subramanian/i)).toBeNull();
    expect(screen.queryByText(/rahul nair/i)).toBeNull();
  });

  it("never leaks a name to a coordinator who cannot open the list", async () => {
    show({ role: "delivery_head" });
    await screen.findByText(/zoho corporation/i);
    expect(screen.queryByText(/21CSE1042/)).toBeNull();
  });
});

describe("the blurb describes what the reader actually does", () => {
  it("says raise or approve, and no longer claims they publish", async () => {
    show({ role: "account_executive" });

    const blurb = await screen.findByText(/every drive i raise or approve/i);
    expect(blurb.textContent).not.toMatch(/publish/i);
  });
});

/**
 * Held in constants, not inline: `role` is a prop here and an ARIA attribute
 * everywhere else, and the linter cannot tell the difference from a literal.
 */
const CENTRAL: AppRole = "central_placement_coordinator";
const AE: AppRole = "account_executive";

/**
 * The Drives heading has three tabs and no chips (2026-08-18).
 *
 * "we only need two sub heading … actually, we can have a third box, there
 * called completed. This way we have three tabs — approved = yet to publish;
 * published - page name can be live; completed. drafts can be removed."
 * And: "just remove the three select options at the top of the page."
 */
describe("DrivePortfolioPage — one list, one status group", () => {
  const drive = (
    driveId: string,
    companyName: string,
    status: PortfolioDrive["status"],
  ): PortfolioDrive => ({
    driveId,
    companyName,
    roleTitle: "Jr. Developer",
    status,
    onHold: false,
    ctcMinLpa: null,
    ctcMaxLpa: null,
    createdBy: "p1",
    approvedBy: null,
    publishedBy: null,
    totalRounds: 2,
    roundsDecided: 0,
    applicationStart: null,
    applicationEnd: null,
    applicants: [],
  });

  const view = (drives: readonly PortfolioDrive[]) => ({ drives: async () => drives });

  it("no longer offers the three filters that filtered a list to itself", async () => {
    render(
      <MemoryRouter>
        <DrivePortfolioPage
          view={view([drive("d1", "HCL Technologies", "live")])}
          profileId="p1"
          role={CENTRAL}
          title="Live"
        />
      </MemoryRouter>,
    );

    await screen.findByText("HCL Technologies");
    expect(screen.queryByRole("radiogroup", { name: /filter drives/i })).toBeNull();
    expect(screen.queryByText(/all my drives/i)).toBeNull();
    expect(screen.queryByText(/raised by me/i)).toBeNull();
    expect(screen.queryByText(/approved by me/i)).toBeNull();
  });

  it("shows only the statuses the tab is for - an approved drive is not Live", async () => {
    render(
      <MemoryRouter>
        <DrivePortfolioPage
          view={view([
            drive("d1", "HCL Technologies", "live"),
            drive("d2", "LTI Mindtree", "approved"),
            drive("d3", "Wipro", "draft"),
          ])}
          profileId="p1"
          role={CENTRAL}
          title="Live"
          statuses={["live", "applications_closed", "in_rounds"]}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("HCL Technologies")).toBeDefined();
    expect(screen.queryByText("LTI Mindtree")).toBeNull();
    expect(screen.queryByText("Wipro")).toBeNull();
  });

  it("shows everything when no status group is given, so /my-drives is unchanged", async () => {
    render(
      <MemoryRouter>
        <DrivePortfolioPage
          view={view([
            drive("d1", "HCL Technologies", "live"),
            drive("d2", "LTI Mindtree", "approved"),
          ])}
          profileId="p1"
          role={AE}
          title="My drives"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("HCL Technologies")).toBeDefined();
    expect(screen.getByText("LTI Mindtree")).toBeDefined();
  });

  it("says the tab is empty rather than that there are no drives at all", async () => {
    render(
      <MemoryRouter>
        <DrivePortfolioPage
          view={view([drive("d2", "LTI Mindtree", "approved")])}
          profileId="p1"
          role={CENTRAL}
          title="Completed"
          statuses={["completed"]}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/no drives in this list yet/i)).toBeDefined();
  });
});

/** "add a search button for the drive in progress/live drives page" (2026-08-18). */
describe("DrivePortfolioPage — searching the list", () => {
  const drive = (companyName: string, roleTitle: string): PortfolioDrive => ({
    driveId: companyName,
    companyName,
    roleTitle,
    status: "live",
    onHold: false,
    ctcMinLpa: null,
    ctcMaxLpa: null,
    createdBy: "p1",
    approvedBy: null,
    publishedBy: null,
    totalRounds: 2,
    roundsDecided: 0,
    applicationStart: null,
    applicationEnd: null,
    applicants: [],
  });

  const renderList = () =>
    render(
      <MemoryRouter>
        <DrivePortfolioPage
          view={{
            drives: async () => [
              drive("HCL Technologies", "Jr. Developer"),
              drive("Accenture", "Jr. Software engineer"),
              drive("LTI Mindtree", "Software Engineer Trainee"),
            ],
          }}
          profileId="p1"
          role={CENTRAL}
          title="Live"
        />
      </MemoryRouter>,
    );

  it("offers a search box, labelled", async () => {
    renderList();
    await screen.findByText("HCL Technologies");

    expect(screen.getByRole("searchbox", { name: /search drives/i })).toBeDefined();
  });

  it("narrows the list to what was typed", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("HCL Technologies");

    await user.type(screen.getByRole("searchbox", { name: /search drives/i }), "mindtree");

    expect(screen.getByText("LTI Mindtree")).toBeDefined();
    expect(screen.queryByText("HCL Technologies")).toBeNull();
    expect(screen.queryByText("Accenture")).toBeNull();
  });

  it("searches the role as well as the company", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("HCL Technologies");

    await user.type(screen.getByRole("searchbox", { name: /search drives/i }), "trainee");

    expect(screen.getByText("LTI Mindtree")).toBeDefined();
    expect(screen.queryByText("Accenture")).toBeNull();
  });

  it("says nothing matched, and what was searched for", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("HCL Technologies");

    await user.type(screen.getByRole("searchbox", { name: /search drives/i }), "infosys");

    expect(screen.getByText(/no drives match .*infosys/i)).toBeDefined();
  });

  it("gives the whole list back when the box is cleared", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("HCL Technologies");

    const box = screen.getByRole("searchbox", { name: /search drives/i });
    await user.type(box, "infosys");
    await user.clear(box);

    expect(screen.getByText("HCL Technologies")).toBeDefined();
    expect(screen.getByText("Accenture")).toBeDefined();
    expect(screen.getByText("LTI Mindtree")).toBeDefined();
  });
});

/**
 * G5b (UAT 2026-08-20): "when a company runs multiple drives, its name
 * appears twice in listings with no way to tell them apart." The card now
 * carries the CTC and the applications-close date beside the role.
 */
describe("distinguishing same-company drives (G5b)", () => {
  it("shows the CTC band and the close date on the card", async () => {
    const priced: PortfolioDrive = {
      ...DRIVE,
      ctcMinLpa: 6,
      ctcMaxLpa: 8,
      applicationEnd: "2026-09-10T00:00:00.000Z",
    };
    render(
      <MemoryRouter>
        <DrivePortfolioPage
          view={{ drives: async () => [priced] }}
          profileId="ae-1"
          title="Live"
          role={CENTRAL}
        />
      </MemoryRouter>,
    );

    const card = (await screen.findByText("Zoho Corporation")).closest("section");
    if (card === null) throw new Error("card not found");
    expect(within(card).getByText(/₹6–8 LPA/)).toBeDefined();
    expect(within(card).getByText(/applications close 10 Sept 2026/i)).toBeDefined();
  });
});

/**
 * G5c / G1d (UAT 2026-08-20, answer 1a): drives whose deadline has passed
 * collapse into an "Expired" section so the working list stays on drives
 * needing action. Nothing is destroyed.
 */
describe("expired drives collapse (G5c)", () => {
  const NOW = new Date("2026-08-20T12:00:00+05:30");

  it("moves a past-deadline drive behind an Expired summary", async () => {
    const expired: PortfolioDrive = {
      ...DRIVE,
      driveId: "d8",
      companyName: "Bygone Corp",
      status: "applications_closed",
      applicationEnd: "2026-08-01T00:00:00.000Z",
    };
    const open: PortfolioDrive = {
      ...DRIVE,
      driveId: "d9",
      companyName: "Current Co",
      status: "live",
      applicationEnd: "2026-08-25T00:00:00.000Z",
    };

    render(
      <MemoryRouter>
        <DrivePortfolioPage
          view={{ drives: async () => [expired, open] }}
          profileId="cpc-1"
          title="Live"
          role={CENTRAL}
          statuses={["live", "applications_closed", "in_rounds"]}
          now={NOW}
        />
      </MemoryRouter>,
    );

    await screen.findByText("Current Co");
    expect(screen.getByText(/expired — application deadline passed \(1\)/i)).toBeDefined();
    expect(screen.getByText("Bygone Corp")).toBeDefined();
  });
});
