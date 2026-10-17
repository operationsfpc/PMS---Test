import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import {
  createSupabaseParticipationQueueView,
  OPT_OUT_QUEUE_COLUMNS,
  SELF_PLACEMENT_QUEUE_COLUMNS,
} from "./participation-view";

/**
 * The coordinator's opt-out and self-placement queue.
 *
 * Both approvals are irreversible in practice, and each has TWO consequences:
 * `students.participation_status` for an opt-out (which 0009 locks forever), an
 * `offers` row for a self-placement. If the second half fails silently, a
 * student is opted out with no record of it, or approved with no offer. So the
 * opt-out half moved into one atomic database call (0096) and the offer half
 * is asserted here as a second write the client has to make itself.
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
    placementUpdate?: unknown;
    placementUpdateFails?: boolean;
    approvalFails?: boolean;
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
    // 0096: approving an opt-out is one call, and the database does both
    // halves inside one transaction.
    http.post(`${BASE}/rest/v1/rpc/approve_opt_out_atomic`, async ({ request }) => {
      await record("approve_opt_out_atomic", request);
      return opts.approvalFails === true
        ? HttpResponse.json(
            { message: "Opt-out request not found or already decided" },
            { status: 400 },
          )
        : HttpResponse.json("s1");
    }),
    http.patch(`${BASE}/rest/v1/opt_out_requests`, async ({ request }) => {
      await record("opt_out_requests", request);
      return HttpResponse.json({ student_id: "s1" });
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
    // Nothing should reach this any more — kept so that a client-side second
    // write is recorded and asserted against, rather than erroring unhandled.
    http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
      await record("students", request);
      return HttpResponse.json({ id: "s1" });
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
          student_id: "s1",
          reason: "Joining the family business",
          // An array embed, because PostgREST may return a to-one either way.
          students: {
            full_name: "Anjali Subramanian",
            roll_number: "21CSE1042",
            campuses: [{ name: "PSG College of Technology" }],
          },
        },
      ],
    });

    const { optOuts } = await view().pending();

    expect(optOuts).toEqual([
      {
        id: "req-1",
        studentId: "s1",
        studentName: "Anjali Subramanian",
        rollNumber: "21CSE1042",
        college: "PSG College of Technology",
        reason: "Joining the family business",
        // No document embedded in this fixture, so there is nothing to sign.
        declarationUrl: null,
      },
    ]);
  });

  /**
   * The coordinator's queues run across every campus at once, so a name and a
   * roll number are not enough to say who is standing in front of them. The
   * college has to be read, not assumed.
   */
  it("asks the database for the college beside every queued student", async () => {
    const selects = new Map<string, string>();
    stub();
    // Registered after `stub`, so these win — the reads still answer empty.
    const record = (table: string) =>
      server.use(
        http.get(`${BASE}/rest/v1/${table}`, ({ request }) => {
          const search = new URL(request.url).searchParams.get("select");
          selects.set(table, decodeURIComponent(search ?? ""));
          return HttpResponse.json([]);
        }),
      );
    record("opt_out_requests");
    record("self_placement_requests");

    await view().pending();

    // supabase-js strips the spaces from the select before sending it.
    const sent = (columns: string) => columns.replace(/ /g, "");
    expect(selects.get("opt_out_requests")).toBe(sent(OPT_OUT_QUEUE_COLUMNS));
    expect(selects.get("self_placement_requests")).toBe(sent(SELF_PLACEMENT_QUEUE_COLUMNS));
  });

  it("shows a pending self-placement with the company and CTC", async () => {
    stub({
      placements: [
        {
          id: "sp-1",
          student_id: "s2",
          company_name: "Freshworks",
          ctc_lpa: 7.5,
          students: {
            full_name: "Rahul Nair",
            roll_number: "21CSE1099",
            campuses: { name: "Coimbatore Institute of Technology" },
          },
        },
      ],
    });

    const { selfPlacements } = await view().pending();

    expect(selfPlacements[0]?.companyName).toBe("Freshworks");
    expect(selfPlacements[0]?.ctcLpa).toBe(7.5);
    expect(selfPlacements[0]?.studentId).toBe("s2");
    expect(selfPlacements[0]?.college).toBe("Coimbatore Institute of Technology");
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
    // No college is invented for a student whose row never arrived.
    expect(optOuts[0]?.college).toBeNull();
    expect(selfPlacements[0]?.companyName).toBe("Unknown company");
    expect(selfPlacements[0]?.ctcLpa).toBe(0);
    expect(selfPlacements[0]?.college).toBeNull();
  });

  it("shows an empty queue as empty", async () => {
    stub();

    expect(await view().pending()).toEqual({ optOuts: [], selfPlacements: [] });
  });
});

describe("approving an opt-out", () => {
  it("makes the single atomic call that carries the decision and its doer (PRD §16.1)", async () => {
    const writes = stub();

    await view().approveOptOut("req-1");

    // 0096: the request and the student's `opted_out` status are written in one
    // database transaction, so a student can never be opted out with no record
    // of it. The client's whole job is to make that one call, attributed.
    expect(writes.map((w) => w.table)).toEqual(["approve_opt_out_atomic"]);
    expect(writes[0]?.body).toEqual({ request_id: "req-1", actor_id: "cpc-1" });
  });

  it("says so loudly when the database refuses the approval", async () => {
    stub({ approvalFails: true });

    await expect(view().approveOptOut("req-1")).rejects.toThrow(/could not approve/i);
  });

  it("writes nothing anywhere else when the approval failed", async () => {
    const writes = stub({ approvalFails: true });

    await expect(view().approveOptOut("req-1")).rejects.toThrow(/could not approve/i);
    // A client-side second write would put the atomicity back in JS's hands.
    expect(writes.map((w) => w.table)).toEqual(["approve_opt_out_atomic"]);
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
   * off-campus offer.
   *
   * D5/D6 (2026-08-12): a self-placed offer now climbs the ladder, so the
   * approving coordinator MUST classify it — job or internship, and for a job
   * which category rung it occupies.
   */
  it("creates the offer only on approval, carrying the coordinator's classification", async () => {
    const writes = stub();

    await view().approveSelfPlacement("sp-1", { driveType: "placement", offerCategory: "dream" });

    expect(writes.map((w) => w.table)).toEqual(["self_placement_requests", "offers"]);
    expect(writes[1]?.body).toMatchObject({
      student_id: "s1",
      drive_id: null,
      source: "self_placed",
      company_name: "Family Business",
      role_title: "Analyst",
      drive_type: "placement",
      offer_category: "dream",
      ctc_lpa: 4.5,
      approved_by: "cpc-1",
    });
  });

  it("records a self-placed internship on its own rung, never as a category", async () => {
    const writes = stub();

    await view().approveSelfPlacement("sp-1", { driveType: "internship", offerCategory: null });

    // 0067: a check refuses an internship row whose offer_category is anything
    // but 'internship', and the ladder orders it below every real rung — so an
    // internship cannot be used to claim a dream offer.
    expect(writes[1]?.body).toMatchObject({
      drive_type: "internship",
      offer_category: "internship",
      ctc_lpa: null,
    });
  });

  it("refuses a job offer with no category before anything is written (D6)", async () => {
    const writes = stub();

    await expect(
      view().approveSelfPlacement("sp-1", { driveType: "placement", offerCategory: null }),
    ).rejects.toThrow(/category/i);
    expect(writes).toHaveLength(0);
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

    await view().approveSelfPlacement("sp-1", { driveType: "placement", offerCategory: "regular" });

    expect(writes[1]?.body).toMatchObject({ role_title: null });
  });

  it("says so when the offer was not recorded, so it is never silently lost", async () => {
    stub({ offerInsertFails: true });

    await expect(
      view().approveSelfPlacement("sp-1", { driveType: "placement", offerCategory: "regular" }),
    ).rejects.toThrow(/not recorded/i);
  });

  it("does not write an offer when the approval itself failed", async () => {
    const writes = stub({ placementUpdateFails: true });

    await expect(
      view().approveSelfPlacement("sp-1", { driveType: "placement", offerCategory: "regular" }),
    ).rejects.toThrow(/could not approve/i);
    expect(writes.some((w) => w.table === "offers")).toBe(false);
  });

  it("refuses a role that may not approve", async () => {
    stub();

    await expect(
      view("account_executive").approveSelfPlacement("sp-1", {
        driveType: "placement",
        offerCategory: "regular",
      }),
    ).rejects.toThrow(/coordinator/i);
  });
});
