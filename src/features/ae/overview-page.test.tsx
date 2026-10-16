// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  type AeOverviewDrive,
  AeOverviewPage,
  type AeOverviewSnapshot,
  type AeOverviewView,
} from "./overview-page";

/**
 * The Account Executive's landing page. Mockup approved 2026-08-26
 * (`docs/specs/2026-08-26-ae-overview-mockup.html`), option A.
 *
 * Two sections that must not be confused:
 *
 *  A. MY DRIVES — their own work, from rows RLS already returns to them.
 *     Every card opens the drives behind it.
 *  B. PLACEMENT OVERALL — the organisation's numbers, as aggregates. NOT
 *     links: the student directory is closed to an AE, and a card that opened
 *     an empty list would be worse than a number that never claimed to.
 */
const SNAPSHOT: AeOverviewSnapshot = {
  drives: [
    {
      driveId: "d1",
      companyDriveId: null,
      companyName: "Accenture",
      roleTitle: "Junior Analyst",
      status: "live",
      driveType: "placement",
      ctcMinLpa: 4,
      ctcMaxLpa: 5,
      createdAt: "2026-08-20T09:00:00.000Z",
      campuses: [],
      applicants: [
        { shortlisted: true, hasOffer: false },
        { shortlisted: false, hasOffer: false },
      ],
    },
    {
      driveId: "d2",
      companyDriveId: null,
      companyName: "Zoho Corporation",
      roleTitle: "Member Technical Staff",
      status: "completed",
      driveType: "internship_convertible",
      ctcMinLpa: 6,
      ctcMaxLpa: 9,
      createdAt: "2026-08-01T09:00:00.000Z",
      campuses: ["PSG Tech", "Sona College"],
      applicants: [{ shortlisted: true, hasOffer: true }],
    },
  ],
  totals: {
    eligible: 598,
    placed: 231,
    selfPlaced: 17,
    optedOut: 9,
    completedDrives: 27,
    highestLpa: 18,
    lowestLpa: 3.6,
    averageLpa: 6.4,
    medianLpa: 5.5,
  },
};

const view = (snapshot: AeOverviewSnapshot = SNAPSHOT): AeOverviewView => ({
  snapshot: async () => snapshot,
});

const show = (v: AeOverviewView = view()) =>
  render(
    <MemoryRouter>
      <AeOverviewPage view={v} />
    </MemoryRouter>,
  );

const inSection = async (name: RegExp) => within(await screen.findByRole("region", { name }));

/**
 * The `<li>` a visit owns, found by its "N roles" badge. The popup's filter
 * chips carry the same type words as a visit's badges, so type assertions are
 * made inside the visit rather than inside the dialog.
 */
const visitOf = (scope: HTMLElement) => {
  const li = within(scope)
    .getByText(/\d+ roles/)
    .closest("li");
  const head = li?.querySelector("p");
  if (li === null || head == null) throw new Error("visit not found");
  return { visit: within(li), head: within(head) };
};

/** One company visit that raised two roles — the shape that printed the company twice. */
const role = (
  driveId: string,
  roleTitle: string,
  over: Partial<AeOverviewDrive> = {},
): AeOverviewDrive => ({
  driveId,
  companyDriveId: "e1",
  companyName: "Wipro",
  roleTitle,
  status: "live",
  driveType: "placement",
  ctcMinLpa: 6,
  ctcMaxLpa: 8,
  createdAt: "2026-08-25T09:00:00.000Z",
  campuses: ["PSG Tech"],
  applicants: [{ shortlisted: true, hasOffer: false }],
  ...over,
});

const VISIT: readonly AeOverviewDrive[] = [
  role("d10", "SDE", {
    applicants: [
      { shortlisted: true, hasOffer: false },
      { shortlisted: false, hasOffer: false },
    ],
  }),
  role("d11", "Data analyst", { ctcMinLpa: 4, ctcMaxLpa: 5 }),
];

describe("AeOverviewPage — my drives", () => {
  it("counts the drives they brought in", async () => {
    show();
    const mine = await inSection(/my drives/i);

    expect(mine.getByRole("button", { name: /drives brought in 2/i })).toBeDefined();
  });

  it("counts the live ones separately from the completed ones", async () => {
    show();
    const mine = await inSection(/my drives/i);

    expect(mine.getByRole("button", { name: /live now 1/i })).toBeDefined();
    expect(mine.getByRole("button", { name: /drives completed 1/i })).toBeDefined();
  });

  it("adds up applicants, shortlists and offers across their drives", async () => {
    show();
    const mine = await inSection(/my drives/i);

    expect(mine.getByRole("button", { name: /applicants 3/i })).toBeDefined();
    expect(mine.getByRole("button", { name: /shortlisted 2/i })).toBeDefined();
    expect(mine.getByRole("button", { name: /offers made 1/i })).toBeDefined();
  });

  it("opens the drives behind a card in a popup, with who and which college", async () => {
    const user = userEvent.setup();
    show();
    const mine = await inSection(/my drives/i);

    await user.click(mine.getByRole("button", { name: /live now 1/i }));

    const dialog = await screen.findByRole("dialog", { name: /open drives/i });
    expect(within(dialog).getByText("Accenture")).toBeDefined();
    expect(within(dialog).getByText(/open to every campus/i)).toBeDefined();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filters the popup by drive type", async () => {
    const user = userEvent.setup();
    show();
    const mine = await inSection(/my drives/i);

    await user.click(mine.getByRole("button", { name: /drives brought in 2/i }));
    const dialog = await screen.findByRole("dialog", { name: /drives brought in/i });

    await user.click(within(dialog).getByRole("button", { name: /internship → full time/i }));

    expect(within(dialog).queryByText("Accenture")).toBeNull();
    expect(within(dialog).getByText("Zoho Corporation")).toBeDefined();
    expect(within(dialog).getByText(/open to: psg tech, sona college/i)).toBeDefined();
  });

  it("lists their most recent drives, newest first, each opening the drive", async () => {
    show();
    const recent = await inSection(/most recent/i);
    const rows = recent.getAllByRole("row").slice(1);

    expect(rows[0]?.textContent).toMatch(/accenture/i);
    expect(rows[1]?.textContent).toMatch(/zoho/i);
    expect(recent.getByRole("link", { name: /accenture/i }).getAttribute("href")).toBe(
      "/drives/d1",
    );
  });

  /**
   * UAT 2026-10-16: "same company shows as two". Two roles of one visit are one
   * visit. The table gives the visit one company cell and keeps a row per role,
   * because each role has its own applicants, shortlist and offers.
   */
  it("names the visit once in the most-recent table, with a row per role", async () => {
    show(view({ ...SNAPSHOT, drives: VISIT }));
    const recent = await inSection(/most recent/i);

    expect(recent.getAllByText("Wipro")).toHaveLength(1);
    expect(recent.getByText("2 roles")).toBeDefined();
    // The company headline of a multi-role visit is not a link: each role links
    // to its own record, and one link would have to guess which role it meant.
    expect(recent.queryByRole("link", { name: /wipro/i })).toBeNull();

    const rows = recent.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toMatch(/sde/i);
    expect(rows[1]?.textContent).toMatch(/data analyst/i);
    expect(rows[1]?.textContent).not.toMatch(/wipro/i);
    expect(recent.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/drives/d10",
      "/drives/d11",
    ]);
  });

  it("folds a visit's roles under the company in the popup", async () => {
    const user = userEvent.setup();
    show(view({ ...SNAPSHOT, drives: VISIT }));
    const mine = await inSection(/my drives/i);

    await user.click(mine.getByRole("button", { name: /drives brought in 2/i }));
    const dialog = await screen.findByRole("dialog", { name: /drives brought in/i });

    expect(within(dialog).getAllByText("Wipro")).toHaveLength(1);
    expect(within(dialog).getByText("2 roles")).toBeDefined();
    expect(
      within(dialog)
        .getByRole("button", { name: /data analyst/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(within(dialog).getAllByText(/applied · .* shortlisted · .* offers/i)).toHaveLength(2);
    expect(
      within(dialog)
        .getAllByRole("link", { name: /open the drive record/i })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/drives/d10", "/drives/d11"]);
  });

  it("says the visit mixes drive types instead of claiming one", async () => {
    const user = userEvent.setup();
    show(
      view({
        ...SNAPSHOT,
        drives: [role("d10", "SDE"), role("d11", "Intern", { driveType: "internship" })],
      }),
    );
    const mine = await inSection(/my drives/i);

    await user.click(mine.getByRole("button", { name: /drives brought in 2/i }));
    const dialog = await screen.findByRole("dialog", { name: /drives brought in/i });
    const { visit, head } = visitOf(dialog);

    expect(head.getByText("Mixed types")).toBeDefined();
    expect(head.queryByText("Full time")).toBeNull();
    // A mixed visit says no single type, so each role badges its own.
    expect(visit.getByRole("button", { name: /^intern ·/i }).textContent).toMatch(/internship/i);
  });

  it("says a visit's type once when every role shares it", async () => {
    const user = userEvent.setup();
    show(view({ ...SNAPSHOT, drives: VISIT }));
    const mine = await inSection(/my drives/i);

    await user.click(mine.getByRole("button", { name: /drives brought in 2/i }));
    const dialog = await screen.findByRole("dialog", { name: /drives brought in/i });
    const { visit, head } = visitOf(dialog);

    expect(head.getAllByText("Full time")).toHaveLength(1);
    expect(head.queryByText("Mixed types")).toBeNull();
    // Said once means said once: the roles under it do not repeat it.
    expect(visit.getByRole("button", { name: /^sde ·/i }).textContent).not.toMatch(/full time/i);
  });

  it("says so plainly when they have raised nothing yet", async () => {
    show(view({ ...SNAPSHOT, drives: [] }));

    expect(await screen.findByText(/no drives yet.*position information form/i)).toBeDefined();
  });
});

describe("AeOverviewPage — placement overall", () => {
  it("publishes the organisation's rate from the domain rule", async () => {
    show();
    const org = await inSection(/placement overall/i);

    // 231 of 598 — computed by summarisePlacementTotals, not by this screen.
    expect(org.getByText("38.6%")).toBeDefined();
  });

  it("shows the cohort behind the rate", async () => {
    show();
    const org = await inSection(/placement overall/i);

    expect(org.getByText(/of 598 eligible/i)).toBeDefined();
    expect(org.getByText("17")).toBeDefined();
    expect(org.getByText("9")).toBeDefined();
  });

  it("shows the package spread", async () => {
    show();
    const org = await inSection(/package/i);

    expect(org.getByText("₹18 LPA")).toBeDefined();
    expect(org.getByText("₹5.5 LPA")).toBeDefined();
  });

  /** THE RULE OF THIS SCREEN. An AE may not open a student record. */
  it("makes no organisation figure a link", async () => {
    show();
    const org = await inSection(/placement overall/i);

    expect(org.queryAllByRole("link")).toEqual([]);
  });

  it("says the package is not known yet rather than printing a zero", async () => {
    show(
      view({
        ...SNAPSHOT,
        totals: {
          ...SNAPSHOT.totals,
          placed: 0,
          highestLpa: null,
          lowestLpa: null,
          averageLpa: null,
          medianLpa: null,
        },
      }),
    );
    const org = await inSection(/package/i);

    expect(org.getByText(/no packages yet/i)).toBeDefined();
  });
});

describe("AeOverviewPage — loading and failure", () => {
  it("says it is loading rather than showing an empty overview", () => {
    show({ snapshot: () => new Promise(() => undefined) });

    expect(screen.getByRole("status").textContent).toMatch(/loading/i);
  });

  it("says so when the figures cannot be read, instead of reporting zeroes", async () => {
    show({ snapshot: async () => Promise.reject(new Error("nope")) });

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not load/i);
  });
});
