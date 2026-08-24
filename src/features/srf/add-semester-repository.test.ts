import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseAddSemesterView } from "./add-semester-repository";

/**
 * A semester added after approval. F13 (UAT 2026-08-06).
 *
 * The marksheet goes to storage first, then the document row, then the
 * semester line pointing at it. `student_semesters.marksheet_id` is NOT NULL
 * (0023), so a line without its document cannot be written at all — which is
 * the correct outcome, not something to work around.
 */
const BASE = "https://project.supabase.co";

function stub(opts: { uploadFails?: boolean; insertFails?: boolean } = {}) {
  const writes: Array<{ table: string; body: Record<string, unknown> }> = [];
  const uploads: string[] = [];

  const client = createClient(BASE, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  client.storage.from = ((bucket: string) => ({
    upload: async (path: string) => {
      uploads.push(`${bucket}/${path}`);
      return opts.uploadFails === true
        ? { data: null, error: new Error("network") }
        : { data: { path }, error: null };
    },
  })) as unknown as typeof client.storage.from;

  server.use(
    http.post(`${BASE}/rest/v1/student_documents`, async ({ request }) => {
      writes.push({
        table: "student_documents",
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json({ id: "doc-1" });
    }),
    http.post(`${BASE}/rest/v1/student_semesters`, async ({ request }) => {
      writes.push({
        table: "student_semesters",
        body: (await request.json()) as Record<string, unknown>,
      });
      return opts.insertFails === true
        ? HttpResponse.json({ message: "duplicate key", code: "23505" }, { status: 409 })
        : HttpResponse.json({ id: "sem-1" });
    }),
  );

  return { client, writes, uploads };
}

const semester = {
  semesterNumber: 5,
  marks: 8.4,
  currentArrears: 1,
  historyOfArrears: 2,
  marksheet: new File(["scan"], "sem5.pdf", { type: "application/pdf" }),
};

const view = (client: ReturnType<typeof stub>["client"], scale: "cgpa" | "percentage" = "cgpa") =>
  createSupabaseAddSemesterView(client, async () => "student-1", scale);

describe("createSupabaseAddSemesterView", () => {
  it("uploads the marksheet under the student's own folder", async () => {
    const { client, uploads } = stub();

    await view(client).add(semester);

    expect(uploads[0]).toMatch(/^marksheets\/student-1\//);
  });

  it("records the document as a semester marksheet", async () => {
    const { client, writes } = stub();

    await view(client).add(semester);

    expect(writes[0]).toMatchObject({
      table: "student_documents",
      body: { student_id: "student-1", kind: "semester_marksheet" },
    });
  });

  /**
   * Both, deliberately: `cgpa` is the only figure a cutoff can be compared
   * against, `declared_marks` is what the student typed and what the
   * coordinator finds on the marksheet.
   */
  it("stores the declared figure and the comparable one", async () => {
    const { client, writes } = stub();

    await view(client, "percentage").add({ ...semester, marks: 65 });

    expect(writes[1]?.body).toMatchObject({
      declared_marks: 65,
      marks_scale: "percentage",
      cgpa: 6.84,
    });
  });

  it("points the semester line at the marksheet that evidences it", async () => {
    const { client, writes } = stub();

    await view(client).add(semester);

    expect(writes[1]?.body).toMatchObject({
      student_id: "student-1",
      semester_number: 5,
      current_arrears: 1,
      history_of_arrears: 2,
      marksheet_id: "doc-1",
    });
  });

  /** F13: "these marks have to be verified". It arrives pending, always. */
  it("never writes a verified line", async () => {
    const { client, writes } = stub();

    await view(client).add(semester);

    expect(writes[1]?.body.status).toBe("pending");
    expect(writes[1]?.body.verified_by).toBeUndefined();
  });

  it("writes no semester line when the marksheet cannot be uploaded", async () => {
    const { client, writes } = stub({ uploadFails: true });

    await expect(view(client).add(semester)).rejects.toThrow(/marksheet/i);
    expect(writes).toHaveLength(0);
  });

  it("says plainly when the semester is already on the record", async () => {
    const { client } = stub({ insertFails: true });

    await expect(view(client).add(semester)).rejects.toThrow(/already/i);
  });

  it("refuses to write for nobody", async () => {
    const { client } = stub();

    await expect(
      createSupabaseAddSemesterView(client, async () => null, "cgpa").add(semester),
    ).rejects.toThrow(/session/i);
  });
});

/**
 * 2026-08-24 (0061): a REJECTED semester's number is declared again. The
 * rejected line is the student's to remove — the unique key would otherwise
 * block the corrected figure for good — so the add clears it first.
 */
describe("re-declaring a rejected semester", () => {
  it("deletes any rejected line for that number before inserting, scoped tight", async () => {
    const { client, writes } = stub();
    let deleteSearch: string | null = null;
    server.use(
      http.delete(`${BASE}/rest/v1/student_semesters`, ({ request }) => {
        deleteSearch = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );

    await view(client).add(semester);

    expect(deleteSearch).not.toBeNull();
    expect(deleteSearch).toContain("semester_number=eq.5");
    expect(deleteSearch).toContain("status=eq.rejected");
    // The corrected line still lands.
    expect(writes.some((w) => w.table === "student_semesters")).toBe(true);
  });
});
