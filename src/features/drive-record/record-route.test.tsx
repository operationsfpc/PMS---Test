// @vitest-environment jsdom

import type { AppRole } from "@domain/types";
import { AuthContext } from "@features/auth/require-auth";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { OpenDrive } from "../student/drives-list";
import { DriveRecordRoute } from "./record-route";
import type { DriveRecordView } from "./record-view";
import type { StudentApplyView } from "./student-apply-bar";

/**
 * N1 + 2026-10-29 UAT: the canonical page had no Apply for the student it was
 * linked to from their card. The bar is wired in the composition root, so this
 * test guards the route's half of that wiring: students get it, staff do not.
 */
const ZOHO: OpenDrive = {
  id: "d1",
  companyName: "Zoho",
  roleTitle: "Member Technical Staff",
  roleCategory: "software_technical",
  ctcLabel: "₹6.5–9 LPA",
  offerCategory: "dream",
  applicationEnd: "2026-09-10T00:00:00Z",
  canApply: true,
  refusal: null,
  applied: false,
  profileResumeName: null,
  companyDriveId: null,
  tentativeDate: null,
  details: {
    jobDescription: "",
    designations: [],
    locations: "",
    openings: null,
    ctcBreakup: "",
    bondDetails: "",
    shift: "",
    joining: "",
    jobDescriptionUrl: null,
    jobDescriptionName: null,
    mandatorySkills: "",
    driveMode: "",
    venue: "",
    applicationStart: null,
    rounds: [],
  },
};

/** The page's own content is proven elsewhere; here it only has to render. */
const pageView: DriveRecordView = { record: async () => null };
const applyView: StudentApplyView = {
  openDrive: async () => ZOHO,
  apply: async () => undefined,
};

function at(role: AppRole, customPageView: DriveRecordView = pageView) {
  return render(
    <AuthContext.Provider
      value={{ status: "signed-in", role, email: "test@example.com", campuses: [] }}
    >
      <MemoryRouter initialEntries={["/drives/d1"]}>
        <Routes>
          <Route
            path="/drives/:driveId"
            element={<DriveRecordRoute view={customPageView} studentApplyView={() => applyView} />}
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("DriveRecordRoute", () => {
  it("offers a student the Apply their card led them to", async () => {
    at("student");

    expect(
      await screen.findByRole("button", { name: "Apply to Zoho — Member Technical Staff" }),
    ).toBeDefined();
  });

  it("offers Apply in the page header actions when the drive is loaded", async () => {
    const loadedPageView: DriveRecordView = {
      record: async () => ({
        id: "d1",
        companyDriveId: null,
        companyName: "Zoho",
        industry: "Technology",
        companyWebsite: "https://zoho.com",
        roleTitle: "Member Technical Staff",
        additionalDesignations: [],
        roleCategory: "software_technical",
        status: "live",
        driveType: "placement",
        driveMode: "on_campus",
        venue: null,
        offerCategory: "dream",
        openings: 25,
        ctcLabel: "₹6.5–9 LPA",
        ctcBreakup: "",
        bondDetails: "",
        locations: "Chennai",
        applicationStart: "2026-09-01T00:00:00Z",
        applicationEnd: "2026-09-10T00:00:00Z",
        tentativeDate: null,
        shift: "Day",
        joining: "Immediate",
        jobDescription: "Build backend services",
        jobDescriptionUrl: null,
        jobDescriptionName: null,
        eligibility: {
          cgpaLabel: "≥ 7.0 CGPA",
          tenthLabel: "≥ 70%",
          twelfthLabel: "≥ 70%",
          arrearsLabel: "No arrears",
          passingYears: [2027],
          mandatorySkills: "TypeScript",
          degrees: ["B.E"],
          branches: ["CSE"],
          campuses: [],
        },
        rounds: [],
        recruiters: [],
        provenance: {
          raisedBy: null,
          raisedAt: null,
          approvedBy: null,
          approvedAt: null,
          publishedBy: null,
          publishedAt: null,
        },
        applicants: [],
        siblingRoles: [],
      }),
    };
    at("student", loadedPageView);

    expect(
      await screen.findByRole("heading", { name: /zoho — member technical staff/i }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDefined();
  });

  it("does not offer staff an Apply", async () => {
    at("account_executive");

    expect(await screen.findByText(/does not exist, or you cannot see it/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /apply to Zoho/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
  });
});
