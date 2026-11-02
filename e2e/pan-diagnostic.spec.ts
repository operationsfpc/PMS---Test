import { devices, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

/**
 * Scratch diagnostic: which element actually makes the ROOT scroll sideways.
 * Run with
 *   npx playwright test e2e/pan-diagnostic.spec.ts --reporter=list
 * and delete afterwards.
 */
test.use({ ...devices["Pixel 7"] });

const STUB = "https://e2e.supabase.co";

async function stubStaff(page: import("@playwright/test").Page, role: string) {
  const row = (n: number) => ({
    id: `r-${n}`,
    created_at: "2026-11-01T09:30:00.000Z",
    company_name: "Vizup Technologies Private Limited",
    role_title: "Software Development Engineer Intern",
    status: "live",
    full_name: "Anitha Ramanathan Krishnamurthy",
    roll_number: "TEC001BE0001BE2026",
    email: "anitha.raman@example-technology-institute.edu.in",
    name: "Alliance University, Bangalore East Campus",
    is_active: true,
    role,
  });
  await page.route(`${STUB}/**`, async (route) => {
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
    return json([row(1), row(2), row(3)]);
  });
}

async function diagnose(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const rows: string[] = [];
    const describe = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return `right=${Math.round(rect.right)} w=${Math.round(rect.width)} h=${Math.round(rect.height)} pos:${cs.position} ox:${cs.overflowX}  <${el.tagName.toLowerCase()} class="${el.className.toString().slice(0, 60)}">`;
    };
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.right <= vw + 1) continue;
      const cs = getComputedStyle(el);
      let clipper = "none";
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "hidden" || ox === "scroll" || ox === "clip") {
          clipper = `${p.tagName.toLowerCase()}.${p.className.toString().slice(0, 30)}=${ox}`;
          break;
        }
      }
      rows.push(`STICKS OUT clip:${clipper}  ${describe(el)}`);
    }
    // Elements that are themselves wider than their own clipped box.
    const scrollers: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const ox = getComputedStyle(el).overflowX;
      if (ox !== "visible") continue;
      scrollers.push(`OVERFLOWS-WITHOUT-CLIP ${describe(el)} scrollW=${el.scrollWidth}`);
    }
    rows.sort(
      (a, b) => Number(b.match(/right=(-?\d+)/)?.[1]) - Number(a.match(/right=(-?\d+)/)?.[1]),
    );
    return {
      vw,
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
      rows: rows.slice(0, 4),
      scrollers: scrollers.slice(0, 6),
    };
  });
  console.log(`\n### ${path}\n${JSON.stringify(report, null, 2)}`);

  const scrolled = await page.evaluate(() => {
    window.scrollTo(9999, 0);
    const hits: string[] = [];
    for (const x of [405, 500, 650, 830]) {
      const el = document.elementFromPoint(x - window.scrollX, 300);
      const chain: string[] = [];
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        chain.push(`${p.tagName.toLowerCase()}.${p.className.toString().slice(0, 34)}`);
      }
      hits.push(`x=${x} scrollX=${window.scrollX} -> ${chain.join(" < ") || "(nothing)"}`);
    }
    return { scrollX: window.scrollX, maxX: document.documentElement.scrollWidth, hits };
  });
  console.log(JSON.stringify(scrolled, null, 2));
  await page.screenshot({ path: `test-results/pan-${path.replace(/\//g, "-")}.png` });
}

test.describe("what pans the page", () => {
  test("cpc drives", async ({ page }) => {
    await stubStaff(page, "campus_placement_coordinator");
    await signInAs(page, { role: "staff", userId: "auth-cpc", email: "cpc@example.com" });
    await diagnose(page, "/cpc/drives");
  });

  test("central students", async ({ page }) => {
    await stubStaff(page, "central_placement_coordinator");
    await signInAs(page, { role: "staff", userId: "auth-central", email: "central@example.com" });
    await diagnose(page, "/central/students");
  });
});
