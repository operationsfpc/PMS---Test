import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../mocks/node";
import { chunk, PostgrestReadError, readAll, readAllByIds } from "./postgrest-read";

/**
 * The cap is invisible until the roster grows, which is the worst time to
 * find it: a 1,000-student campus reports correctly and a 6,000-student one
 * silently reports its first thousand.
 */
const BASE = "https://project.supabase.co";
const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const roster = (count: number) =>
  Array.from({ length: count }, (_, at) => ({ id: `s${String(at)}` }));

/** A PostgREST-shaped endpoint that honours `offset`/`limit` like the real one. */
function serve(rows: readonly { id: string }[]) {
  server.use(
    http.get(`${BASE}/rest/v1/students`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      const offset = Number(params.get("offset") ?? "0");
      const limit = Number(params.get("limit") ?? String(rows.length));
      return HttpResponse.json(rows.slice(offset, offset + limit));
    }),
  );
}

describe("readAll", () => {
  it("keeps asking for pages until the roster is whole", async () => {
    const rows = roster(2_500);
    serve(rows);
    const asked: number[] = [];

    const gathered = await readAll((from, to) => {
      asked.push(to - from + 1);
      return client().from("students").select("id").range(from, to);
    });

    expect(gathered).toHaveLength(2_500);
    expect(gathered.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    // Three requests: a full thousand, another, and the short one that ends it.
    expect(asked).toEqual([1000, 1000, 1000]);
  });

  it("stops at the first page when the table is smaller than the cap", async () => {
    serve(roster(4));
    let pages = 0;

    const gathered = await readAll((from, to) => {
      pages += 1;
      return client().from("students").select("id").range(from, to);
    });

    expect(gathered).toHaveLength(4);
    expect(pages).toBe(1);
  });

  it("refuses to answer with an empty list when the read failed", async () => {
    // The old bug in miniature: supabase-js resolves here, `data` is null, and
    // a view that never looked at `error` rendered "No students yet".
    server.use(
      http.get(
        `${BASE}/rest/v1/students`,
        () =>
          HttpResponse.json(
            { message: 'relation "public.students" does not exist', code: "42P01" },
            { status: 400 },
          ),
        { once: true },
      ),
    );

    await expect(
      readAll(() => client().from("students").select("id").range(0, 999)),
    ).rejects.toThrow(PostgrestReadError);
  });
});

describe("readAllByIds", () => {
  it("splits a long id list so the request stays addressable", async () => {
    const batches: number[] = [];

    server.use(
      http.get(`${BASE}/rest/v1/offers`, ({ request }) => {
        const ids = (new URL(request.url).searchParams.get("student_id") ?? "").split(",");
        batches.push(ids.length);
        return HttpResponse.json(ids.map((id) => ({ student_id: id.replace("in.(", "") })));
      }),
    );

    const ids = Array.from({ length: 450 }, (_, at) => `s${String(at)}`);
    const gathered = await readAllByIds(ids, (batch) => (from, to) => {
      return client().from("offers").select("student_id").in("student_id", batch).range(from, to);
    });

    expect(batches).toEqual([200, 200, 50]);
    expect(gathered).toHaveLength(450);
  });

  it("reads nothing when there is nothing to look up", async () => {
    let asked = 0;
    server.use(
      http.get(`${BASE}/rest/v1/offers`, () => {
        asked += 1;
        return HttpResponse.json([]);
      }),
    );

    await expect(
      readAllByIds([], (batch) => (from, to) => {
        return client().from("offers").select("id").in("student_id", batch).range(from, to);
      }),
    ).resolves.toEqual([]);
    expect(asked).toBe(0);
  });
});

describe("chunk", () => {
  it("keeps every id exactly once", () => {
    const batches = chunk(
      Array.from({ length: 1001 }, (_, at) => `x${String(at)}`),
      300,
    );
    expect(batches.map((b) => b.length)).toEqual([300, 300, 300, 101]);
    expect(batches.flat()).toHaveLength(1001);
  });
});
