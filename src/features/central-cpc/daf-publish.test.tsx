// @vitest-environment jsdom
import type { AcademicProfile } from "@domain/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  DafPublish,
  type PublishCandidate,
  type PublishDrive,
  type PublishView,
} from "./daf-publish";

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

const DRIVE: PublishDrive = {
  id: "drive-1",
  companyName: "Zoho",
  roleTitle: "Member Technical Staff",
  subtitle: "Member Technical Staff · Dream · ₹6–8 LPA · Placement",
  status: "approved",
  driveType: "placement",
  offerCategory: "dream",
  roleCategory: "software_technical",
  jobDescription: "Build things.",
  hasJobDescriptionFile: false,
  locations: ["Chennai"],
  ctcMinLpa: 6,
  stipendMinMonthly: null,
  stipendMaxMonthly: null,
  applicationStart: new Date("2026-08-01T00:00:00Z"),
  applicationEnd: new Date("2026-08-14T00:00:00Z"),
  onHold: false,
  rounds: [{ sequence: 1, name: "Aptitude test" }],
  declaredRoundCount: null,
  // A drive that declares nothing: every test that cares states its own.
  minOverallCgpa: null,
  minTenthPercentage: null,
  minTwelfthPercentage: null,
  arrearPolicy: "flexible",
  mandatorySkills: "TypeScript, SQL",
  targeting: { cities: [], campuses: [], degrees: [], branches: [] },
};

/** A drive in the state the TCS drive was actually in: approved, but bare. */
const BARE_DRIVE: PublishDrive = {
  ...DRIVE,
  applicationStart: null,
  applicationEnd: null,
  rounds: [],
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
 * The screen must start from what the drive already says.
 *
 * The AE declares the cutoff and the arrear policy on the PIF; the Delivery
 * Head approves THAT drive. This screen used to seed a hardcoded 7.0 and "no
 * standing arrears" over the top of both, and then publish the invention — so
 * the criteria that went live were never the criteria anybody approved.
 */
describe("DafPublish — starts from the approved criteria", () => {
  const withDrive = (over: Partial<typeof DRIVE>) =>
    view({ load: async () => ({ ...(await view().load()), drive: { ...DRIVE, ...over } }) });

  const cgpaBox = async () =>
    (await screen.findByLabelText(/minimum overall cgpa/i)) as HTMLInputElement;

  it("seeds the cutoff the drive was approved with, not a hardcoded 7", async () => {
    routed(withDrive({ minOverallCgpa: 7.89 }));

    expect((await cgpaBox()).value).toBe("7.89");
  });

  it("leaves the cutoff empty when the drive declares none, rather than inventing one", async () => {
    routed(withDrive({ minOverallCgpa: null }));

    expect((await cgpaBox()).value).toBe("");
  });

  it("seeds the arrear policy the drive was approved with", async () => {
    routed(withDrive({ arrearPolicy: "no_history" }));

    expect(((await screen.findByLabelText(/arrear policy/i)) as HTMLSelectElement).value).toBe(
      "no_history",
    );
  });

  it("seeds the targeting the drive already has", async () => {
    routed(
      withDrive({
        targeting: {
          cities: ["Chennai"],
          campuses: ["Alliance University"],
          degrees: ["BCA"],
          branches: ["AI and DS"],
        },
      }),
    );

    expect(await screen.findByRole("checkbox", { name: "BCA", checked: true })).toBeDefined();
    expect(screen.getByRole("checkbox", { name: "AI and DS", checked: true })).toBeDefined();
    expect(screen.getByRole("checkbox", { name: "Chennai", checked: true })).toBeDefined();
    expect(screen.getByRole("checkbox", { name: "CSE", checked: false })).toBeDefined();
  });

  /**
   * A live drive re-opened on this screen used to arrive with every chip
   * cleared, and publishing again DELETED its link rows — and an empty list
   * means "any", so the drive silently opened to the whole roster.
   */
  it("re-publishes the targeting it arrived with instead of widening the drive", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const seeded = withDrive({
      targeting: {
        cities: [],
        campuses: ["Alliance University"],
        degrees: ["BCA"],
        branches: ["AI and DS"],
      },
    });
    routed(view({ ...seeded, publish }));
    // Two, not three: the seeded targeting is doing its job - the CSE student
    // is outside a drive targeted at AI and DS.
    await waitFor(() => expect(count()).toBe(2));

    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      campuses: ["Alliance University"],
      degrees: ["BCA"],
      branches: ["AI and DS"],
    });
  });

  it("publishes the cutoff it was seeded with, unchanged", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const seeded = withDrive({ minOverallCgpa: 7.89 });
    routed(view({ ...seeded, publish }));
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ minOverallCgpa: 7.89 });
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
    expect(new Date(sent.applicationStart).getTime()).toBe(DRIVE.applicationStart?.getTime());
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

/**
 * "in application window while making a live open. there should also be a now
 * click box." (2026-08-18)
 *
 * Typing today's date and time into a `datetime-local` to mean "now" is four
 * fields of arithmetic to express the most common intent there is - and getting
 * the minute wrong means a drive that is announced but not yet open, which
 * students read as a broken page.
 */
describe("DafPublish — opening the applications now", () => {
  it("offers a box for it", async () => {
    routed(view());

    expect(await screen.findByRole("checkbox", { name: /open now/i })).toBeDefined();
  });

  it("takes the start over, and stops asking for a date", async () => {
    routed(view());

    await userEvent.click(await screen.findByRole("checkbox", { name: /open now/i }));

    expect((screen.getByLabelText(/applications open/i) as HTMLInputElement).disabled).toBe(true);
  });

  /** A window that closes before it opens is refused - see the last test here. */
  const openEnded = async () => ({
    ...(await view().load()),
    drive: { ...DRIVE, applicationEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
  });

  it("publishes the moment of publishing, not the moment the box was ticked", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    routed(view({ publish, load: openEnded }));
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("checkbox", { name: /open now/i }));
    const before = Date.now();
    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const sent = publish.mock.calls[0]?.[0] as { applicationStart: string };
    const stamped = new Date(sent.applicationStart).getTime();
    /**
     * To the MINUTE, which is the precision the window is expressed in - so it
     * can sit up to 59 seconds in the past. That direction is deliberate: a
     * window that opened a moment ago is open, and one rounded a moment into
     * the future would announce a drive nobody can apply to yet.
     */
    expect(stamped).toBeGreaterThanOrEqual(before - 60_000);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it("gives the coordinator their own date back when they untick it", async () => {
    routed(view());
    const box = await screen.findByRole("checkbox", { name: /open now/i });

    await userEvent.click(box);
    await userEvent.click(box);

    const start = screen.getByLabelText(/applications open/i) as HTMLInputElement;
    expect(start.disabled).toBe(false);
    expect(start.value).toContain("2026-08-01");
  });

  it("satisfies the missing-start rule that would otherwise block publishing", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    routed(view({ publish, load: openEnded }));
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("checkbox", { name: /open now/i }));
    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  });

  /**
   * Found by writing these tests: ticking "Open now" on a drive whose close
   * date has already passed makes a window that ends before it starts. The
   * domain rule for that already existed (`missingBeforeGoLive`); what mattered
   * was that "now" is expressed in the SAME wall-clock format as the input it
   * replaces. As an ISO-Z stamp it was being compared as a string against a
   * local `datetime-local` value, which is right by luck in the morning and
   * wrong by five and a half hours in the evening.
   */
  it("refuses to open now on a drive that has already closed, and says why", async () => {
    const publish = vi.fn();
    routed(view({ publish }));
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("checkbox", { name: /open now/i }));
    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    expect(publish).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toMatch(/ends before it starts/i);
  });
});

/**
 * "we also need 10th and 12th marks based targetting. now only cgpa field is
 * there." (2026-08-18, set at publish — Karthik's answer to Q3.)
 *
 * The columns have existed since 0004 and `evaluateEligibility` has always read
 * them; nothing has ever been able to SET them. 0050 enforces them in the apply
 * gate as well, so the audience below is a promise the database keeps.
 */
describe("DafPublish — the 10th and 12th bars", () => {
  it("offers both, empty when the drive sets neither", async () => {
    routed(view());

    expect(((await screen.findByLabelText(/minimum 10th/i)) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/minimum 12th/i) as HTMLInputElement).value).toBe("");
  });

  it("publishes what the coordinator set", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    routed(view({ publish }));
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.type(screen.getByLabelText(/minimum 10th/i), "60");
    await userEvent.type(screen.getByLabelText(/minimum 12th/i), "65.5");
    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const sent = publish.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.minTenthPercentage).toBe(60);
    expect(sent.minTwelfthPercentage).toBe(65.5);
  });

  /** An empty box is "no bar", never a bar of zero. */
  it("publishes null when neither is set", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    routed(view({ publish }));
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.click(screen.getByRole("button", { name: /publish to \d+ student/i }));

    const sent = publish.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.minTenthPercentage).toBeNull();
    expect(sent.minTwelfthPercentage).toBeNull();
  });

  /** The audience is judged on the bar as typed, before anything is published. */
  it("shrinks the audience as the bar is raised", async () => {
    routed(view());
    await waitFor(() => expect(count()).toBe(3));

    await userEvent.type(screen.getByLabelText(/minimum 10th/i), "95");

    await waitFor(() => expect(count()).toBe(0));
  });
});

/**
 * Tracker item 38, second half (answer 4, 2026-08-21): the skills tagged to
 * the role, INLINE on the publish screen — the coordinator publishing a
 * drive should not need to open the record page to know what it demands.
 */
describe("DafPublish — a JD that arrived as the recruiter's own PDF", () => {
  /**
   * The Infosys drive of 2026-08-24: JD attached at the PIF, viewable and
   * downloadable, typed text left blank (optional since J1) — and the
   * publish screen said "Missing: Job description" with no control to fix
   * it. The attachment must satisfy the checklist.
   */
  it("does not report the job description missing", async () => {
    routed(
      view({
        load: async () => ({
          drive: { ...DRIVE, jobDescription: "", hasJobDescriptionFile: true },
          options: { cities: [], campuses: [], degrees: [], branches: [] },
          cohort: [candidate("s1", "Sai Naveen")],
        }),
      }),
    );

    await screen.findByRole("heading", { name: /publish drive — zoho/i });
    expect(screen.queryByText("Job description")).toBeNull();
  });

  it("still reports it missing when there is neither text nor file", async () => {
    routed(
      view({
        load: async () => ({
          drive: { ...DRIVE, jobDescription: "", hasJobDescriptionFile: false },
          options: { cities: [], campuses: [], degrees: [], branches: [] },
          cohort: [candidate("s1", "Sai Naveen")],
        }),
      }),
    );

    await screen.findByRole("heading", { name: /publish drive — zoho/i });
    expect(screen.getByText("Job description")).toBeDefined();
  });
});

describe("the role's must-have skills, on the publish screen", () => {
  it("names them alongside the other company info", async () => {
    render(<DafPublish view={view()} />);

    expect(await screen.findByText(/must-have skills/i)).toBeDefined();
    expect(screen.getByText(/TypeScript, SQL/)).toBeDefined();
  });

  it("admits when the role declares none, rather than staying silent", async () => {
    render(
      <DafPublish
        view={view({
          load: async () => ({
            drive: { ...DRIVE, mandatorySkills: "" },
            options: { cities: [], campuses: [], degrees: [], branches: [] },
            cohort: [],
          }),
        })}
      />,
    );

    expect(await screen.findByText(/no must-have skills declared/i)).toBeDefined();
  });
});
