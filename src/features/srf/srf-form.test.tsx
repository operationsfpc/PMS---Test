// @vitest-environment jsdom
import { setSupabaseClient } from "@lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { SrfPage } from "./srf-page";

/**
 * Submission now goes to Supabase, so refusals are PostgREST errors rather
 * than a JSON `error` field from the retired /api/srf stand-in.
 */
const BASE = "https://project.supabase.co";

function signedIn() {
  const client = createClient(BASE, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  client.auth.getSession = (async () => ({
    data: { session: { user: { id: "40000000-0000-0000-0000-000000000001" } } },
    error: null,
  })) as unknown as typeof client.auth.getSession;
  setSupabaseClient(client);
}

/**
 * Submitting writes the student row AND their semester lines (2026-08-04), so
 * tests asserting the student row still have to let the semester writes
 * through, or MSW fails them for a request unrelated to what they assert.
 */
const studentsPatch = (respond: () => Response | Promise<Response>) =>
  server.use(
    http.patch(`${BASE}/rest/v1/students`, respond),
    http.delete(`${BASE}/rest/v1/student_semesters`, () => HttpResponse.json([])),
    http.post(`${BASE}/rest/v1/student_semesters`, () => HttpResponse.json([])),
  );

/** Behaviour of the real SRF: validation, dynamic fields, submission. */

/**
 * `delay: null` removes userEvent's wait between keystrokes.
 *
 * This is the largest form in the application and these tests type into most
 * of it, so the default delay pushed several of them past the 5s timeout under
 * parallel load - they failed intermittently, which is worse than failing.
 * Behaviour is unchanged: every keystroke still dispatches its real events.
 */
const setup = () => userEvent.setup({ delay: null });

/**
 * The student's roster record. Identity used to arrive as fabricated defaults
 * ('Priya Ramesh', '21CSE1042') - what was reported as the form showing random
 * data. Those fields are disabled, so with the fake defaults gone the form
 * could not be completed at all until it was prefilled from here.
 */
const ROSTER = {
  fullName: "Asha Rao",
  rollNumber: "21CSE1042",
  email: "asha@example.edu",
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
};

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^mobile number/i), "9876543210");
  // Mandatory since 2026-08-04.
  await user.type(screen.getByLabelText(/alternate contact number/i), "9876500000");
  await user.type(screen.getByLabelText(/10th marks \(%\)/i), "91.4");
  await user.type(screen.getByLabelText(/12th marks \(%\)/i), "88");
  await user.type(screen.getByLabelText(/semester 1 cgpa/i), "8.24");
  await user.click(screen.getByRole("checkbox", { name: /software \/ technical/i }));
  await user.upload(
    screen.getByLabelText(/software \/ technical resume/i),
    new File(["cv"], "cv.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByRole("checkbox", { name: /consent/i }));
}

describe("SRF validation", () => {
  it("blocks submission and reports problems rather than silently failing", async () => {
    const user = setup();
    render(<SrfPage profile={ROSTER} />);

    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.queryByText(/submitted for verification/i)).toBeNull();
  });

  it("rejects a percentage typed into a semester CGPA", async () => {
    const user = setup();
    render(<SrfPage profile={ROSTER} />);
    await fillValidForm(user);

    const cgpa = screen.getByLabelText(/semester 1 cgpa/i);
    await user.clear(cgpa);
    await user.type(cgpa, "82.4");
    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    // Scoped to the error, not the hint: the section explains the 10-point
    // scale too, so a bare text match would pass without any validation.
    expect(await screen.findByText(/Semester 1: CGPA is on a 10-point scale/i)).toBeDefined();
    expect(screen.queryByText(/submitted for verification/i)).toBeNull();
  });

  it("rejects arrear history lower than standing arrears, per semester", async () => {
    // Cross-field, and Zod only evaluates object-level refinements once every
    // individual field parses - so the form must otherwise be valid, which is
    // exactly how a student meets this.
    const user = setup();
    render(<SrfPage profile={ROSTER} />);
    await fillValidForm(user);

    const current = screen.getByLabelText(/semester 1 standing arrears/i);
    const history = screen.getByLabelText(/semester 1 arrear history/i);
    await user.clear(current);
    await user.type(current, "3");
    await user.clear(history);
    await user.type(history, "1");
    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    expect(await screen.findByText(/history of arrears cannot be less/i)).toBeDefined();
    expect(screen.queryByText(/submitted for verification/i)).toBeNull();
  });

  /**
   * Semester-wise academics, confirmed 2026-08-04. A student says whether they
   * are pursuing UG or PG, then records one line per semester: CGPA (not GPA),
   * standing arrears and history of arrears.
   */
  describe("semester-wise academics", () => {
    it("starts an undergraduate on semester 1, numbered for them", () => {
      render(<SrfPage profile={ROSTER} />);

      expect(screen.getByRole("radio", { name: /undergraduate/i })).toBeDefined();
      expect(screen.getByLabelText(/semester 1 cgpa/i)).toBeDefined();
    });

    it("adds the next semester, numbering it automatically", async () => {
      const user = setup();
      render(<SrfPage profile={ROSTER} />);

      await user.click(screen.getByRole("button", { name: /add semester/i }));

      expect(screen.getByLabelText(/semester 2 cgpa/i)).toBeDefined();
    });

    it("stops an undergraduate at ten semesters", async () => {
      const user = setup();
      render(<SrfPage profile={ROSTER} />);

      for (let i = 0; i < 12; i += 1) {
        const add = screen.queryByRole("button", { name: /add semester/i });
        if (add === null) break;
        await user.click(add);
      }

      expect(screen.getByLabelText(/semester 10 cgpa/i)).toBeDefined();
      expect(screen.queryByLabelText(/semester 11 cgpa/i)).toBeNull();
      expect(screen.queryByRole("button", { name: /add semester/i })).toBeNull();
    });

    it("stops a postgraduate at four, and asks for their completed UG result", async () => {
      const user = setup();
      render(<SrfPage profile={ROSTER} />);

      await user.click(screen.getByRole("radio", { name: /postgraduate/i }));

      expect(screen.getByLabelText(/undergraduate cgpa/i)).toBeDefined();

      for (let i = 0; i < 6; i += 1) {
        const add = screen.queryByRole("button", { name: /add semester/i });
        if (add === null) break;
        await user.click(add);
      }

      expect(screen.getByLabelText(/semester 4 cgpa/i)).toBeDefined();
      expect(screen.queryByLabelText(/semester 5 cgpa/i)).toBeNull();
    });

    it("does not ask an undergraduate for a separate UG aggregate", () => {
      render(<SrfPage profile={ROSTER} />);

      expect(screen.queryByLabelText(/undergraduate cgpa/i)).toBeNull();
    });

    it("removes a semester the student added by mistake", async () => {
      const user = setup();
      render(<SrfPage profile={ROSTER} />);

      await user.click(screen.getByRole("button", { name: /add semester/i }));
      await user.click(screen.getByRole("button", { name: /remove semester 2/i }));

      expect(screen.queryByLabelText(/semester 2 cgpa/i)).toBeNull();
    });

    it("collects arrears per semester, not once for the whole degree", () => {
      render(<SrfPage profile={ROSTER} />);

      expect(screen.getByLabelText(/semester 1 standing arrears/i)).toBeDefined();
      expect(screen.getByLabelText(/semester 1 arrear history/i)).toBeDefined();
    });
  });

  /**
   * Requested 2026-08-04: "when file is not submitted, reason has to be
   * highlighted". A group message under a row of uploads does not say WHICH
   * one is missing when several are on screen.
   */
  it("marks the specific resume that is missing, not just the group", async () => {
    const user = setup();
    render(<SrfPage profile={ROSTER} />);

    await fillValidForm(user);
    await user.click(screen.getByRole("checkbox", { name: /^sales/i }));
    await user.click(screen.getByRole("button", { name: /submit/i }));

    const missing = await screen.findByLabelText(/sales resume/i);
    expect(missing.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByLabelText(/software \/ technical resume/i).getAttribute("aria-invalid"),
    ).toBe(null);
  });

  it("rejects a malformed mobile number", async () => {
    const user = setup();
    render(<SrfPage profile={ROSTER} />);

    await user.type(screen.getByLabelText(/mobile number/i), "12345");
    await user.tab();

    expect(await screen.findByText(/valid 10-digit mobile/i)).toBeDefined();
  });

  it("requires consent", async () => {
    const user = setup();
    render(<SrfPage profile={ROSTER} />);
    await user.click(screen.getByRole("button", { name: /submit for verification/i }));
    expect(await screen.findByText(/must consent/i)).toBeDefined();
  });
});

describe("SRF dynamic fields", () => {
  it("shows a resume slot only for the categories the student picked", async () => {
    const user = setup();
    render(<SrfPage profile={ROSTER} />);

    expect(screen.queryByLabelText(/sales resume/i)).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: /^sales$/i }));

    expect(screen.getByLabelText(/sales resume/i)).toBeDefined();
    expect(screen.queryByLabelText(/digital marketing resume/i)).toBeNull();
  });

  it("removes the resume slot when the category is deselected", async () => {
    const user = setup();
    render(<SrfPage profile={ROSTER} />);

    const sales = screen.getByRole("checkbox", { name: /^sales$/i });
    await user.click(sales);
    expect(screen.getByLabelText(/sales resume/i)).toBeDefined();

    await user.click(sales);
    expect(screen.queryByLabelText(/sales resume/i)).toBeNull();
  });

  it("demands a resume for every selected category", async () => {
    const user = setup();
    render(<SrfPage profile={ROSTER} />);
    await fillValidForm(user);

    // Add a second category but no second resume.
    await user.click(screen.getByRole("checkbox", { name: /^sales$/i }));
    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    expect(await screen.findByText(/resume for every role category/i)).toBeDefined();
  });

  it("lets a student add and remove semester marksheet slots", async () => {
    const user = setup();
    render(<SrfPage profile={ROSTER} />);

    expect(screen.getByLabelText(/semester 2 marksheet/i)).toBeDefined();
    expect(screen.queryByLabelText(/semester 3 marksheet/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: /add another semester/i }));
    expect(screen.getByLabelText(/semester 3 marksheet/i)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /remove last semester/i }));
    expect(screen.queryByLabelText(/semester 3 marksheet/i)).toBeNull();
  });
});

describe("SRF submission", () => {
  afterEach(() => setSupabaseClient(undefined));

  it("confirms submission and sets the expectation of verification", async () => {
    studentsPatch(() => HttpResponse.json({ id: "s1", srf_status: "srf_submitted" }));
    signedIn();

    const user = setup();
    render(<SrfPage profile={ROSTER} />);
    await fillValidForm(user);

    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    expect(await screen.findByText(/submitted for verification/i)).toBeDefined();
    expect(screen.getByText(/notified once approved/i)).toBeDefined();
  });

  it("surfaces a server refusal without losing the student's work", async () => {
    // The verified-academics guard from 0009 - a refusal a student can really hit.
    studentsPatch(() =>
      HttpResponse.json(
        { code: "42501", message: "permission denied", details: null, hint: null },
        { status: 403 },
      ),
    );
    signedIn();

    const user = setup();
    render(<SrfPage profile={ROSTER} />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    expect(
      await screen.findByText(/can only be changed by your placement coordinator/i),
    ).toBeDefined();
    // The form is still there, still filled in.
    expect((screen.getByLabelText(/semester 1 cgpa/i) as HTMLInputElement).value).toBe("8.24");
  });

  it("falls back to a generic message when the server fails opaquely", async () => {
    studentsPatch(() => new HttpResponse(null, { status: 500 }));
    signedIn();

    const user = setup();
    render(<SrfPage profile={ROSTER} />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    expect(await screen.findByText(/could not submit your form/i)).toBeDefined();
  });

  it("disables the submit button while in flight", async () => {
    studentsPatch(async () => {
      await delay(80);
      return HttpResponse.json({ id: "s1", srf_status: "srf_submitted" });
    });
    signedIn();

    const user = setup();
    render(<SrfPage profile={ROSTER} />);
    await fillValidForm(user);

    await user.click(screen.getByRole("button", { name: /submit for verification/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /submitting/i })).toBeDefined();
    });
  });
});
