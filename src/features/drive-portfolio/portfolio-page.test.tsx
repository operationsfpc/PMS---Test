// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  createdBy: "ae-1",
  approvedBy: "dh-1",
  publishedBy: "cpc-1",
  totalRounds: 4,
  roundsDecided: 2,
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
  applicants: [],
};

const view = (drives: readonly PortfolioDrive[] = [DRIVE, OTHERS]): PortfolioView => ({
  drives: async () => drives,
});

const show = (overrides: { view?: PortfolioView; profileId?: string; title?: string } = {}) =>
  render(
    <DrivePortfolioPage
      view={overrides.view ?? view()}
      profileId={overrides.profileId ?? "ae-1"}
      title={overrides.title ?? "My drives"}
    />,
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

  it("filters to the drives the viewer raised", async () => {
    const user = userEvent.setup();
    show({ profileId: "ae-1" });

    await user.click(await screen.findByRole("radio", { name: /raised by me/i }));

    expect(screen.getByRole("region", { name: "Zoho Corporation" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "Freshworks" })).toBeNull();
  });

  it("filters to the drives the viewer approved", async () => {
    const user = userEvent.setup();
    show({ profileId: "dh-1" });

    await user.click(await screen.findByRole("radio", { name: /approved by me/i }));

    expect(screen.getByRole("region", { name: "Zoho Corporation" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "Freshworks" })).toBeNull();
  });

  it("shows everything the viewer can see when no filter is applied", async () => {
    show();

    expect(await screen.findByRole("region", { name: "Zoho Corporation" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Freshworks" })).toBeDefined();
  });

  it("says so plainly when a filter leaves nothing, rather than showing an empty page", async () => {
    const user = userEvent.setup();
    show({ profileId: "nobody" });

    await user.click(await screen.findByRole("radio", { name: /raised by me/i }));

    expect(screen.getByText(/no drives match/i)).toBeDefined();
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
