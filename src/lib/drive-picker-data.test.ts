import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../mocks/node";
import { fetchDriveRounds, fetchPickerDrives } from "./drive-picker-data";

/**
 * M1's data: the in-progress drives every picker page lists, and a drive's
 * rounds for the attendance chooser. In `src/lib` because four features
 * share it and features may not import each other.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

describe("fetchPickerDrives", () => {
  it("maps the row the picker needs, CTC worded, and asks only for in-progress statuses", async () => {
    let url = "";
    server.use(
      http.get(`${BASE}/rest/v1/drives`, ({ request }) => {
        url = request.url;
        return HttpResponse.json([
          {
            id: "d1",
            company_name: "Deloitte",
            role_title: "Junior Associate",
            ctc_min_lpa: 4,
            ctc_max_lpa: 5,
            status: "in_rounds",
            created_at: "2026-08-12T10:00:00Z",
          },
        ]);
      }),
    );

    const drives = await fetchPickerDrives(client());

    expect(drives).toEqual([
      {
        driveId: "d1",
        companyName: "Deloitte",
        roleTitle: "Junior Associate",
        ctcLabel: "₹4–5 LPA",
        raisedOn: "2026-08-12T10:00:00Z",
        status: "in_rounds",
      },
    ]);
    expect(url).toContain("status=in.%28");
    expect(url).toContain("in_rounds");
  });

  it("copes with a drive that declared almost nothing — nulls become honest fallbacks", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/drives`, () =>
        HttpResponse.json([
          {
            id: "d2",
            company_name: null,
            role_title: null,
            ctc_min_lpa: null,
            ctc_max_lpa: null,
            status: null,
            created_at: null,
          },
        ]),
      ),
    );

    const [drive] = await fetchPickerDrives(client());

    expect(drive).toEqual({
      driveId: "d2",
      companyName: "Unnamed drive",
      roleTitle: null,
      ctcLabel: null,
      raisedOn: null,
      status: "draft",
    });
  });

  it("throws a readable error rather than returning an empty page", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/drives`, () =>
        HttpResponse.json({ message: "x" }, { status: 500 }),
      ),
    );
    await expect(fetchPickerDrives(client())).rejects.toThrow(/could not list/i);
  });
});

describe("fetchDriveRounds", () => {
  it("names a nameless round by its number, and reports a failure readably", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/drive_rounds`, () =>
        HttpResponse.json([{ id: "r1", sequence: 1, name: null }]),
      ),
    );
    expect(await fetchDriveRounds(client(), "d1")).toEqual([
      { roundId: "r1", sequence: 1, name: "Round 1" },
    ]);

    server.use(
      http.get(`${BASE}/rest/v1/drive_rounds`, () =>
        HttpResponse.json({ message: "x" }, { status: 500 }),
      ),
    );
    await expect(fetchDriveRounds(client(), "d1")).rejects.toThrow(/could not read/i);
  });

  it("returns the drive's rounds in sequence order", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/drive_rounds`, () =>
        HttpResponse.json([
          { id: "r2", sequence: 2, name: "HR" },
          { id: "r1", sequence: 1, name: "Aptitude" },
        ]),
      ),
    );

    const rounds = await fetchDriveRounds(client(), "d1");

    expect(rounds).toEqual([
      { roundId: "r1", sequence: 1, name: "Aptitude" },
      { roundId: "r2", sequence: 2, name: "HR" },
    ]);
  });
});
