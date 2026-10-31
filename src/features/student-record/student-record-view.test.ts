import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseStudentRecordView, StudentRecordError } from "./student-record-view";

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
          drives: {
            company_name: "Zoho",
            role_title: "MTS",
            company_drive_id: "e1",
            tentative_date: "2026-09-01",
          },
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
    http.get(`${BASE}/rest/v1/student_documents`, () => HttpResponse.json([])),
    http.get(`${BASE}/rest/v1/student_certificates`, () => HttpResponse.json([])),
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
        companyDriveId: "e1",
        tentativeDate: "2026-09-01",
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

  /**
   * Only the student row itself is allowed to be silent, because there a
   * refusal and an absent row are the same answer to a stranger probing URLs.
   * The satellites are not: a refused read used to return a record with an
   * empty skills list, and the page said "no skill scores recorded" about a
   * student whose scores exist.
   */
  describe("when a part of the record cannot be read", () => {
    it("raises instead of returning a record that quietly lacks a section", async () => {
      stubHappyPath();
      server.use(
        http.get(
          `${BASE}/rest/v1/student_skill_scores`,
          () => new HttpResponse(null, { status: 401 }),
        ),
      );

      await expect(createSupabaseStudentRecordView(client()).record("s1")).rejects.toBeInstanceOf(
        StudentRecordError,
      );
    });

    it("names the record it could not read, not the student", async () => {
      stubHappyPath();
      server.use(http.get(`${BASE}/rest/v1/offers`, () => new HttpResponse(null, { status: 401 })));

      await expect(createSupabaseStudentRecordView(client()).record("s1")).rejects.toThrow(
        /full record/i,
      );
    });
  });

  describe("reading a record bigger than one page", () => {
    /** Answers `readAllRows` page by page, the way PostgREST does. */
    function paged(table: string, all: unknown[], urls: string[]) {
      return http.get(`${BASE}/rest/v1/${table}`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        const offset = Number(params.get("offset") ?? "0");
        const limit = Number(params.get("limit") ?? String(all.length));
        urls.push(request.url);
        return HttpResponse.json(all.slice(offset, offset + limit));
      });
    }

    it("asks for the first page at the cap, not everything at once", async () => {
      stubHappyPath();
      const urls: string[] = [];
      server.use(paged("student_semesters", [], urls));

      await createSupabaseStudentRecordView(client()).record("s1");

      expect(urls[0]).toContain("offset=0&limit=1000");
    });

    it("keeps the semesters past the first thousand rows", async () => {
      stubHappyPath();
      const many = Array.from({ length: 1400 }, (_, i) => ({
        semester_number: i + 1,
        cgpa: "8.00",
        status: "verified",
      }));
      const urls: string[] = [];
      server.use(paged("student_semesters", many, urls));

      const record = await createSupabaseStudentRecordView(client()).record("s1");

      expect(urls).toHaveLength(2);
      expect(record?.semesters).toHaveLength(1400);
      expect(record?.semesters.at(-1)?.semesterNumber).toBe(1400);
    });

    it("keeps the applications past the first thousand rows", async () => {
      stubHappyPath();
      const many = Array.from({ length: 1250 }, (_, i) => ({
        id: `a${i}`,
        drive_id: `d${i}`,
        applied_at: "2026-08-10T10:00:00Z",
        drives: { company_name: `Company ${i}`, role_title: null },
        shortlist_entries: [],
      }));
      server.use(paged("applications", many, []));

      const record = await createSupabaseStudentRecordView(client()).record("s1");

      expect(record?.applications).toHaveLength(1250);
      expect(record?.applications.at(-1)?.companyName).toBe("Company 1249");
    });
  });
});
