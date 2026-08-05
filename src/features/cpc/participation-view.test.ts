import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseParticipationQueueView } from "./participation-view";

/**
 * The coordinator's opt-out and self-placement queue.
 *
 * Both approvals are irreversible in practice, and each writes TWO rows: the
 * decision, and then the consequence — `students.participation_status` for an
 * opt-out (which 0009 locks forever), an `offers` row for a self-placement.
 * If the second write fails silently, a student is opted out with no record of
 * it, or approved with no offer. Both halves are asserted here.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

interface Recorded {
  readonly table: string;
  readonly method: string;
  readonly body: unknown;
}

function stub(
  opts: {
    optOuts?: unknown[];
    placements?: unknown[];
    optOutUpdateFails?: boolean;
    placementUpdate?: unknown;
    placementUpdateFails?: boolean;
    studentUpdateFails?: boolean;
    offerInsertFails?: boolean;
  } = {},
) {
  const writes: Recorded[] = [];

  const record = async (table: string, request: Request) => {
    writes.push({ table, method: request.method, body: await request.clone().json() });
  };

  server.use(
    http.get(`${BASE}/rest/v1/opt_out_requests`, () => HttpResponse.json(opts.optOuts ?? [])),
    http.get(`${BASE}/rest/v1/self_placement_requests`, () =>
      HttpResponse.json(opts.placements ?? []),
    ),
    http.patch(`${BASE}/rest/v1/opt_out_requests`, async ({ request }) => {
      await record("opt_out_requests", request);
      return opts.optOutUpdateFails === true
        ? new HttpResponse(null, { status: 400 })
        : HttpResponse.json({ student_id: "s1" });
    }),
    http.patch(`${BASE}/rest/v1/self_placement_requests`, async ({ request }) => {
      await record("self_placement_requests", request);
      if (opts.placementUpdateFails === true) return new HttpResponse(null, { status: 400 });
      return HttpResponse.json(
        opts.placementUpdate ?? {
          student_id: "s1",
          company_name: "Family Business",
          role_title: "Analyst",
          ctc_lpa: 4.5,
        },
      );
    }),
    http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
      await record("students", request);
      return opts.studentUpdateFails === true
        ? new HttpResponse(null, { status: 409 })
        : HttpResponse.json({ id: "s1" });
    }),
    http.post(`${BASE}/rest/v1/offers`, async ({ request }) => {
      await record("offers", request);
      return opts.offerInsertFails === true
        ? new HttpResponse(null, { status: 400 })
        : HttpResponse.json({ id: "o1" });
    }),
  );

  return writes;
}

/** Storage is stubbed at the client: signing is not what these tests are about. */
function signingClient() {
  const base = client();
  base.storage.from = ((bucket: string) => ({
    createSignedUrl: async (path: string) => ({
      data: { signedUrl: `https://signed/${bucket}/${path}` },
      error: null,
    }),
  })) as unknown as typeof base.storage.from;
  return base;
}

const view = (role = "campus_placement_coordinator", actorId: string | null = "cpc-1") =>
  createSupabaseParticipationQueueView(
    signingClient(),
    async () => actorId,
    async () => role as "campus_placement_coordinator",
  );

describe("the pending queue", () => {
  it("mints a signed URL for the evidence behind each request", async () => {
    stub({
      optOuts: [
        {
          id: "req-1",
          reason: "Higher studies",
          students: { full_name: "Anjali", roll_number: "21CSE1042" },
          student_documents: { storage_path: "declarations/s1/declaration.jpg" },
        },
      ],
      placements: [
        {
          id: "sp-1",
          company_name: "Freshworks",
          ctc_lpa: 7.5,
          students: { full_name: "Rahul", roll_number: "21CSE1099" },
          student_documents: { storage_path: "offer-letters/s1/offer.pdf" },
        },
      ],
    });

    const { optOuts, selfPlacements } = await view().pending();

    expect(optOuts[0]?.declarationUrl).toBe("https://signed/declarations/s1/declaration.jpg");
    expect(selfPlacements[0]?.offerLetterUrl).toBe("https://signed/offer-letters/s1/offer.pdf");
  });

  it("reports a request with no document rather than a dead link", async () => {
    stub({
      optOuts: [
        {
          id: "req-1",
          reason: "Higher studies",
          students: null,
          student_documents: null,
        },
      ],
    });

    expect((await view().pending()).optOuts[0]?.declarationUrl).toBeNull();
  });

  it("shows a pending opt-out with the student and their reason", async () => {
    stub({
      optOuts: [
        {
          id: "req-1",
          reason: "Joining the family business",
          students: { full_name: "Anjali Subramanian", roll_number: "21CSE1042" },
        },
      ],
    });

    const { optOuts } = await view().pending();

    expect(optOuts).toEqual([
      {
        id: "req-1",
        studentName: "Anjali Subramanian",
        rollNumber: "21CSE1042",
        reason: "Joining the family business",
        // No document embedded in this fixture, so there is nothing to sign.
        declarationUrl: null,
      },
    ]);
  });

  it("shows a pending self-placement with the company and CTC", async () => {
    stub({
      placements: [
        {
          id: "sp-1",
          company_name: "Freshworks",
          ctc_lpa: 7.5,
          students: { full_name: "Rahul Nair", roll_number: "21CSE1099" },
        },
      ],
    });

    const { selfPlacements } = await view().pending();

    expect(selfPlacements[0]?.companyName).toBe("Freshworks");
    expect(selfPlacements[0]?.ctcLpa).toBe(7.5);
  });

  it("still shows a request whose student row did not come back", async () => {
    stub({
      optOuts: [{ id: "req-1", reason: null, students: null }],
      placements: [{ id: "sp-1", company_name: null, ctc_lpa: null, students: null }],
    });

    const { optOuts, selfPlacements } = await view().pending();

    expect(optOuts[0]?.studentName).toBe("Unknown student");
    expect(optOuts[0]?.rollNumber).toBe("—");
    expect(optOuts[0]?.reason).toBe("");
    expect(selfPlacements[0]?.companyName).toBe("Unknown company");
    expect(selfPlacements[0]?.ctcLpa).toBe(0);
  });

  it("shows an empty queue as empty", async () => {
    stub();

    expect(await view().pending()).toEqual({ optOuts: [], selfPlacements: [] });
  });
});

describe("approving an opt-out", () => {
  it("records the decision and then opts the student out (PRD §16.1)", async () => {
    const writes = stub();

    await view().approveOptOut("req-1");

    expect(writes.map((w) => w.table)).toEqual(["opt_out_requests", "students"]);
    expect(writes[0]?.body).toMatchObject({ status: "verified", decided_by: "cpc-1" });
    expect(writes[1]?.body).toEqual({ participation_status: "opted_out" });
  });

  it("says so loudly when the student's status did not change", async () => {
    stub({ studentUpdateFails: true });

    await expect(view().approveOptOut("req-1")).rejects.toThrow(/did not change/i);
  });

  it("refuses a role that may not approve participation changes", async () => {
    stub();

    await expect(view("student").approveOptOut("req-1")).rejects.toThrow(/coordinator/i);
  });

  it("refuses when the session has gone, rather than writing an unattributed decision", async () => {
    stub();

    await expect(view("campus_placement_coordinator", null).approveOptOut("req-1")).rejects.toThrow(
      /session has expired/i,
    );
  });

  it("does not touch the student when the decision itself failed", async () => {
    const writes = stub({ optOutUpdateFails: true });

    await expect(view().approveOptOut("req-1")).rejects.toThrow(/could not approve/i);
    expect(writes.map((w) => w.table)).toEqual(["opt_out_requests"]);
  });
});

/**
 * F1 (UAT 2026-08-06): "decline button with reason. The status of approval or
 * rejection should go to student."
 */
describe("declining an opt-out", () => {
  it("records the decline against the coordinator who made it", async () => {
    const writes = stub();

    await view().declineOptOut("req-1", "Your declaration was not signed.");

    expect(writes[0]?.body).toMatchObject({ status: "rejected", decided_by: "cpc-1" });
  });

  /** The reason is the message to the student, so it must survive the trip. */
  it("stores the reason the student will be shown", async () => {
    const writes = stub();

    await view().declineOptOut("req-1", "Your declaration was not signed.");

    expect(writes[0]?.body).toMatchObject({
      decision_reason: "Your declaration was not signed.",
    });
  });

  it("refuses to decline with no reason, before touching the database", async () => {
    const writes = stub();

    await expect(view().declineOptOut("req-1", "   ")).rejects.toThrow(/reason/i);
    expect(writes).toHaveLength(0);
  });

  it("refuses anyone who is not a placement coordinator", async () => {
    stub();

    await expect(view("student").declineOptOut("req-1", "Not enough evidence")).rejects.toThrow(
      /coordinator/i,
    );
  });

  it("leaves the student untouched", async () => {
    const writes = stub();

    await view().declineOptOut("req-1", "Your declaration was not signed.");

    expect(writes.some((w) => w.table === "students")).toBe(false);
  });
});

describe("declining an off-campus offer", () => {
  it("records the decline and the reason, and creates no offer", async () => {
    const writes = stub();

    await view().declineSelfPlacement("sp-1", "The letter has no CTC on it.");

    expect(writes[0]?.body).toMatchObject({
      status: "rejected",
      decided_by: "cpc-1",
      decision_reason: "The letter has no CTC on it.",
    });
    expect(writes.some((w) => w.table === "offers")).toBe(false);
  });

  it("refuses to decline with no reason", async () => {
    const writes = stub();

    await expect(view().declineSelfPlacement("sp-1", "no")).rejects.toThrow(/reason/i);
    expect(writes).toHaveLength(0);
  });
});

describe("approving a self-placement", () => {
  /**
   * A18: the offer row is created HERE, on approval, and never when the
   * student raises the request - there is no drive to corroborate an
   * off-campus offer. It is written as `self_placed` so R3, R4 and R9 continue
   * to ignore it: a self-placed student is still eligible for every on-campus
   * drive (PRD §16.2).
   */
  it("creates the offer only on approval, as a self-placed one with no category", async () => {
    const writes = stub();

    await view().approveSelfPlacement("sp-1");

    expect(writes.map((w) => w.table)).toEqual(["self_placement_requests", "offers"]);
    expect(writes[1]?.body).toMatchObject({
      student_id: "s1",
      drive_id: null,
      source: "self_placed",
      company_name: "Family Business",
      role_title: "Analyst",
      offer_category: null,
      ctc_lpa: 4.5,
      approved_by: "cpc-1",
    });
  });

  it("records a missing role title as null rather than the string 'null'", async () => {
    const writes = stub({
      placementUpdate: {
        student_id: "s1",
        company_name: "Family Business",
        role_title: null,
        ctc_lpa: 4,
      },
    });

    await view().approveSelfPlacement("sp-1");

    expect(writes[1]?.body).toMatchObject({ role_title: null });
  });

  it("says so when the offer was not recorded, so it is never silently lost", async () => {
    stub({ offerInsertFails: true });

    await expect(view().approveSelfPlacement("sp-1")).rejects.toThrow(/not recorded/i);
  });

  it("does not write an offer when the approval itself failed", async () => {
    const writes = stub({ placementUpdateFails: true });

    await expect(view().approveSelfPlacement("sp-1")).rejects.toThrow(/could not approve/i);
    expect(writes.some((w) => w.table === "offers")).toBe(false);
  });

  it("refuses a role that may not approve", async () => {
    stub();

    await expect(view("account_executive").approveSelfPlacement("sp-1")).rejects.toThrow(
      /coordinator/i,
    );
  });
});
