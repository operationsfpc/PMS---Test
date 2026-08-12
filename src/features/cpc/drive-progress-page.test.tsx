// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  type DriveProgressEntry,
  DriveProgressPage,
  type DriveProgressView,
} from "./drive-progress-page";

/**
 * D10 (2026-08-12): the campus placement coordinator follows their students
 * through the ENTIRE cycle — shortlist, every round, the offer. Read-only:
 * recording stays with the Central CPC, attendance on its own screen.
 */
const DRIVE: DriveProgressEntry = {
  driveId: "d1",
  companyName: "Zoho",
  roleTitle: "Engineer",
  status: "in_rounds",
  students: [
    {
      applicationId: "a1",
      studentName: "Priya Ramesh",
      rollNumber: "21CSE1042",
      shortlisted: true,
      rounds: [
        { sequence: 1, name: "Aptitude", attendance: "present", result: "selected" },
        { sequence: 2, name: "Technical", attendance: "scheduled", result: null },
      ],
      offer: null,
    },
    {
      applicationId: "a2",
      studentName: "Arjun Menon",
      rollNumber: "21CSE9001",
      shortlisted: true,
      rounds: [{ sequence: 1, name: "Aptitude", attendance: "absent", result: "rejected" }],
      offer: { ctcLpa: 8, offerCategory: "dream" },
    },
    {
      applicationId: "a3",
      studentName: "Meena V",
      rollNumber: "21CSE5555",
      shortlisted: false,
      rounds: [],
      offer: null,
    },
  ],
};

const view = (drives: readonly DriveProgressEntry[] = [DRIVE]): DriveProgressView => ({
  drives: async () => drives,
});

describe("DriveProgressPage", () => {
  it("shows each drive with its students' full journey", async () => {
    render(<DriveProgressPage view={view()} />);

    expect(await screen.findByText("Zoho")).toBeDefined();

    const priya = screen.getByText("Priya Ramesh").closest("li");
    if (priya === null) throw new Error("row not found");
    expect(within(priya).getByText(/round 1.*selected/i)).toBeDefined();
    expect(within(priya).getByText(/round 2/i)).toBeDefined();
  });

  it("shows the offer once it is made — the end of the cycle they asked to see", async () => {
    render(<DriveProgressPage view={view()} />);

    const arjun = (await screen.findByText("Arjun Menon")).closest("li");
    if (arjun === null) throw new Error("row not found");
    expect(within(arjun).getByText(/offer.*dream/i)).toBeDefined();
  });

  it("says who applied but was not shortlisted, rather than dropping them", async () => {
    render(<DriveProgressPage view={view()} />);

    const meena = (await screen.findByText("Meena V")).closest("li");
    if (meena === null) throw new Error("row not found");
    expect(within(meena).getByText(/not shortlisted/i)).toBeDefined();
  });

  it("is read-only — no controls anywhere", async () => {
    render(<DriveProgressPage view={view()} />);

    await screen.findByText("Zoho");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says so when no drive touches their campus yet", async () => {
    render(<DriveProgressPage view={view([])} />);

    expect(await screen.findByText(/no drives involve your students yet/i)).toBeDefined();
  });
});
