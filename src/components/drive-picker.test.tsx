// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { DrivePicker, type PickerDrive } from "./drive-picker";

/**
 * M1 (approved 2026-08-21): the one drive picker behind Shortlisting,
 * Rounds & results, Attendance and Final selection. Three of those pages
 * dead-ended at "Choose a drive…" with no list at all — the "empty page"
 * reports of 21/08.
 */
const DRIVES: readonly PickerDrive[] = [
  {
    driveId: "d2",
    companyName: "HCL Technologies",
    roleTitle: "Jr. Software engineer",
    ctcLabel: "₹4–5 LPA",
    raisedOn: "2026-08-19T10:00:00Z",
    status: "live",
  },
  {
    driveId: "d1",
    companyName: "Deloitte",
    roleTitle: "Junior Associate",
    ctcLabel: "₹4–5 LPA",
    raisedOn: "2026-08-12T10:00:00Z",
    status: "in_rounds",
  },
  {
    driveId: "d3",
    companyName: "LTI Mindtree",
    roleTitle: "Jr. Developer",
    ctcLabel: "₹6–7 LPA",
    raisedOn: "2026-08-21T10:00:00Z",
    status: "live",
  },
];

const picker = (drives: readonly PickerDrive[] = DRIVES) =>
  render(
    <MemoryRouter>
      <DrivePicker
        drives={drives}
        makeLink={(id) => `/central/results?drive=${id}`}
        prompt="Choose a drive to run its rounds."
      />
    </MemoryRouter>,
  );

describe("DrivePicker", () => {
  /** 2026-08-26 (Karthik): newest raised first, across every section. */
  it("lists company, role, raised date and status — newest raised first", () => {
    picker();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("LTI Mindtree")).toBeDefined();
    expect(within(rows[0] as HTMLElement).getByText(/jr\. developer/i)).toBeDefined();
    expect(within(rows[0] as HTMLElement).getByText(/raised 21 aug 2026/i)).toBeDefined();
    expect(within(rows[2] as HTMLElement).getByText("Deloitte")).toBeDefined();
    expect(within(rows[2] as HTMLElement).getByText(/in rounds/i)).toBeDefined();
  });

  it("links every drive to where the host page wants it", () => {
    picker();
    expect(screen.getByRole("link", { name: /deloitte/i }).getAttribute("href")).toBe(
      "/central/results?drive=d1",
    );
  });

  it("searches by company or role", async () => {
    const user = userEvent.setup();
    picker();

    await user.type(screen.getByRole("searchbox", { name: /search/i }), "developer");
    expect(screen.getByText("LTI Mindtree")).toBeDefined();
    expect(screen.queryByText("Deloitte")).toBeNull();
  });

  it("flips to oldest first on request", async () => {
    const user = userEvent.setup();
    picker();

    await user.selectOptions(screen.getByRole("combobox", { name: /sort/i }), "oldest");
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("Deloitte")).toBeDefined();
  });

  it("says so when nothing matches, instead of a silent blank", async () => {
    const user = userEvent.setup();
    picker();

    await user.type(screen.getByRole("searchbox", { name: /search/i }), "zzz");
    expect(screen.getByText(/no drives match/i)).toBeDefined();
  });

  it("says so when there are no drives at all", () => {
    picker([]);
    expect(screen.getByText(/no drives are in progress/i)).toBeDefined();
  });
});

describe("DrivePicker — sparse drives", () => {
  it("renders a drive with no role, no CTC and no raised date without inventing any", () => {
    render(
      <MemoryRouter>
        <DrivePicker
          drives={[
            {
              driveId: "d9",
              companyName: "Mystery Co",
              roleTitle: null,
              ctcLabel: null,
              raisedOn: null,
              status: "live",
            },
            ...DRIVES,
          ]}
          makeLink={(id) => `/x?drive=${id}`}
          prompt="Pick."
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Mystery Co")).toBeDefined();
    // Undated drives sort LAST in BOTH orders — age unknown is not age zero,
    // and reversing that judgement would call it the newest instead.
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[3] as HTMLElement).getByText("Mystery Co")).toBeDefined();
  });
});

/**
 * UAT 2026-10-16: "i need central placement coordinator same company shows as
 * two". Two roles raised under one company visit are one visit, so the picker
 * names the company once and puts each role — with its own money and status —
 * underneath it.
 */
describe("DrivePicker — one card per company visit", () => {
  const PAIR: readonly PickerDrive[] = [
    {
      driveId: "r1",
      companyName: "FACE Prep tst",
      roleTitle: "SDE",
      ctcLabel: "₹3–4 LPA",
      raisedOn: "2026-10-20T10:00:00Z",
      status: "live",
      companyDriveId: "e1",
      driveType: "placement",
    },
    {
      driveId: "r2",
      companyName: "FACE Prep tst",
      roleTitle: "Data analyst",
      ctcLabel: "₹5–8 LPA",
      raisedOn: "2026-10-20T09:00:00Z",
      status: "live",
      companyDriveId: "e1",
      driveType: "internship",
    },
  ];

  const visit = (overrides: Partial<PickerDrive>[] = []): readonly PickerDrive[] =>
    PAIR.map((role, index) => ({ ...role, ...overrides[index] }));

  const LEGACY: PickerDrive = { ...(PAIR[1] as PickerDrive), companyDriveId: null };

  const pick = (drives: readonly PickerDrive[]) =>
    render(
      <MemoryRouter>
        <DrivePicker
          drives={drives}
          makeLink={(id) => `/central/shortlisting?drive=${id}`}
          prompt="Choose a drive to shortlist its applicants."
        />
      </MemoryRouter>,
    );

  it("names the company once for a visit that raised two roles", () => {
    pick(visit());
    expect(screen.getAllByText("FACE Prep tst")).toHaveLength(1);
    expect(screen.getByText("2 roles")).toBeDefined();
  });

  it("keeps each role's own CTC instead of picking one for the visit", () => {
    pick(visit());
    expect(screen.getByText(/₹3–4 LPA/)).toBeDefined();
    expect(screen.getByText(/₹5–8 LPA/)).toBeDefined();
  });

  /** A picker's roles are choices, so they are rows — not panels that have to
   * be opened before the choice inside them can be reached. */
  it("gives each role its own row, ready to choose", () => {
    pick(visit());
    const rows = screen.getAllByRole("row").slice(1);

    expect(rows).toHaveLength(2);
    expect(rows.some((row) => /SDE/.test(row.textContent ?? ""))).toBe(true);
    expect(rows.some((row) => /Data analyst/.test(row.textContent ?? ""))).toBe(true);
    expect(screen.getByRole("link", { name: /choose data analyst/i })).toBeDefined();
  });

  it("links each role to its own drive, never to whichever one came first", () => {
    pick(visit());
    expect(screen.getByRole("link", { name: /choose sde/i }).getAttribute("href")).toBe(
      "/central/shortlisting?drive=r1",
    );
    expect(screen.getByRole("link", { name: /choose data analyst/i }).getAttribute("href")).toBe(
      "/central/shortlisting?drive=r2",
    );
  });

  it("says the type once when the visit is uniform, and per role when it mixes", () => {
    pick(visit([{ driveType: "placement" }, { driveType: "placement" }]));
    expect(screen.getByText("Full time")).toBeDefined();
    expect(screen.queryByText("Mixed types")).toBeNull();
  });

  it("refuses to name one type for a visit that mixed an internship with a full-time role", () => {
    pick(visit());
    expect(screen.getByText("Mixed types")).toBeDefined();
    // Each role still declares its own in its own row.
    const analyst = screen.getByRole("row", { name: /data analyst/i });
    expect(within(analyst).getByText("Internship")).toBeDefined();
  });

  /** The Status column below already says where each role stands, so the visit
   * is not asked to repeat it — least of all with two badges when they differ. */
  it("leaves the status to each role's own row", () => {
    pick(visit([{ status: "live" }, { status: "applications_closed" }]));
    expect(screen.getAllByText("Live")).toHaveLength(1);
    expect(within(screen.getByRole("row", { name: /sde/i })).getByText("Live")).toBeDefined();
    expect(
      within(screen.getByRole("row", { name: /data analyst/i })).getByText("Applications closed"),
    ).toBeDefined();
  });

  it("keeps a legacy drive with no visit of its own as the single row it always was", () => {
    pick([LEGACY]);
    expect(screen.getByRole("link", { name: /face prep tst/i })).toBeDefined();
    expect(screen.queryByText(/roles/)).toBeNull();
  });

  it("counts one visit, not two, wherever the picker lists drives", () => {
    pick([...visit(), ...DRIVES]);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
