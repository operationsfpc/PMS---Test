import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";
import { stubSupabase } from "./fixtures/supabase";

/**
 * Journey 1 of 1-per-role: the student.
 *
 * This is the only layer that proves the pieces are wired to each other. The
 * domain rules are already exhaustively unit-tested and the screens are tested
 * in isolation against injected views; what nothing else checks is that a real
 * browser, holding a real session, walking real routes, arrives at the right
 * screen with the right data and can complete the one action that matters.
 *
 * Backed by a stubbed PostgREST rather than a live database, so the run is
 * deterministic and writes nothing to Mumbai. The stub answers the exact
 * queries `drives-view.ts` issues; if those queries change, this fails.
 */
test.describe("student journey", () => {
  test("signs in, sees only the drives open to them, and applies", async ({ page }) => {
    const supabase = await stubSupabase(page, {
      student: {
        id: "stu-1",
        full_name: "Anitha Raman",
        roll_number: "TEC001",
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
        // Open to her, and within the application window.
        {
          id: "drive-open",
          company_name: "Zoho",
          role_title: "Member Technical Staff",
          ctc_min_lpa: 6,
          ctc_max_lpa: 8,
          min_overall_cgpa: 7,
        },
        // R5 must hide this one entirely: she does not meet the CGPA cutoff.
        {
          id: "drive-ineligible",
          company_name: "Goldman Sachs",
          role_title: "Analyst",
          ctc_min_lpa: 20,
          ctc_max_lpa: 24,
          min_overall_cgpa: 9.5,
        },
      ],
    });

    await signInAs(page, { role: "student", studentId: "stu-1" });

    // Landing is a domain rule (auth-routing), not a hardcoded path.
    await page.goto("/");
    await expect(page).toHaveURL(/\/student$/);

    // On a phone the nav is behind the hamburger — this is the real path a
    // student takes, and it is the only one they have (PRD §21.2).
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Open drives" }).click();
    await expect(page.getByRole("heading", { name: "Open drives" })).toBeVisible();

    // Visible, because she is eligible.
    await expect(page.getByRole("heading", { name: "Zoho" })).toBeVisible();

    // Hidden by R5 — never rendered at all, not merely disabled. Showing a
    // student a drive they can never apply to reveals the cutoff by implication.
    await expect(page.getByRole("heading", { name: "Goldman Sachs" })).toHaveCount(0);

    await page.getByRole("button", { name: "Apply to Zoho" }).click();

    // F14 (UAT 2026-08-06): applying is a promise to attend every round and to
    // accept a final offer, and it cannot be withdrawn. The student is told
    // that BEFORE it happens, not after.
    await expect(page.getByText(/are you sure/i)).toBeVisible();
    await expect(page.getByText(/attend all the rounds/i)).toBeVisible();

    // F14: and the recruiter reads the CV chosen for THIS drive.
    await page.getByLabel(/resume for this drive/i).setInputFiles({
      name: "zoho-resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 resume"),
    });
    await page.getByRole("button", { name: "Yes, apply" }).click();

    // The application is now irreversible, and the UI must say so.
    await expect(page.getByText("Applied")).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply to Zoho" })).toHaveCount(0);

    // R7: the application carries a frozen snapshot of the profile, not a
    // pointer to a profile that can still change.
    const application = supabase.inserted("applications").at(0);
    expect(application).toBeDefined();
    expect(application?.drive_id).toBe("drive-open");
    expect(application?.profile_snapshot).toMatchObject({
      profile: { fullName: "Anitha Raman", rollNumber: "TEC001" },
      // F14: the resume the recruiter reads is the one chosen for this drive,
      // not the generic one on the profile.
      resumeId: "drive-resume-1",
    });
    expect(application?.resume_id).toBe("drive-resume-1");

    expect(supabase.unhandled()).toEqual([]);
  });
});
