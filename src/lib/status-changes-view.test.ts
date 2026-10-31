import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../mocks/node";
import {
  createSupabaseStatusChangesView,
  OFFER_WITHDRAWAL_COLUMNS,
  PARTICIPATION_CHANGE_COLUMNS,
  StatusChangesError,
} from "./status-changes-view";

/**
 * The two status ledgers, read and written against live data (0133, 0134).
 *
 * What is provable from the browser is only ever the arguments, because the
 * database decides the permission: WHO moved the standing, WHICH student, and
 * the sentence the RPC raised when it refused. The page tests prove the dialog;
 * these prove that the dialog is talking to the right function with the reason
 * the person typed, and that a ledger row is never invented.
 */
const BASE = "https://changes.test.supabase.co";

const view = () => createSupabaseStatusChangesView(createClient(BASE, "anon-key"));

/** One row of `participation_status_changes`, as PostgREST answers it. */
const CHANGE_ROW = {
  id: "c1",
  from_status: "opted_out",
  to_status: "active",
  reason: "Opted out at counselling by mistake — confirmed with the student on 3 Nov.",
  changed_at: "2026-10-20T09:00:00Z",
  // Supabase returns a to-one embed as an object or a one-element array
  // depending on the day, so the parser has to answer for both.
  changed_by: { full_name: "Karthik Subramanian" },
};

/**
 * One row of `offer_withdrawals`. The pay is NOT a column: 0134 archives the
 * offer as a jsonb snapshot, and numeric columns arrive as strings.
 */
const WITHDRAWAL_ROW = {
  id: "w1",
  company_name: "TCS",
  role_title: "Software Engineer",
  source: "on_campus",
  reason: "Company retracted the joining — confirmed in writing.",
  withdrawn_at: "2026-10-25T09:00:00Z",
  offer: { drive_type: "placement", ctc_lpa: "9.00", stipend_monthly: null },
  withdrawn_by: [{ full_name: "Meena Krishnan" }],
};

function stubLedgers(
  changes: readonly unknown[] = [CHANGE_ROW],
  withdrawals: readonly unknown[] = [WITHDRAWAL_ROW],
): { queries: URLSearchParams[] } {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(`${BASE}/rest/v1/participation_status_changes`, ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json(changes);
    }),
    http.get(`${BASE}/rest/v1/offer_withdrawals`, ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json(withdrawals);
    }),
  );
  return { queries };
}

function stubRpc(name: string, respond: () => Response): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  server.use(
    http.post(`${BASE}/rest/v1/rpc/${name}`, async ({ request }) => {
      bodies.push((await request.clone().json()) as Record<string, unknown>);
      return respond();
    }),
  );
  return bodies;
}

/** A PostgREST failure carries the sentence the RPC raised, which is the user's. */
const refused = (message: string): Response =>
  HttpResponse.json({ code: "P0001", message, details: null, hint: null }, { status: 400 });

describe("status changes view", () => {
  it("merges both ledgers newest first, with the author's name rather than their id", async () => {
    stubLedgers();

    const events = await view().historyFor("s1");

    expect(events.map((event) => event.id)).toEqual(["withdrawal-w1", "change-c1"]);
    expect(events[0]).toMatchObject({
      title: "Offer withdrawn",
      detail: "TCS · Software Engineer · ₹9 LPA · on campus",
      byName: "Meena Krishnan",
      tone: "warning",
    });
    expect(events[1]).toMatchObject({
      title: "Status changed",
      detail: "Opted out → In the pipeline",
      byName: "Karthik Subramanian",
      reason: "Opted out at counselling by mistake — confirmed with the student on 3 Nov.",
      tone: "neutral",
    });
  });

  it("asks each ledger for its own author and the newest rows first", async () => {
    const { queries: urls } = stubLedgers();
    await view().historyFor("s1");

    const [changes, withdrawals] = urls;
    // supabase-js compacts the select it was handed before it goes on the wire.
    expect(changes?.get("select")).toBe(PARTICIPATION_CHANGE_COLUMNS.replaceAll(", ", ","));
    expect(changes?.get("student_id")).toBe("eq.s1");
    expect(changes?.get("order")).toBe("changed_at.desc");
    expect(withdrawals?.get("select")).toBe(OFFER_WITHDRAWAL_COLUMNS.replaceAll(", ", ","));
    expect(withdrawals?.get("order")).toBe("withdrawn_at.desc");
  });

  /**
   * An internship's `ctc_lpa` is a zero the NOT NULL column forced somebody
   * to type. The snapshot is what tells the truth, so the line quotes the
   * stipend — a withdrawn internship must not read as a ₹0 LPA offer.
   */
  it("quotes a withdrawn internship by its stipend, not by the zero its column holds", async () => {
    stubLedgers(
      [],
      [
        {
          ...WITHDRAWAL_ROW,
          company_name: "NxtMeal",
          role_title: null,
          source: "self_placed",
          offer: { drive_type: "internship", ctc_lpa: "0.00", stipend_monthly: "15000" },
        },
      ],
    );

    const [event] = await view().historyFor("s1");

    expect(event?.detail).toContain("15,000");
    expect(event?.detail).not.toContain("0 LPA");
    expect(event?.detail).toContain("self-placed");
    // `role_title` null, and a snapshot with no `drive_type`, both fall back
    // rather than printing undefined.
    expect(event?.detail).not.toContain("null");
  });

  /** Zero rows is a real answer; a refused read is not. */
  it("answers an empty list when the read succeeded and found nothing", async () => {
    stubLedgers([], []);
    expect(await view().historyFor("s1")).toEqual([]);
  });

  it("throws the database's sentence rather than reporting no history", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/participation_status_changes`, () =>
        HttpResponse.json(
          {
            code: "42501",
            message: "permission denied for table participation_status_changes",
            details: null,
            hint: null,
          },
          { status: 403 },
        ),
      ),
      http.get(`${BASE}/rest/v1/offer_withdrawals`, () => HttpResponse.json([])),
    );

    await expect(view().historyFor("s1")).rejects.toThrow(StatusChangesError);
    await expect(view().historyFor("s1")).rejects.toThrow(/permission denied/);
  });
});

describe("the restore write", () => {
  it("names the student and sends the reason the coordinator typed", async () => {
    const bodies = stubRpc("restore_participation", () => HttpResponse.json(null));

    await view().restore("s1", "  Back after counselling — confirmed by phone.  ");

    expect(bodies[0]).toEqual({
      p_student_id: "s1",
      p_reason: "Back after counselling — confirmed by phone.",
    });
  });

  /** The RPC's refusal is the only explanation the manager gets, so it is kept. */
  it("says who the database refused and why", async () => {
    stubRpc("restore_participation", () =>
      refused(
        "Only a Campus Placement Coordinator, a Campus Manager or a Key Account Manager may return a student to the pipeline.",
      ),
    );

    await expect(view().restore("s1", "They asked me to.")).rejects.toThrow(
      /The student was not returned to the pipeline/,
    );
    await expect(view().restore("s1", "They asked me to.")).rejects.toThrow(
      /Only a Campus Placement Coordinator/,
    );
  });
});

describe("the withdrawal write", () => {
  it("names the offer, not the student, and sends the reason", async () => {
    const bodies = stubRpc("withdraw_offer", () => HttpResponse.json(null));

    await view().withdraw("o1", " Company retracted the joining. ");

    expect(bodies[0]).toEqual({ p_offer_id: "o1", p_reason: "Company retracted the joining." });
  });

  it("says when the offer was not taken back", async () => {
    stubRpc("withdraw_offer", () => refused("This offer was declared against another campus."));

    await expect(view().withdraw("o1", "Retracted.")).rejects.toThrow(
      /The offer was not withdrawn/,
    );
    await expect(view().withdraw("o1", "Retracted.")).rejects.toThrow(
      /declared against another campus/,
    );
  });
});
