import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseStudentRecordView } from "./student-record-view";

/**
 * G7 (UAT 2026-08-20): the student record, assembled from live rows. RLS
 * decides whether the student row comes back at all; everything else hangs
 * off it.
 */
const BASE = "https://record.test.supabase.co";

const client = () => createClient(BASE, "anon-key");

const STUDENT_ROW = {
  id: "s1",
  full_name: "Priya Ramesh",
  roll_number: "21CSE1042",
  email: "priya@example.com",
  mobile: "9876543210",
  passing_year: 2027,
  srf_status: "srf_approved",
  participation_status: "active",
  tenth_percentage: "92.40",
  twelfth_percentage: "88.00",
  campuses: { name: "SDNB Vaishnav College" },
  degrees: { name: "B.Sc CS / CT" },
  branches: { name: "CS with AI" },
};

function stubHappyPath() {
  server.use(
    http.get(`${BASE}/rest/v1/students`, () => HttpResponse.json([STUDENT_ROW])),
    http.get(`${BASE}/rest/v1/student_semesters`, () =>
      HttpResponse.json([
        { semester_number: 1, cgpa: "8.20", status: "verified" },
        { semester_number: 2, cgpa: "8.60", status: "pending" },
      ]),
    ),
    http.get(`${BASE}/rest/v1/student_skill_scores`, () =>
      HttpResponse.json([{ score: "4.00", skill_areas: { name: "Java" } }]),
    ),
    http.get(`${BASE}/rest/v1/student_role_preferences`, () =>
      HttpResponse.json([{ category: "software_technical" }]),
    ),
    http.get(`${BASE}/rest/v1/applications`, () =>
      HttpResponse.json([
        {
          id: "a1",
          drive_id: "d1",
          applied_at: "2026-08-10T10:00:00Z",
          drives: { company_name: "Zoho", role_title: "MTS" },
          shortlist_entries: [{ included: true }],
        },
      ]),
    ),
    http.get(`${BASE}/rest/v1/offers`, () =>
      HttpResponse.json([
        {
          id: "o1",
          student_id: "s1",
          drive_id: "d1",
          source: "on_campus",
          drive_type: "placement",
          offer_category: "regular",
          ctc_lpa: "4.50",
          declared_at: "2026-08-15T10:00:00Z",
          company_name: null,
          role_title: null,
        },
      ]),
    ),
  );
}

describe("the student record view", () => {
  it("assembles the whole record from live rows", async () => {
    stubHappyPath();

    const record = await createSupabaseStudentRecordView(client()).record("s1");

    expect(record).not.toBeNull();
    expect(record?.fullName).toBe("Priya Ramesh");
    expect(record?.campusName).toBe("SDNB Vaishnav College");
    expect(record?.tenthPercentage).toBe(92.4);
    expect(record?.semesters).toEqual([
      { semesterNumber: 1, cgpa: 8.2, verified: true },
      { semesterNumber: 2, cgpa: 8.6, verified: false },
    ]);
    expect(record?.skills).toEqual([{ skill: "Java", score: 4 }]);
    expect(record?.rolePreferences).toEqual(["software_technical"]);
    expect(record?.applications).toEqual([
      {
        applicationId: "a1",
        driveId: "d1",
        companyName: "Zoho",
        roleTitle: "MTS",
        appliedAt: "2026-08-10T10:00:00Z",
        shortlisted: true,
        hasOffer: true,
      },
    ]);
    // The on-campus offer names its drive.
    expect(record?.placement).toMatchObject({ companyName: "Zoho", ctcLpa: 4.5 });
  });

  it("is null when the row does not come back — absent and refused look the same", async () => {
    server.use(http.get(`${BASE}/rest/v1/students`, () => HttpResponse.json([])));

    expect(await createSupabaseStudentRecordView(client()).record("missing")).toBeNull();
  });
});
