import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseStudentDirectoryView } from "./students-view";

/**
 * The student directory, read live.
 *
 * 2026-08-26: the placement overview's Self-placed card opens this list, and
 * that card counts every student holding a self-placed offer - including one
 * who ALSO holds an on-campus record, whose displayed placement is the
 * on-campus one (C1 / `resolveDisplayedPlacement`). So "is self-placed" cannot
 * be read off the displayed row; it is its own fact, carried from the offers.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const student = (id: string, name: string) => ({
  id,
  full_name: name,
  roll_number: `21CSE${id}`,
  passing_year: 2026,
  overall_cgpa: 8.45,
  srf_status: "srf_approved",
  participation_status: "active",
  campuses: { name: "SDNB Vaishnav College" },
  degrees: { name: "B.E." },
  branches: { name: "CSE" },
});

const offer = (over: Record<string, unknown>) => ({
  id: "o1",
  student_id: "s1",
  drive_id: null,
  source: "self_placed",
  drive_type: "placement",
  offer_category: "regular",
  ctc_lpa: 4.8,
  declared_at: "2026-08-01T00:00:00.000Z",
  company_name: "Freshworks",
  role_title: null,
  ...over,
});

function stub(students: unknown[], offers: unknown[]) {
  server.use(
    http.get(`${BASE}/rest/v1/students`, () => HttpResponse.json(students)),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(offers)),
    http.get(`${BASE}/rest/v1/applications`, () => HttpResponse.json([])),
    http.get(`${BASE}/rest/v1/drives`, () =>
      HttpResponse.json([{ id: "d1", company_name: "Zoho Corporation", role_title: "MTS" }]),
    ),
  );
}

describe("createSupabaseStudentDirectoryView", () => {
  it("reports a self-placed offer as a fact of its own", async () => {
    stub([student("s1", "Thanush Krishna")], [offer({})]);

    const [row] = await createSupabaseStudentDirectoryView(client()).students();

    expect(row?.hasSelfPlacement).toBe(true);
    expect(row?.placement?.source).toBe("self_placed");
  });

  /**
   * The case the flag exists for: the on-campus record is displayed, and the
   * student must still appear in the list the Self-placed card opens.
   */
  it("keeps the fact when an on-campus record is the one displayed", async () => {
    stub(
      [student("s1", "Divya Ramesh")],
      [
        offer({ id: "o1", source: "self_placed", ctc_lpa: 4.8 }),
        offer({ id: "o2", source: "on_campus", drive_id: "d1", ctc_lpa: 9 }),
      ],
    );

    const [row] = await createSupabaseStudentDirectoryView(client()).students();

    expect(row?.placement?.source).toBe("on_campus");
    expect(row?.hasSelfPlacement).toBe(true);
  });

  it("is false for a student with no self-placed offer", async () => {
    stub([student("s1", "Anjali Subramanian")], [offer({ source: "on_campus", drive_id: "d1" })]);

    const [row] = await createSupabaseStudentDirectoryView(client()).students();

    expect(row?.hasSelfPlacement).toBe(false);
  });

  it("is false for a student holding no offers at all", async () => {
    stub([student("s1", "Rahul Nair")], []);

    const [row] = await createSupabaseStudentDirectoryView(client()).students();

    expect(row?.hasSelfPlacement).toBe(false);
    expect(row?.placement).toBeNull();
  });

  /**
   * 2026-10-18 (UAT): the overview's counts open a popup that prints a CGPA
   * column, and this directory is the list that popup links into. The figure
   * has to be READ — a select that never asks for it leaves the directory
   * silent while the popup beside it quotes a number.
   */
  it("asks for the overall CGPA and carries it on the row", async () => {
    let asked = "";
    server.use(
      http.get(`${BASE}/rest/v1/students`, ({ request }) => {
        asked = new URL(request.url).searchParams.get("select") ?? "";
        return HttpResponse.json([student("s1", "Priya Ramesh")]);
      }),
      http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json([])),
      http.get(`${BASE}/rest/v1/applications`, () => HttpResponse.json([])),
    );

    const [row] = await createSupabaseStudentDirectoryView(client()).students();

    expect(asked).toContain("overall_cgpa");
    expect(row?.cgpa).toBe(8.45);
  });

  it("leaves the CGPA null when the roster records none", async () => {
    stub([{ ...student("s1", "Rahul Nair"), overall_cgpa: null }], []);

    const [row] = await createSupabaseStudentDirectoryView(client()).students();

    expect(row?.cgpa).toBeNull();
  });
});

/**
 * #79 (UAT 2026-10-18): the directory's CSV carries the CV as well as the
 * figures. A student may hold one resume PER ROLE CATEGORY (0003's
 * `one_resume_per_category`), so the link a coordinator sends is the one they
 * uploaded last — the file they would attach today.
 */
describe("resumeLinks", () => {
  /** A storage that signs every path it is asked for, and records the batches. */
  function signingClient(batches: string[][]) {
    const c = client();
    c.storage.from = ((_bucket: string) => ({
      createSignedUrls: async (paths: string[]) => {
        batches.push(paths);
        return {
          data: paths.map((path) => ({ path, signedUrl: `https://x/${path}`, error: null })),
          error: null,
        };
      },
    })) as unknown as typeof c.storage.from;
    return c;
  }

  const document = (studentId: string, path: string, uploadedAt: string) => ({
    student_id: studentId,
    storage_path: path,
    uploaded_at: uploadedAt,
  });

  it("links each student to the resume they uploaded last", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/student_documents`, () =>
        HttpResponse.json([
          document("s1", "resumes/s1/2026-march.pdf", "2026-03-01T00:00:00Z"),
          document("s1", "resumes/s1/2026-september.pdf", "2026-09-01T00:00:00Z"),
          document("s2", "resumes/s2/cv.pdf", "2026-05-01T00:00:00Z"),
        ]),
      ),
    );
    const batches: string[][] = [];

    const links = await createSupabaseStudentDirectoryView(signingClient(batches)).resumeLinks?.([
      "s1",
      "s2",
    ]);

    expect(links?.get("s1")).toBe("https://x/s1/2026-september.pdf");
    expect(links?.get("s2")).toBe("https://x/s2/cv.pdf");
  });

  it("asks for resumes only, by student, newest first", async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${BASE}/rest/v1/student_documents`, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json([]);
      }),
    );

    await createSupabaseStudentDirectoryView(client()).resumeLinks?.(["s1"]);

    const asked = decodeURIComponent(urls[0] ?? "");
    expect(asked).toContain("kind=eq.resume");
    expect(asked).toContain("student_id=in.");
    expect(asked).toContain("order=uploaded_at");
  });

  /**
   * The #34 class, on the read this column adds: two hundred and fifty student
   * ids in one URL is a URL the gateway refuses, and a refused list arrives
   * empty — which would read as a roster whose nobody has a CV.
   */
  it("splits a long roster into addressable batches", async () => {
    const ids: string[] = [];
    const urls: string[] = [];
    for (let i = 0; i < 250; i += 1) ids.push(`s${i}`);
    server.use(
      http.get(`${BASE}/rest/v1/student_documents`, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json([]);
      }),
    );

    await createSupabaseStudentDirectoryView(client()).resumeLinks?.(ids);

    expect(urls).toHaveLength(2);
    for (const url of urls) {
      const list = decodeURIComponent(new URL(url).searchParams.get("student_id") ?? "");
      expect(list.split(",").length).toBeLessThanOrEqual(200);
    }
  });

  it("answers with nothing for a directory with no students", async () => {
    const batches: string[][] = [];

    const links = await createSupabaseStudentDirectoryView(signingClient(batches)).resumeLinks?.(
      [],
    );

    expect(links?.size).toBe(0);
    expect(batches).toEqual([]);
  });
});
