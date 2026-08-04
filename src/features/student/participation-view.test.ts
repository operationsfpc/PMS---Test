import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseParticipationView } from "./participation-view";

/**
 * The student's own participation, against live rows.
 *
 * Both actions here are gated by src/domain/participation.ts and by the
 * database independently. What this layer must get right is the state it feeds
 * those rules: a pending request read as "none" lets a student raise a second
 * opt-out, and an opted-out student read as "active" offers them a button that
 * the database will refuse.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

function stub(
  opts: {
    student?: Record<string, unknown> | null;
    requests?: unknown[];
    placements?: unknown[];
    writeFails?: boolean;
  } = {},
) {
  const writes: { table: string; body: unknown }[] = [];

  const write = async (table: string, request: Request) => {
    writes.push({ table, body: await request.clone().json() });
    return opts.writeFails === true
      ? new HttpResponse(null, { status: 400 })
      : HttpResponse.json({ id: "new-1" });
  };

  server.use(
    http.get(`${BASE}/rest/v1/students`, () =>
      HttpResponse.json(
        opts.student === undefined ? { participation_status: "active" } : opts.student,
      ),
    ),
    http.get(`${BASE}/rest/v1/opt_out_requests`, () => HttpResponse.json(opts.requests ?? [])),
    http.get(`${BASE}/rest/v1/self_placement_requests`, () =>
      HttpResponse.json(opts.placements ?? []),
    ),
    http.post(`${BASE}/rest/v1/opt_out_requests`, ({ request }) =>
      write("opt_out_requests", request),
    ),
    http.post(`${BASE}/rest/v1/self_placement_requests`, ({ request }) =>
      write("self_placement_requests", request),
    ),
  );

  return writes;
}

const view = (studentId: string | null = "s1") =>
  createSupabaseParticipationView(client(), async () => studentId);

const OFFER = { companyName: "Family Business", roleTitle: "Analyst", ctcLpa: 4.5 };

describe("reading the student's participation", () => {
  it("reports an active student as active", async () => {
    stub();

    expect((await view().status()).participationStatus).toBe("active");
  });

  it("defaults to active rather than crashing when the row does not come back", async () => {
    stub({ student: null });

    expect((await view().status()).participationStatus).toBe("active");
  });

  it("knows a request is already pending", async () => {
    stub({ requests: [{ id: "r1", status: "pending" }] });

    expect((await view().status()).hasPendingRequest).toBe(true);
  });

  it("does not count a decided request as pending", async () => {
    stub({ requests: [{ id: "r1", status: "rejected" }] });

    expect((await view().status()).hasPendingRequest).toBe(false);
  });

  it("shows a self-placement and whether a coordinator has verified it", async () => {
    stub({
      placements: [
        { id: "sp1", company_name: "Freshworks", ctc_lpa: 7.5, status: "verified" },
        { id: "sp2", company_name: "Zoho", ctc_lpa: 6, status: "pending" },
      ],
    });

    const { selfPlacements } = await view().status();

    expect(selfPlacements[0]).toEqual({
      id: "sp1",
      companyName: "Freshworks",
      ctcLpa: 7.5,
      approved: true,
    });
    expect(selfPlacements[1]?.approved).toBe(false);
  });

  it("survives a self-placement row with missing detail", async () => {
    stub({ placements: [{ id: "sp1", company_name: null, ctc_lpa: null, status: "pending" }] });
    const [placement] = (await view().status()).selfPlacements;

    expect(placement?.companyName).toBe("Unknown company");
    expect(placement?.ctcLpa).toBe(0);
  });

  it("refuses to answer for nobody", async () => {
    stub();

    await expect(view(null).status()).rejects.toThrow(/session has expired/i);
  });
});

describe("requesting an opt-out", () => {
  it("sends the reason with the request, as pending", async () => {
    const writes = stub();

    await view().requestOptOut("Joining the family business");

    expect(writes[0]?.body).toMatchObject({
      student_id: "s1",
      reason: "Joining the family business",
      status: "pending",
    });
  });

  it("refuses a second request while one is pending", async () => {
    const writes = stub({ requests: [{ id: "r1", status: "pending" }] });

    await expect(view().requestOptOut("Again")).rejects.toThrow(/already/i);
    expect(writes).toHaveLength(0);
  });

  it("refuses a student who has already opted out — it is irreversible", async () => {
    const writes = stub({ student: { participation_status: "opted_out" } });

    await expect(view().requestOptOut("Changed my mind")).rejects.toThrow(/opted out/i);
    expect(writes).toHaveLength(0);
  });

  it("says so when the request could not be sent", async () => {
    stub({ writeFails: true });

    await expect(view().requestOptOut("Reason")).rejects.toThrow(/could not send/i);
  });
});

describe("recording a self-placement", () => {
  /**
   * A18: raised as a REQUEST. The `offers` row — and with it the statistic —
   * is created only when a coordinator approves, because there is no drive to
   * corroborate an off-campus offer.
   */
  it("raises a request, not an offer", async () => {
    const writes = stub();

    await view().recordSelfPlacement(OFFER);

    expect(writes[0]?.table).toBe("self_placement_requests");
    expect(writes[0]?.body).toMatchObject({
      student_id: "s1",
      company_name: "Family Business",
      role_title: "Analyst",
      ctc_lpa: 4.5,
    });
  });

  it("stores an omitted role title as null, not as an empty string", async () => {
    const writes = stub();

    await view().recordSelfPlacement({ ...OFFER, roleTitle: "" });

    expect(writes[0]?.body).toMatchObject({ role_title: null });
  });

  /**
   * Deliberately allowed, and worth pinning because it reads like a bug:
   * opting out means leaving the CAMPUS process, not leaving the report. A
   * student who withdrew and then found their own job is exactly the
   * self-placement statistic PRD §16.2 asks for. Only disbarment refuses.
   */
  it("still lets a student who opted out report an offer they found themselves", async () => {
    const writes = stub({ student: { participation_status: "opted_out" } });

    await view().recordSelfPlacement(OFFER);

    expect(writes).toHaveLength(1);
  });

  it("refuses a disbarred student, who must speak to their coordinator", async () => {
    const writes = stub({ student: { participation_status: "disbarred" } });

    await expect(view().recordSelfPlacement(OFFER)).rejects.toThrow(/disbarred/i);
    expect(writes).toHaveLength(0);
  });

  it("says so when the offer could not be recorded", async () => {
    stub({ writeFails: true });

    await expect(view().recordSelfPlacement(OFFER)).rejects.toThrow(/could not record/i);
  });
});
