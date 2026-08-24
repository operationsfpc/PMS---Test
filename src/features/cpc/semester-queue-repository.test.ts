import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import {
  createSupabaseSemesterQueueRepository,
  SemesterQueueError,
} from "./semester-queue-repository";

/**
 * The coordinator's semester (CGPA) queue — 2026-08-24 UAT: "add request by
 * students for cgpa … is not showing up for approval. similar request for
 * certifications is showing up. but cgpa is not."
 *
 * Modelled on the certificate queue. No campus filter here: RLS scopes the
 * coordinator to their own students. SRF-SUBMITTED students are excluded —
 * their declared semesters are decided wholesale by SRF approval (0031), and
 * a row in two queues would be decided twice.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const repo = (actor: string | null = "cpc-1") =>
  createSupabaseSemesterQueueRepository(client(), async () => actor);

const ROW = {
  id: "sem-1",
  semester_number: 3,
  cgpa: 7.5,
  declared_marks: 75,
  marks_scale: "percentage",
  current_arrears: 0,
  history_of_arrears: 1,
  created_at: "2026-08-24T07:00:00Z",
  status: "pending",
  students: { full_name: "Thanush Krishna", roll_number: "124", srf_status: "srf_approved" },
  student_documents: { storage_path: "s1/sem-3.pdf" },
};

function stub(opts: { rows?: unknown[]; updateStatus?: number } = {}): {
  updates: () => unknown[];
  query: () => string;
} {
  const updates: unknown[] = [];
  let query = "";

  server.use(
    http.get(`${BASE}/rest/v1/student_semesters`, ({ request }) => {
      query = new URL(request.url).search;
      return HttpResponse.json(opts.rows ?? [ROW]);
    }),
    http.post(`${BASE}/storage/v1/object/sign/marksheets`, () =>
      HttpResponse.json([{ path: "s1/sem-3.pdf", signedURL: "/signed/sem-3.pdf" }]),
    ),
    http.patch(`${BASE}/rest/v1/student_semesters`, async ({ request }) => {
      updates.push(await request.clone().json());
      return opts.updateStatus === undefined
        ? HttpResponse.json([{ id: "sem-1" }])
        : new HttpResponse(null, { status: opts.updateStatus });
    }),
  );

  return { updates: () => updates, query: () => query };
}

describe("pending", () => {
  it("lists pending semesters of APPROVED students, oldest first, marksheet signed", async () => {
    const { query } = stub();

    const rows = await repo().pending();

    expect(rows).toEqual([
      {
        id: "sem-1",
        studentName: "Thanush Krishna",
        rollNumber: "124",
        semesterNumber: 3,
        cgpa: 7.5,
        declaredMarks: 75,
        marksScale: "percentage",
        currentArrears: 0,
        historyOfArrears: 1,
        uploadedAt: "2026-08-24T07:00:00Z",
        url: expect.stringContaining("/signed/sem-3.pdf"),
      },
    ]);
    expect(query()).toContain("status=eq.pending");
    expect(query()).toContain("srf_status=eq.srf_approved");
  });

  it("survives a marksheet that cannot be signed — the row still appears", async () => {
    stub({ rows: [{ ...ROW, student_documents: null }] });

    const rows = await repo().pending();
    expect(rows[0]?.url).toBeNull();
  });
});

describe("decide", () => {
  it("verifies: status, decider and moment", async () => {
    const { updates } = stub();

    await repo().decide("sem-1", "pending", { decision: "verify" });

    const body = updates()[0] as Record<string, unknown>;
    expect(body.status).toBe("verified");
    expect(body.verified_by).toBe("cpc-1");
    expect(body.rejection_reason).toBeNull();
  });

  it("rejects with the reason the student will read", async () => {
    const { updates } = stub();

    await repo().decide("sem-1", "pending", { decision: "reject", reason: "Marksheet says 6.9" });

    const body = updates()[0] as Record<string, unknown>;
    expect(body.status).toBe("rejected");
    expect(body.rejection_reason).toBe("Marksheet says 6.9");
  });

  it("refuses an empty rejection before the network is touched", async () => {
    const { updates } = stub();

    await expect(
      repo().decide("sem-1", "pending", { decision: "reject", reason: " " }),
    ).rejects.toBeInstanceOf(SemesterQueueError);
    expect(updates()).toHaveLength(0);
  });

  it("refuses to re-decide a decided row", async () => {
    const { updates } = stub();

    await expect(repo().decide("sem-1", "verified", { decision: "verify" })).rejects.toBeInstanceOf(
      SemesterQueueError,
    );
    expect(updates()).toHaveLength(0);
  });
});
