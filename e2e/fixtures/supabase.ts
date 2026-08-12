import type { Page, Route } from "@playwright/test";
import { E2E_SUPABASE_URL } from "./env";

/**
 * A stand-in for PostgREST, good enough for one journey and no more.
 *
 * Why not the live database: `0007_audit.sql` revokes UPDATE and DELETE on the
 * audit table, so anything a test writes to the real project is permanent.
 * Why not MSW: the app disables MSW outside DEV+opt-in, and routing here keeps
 * the fixture next to the journey that depends on it.
 *
 * It answers the exact queries the repositories issue. If a query changes
 * shape, this stops matching and the journey fails — which is the point. A
 * stub that quietly answers everything proves nothing.
 */

export interface StudentSeed {
  readonly id: string;
  readonly full_name: string;
  readonly roll_number: string;
  readonly email: string;
  readonly passing_year: number;
  readonly overall_cgpa: number;
  readonly tenth_percentage: number;
  readonly twelfth_percentage: number;
  readonly current_arrears: number;
  readonly history_of_arrears: number;
  readonly srf_status: string;
  readonly participation_status: string;
}

export interface DriveSeed {
  readonly id: string;
  readonly company_name: string;
  readonly role_title: string;
  readonly ctc_min_lpa: number;
  readonly ctc_max_lpa: number;
  readonly min_overall_cgpa?: number | null;
  readonly status?: string;
  readonly drive_type?: string;
  readonly offer_category?: string | null;
  readonly role_category?: string;
}

export interface StubOptions {
  readonly student: StudentSeed;
  readonly drives: readonly DriveSeed[];
  readonly applications?: readonly string[];
  readonly offers?: readonly Record<string, unknown>[];
}

export interface SupabaseStub {
  /** Rows the app POSTed to a table, in order. */
  inserted(table: string): readonly Record<string, unknown>[];
  /** Requests the stub did not recognise. Should always be empty. */
  unhandled(): readonly string[];
}

const DAY = 24 * 60 * 60 * 1000;

function fullDrive(seed: DriveSeed, now: number): Record<string, unknown> {
  return {
    id: seed.id,
    company_name: seed.company_name,
    role_title: seed.role_title,
    role_category: seed.role_category ?? "software_technical",
    drive_type: seed.drive_type ?? "placement",
    offer_category: seed.offer_category ?? "regular",
    open_to_all_override: false,
    status: seed.status ?? "live",
    application_start: new Date(now - DAY).toISOString(),
    application_end: new Date(now + 7 * DAY).toISOString(),
    ctc_min_lpa: seed.ctc_min_lpa,
    ctc_max_lpa: seed.ctc_max_lpa,
    min_overall_cgpa: seed.min_overall_cgpa ?? null,
    min_tenth_percentage: null,
    min_twelfth_percentage: null,
    arrears_policy: "flexible",
    eligible_passing_years: [2026],
  };
}

function fullStudent(seed: StudentSeed): Record<string, unknown> {
  return {
    ...seed,
    technical_skills: "TypeScript, Postgres",
    degrees: { name: "B.E" },
    branches: { name: "Computer Science and Engineering" },
    campuses: { name: "Tech Institute of Engineering", cities: { name: "Coimbatore" } },
    student_documents: [{ id: "resume-tech", kind: "resume", role_category: "software_technical" }],
  };
}

/** PostgREST returns a bare object, not an array, for `.single()`. */
function isSingle(route: Route): boolean {
  const accept = route.request().headers().accept ?? "";
  return accept.includes("application/vnd.pgrst.object+json");
}

export async function stubSupabase(page: Page, options: StubOptions): Promise<SupabaseStub> {
  const inserts = new Map<string, Record<string, unknown>[]>();
  const unrecognised: string[] = [];
  const now = Date.now();

  const record = (table: string, row: Record<string, unknown>) => {
    const rows = inserts.get(table) ?? [];
    rows.push(row);
    inserts.set(table, rows);
  };

  // Applications the student already holds, plus any made during the journey.
  const applied = new Set<string>(options.applications ?? []);

  await page.route(`${E2E_SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.replace("/rest/v1/", "");
    const select = url.searchParams.get("select") ?? "";
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    /**
     * F14: the drive-specific resume is uploaded before the application is
     * written. Storage is not under /rest/v1, so it is matched on the path.
     */
    if (url.pathname.startsWith("/storage/v1/object/")) {
      record("storage", { path: url.pathname });
      return json({ Key: url.pathname.replace("/storage/v1/object/", "") }, 200);
    }

    if (route.request().method() === "POST" && table === "student_documents") {
      const row = route.request().postDataJSON() as Record<string, unknown>;
      record("student_documents", row);
      return json({ id: "drive-resume-1" }, 201);
    }

    if (route.request().method() === "POST" && table === "applications") {
      const row = route.request().postDataJSON() as Record<string, unknown>;
      record("applications", row);
      applied.add(row.drive_id as string);
      return json({ id: `app-${applied.size}` }, 201);
    }

    if (table === "profiles") {
      // Students deliberately have no profiles row; role comes from `students`.
      return json([]);
    }

    if (table === "students") {
      // Two different queries hit this table: the identity probe in
      // resolve-auth (select=id) and the full profile load in drives-view.
      const row =
        select.trim() === "id" ? { id: options.student.id } : fullStudent(options.student);
      return json(isSingle(route) ? row : [row]);
    }

    if (table === "drives") {
      return json(options.drives.map((d) => fullDrive(d, now)));
    }

    if (table === "applications") {
      return json([...applied].map((drive_id) => ({ drive_id })));
    }

    if (table === "offers") {
      return json(options.offers ?? []);
    }

    // D8/D9 (2026-08-12): the dashboard's notifications panel. The journey
    // starts with none; the panel stays out of the way.
    if (table === "notifications") {
      return json([]);
    }

    unrecognised.push(`${route.request().method()} ${url.pathname}${url.search}`);
    return json({ message: "not stubbed" }, 501);
  });

  return {
    inserted: (table) => inserts.get(table) ?? [],
    unhandled: () => unrecognised,
  };
}
