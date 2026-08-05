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
  roleCategory: "software_technical" as const,
  jobDescription: "Build things.",
  locations: ["Chennai"],
  ctcMinLpa: 6,
  applicationStart: new Date("2026-08-01T00:00:00Z"),
  applicationEnd: new Date("2026-08-14T00:00:00Z"),
  onHold: false,
  rounds: [{ sequence: 1, name: "Aptitude test" }],
  declaredRoundCount: null as number | null,
};

/** A drive in the state the TCS drive was actually in: approved, but bare. */
const BARE_DRIVE = {
  ...DRIVE,
  applicationStart: null,
  applicationEnd: null,
  rounds: [] as ReadonlyArray<{ sequence: number; name: string }>,
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

/**
 * The window and the rounds are set here, at publish time (A24).
 *
 * Neither had any input anywhere in the application. The mock drew green ticks
 * next to "Rounds configured" and "Application window set" regardless, so a
 * drive that could never go live looked ready, and the only way to find out
 * otherwise was to press a button that did nothing.
 */
describe("DafPublish — window and rounds", () => {
  it("shows what the drive is still missing, from the domain rules", async () => {
    routed(view({ load: async () => ({ ...(await view().load()), drive: BARE_DRIVE }) }));

    expect(await screen.findByText(/at least one round/i)).toBeDefined();
    expect(screen.getByText(/application start/i)).toBeDefined();
  });

  it("prefills a window the drive already has", async () => {
    routed(view());

    const start = (await screen.findByLabelText(/applications open/i)) as HTMLInputElement;
    expect(start.value).toContain("2026-08-01");
  });

  it("adds a round", async () => {
    routed(view({ load: async () => ({ ...(await view().load()), drive: BARE_DRIVE }) }));
    await screen.findByRole("button", { name: /add round/i });

    await userEvent.type(screen.getByLabelText(/round name/i), "Technical interview");
    await userEvent.click(screen.getByRole("button", { name: /add round/i }));

    expect(await screen.findByText(/1\. Technical interview/i)).toBeDefined();
  });

  it("removes a round", async () => {
    routed(view());
    await screen.findByText(/1\. Aptitude test/i);

    await userEvent.click(screen.getByRole("button", { name: /remove round 1: aptitude test/i }));

    await waitFor(() => expect(screen.queryByText(/1\. Aptitude test/i)).toBeNull());
  });

  it("publishes the window and the rounds it was given", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    routed(view({ publish }));
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const sent = publish.mock.calls[0]?.[0] as { applicationStart: string; rounds: unknown };

    // The field is `datetime-local`, so it carries wall-clock time in the
    // browser's zone (Asia/Kolkata in production). Asserting a literal string
    // would just pin the test machine's offset; what matters is that the
    // instant survives the round trip without drifting.
    expect(new Date(sent.applicationStart).getTime()).toBe(DRIVE.applicationStart.getTime());
    expect(sent.rounds).toEqual([{ sequence: 1, name: "Aptitude test" }]);
  });

  it("will not publish a drive with no rounds, and says which field is missing", async () => {
    const publish = vi.fn();
    routed(view({ publish, load: async () => ({ ...(await view().load()), drive: BARE_DRIVE }) }));
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    expect(publish).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least one round/i);
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

/**
 * F11 (UAT 2026-08-06): "Account Executive we should collect the number of
 * rounds for the drive and should reflect in the Central placement coordinator
 * login where they are trying to publish the drive, it should be automatically
 * fetched."
 */
describe("DafPublish \u2014 the rounds the AE declared", () => {
  const withCount = (declaredRoundCount: number | null, rounds = BARE_DRIVE.rounds) =>
    view({
      load: async () => ({
        drive: { ...BARE_DRIVE, rounds, declaredRoundCount },
        options: {
          cities: ["Chennai"],
          campuses: ["Alliance University"],
          degrees: ["B.E"],
          branches: ["CSE"],
        },
        cohort: [candidate("s1", "Sai Naveen")],
      }),
    });

  it("says how many rounds the AE declared", async () => {
    render(<DafPublish view={withCount(3)} />);

    expect(await screen.findByText(/account executive.*3 rounds/i)).toBeDefined();
  });

  it("seeds that many rounds to be named, so nothing is typed from memory", async () => {
    render(<DafPublish view={withCount(3)} />);

    await screen.findByText(/account executive.*3 rounds/i);
    expect(screen.getAllByRole("button", { name: /^remove round/i })).toHaveLength(3);
  });

  it("leaves the round list alone when the AE never said", async () => {
    render(<DafPublish view={withCount(null)} />);

    await screen.findByText(/no rounds yet/i);
    expect(screen.queryByText(/account executive/i)).toBeNull();
  });

  /** Named rounds are the coordinator's own work and must survive the fetch. */
  it("never overwrites rounds that already exist", async () => {
    render(<DafPublish view={withCount(3, [{ sequence: 1, name: "Aptitude test" }])} />);

    expect(await screen.findByText(/1\. Aptitude test/)).toBeDefined();
    expect(screen.getAllByRole("button", { name: /^remove/i })).toHaveLength(1);
  });

  /** A disagreement is worth saying out loud: one of the two is out of date. */
  it("says so when the configured rounds do not match what the AE declared", async () => {
    render(<DafPublish view={withCount(3, [{ sequence: 1, name: "Aptitude test" }])} />);

    expect(await screen.findByText(/declared 3 rounds.*1 is configured/i)).toBeDefined();
  });
});
