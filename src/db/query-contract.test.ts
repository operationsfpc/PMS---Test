import { STUDENT_STANDING_COLUMNS } from "@features/auth/student-standing";
import { PUBLISH_COHORT_COLUMNS, PUBLISH_DRIVE_COLUMNS } from "@features/central-cpc/publish-view";
import { VERIFICATION_QUEUE_COLUMNS } from "@features/cpc/verification-repository";
import {
  DASHBOARD_COHORT_COLUMNS,
  DASHBOARD_LIVE_DRIVE_COLUMNS,
} from "@features/dashboard/dashboard-view";
import { PORTFOLIO_DRIVE_COLUMNS } from "@features/drive-portfolio/portfolio-view";
import { SRF_PROFILE_COLUMNS } from "@features/srf/srf-profile";
import { DRIVE_COLUMNS, STUDENT_COLUMNS } from "@features/student/drives-view";
import {
  DASHBOARD_APPLICATION_COLUMNS,
  DASHBOARD_STUDENT_COLUMNS,
} from "@features/student/student-dashboard-view";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

/**
 * Every column a PostgREST select asks for must actually exist.
 *
 * The unit tests for these views hand the client a hand-written object, so a
 * select string can drift from the schema and stay green forever - the fake
 * simply returns whatever the test wrote. That gap shipped a real defect: a
 * migration dropped campuses.city while the query still asked for it, and the
 * whole suite passed. Vitest cannot catch it and neither can tsc, because the
 * select is an opaque string.
 *
 * So the string is parsed and checked against information_schema instead.
 */

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

interface Embed {
  readonly table: string;
  readonly spec: string;
  /** The `!constraint` hint, when the select names one. */
  readonly hint: string | undefined;
}

/** Splits on commas that are not inside a nested embed. */
function splitTopLevel(spec: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of spec) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function parse(spec: string): { columns: string[]; embeds: Embed[] } {
  const columns: string[] = [];
  const embeds: Embed[] = [];

  for (const part of splitTopLevel(spec)) {
    // `table(...)` or, when the relationship needs naming, `table!fkey(...)`.
    const embed = /^(\w+)(?:!(\w+))?\s*\(([\s\S]*)\)$/.exec(part);
    if (embed?.[1] !== undefined && embed[3] !== undefined) {
      embeds.push({ table: embed[1], spec: embed[3], hint: embed[2] });
    } else {
      columns.push(part);
    }
  }

  return { columns, embeds };
}

async function columnsOf(table: string): Promise<string[]> {
  const rows = await t.sql(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1`,
    [table],
  );
  return rows.map((r) => String(r.column_name));
}

/** Walks a select spec, returning every "table.column" that does not exist. */
async function missingColumns(rootTable: string, spec: string): Promise<string[]> {
  const missing: string[] = [];
  const { columns, embeds } = parse(spec);

  const available = await columnsOf(rootTable);
  if (available.length === 0) {
    return [`${rootTable} (table does not exist)`];
  }
  for (const column of columns) {
    if (!available.includes(column)) missing.push(`${rootTable}.${column}`);
  }

  for (const embed of embeds) {
    missing.push(...(await missingColumns(embed.table, embed.spec)));
  }

  return missing;
}

/**
 * Every foreign key joining two tables, in either direction.
 *
 * PostgREST resolves `parent(child(...))` by looking for exactly one
 * relationship. Add a second - which a single `references` column does - and
 * it stops answering the query and returns PGRST201 instead.
 */
async function relationshipsBetween(parent: string, child: string): Promise<string[]> {
  const rows = await t.sql(
    `select con.conname
       from pg_constraint con
       join pg_class src on src.oid = con.conrelid
       join pg_class tgt on tgt.oid = con.confrelid
      where con.contype = 'f'
        and ((src.relname = $1 and tgt.relname = $2)
          or (src.relname = $2 and tgt.relname = $1))`,
    [parent, child],
  );
  return rows.map((r) => String(r.conname));
}

/**
 * Embeds PostgREST cannot resolve, because more than one key joins the tables
 * and the select does not say which to use.
 *
 * This shipped TWICE, silently, and took out two screens in production at
 * once: the coordinator's verification queue and the student's drives list
 * both 400'd with PGRST201. Nothing caught it, because
 * `students.ug_marksheet_id` (0023) and `students.diploma_marksheet_id`
 * (0024) are perfectly good columns - they simply made a query written months
 * earlier ambiguous. The select never changed; the schema moved underneath it.
 *
 * A column check cannot see this. It needs the KEYS.
 */
async function ambiguousEmbeds(rootTable: string, spec: string): Promise<string[]> {
  const problems: string[] = [];

  for (const embed of parse(spec).embeds) {
    const keys = await relationshipsBetween(rootTable, embed.table);
    if (keys.length > 1 && embed.hint === undefined) {
      problems.push(
        `${rootTable} -> ${embed.table} (${keys.length} relationships: ${keys.sort().join(", ")})`,
      );
    }
    problems.push(...(await ambiguousEmbeds(embed.table, embed.spec)));
  }

  return problems;
}

describe("the student drives view asks only for columns that exist", () => {
  it("selects a real student shape", async () => {
    expect(await missingColumns("students", STUDENT_COLUMNS)).toEqual([]);
  });

  it("selects a real drive shape", async () => {
    expect(await missingColumns("drives", DRIVE_COLUMNS)).toEqual([]);
  });

  /** This one 400'd in production: every student's drives list, for everyone. */
  it("resolves the student's embeds to exactly one relationship", async () => {
    expect(await ambiguousEmbeds("students", STUDENT_COLUMNS)).toEqual([]);
  });

  it("resolves the drive's embeds to exactly one relationship", async () => {
    expect(await ambiguousEmbeds("drives", DRIVE_COLUMNS)).toEqual([]);
  });
});

/**
 * The same guard for every other hand-written select in the app.
 *
 * Each of these was written against an assumed schema at least once, and the
 * shortlisting view got three columns wrong on the first attempt - a drive_id
 * that does not exist on shortlist_entries, and skill_scores.skill/score
 * instead of metric/score/max_score.
 */
describe("every hand-written select matches the schema", () => {
  const SELECTS: ReadonlyArray<readonly [string, string, string]> = [
    [
      "shortlisting applicants",
      "applications",
      "id, student_id, profile_snapshot, students(full_name, roll_number), shortlist_entries(included)",
    ],
    ["shortlisting skills", "skill_scores", "student_id, metric, score, max_score"],
    [
      "shortlisting drive",
      "drives",
      "id, company_name, role_title, role_category, mandatory_skills",
    ],
    [
      "round results",
      "attendance",
      "application_id, status, applications(students(full_name, roll_number))",
    ],
    ["round result rows", "round_results", "application_id, result"],
    [
      "final selection candidates",
      "round_results",
      "application_id, result, applications(student_id, students(full_name, roll_number))",
    ],
    [
      "final selection drive",
      "drives",
      "id, company_name, role_title, drive_type, offer_category, ctc_min_lpa, ctc_max_lpa",
    ],
    [
      "cockpit drives",
      "drives",
      "id, company_name, role_title, status, on_hold, drive_rounds(id, sequence, name)",
    ],
    // The publish screen ran on invented data until 2026-08-04, so neither of
    // these selects had ever met the schema.
    ["publish drive", "drives", PUBLISH_DRIVE_COLUMNS],
    ["srf prefill", "students", SRF_PROFILE_COLUMNS],
    // Decides where a student lands after signing in, so a drift here would
    // strand every student on a fallback route rather than their form.
    ["student landing standing", "students", STUDENT_STANDING_COLUMNS],
    ["publish cohort", "students", PUBLISH_COHORT_COLUMNS],
    [
      "cockpit absence reviews",
      "attendance",
      "status, round_id, applications(student_id, drive_id, students(full_name, roll_number))",
    ],
    ["campus list", "campuses", "id, name, code, is_active, cities(name, state)"],
    // The student's own dashboard and the DH/AE drive portfolio, added
    // 2026-08-05. The portfolio embeds three tables under drive_rounds, which
    // is exactly the shape that has been wrong before.
    ["student dashboard identity", "students", DASHBOARD_STUDENT_COLUMNS],
    ["student dashboard applications", "applications", DASHBOARD_APPLICATION_COLUMNS],
    [
      "student dashboard offers",
      "offers",
      "id, drive_id, company_name, role_title, ctc_lpa, offer_category, declared_at, source",
    ],
    ["student dashboard rounds", "round_participants", "round_id, application_id"],
    ["student dashboard results", "round_results", "round_id, application_id, result"],
    ["student dashboard attendance", "attendance", "round_id, application_id, status"],
    ["drive portfolio", "drives", PORTFOLIO_DRIVE_COLUMNS],
    ["drive portfolio offers", "offers", "drive_id, student_id"],
    ["dashboard students", "students", DASHBOARD_COHORT_COLUMNS],
    ["dashboard live drives", "drives", DASHBOARD_LIVE_DRIVE_COLUMNS],
    [
      "dashboard offers",
      "offers",
      "id, student_id, drive_id, source, drive_type, offer_category, ctc_lpa, declared_at",
    ],
    ["dashboard applications", "applications", "student_id, drive_id"],
    ["staff list", "staff_invitations", "email, full_name, role, accepted_at"],
    ["staff profiles", "profiles", "email, is_active"],
    ["programmes degrees", "degrees", "id, name"],
    ["programmes branches", "branches", "id, degree_id, name, is_active"],
    ["student participation", "self_placement_requests", "id, company_name, ctc_lpa, status"],
    [
      "coordinator opt-out queue",
      "opt_out_requests",
      "id, reason, students(full_name, roll_number), student_documents(storage_path)",
    ],
    [
      "coordinator self-placement queue",
      "self_placement_requests",
      "id, company_name, ctc_lpa, students(full_name, roll_number), student_documents(storage_path)",
    ],
    // The screen a coordinator does their actual job on, and the one that was
    // reported broken. It was never registered here, which is the only reason
    // this file stayed green while the queue returned PGRST201 in production.
    ["coordinator verification queue", "students", VERIFICATION_QUEUE_COLUMNS],
  ];

  it.each(SELECTS)("%s", async (_name, table, spec) => {
    expect(await missingColumns(table, spec)).toEqual([]);
  });

  /**
   * The same registry, checked for the other way a select can be wrong.
   *
   * A select that names every column correctly still fails outright if the
   * embed is ambiguous, and it fails at RUNTIME, for everyone, the moment an
   * unrelated migration adds a second key between the two tables.
   */
  it.each(SELECTS)(
    "%s resolves each embed to exactly one relationship",
    async (_n, table, spec) => {
      expect(await ambiguousEmbeds(table, spec)).toEqual([]);
    },
  );
});
