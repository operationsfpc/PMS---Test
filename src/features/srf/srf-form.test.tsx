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

const studentsPatch = (respond: () => Response | Promise<Response>) =>
  server.use(http.patch(`${BASE}/rest/v1/students`, respond));

/** Behaviour of the real SRF: validation, dynamic fields, submission. */

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^mobile number/i), "9876543210");
  // Mandatory since 2026-08-04.
  await user.type(screen.getByLabelText(/alternate contact number/i), "9876500000");
  await user.type(screen.getByLabelText(/10th marks \(%\)/i), "91.4");
  await user.type(screen.getByLabelText(/12th marks \(%\)/i), "88");
  await user.selectOptions(screen.getByLabelText(/^degree/i), "B.E");
  await user.selectOptions(screen.getByLabelText(/branch/i), "CSE");
  await user.type(screen.getByLabelText(/passing year/i), "2026");
  await user.type(screen.getByLabelText(/overall cgpa/i), "8.24");
  await user.click(screen.getByRole("checkbox", { name: /software \/ technical/i }));
  await user.upload(
    screen.getByLabelText(/software \/ technical resume/i),
    new File(["cv"], "cv.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByRole("checkbox", { name: /consent/i }));
}

describe("SRF validation", () => {
  it("blocks submission and reports problems rather than silently failing", async () => {
    const user = userEvent.setup();
    render(<SrfPage />);

    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.queryByText(/submitted for verification/i)).toBeNull();
  });

  it("rejects a percentage typed into the CGPA field", async () => {
    const user = userEvent.setup();
    render(<SrfPage />);

    await user.type(screen.getByLabelText(/overall cgpa/i), "82.4");
    await user.tab();

    // Scoped to the alert: the field hint mentions the 10-point scale too.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/10-point scale/i);
  });

  it("rejects arrear history lower than standing arrears", async () => {
    // NOTE: this is a cross-field rule, and Zod only evaluates object-level
    // refinements once every individual field parses. So the form must
    // otherwise be valid for this error to surface — which is exactly how a
    // student encounters it.
    const user = userEvent.setup();
    render(<SrfPage />);
    await fillValidForm(user);

    const current = screen.getByLabelText(/current arrears/i);
    const history = screen.getByLabelText(/history of arrears/i);
    await user.clear(current);
    await user.type(current, "3");
    await user.clear(history);
    await user.type(history, "1");
    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    expect(await screen.findByText(/cannot be lower than your standing arrears/i)).toBeDefined();
    expect(screen.queryByText(/submitted for verification/i)).toBeNull();
  });

  it("rejects a malformed mobile number", async () => {
    const user = userEvent.setup();
    render(<SrfPage />);

    await user.type(screen.getByLabelText(/mobile number/i), "12345");
    await user.tab();

    expect(await screen.findByText(/valid 10-digit mobile/i)).toBeDefined();
  });

  it("requires consent", async () => {
    const user = userEvent.setup();
    render(<SrfPage />);
    await user.click(screen.getByRole("button", { name: /submit for verification/i }));
    expect(await screen.findByText(/must consent/i)).toBeDefined();
  });
});

describe("SRF dynamic fields", () => {
  it("shows a resume slot only for the categories the student picked", async () => {
    const user = userEvent.setup();
    render(<SrfPage />);

    expect(screen.queryByLabelText(/sales resume/i)).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: /^sales$/i }));

    expect(screen.getByLabelText(/sales resume/i)).toBeDefined();
    expect(screen.queryByLabelText(/digital marketing resume/i)).toBeNull();
  });

  it("removes the resume slot when the category is deselected", async () => {
    const user = userEvent.setup();
    render(<SrfPage />);

    const sales = screen.getByRole("checkbox", { name: /^sales$/i });
    await user.click(sales);
    expect(screen.getByLabelText(/sales resume/i)).toBeDefined();

    await user.click(sales);
    expect(screen.queryByLabelText(/sales resume/i)).toBeNull();
  });

  it("demands a resume for every selected category", async () => {
    const user = userEvent.setup();
    render(<SrfPage />);
    await fillValidForm(user);

    // Add a second category but no second resume.
    await user.click(screen.getByRole("checkbox", { name: /^sales$/i }));
    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    expect(await screen.findByText(/resume for every role category/i)).toBeDefined();
  });

  it("lets a student add and remove semester marksheet slots", async () => {
    const user = userEvent.setup();
    render(<SrfPage />);

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

    const user = userEvent.setup();
    render(<SrfPage />);
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

    const user = userEvent.setup();
    render(<SrfPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /submit for verification/i }));

    expect(
      await screen.findByText(/can only be changed by your placement coordinator/i),
    ).toBeDefined();
    // The form is still there, still filled in.
    expect((screen.getByLabelText(/overall cgpa/i) as HTMLInputElement).value).toBe("8.24");
  });

  it("falls back to a generic message when the server fails opaquely", async () => {
    studentsPatch(() => new HttpResponse(null, { status: 500 }));
    signedIn();

    const user = userEvent.setup();
    render(<SrfPage />);
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

    const user = userEvent.setup();
    render(<SrfPage />);
    await fillValidForm(user);

    await user.click(screen.getByRole("button", { name: /submit for verification/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /submitting/i })).toBeDefined();
    });
  });
});
