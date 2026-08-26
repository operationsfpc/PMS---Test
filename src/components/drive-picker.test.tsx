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
