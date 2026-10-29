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

function at(role: AppRole) {
  return render(
    <AuthContext.Provider
      value={{ status: "signed-in", role, email: "test@example.com", campuses: [] }}
    >
      <MemoryRouter initialEntries={["/drives/d1"]}>
        <Routes>
          <Route
            path="/drives/:driveId"
            element={<DriveRecordRoute view={pageView} studentApplyView={() => applyView} />}
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

  it("does not offer staff an Apply", async () => {
    at("account_executive");

    expect(await screen.findByText(/does not exist, or you cannot see it/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /apply to Zoho/i })).toBeNull();
  });
});
