// @vitest-environment jsdom
import type { AcademicProfile } from "@domain/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DafPublish, type PublishCandidate, type PublishView } from "./daf-publish";

/**
 * Publishing a drive.
 *
 * This screen was a visual mock: a hardcoded cohort of twelve invented
 * students, hardcoded city/campus/degree/branch chips, and a Publish button
 * with no handler on it at all. A coordinator targeting a real drive was shown
 * numbers that had nothing to do with their roster, and pressing Publish did
 * nothing.
 *
 * The audience is still computed by the REAL domain rules, so these tests
 * assert targeting behaviour end to end - but over the cohort the view
 * supplies, which is the one in the database.
 */
const academics = (over: Partial<AcademicProfile> = {}): AcademicProfile => ({
  degree: "BCA",
  branch: "AI and DS",
  passingYear: 2027,
  overallCgpa: 8,
  tenthPercentage: 80,
  twelfthPercentage: 80,
  currentArrears: 0,
  historyOfArrears: 0,
  city: "Chennai",
  campus: "Alliance University",
  ...over,
});

const candidate = (
  id: string,
  name: string,
  over: Partial<PublishCandidate> = {},
): PublishCandidate => ({
  id,
  name,
  srfStatus: "srf_approved",
  participationStatus: "active",
  academics: academics(),
  offers: [],
  ...over,
});

const DRIVE = {
  id: "drive-1",
  companyName: "Zoho",
  roleTitle: "Member Technical Staff",
  subtitle: "Member Technical Staff · Dream · ₹6–8 LPA · Placement",
  status: "approved" as const,
  driveType: "placement" as const,
  offerCategory: "dream" as const,
  applicationStart: new Date("2026-08-01T00:00:00Z"),
  applicationEnd: new Date("2026-08-14T00:00:00Z"),
  onHold: false,
  hasJobDescription: true,
  hasCtc: true,
  hasRounds: true,
};

function view(over: Partial<PublishView> = {}, cohort?: readonly PublishCandidate[]): PublishView {
  return {
    load: async () => ({
      drive: DRIVE,
      options: {
        cities: ["Chennai", "Bengaluru"],
        campuses: ["Alliance University"],
        degrees: ["BCA", "B.E"],
        branches: ["AI and DS", "CSE"],
      },
      cohort: cohort ?? [
        candidate("s1", "Sai Naveen"),
        candidate("s2", "Thanush Krishna"),
        candidate("s3", "Naveen Kumar", { academics: academics({ branch: "CSE" }) }),
      ],
    }),
    publish: async () => undefined,
    ...over,
  };
}

const routed = (v: PublishView) =>
  render(
    <MemoryRouter>
      <DafPublish view={v} />
    </MemoryRouter>,
  );

const count = (): number => Number(screen.getByTestId("audience-count").textContent);

describe("DafPublish — the drive being published", () => {
  it("names the real drive, not a hardcoded one", async () => {
    routed(view());

    expect(await screen.findByRole("heading", { name: /publish drive — zoho/i })).toBeDefined();
  });

  it("offers the degrees and branches that actually exist on the roster", async () => {
    routed(view());

    expect(await screen.findByRole("checkbox", { name: "BCA" })).toBeDefined();
    expect(screen.getByRole("checkbox", { name: "AI and DS" })).toBeDefined();
  });
});

describe("DafPublish — live audience", () => {
  it("counts the cohort the view supplied", async () => {
    routed(view());

    await waitFor(() => expect(count()).toBe(3));
    expect(screen.getByText(/of 3 students will see this drive/i)).toBeDefined();
  });

  it("never counts students whose SRF is unverified, who opted out, or who are disbarred", async () => {
    routed(
      view({}, [
        candidate("s1", "Fine"),
        candidate("s2", "Unverified", { srfStatus: "srf_submitted" }),
        candidate("s3", "Gone", { participationStatus: "opted_out" }),
        candidate("s4", "Barred", { participationStatus: "disbarred" }),
      ]),
    );

    await waitFor(() => expect(count()).toBe(1));
    for (const label of [/SRF not yet verified/i, /Opted out of placements/i, /Disbarred/i]) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("shrinks the audience when a branch filter is applied", async () => {
    routed(view());
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("checkbox", { name: "CSE" }));

    await waitFor(() => expect(count()).toBe(1));
  });
});

describe("DafPublish — publishing", () => {
  it("publishes with the targeting the coordinator chose", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    routed(view({ publish }));
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("checkbox", { name: "BCA" }));
    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      driveId: "drive-1",
      degrees: ["BCA"],
      openToAllOverride: false,
    });
  });

  it("confirms when the drive is live, so nobody presses it twice", async () => {
    routed(view());
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    expect(await screen.findByRole("status")).toHaveProperty("textContent", expect.any(String));
    expect(screen.getByText(/is live/i)).toBeDefined();
  });

  /**
   * R5a is audit-logged and mandatory. Refusing silently by disabling the
   * button is what made this look broken: the reason sat in a checklist the
   * coordinator had already scrolled past.
   */
  it("says why it will not publish when the override reason is missing", async () => {
    const publish = vi.fn();
    routed(view({ publish }));
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("checkbox", { name: /open to all students/i }));
    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    expect(publish).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent");
    expect(screen.getByRole("alert").textContent).toMatch(/reason/i);
  });

  it("surfaces a refusal from the database instead of appearing to do nothing", async () => {
    routed(
      view({
        publish: async () => {
          throw new Error("This drive is on hold and cannot be published.");
        },
      }),
    );
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/on hold/i);
  });
});
