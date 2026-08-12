import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import {
  CertificateQueueError,
  createSupabaseCertificateQueueRepository,
} from "./certificate-queue-repository";

/**
 * The coordinator's certificate queue (asked for 2026-08-06).
 *
 * No campus filter is applied here: RLS already scopes a coordinator to their
 * own students, and re-filtering in the client would be a weaker duplicate of
 * a rule the database owns.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const repo = (actor: string | null = "cpc-1") =>
  createSupabaseCertificateQueueRepository(client(), async () => actor);

const ROW = {
  id: "c1",
  name: "AWS Cloud Practitioner",
  created_at: "2026-08-06T10:00:00Z",
  status: "pending",
  students: { full_name: "Priya Ramesh", roll_number: "21CSE1042" },
  student_documents: { storage_path: "s1/aws.pdf" },
};

function stub(opts: { rows?: unknown[]; signed?: unknown; updateStatus?: number } = {}): {
  updates: () => unknown[];
  query: () => string;
} {
  const updates: unknown[] = [];
  let query = "";

  server.use(
    http.get(`${BASE}/rest/v1/student_certificates`, ({ request }) => {
      query = new URL(request.url).search;
      return HttpResponse.json(opts.rows ?? [ROW]);
    }),
    http.post(`${BASE}/storage/v1/object/sign/marksheets`, () =>
      HttpResponse.json(opts.signed ?? [{ path: "s1/aws.pdf", signedURL: "/signed/aws.pdf" }]),
    ),
    http.patch(`${BASE}/rest/v1/student_certificates`, async ({ request }) => {
      updates.push(await request.clone().json());
      return opts.updateStatus === undefined
        ? HttpResponse.json([{ id: "c1" }])
        : new HttpResponse(null, { status: opts.updateStatus });
    }),
  );

  return { updates: () => updates, query: () => query };
}

describe("pending", () => {
  it("lists the certificates waiting to be checked, with a signed link to each", async () => {
    stub();

    const [certificate] = await repo().pending();

    expect(certificate?.studentName).toBe("Priya Ramesh");
    expect(certificate?.rollNumber).toBe("21CSE1042");
    expect(certificate?.name).toBe("AWS Cloud Practitioner");
    expect(certificate?.url).toContain("/signed/aws.pdf");
  });

  it("asks only for the ones still pending", async () => {
    const { query } = stub();

    await repo().pending();

    expect(query()).toContain("status=eq.pending");
  });

  /**
   * A certificate whose document cannot be signed shows as having none. A
   * coordinator must never believe they have checked something they have not.
   */
  it("reads an unsignable document as no document, never a dead link", async () => {
    stub({ signed: [] });

    expect((await repo().pending())[0]?.url).toBeNull();
  });

  it("survives a certificate whose student row did not come back", async () => {
    stub({ rows: [{ ...ROW, students: null }] });

    expect((await repo().pending())[0]?.studentName).toBe("Unknown student");
  });

  it("reports a failed load rather than an empty queue", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/student_certificates`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );

    await expect(repo().pending()).rejects.toThrow(CertificateQueueError);
  });
});

describe("decide", () => {
  it("verifies one, recording who checked it and when", async () => {
    const { updates } = stub();

    await repo().decide("c1", "pending", { decision: "verify" });

    const body = updates()[0] as Record<string, unknown>;
    expect(body.status).toBe("verified");
    expect(body.verified_by).toBe("cpc-1");
    expect(body.verified_at).toEqual(expect.any(String));
    expect(body.rejection_reason).toBeNull();
  });

  it("rejects one with the reason the student will read", async () => {
    const { updates } = stub();

    await repo().decide("c1", "pending", { decision: "reject", reason: "Not legible" });

    const body = updates()[0] as Record<string, unknown>;
    expect(body.status).toBe("rejected");
    expect(body.rejection_reason).toBe("Not legible");
  });

  /** The domain owns the transition; an invalid one must not reach the network. */
  it("refuses a rejection with no reason, without calling the database", async () => {
    const { updates } = stub();

    await expect(
      repo().decide("c1", "pending", { decision: "reject", reason: "  " }),
    ).rejects.toThrow(/needs a reason/i);
    expect(updates()).toEqual([]);
  });

  it("refuses to re-decide one that was already verified", async () => {
    const { updates } = stub();

    await expect(repo().decide("c1", "verified", { decision: "verify" })).rejects.toThrow(
      /already been decided/i,
    );
    expect(updates()).toEqual([]);
  });

  it("refuses to write with no session rather than recording an anonymous decision", async () => {
    stub();

    await expect(repo(null).decide("c1", "pending", { decision: "verify" })).rejects.toThrow(
      /sign in again/i,
    );
  });

  it("surfaces a failed write", async () => {
    stub({ updateStatus: 400 });

    await expect(repo().decide("c1", "pending", { decision: "verify" })).rejects.toThrow(
      CertificateQueueError,
    );
  });
});
