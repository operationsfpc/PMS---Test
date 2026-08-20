// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  type StudentRecord,
  StudentRecordPage,
  type StudentRecordView,
} from "./student-record-page";

/**
 * G7 (UAT 2026-08-20, Q7 answer b): the canonical student record —
 * `/students/:studentId`, N1's second canonical page. The directory's
 * numbers were dead ends; every count now opens the person behind it.
 *
 * Read-only. Verification and editing live with the campus coordinator; this
 * page must not become a second way in.
 */
const PRIYA: StudentRecord = {
  studentId: "s1",
  fullName: "Priya Ramesh",
  rollNumber: "21CSE1042",
  email: "priya@example.com",
  mobile: "9876543210",
  campusName: "SDNB Vaishnav College",
  degree: "B.Sc CS / CT",
  branch: "CS with AI",
  passingYear: 2027,
  srfStatus: "srf_approved",
  participationStatus: "active",
  tenthPercentage: 92.4,
  twelfthPercentage: 88,
  semesters: [
    { semesterNumber: 1, cgpa: 8.2, verified: true },
    { semesterNumber: 2, cgpa: 8.6, verified: false },
  ],
  skills: [
    { skill: "Java", score: 4 },
    { skill: "SQL", score: 3 },
  ],
  rolePreferences: ["software_technical", "sales"],
  applications: [
    {
      applicationId: "a1",
      driveId: "d1",
      companyName: "Zoho",
      roleTitle: "MTS",
      appliedAt: "2026-08-10T10:00:00Z",
      shortlisted: true,
      hasOffer: false,
    },
  ],
  placement: null,
};

const view = (record: StudentRecord | null = PRIYA): StudentRecordView => ({
  record: async () => record,
});

const show = (v: StudentRecordView = view()) =>
  render(
    <MemoryRouter>
      <StudentRecordPage studentId="s1" view={v} />
    </MemoryRouter>,
  );

describe("StudentRecordPage", () => {
  it("names the student, their roll number and their campus", async () => {
    show();

    expect(await screen.findByRole("heading", { name: /priya ramesh/i })).toBeDefined();
    expect(screen.getByText(/21CSE1042/)).toBeDefined();
    expect(screen.getByText(/SDNB Vaishnav College/)).toBeDefined();
    expect(screen.getByText(/B\.Sc CS \/ CT/)).toBeDefined();
  });

  it("shows the school marks and each semester with its verification state", async () => {
    show();

    const academics = await screen.findByRole("region", { name: /academics/i });
    expect(within(academics).getByText(/92\.4/)).toBeDefined();
    expect(within(academics).getByText(/88/)).toBeDefined();
    expect(within(academics).getByText(/semester 1/i)).toBeDefined();
    expect(within(academics).getByText(/8\.2/)).toBeDefined();
    expect(within(academics).getByText(/verified/i)).toBeDefined();
    expect(within(academics).getByText(/pending/i)).toBeDefined();
  });

  it("shows the skill scores out of 5, and the role preferences", async () => {
    show();

    const skills = await screen.findByRole("region", { name: /skills/i });
    expect(within(skills).getByText(/java 4\/5/i)).toBeDefined();
    expect(within(skills).getByText(/sql 3\/5/i)).toBeDefined();
    expect(screen.getByText(/software \/ technical/i)).toBeDefined();
  });

  it("is honest when no skill scores are recorded", async () => {
    show(view({ ...PRIYA, skills: [] }));

    const skills = await screen.findByRole("region", { name: /skills/i });
    expect(within(skills).getByText(/no skill scores recorded/i)).toBeDefined();
  });

  it("lists every application, each opening its drive", async () => {
    show();

    const applications = await screen.findByRole("region", { name: /applications/i });
    const link = within(applications).getByRole("link", { name: /zoho/i });
    expect(link.getAttribute("href")).toBe("/drives/d1");
    expect(within(applications).getByText(/shortlisted/i)).toBeDefined();
  });

  it("says plainly when the student has not applied anywhere", async () => {
    show(view({ ...PRIYA, applications: [] }));

    const applications = await screen.findByRole("region", { name: /applications/i });
    expect(within(applications).getByText(/no applications yet/i)).toBeDefined();
  });

  it("shows the placement when there is one — with its source", async () => {
    show(
      view({
        ...PRIYA,
        placement: {
          companyName: "Freshworks",
          roleTitle: "SDE",
          ctcLpa: 6,
          offerCategory: "dream",
          source: "self_placed",
        },
      }),
    );

    const placement = await screen.findByRole("region", { name: /placement/i });
    expect(within(placement).getByText(/freshworks/i)).toBeDefined();
    expect(within(placement).getByText(/self-placed/i)).toBeDefined();
  });

  it("says Not placed as a fact, not a blank", async () => {
    show();

    const placement = await screen.findByRole("region", { name: /placement/i });
    expect(within(placement).getByText(/not placed/i)).toBeDefined();
  });

  it("says so when the record cannot be read", async () => {
    show(view(null));

    expect(
      await screen.findByText(/this student record does not exist, or you cannot read it/i),
    ).toBeDefined();
  });
});
