import { JOINING_TIMELINES } from "@domain/joining";
import { SHIFT_TYPES } from "@domain/shift";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * `0051` — the attached JD, the shift and the joining timeline, proved against
 * the real schema.
 *
 * The domain refuses these shapes and so does the form, but neither of them is
 * what stops a bad row: a rule that lives only in a screen is a rule the next
 * screen does not have.
 */

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  await seed(t);
}, 60_000);

/** A drive as the AE's first save writes it, with whatever is under test. */
const raise = (columns: string, values: unknown[]) =>
  t.sql(
    `insert into drives (company_name, status, ${columns})
     values ('Zoho Corporation', 'draft', ${values.map((_, i) => `$${i + 1}`).join(", ")})
     returning id`,
    values,
  );

describe("the attached job description", () => {
  it("stores the path, the name and the size together", async () => {
    const rows = await raise("jd_storage_path, jd_file_name, jd_size_bytes", [
      "11111111-1111-1111-1111-111111111111/jd-1.pdf",
      "Zoho-GET-JD.pdf",
      412_000,
    ]);

    expect(rows).toHaveLength(1);
  });

  it("refuses a path with no name — that is a link that opens nothing", async () => {
    await expect(
      raise("jd_storage_path, jd_file_name, jd_size_bytes", ["some/path.pdf", null, 412_000]),
    ).rejects.toThrow(/jd_attachment_is_whole/);
  });

  it("refuses a size the bucket itself would have refused", async () => {
    // The bucket's file_size_limit is 5 MB. A row claiming more describes an
    // object that cannot exist.
    await expect(
      raise("jd_storage_path, jd_file_name, jd_size_bytes", ["p.pdf", "jd.pdf", 5_242_881]),
    ).rejects.toThrow(/jd_attachment_is_whole/);
    await expect(
      raise("jd_storage_path, jd_file_name, jd_size_bytes", ["p.pdf", "jd.pdf", 0]),
    ).rejects.toThrow(/jd_attachment_is_whole/);
  });

  it("accepts a drive with no attachment at all", async () => {
    expect(await raise("job_description", ["Backend services."])).toHaveLength(1);
  });
});

describe("the shift", () => {
  it("accepts every value the domain offers, and nothing else", async () => {
    for (const shift of SHIFT_TYPES) {
      expect(await raise("shift_type", [shift])).toHaveLength(1);
    }

    await expect(raise("shift_type", ["General"])).rejects.toThrow(/shift_type_is_a_known_shift/);
  });

  /**
   * The four live drives say 'General'. The constraint is NOT VALID for
   * exactly that reason, so history stays readable and only new rows are
   * judged — the same decision 0022 made about its evidence constraints.
   */
  /**
   * The drift guard the shift cannot have.
   *
   * `joining_timeline` is a real Postgres enum and `types-drift.test.ts`
   * compares it against the domain directly. The shift could not be one: the
   * column already held 'General' on live rows, and a cast would have refused
   * the deployment. So the constraint IS the vocabulary, and it has to be
   * compared against `SHIFT_TYPES` by hand.
   */
  it("allows exactly the values the domain knows about, and no others", async () => {
    const rows = await t.sql(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'shift_type_is_a_known_shift'`,
    );
    const def = String(rows[0]?.def ?? "");
    const allowed = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);

    expect(allowed).toEqual([...SHIFT_TYPES]);
  });

  it("is NOT VALID, which is what leaves the four live 'General' drives alone", async () => {
    // A validated constraint would have refused the deployment itself. This
    // asserts the deliberate half-measure rather than the deployment's luck:
    // the rule governs every new and updated row and judges no history.
    const rows = await t.sql(
      `select convalidated from pg_constraint where conname = 'shift_type_is_a_known_shift'`,
    );

    expect(rows[0]?.convalidated).toBe(false);
  });

  it("keeps the hours on a night shift and refuses them anywhere else", async () => {
    expect(await raise("shift_type, shift_night_timing", ["night", "9pm – 6am"])).toHaveLength(1);

    await expect(raise("shift_type, shift_night_timing", ["day", "9pm – 6am"])).rejects.toThrow(
      /night_timing_belongs_to_night/,
    );
    await expect(raise("shift_night_timing", ["9pm – 6am"])).rejects.toThrow(
      /night_timing_belongs_to_night/,
    );
  });

  it("allows a night shift whose hours are not filled in yet — a draft may be incomplete", async () => {
    expect(await raise("shift_type", ["night"])).toHaveLength(1);
  });
});

describe("the joining timeline", () => {
  it("accepts either choice", async () => {
    for (const timeline of JOINING_TIMELINES) {
      expect(await raise("joining_timeline", [timeline])).toHaveLength(1);
    }
  });

  it("keeps each comment with the option it was written about", async () => {
    expect(
      await raise("joining_timeline, joining_later_notes", ["later", "Joining July 2027"]),
    ).toHaveLength(1);

    await expect(
      raise("joining_timeline, joining_later_notes", ["immediate", "Joining July 2027"]),
    ).rejects.toThrow(/joining_notes_match_the_choice/);
    await expect(
      raise("joining_timeline, joining_immediate_notes", ["later", "Within 30 days"]),
    ).rejects.toThrow(/joining_notes_match_the_choice/);
    await expect(raise("joining_immediate_notes", ["Within 30 days"])).rejects.toThrow(
      /joining_notes_match_the_choice/,
    );
  });

  it("leaves the legacy prose column alone", async () => {
    // Four live drives keep their whole joining story in `timeline_notes`, and
    // answer 9 leaves them exactly as they are.
    expect(await raise("timeline_notes", ["Offers in Nov, joining in batches"])).toHaveLength(1);
  });
});
