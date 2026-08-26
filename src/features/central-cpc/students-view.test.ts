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
});
