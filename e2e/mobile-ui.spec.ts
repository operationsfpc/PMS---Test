import { devices, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";
import { stubSupabase } from "./fixtures/supabase";

/**
 * Mobile layout sweep — every screen, on a phone, measured rather than admired.
 *
 * "check mobile ui on all end not proper" (2026-11-02). Phones have always been
 * the student's only device (PRD §21.2) and staff use them between campuses,
 * yet nothing in the suite ever asked what a screen does at 412px. Two bugs in
 * this repo's history were found by a person, not a test: the "Preview as"
 * select made the header ~535px wide and mobile Chrome zoomed the whole app out
 * so every tap near the fold went astray (2026-08-19), and the See-who drawer
 * pager overlapped its own list.
 *
 * What is measured, per screen:
 *  - does the PAGE pan sideways (`scrollWidth > clientWidth`)? That is the one
 *    symptom a reader feels as "not proper": the layout is there, but they are
 *    looking at a cropped piece of it and the rest is off-screen.
 *  - which elements stick out past the viewport, outermost first — a nested
 *    list of offenders is useless when forty of them share one wide ancestor.
 *  - controls whose tap box is under the ~44px floor, counted, with examples.
 *
 * It reports; it does not yet assert. Run it with
 * `npx playwright test e2e/mobile-ui.spec.ts --reporter=list` and read the
 * table, or open the screenshots under test-results/. Turning a clean run into
 * an assertion is the point of the sweep, not a precondition of it.
 */
test.use({ ...devices["Pixel 7"] });

/** Anything the sweep asks for, kept out of the way of the journey fixtures. */
const STAFF_STUB_URL = "https://e2e.supabase.co";

interface Overflow {
  readonly pan: boolean;
  readonly scrollWidth: number;
  readonly offenders: readonly string[];
}

async function measure(page: import("@playwright/test").Page, label: string): Promise<Overflow> {
  await page.waitForLoadState("networkidle");
  // React settles after the stubbed reads land; measuring mid-render reports a
  // skeleton that nobody ever sees.
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    /** Content inside a scroller is reachable by swiping; content that simply
     *  sticks out is not. Only the second is a bug, so the two are told apart. */
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      }
      return false;
    };
    const nodes: Element[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= vw + 1 && rect.left >= -1) continue;
      if (clipped(el)) continue;
      nodes.push(el);
    }

    /** Only the outermost offenders: everything inside a wide parent is wide. */
    const offenders = nodes
      .filter((el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (nodes.includes(p)) return false;
        }
        return true;
      })
      .slice(0, 8)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const cls = typeof el.className === "string" ? el.className.slice(0, 70) : "";
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        return `${el.tagName.toLowerCase()}.${cls} "${text}" ${Math.round(rect.width)}px@${Math.round(rect.left)}`;
      });

    const small: string[] = [];
    let cramped = 0;
    let tiny = 0;
    for (const el of document.querySelectorAll(
      "button, a, input, select, textarea, [role='tab']",
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Desktop-only content is `display:none` here and already skipped above.
      // Filtering on `lg:hidden` too would drop the mobile-ONLY controls,
      // which are the ones under review.
      if (rect.height >= 40 && rect.width >= 28) continue;
      if (rect.height < 32) tiny += 1;
      else cramped += 1;
      const label = `${el.tagName.toLowerCase()} "${
        (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 32) ||
        el.getAttribute("aria-label") ||
        "(icon)"
      }" ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      // Only the ones a thumb genuinely misses get named; 38px inputs are a
      // taste call, 28px links are a bug.
      if (rect.height < 32 && small.length < 6) small.push(label);
    }

    /**
     * A wide table does not make the page pan — it is inside its own
     * `overflow-x-auto` card, so the reader swipes a panel instead of a page
     * and never learns there were eleven more columns. Measured per table:
     * how much of it is off-screen at this width.
     */
    const tables = [...document.querySelectorAll("table")]
      .map((el) => {
        const scroller = el.closest('[class*="overflow-x-auto"]') ?? el.parentElement;
        const visible = scroller?.clientWidth ?? 0;
        return {
          label: el.querySelector("caption")?.textContent ?? "table",
          need: el.scrollWidth,
          visible,
        };
      })
      .filter((t) => t.need > t.visible + 1)
      .slice(0, 5)
      .map(
        (t) =>
          `${t.label}: ${t.need}px of ${t.visible}px shown (${Math.round((1 - t.visible / t.need) * 100)}% off-screen)`,
      );

    /**
     * `scrollWidth > clientWidth` on the root is a phantom here: Chromium
     * reports a clipped `overflow-x-auto` descendant's layout width on
     * `documentElement` even though the viewport cannot move. What a reader
     * feels is a page that actually shifts under a swipe, so the sweep tries to
     * scroll and asks whether anything moved.
     */
    window.scrollTo(9999, 0);
    const panned = window.scrollX > 1;
    window.scrollTo(0, 0);

    return {
      pan: panned,
      scrollWidth: document.documentElement.scrollWidth,
      vw,
      offenders,
      tiny,
      cramped,
      small,
      tables,
    };
  });

  const lines = [
    `\n── ${label}  (viewport ${result.vw}px)`,
    result.pan
      ? `   PANS SIDEWAYS: page is ${result.scrollWidth}px wide`
      : `   fits: page is ${result.scrollWidth}px wide`,
    ...result.offenders.map((o) => `   · ${o}`),
    ...result.tables.map((t) => `   WIDE TABLE ${t}`),
    result.tiny > 0 || result.cramped > 0
      ? `   ${result.tiny} control(s) under 32px tall: ${result.small.join(" | ")}\n   ${result.cramped} more at 32-39px`
      : "   all visible controls meet the tap floor",
  ];
  console.log(lines.join("\n"));

  await page.screenshot({ path: `test-results/mobile-${label}.png` });

  return { pan: result.pan, scrollWidth: result.scrollWidth, offenders: result.offenders };
}

/**
 * A staff identity plus a handful of rows in every table.
 *
 * The rows are deliberately over-wide — a 34-character company name and a long
 * role title — because a table's mobile behaviour is decided by its widest
 * cell, and an empty table shows the header and nothing else. A screen that
 * cannot survive these is not a data problem; it is a layout with no plan for
 * a phone.
 */
async function stubStaff(page: import("@playwright/test").Page, role: string) {
  const row = (n: number) => ({
    id: `r-${n}`,
    created_at: "2026-11-01T09:30:00.000Z",
    updated_at: "2026-11-01T09:30:00.000Z",
    applied_at: "2026-11-01T09:30:00.000Z",
    held_at: "2026-11-01T09:30:00.000Z",
    company_name: "Vizup Technologies Private Limited",
    role_title: "Software Development Engineer Intern",
    role_category: "software_technical",
    drive_type: "placement",
    offer_category: "regular",
    status: "live",
    full_name: "Anitha Ramanathan Krishnamurthy",
    roll_number: "TEC001BE0001BE2026",
    email: "anitha.raman@example-technology-institute.edu.in",
    phone: "+91 90000 11122",
    student_id: `stu-${n}`,
    drive_id: `drive-${n}`,
    application_id: `app-${n}`,
    round_id: `round-${n}`,
    campus_id: "campus-1",
    campuses: { name: "Alliance University, Bangalore East Campus" },
    branches: { name: "Computer Science and Engineering" },
    degrees: { name: "B.E" },
    overall_cgpa: 8.24,
    tenth_percentage: 88.4,
    twelfth_percentage: 84.2,
    current_arrears: 0,
    history_of_arrears: 1,
    passing_year: 2026,
    srf_status: "srf_approved",
    participation_status: "active",
    ctc_min_lpa: 6.5,
    ctc_max_lpa: 8,
    min_overall_cgpa: 7,
    application_start: "2026-10-20",
    application_end: "2026-11-20",
    company_visit_date: "2026-11-24",
    name: "Alliance University, Bangalore East Campus",
    city: "Bengaluru",
    kind: "resume",
    storage_path: "students/anitha-software-technical.pdf",
    result: "shortlisted",
    remarks: "Candidate cleared the pre-placement test in the top decile.",
    is_active: true,
    role,
  });

  await page.route(`${STAFF_STUB_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.replace("/rest/v1/", "");
    const accept = route.request().headers().accept ?? "";
    const single = accept.includes("pgrst.object");
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (table === "profiles") {
      const one = { role, is_active: true, full_name: "Terse Tester" };
      return json(single ? one : [one]);
    }
    if (table === "staff_campus_assignments") {
      return json([{ campuses: { name: "Alliance University" } }]);
    }
    // Counts come back as a scalar aggregate, not a row.
    if (url.searchParams.get("select") === "count") return json([{ count: 12 }]);
    return json([row(1), row(2), row(3)]);
  });
}

test.describe("phone layout, 412px", () => {
  test("the sign-in screen", async ({ page }) => {
    await page.goto("/login");
    await measure(page, "login");
  });

  test("student screens", async ({ page }) => {
    await stubSupabase(page, {
      student: {
        id: "stu-1",
        full_name: "Anitha Raman",
        roll_number: "TEC001BE0001",
        email: "anitha@example.com",
        passing_year: 2026,
        overall_cgpa: 8.2,
        tenth_percentage: 88,
        twelfth_percentage: 84,
        current_arrears: 0,
        history_of_arrears: 0,
        srf_status: "srf_approved",
        participation_status: "active",
      },
      drives: [
        {
          id: "drive-open",
          company_name: "Vizup Technologies Private Limited",
          role_title: "Software Development Engineer Intern",
          ctc_min_lpa: 6,
          ctc_max_lpa: 8,
        },
        {
          id: "drive-two",
          company_name: "Lakson",
          role_title: "Business Development Associate",
          ctc_min_lpa: 4,
          ctc_max_lpa: 5,
          drive_type: "internship",
        },
      ],
      applications: ["drive-two"],
    });
    await signInAs(page, { role: "student", studentId: "stu-1" });

    await page.goto("/student");
    await measure(page, "student-dashboard");

    await page.goto("/student/drives");
    await measure(page, "student-drives");

    await page.goto("/drives/drive-open");
    await measure(page, "drive-record");

    await page.goto("/srf");
    await measure(page, "srf");

    await page.goto("/student/profile");
    await measure(page, "student-profile");
  });

  test("the navigation drawer and the account menu", async ({ page }) => {
    await stubStaff(page, "account_executive");
    await signInAs(page, { role: "staff", userId: "auth-staff-1", email: "ae@example.com" });
    await page.goto("/ae/overview");

    await page.getByRole("button", { name: "Open navigation" }).click();
    await measure(page, "nav-drawer");

    // The drawer's own X, not Escape: the panel has no Escape handler today,
    // so the scrim stays up and swallows the click that follows.
    await page.getByRole("button", { name: "Close navigation" }).click();
    await page.getByRole("button", { name: /account menu/i }).click();
    await measure(page, "account-menu");
  });

  test("staff screens", async ({ page }) => {
    const roles: readonly [string, string][] = [
      ["account_executive", "/ae/overview"],
      ["account_executive", "/ae/pif"],
      ["delivery_head", "/delivery-head/pif-approvals"],
      ["campus_placement_coordinator", "/cpc/drives"],
      ["campus_placement_coordinator", "/cpc/verification"],
      ["central_placement_coordinator", "/central/drives/live"],
      ["central_placement_coordinator", "/central/students"],
      ["admin", "/dashboard"],
      ["admin", "/admin/campuses"],
      ["admin", "/admin/staff"],
    ];

    for (const [role, path] of roles) {
      await stubStaff(page, role);
      await signInAs(page, { role: "staff", userId: `auth-${role}`, email: `${role}@example.com` });
      await page.goto(path);
      await measure(page, path.replace(/^\//, "").replace(/\//g, "-"));
    }
  });
});
