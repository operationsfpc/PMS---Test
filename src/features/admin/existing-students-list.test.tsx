// @vitest-environment jsdom
import { setSupabaseClient } from "@lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { ExistingStudentsList } from "./existing-students-list";

const BASE = "https://project.supabase.co";

const CAMPUS = [{ id: "c1", name: "PSG College of Technology" }];

const ASHA = {
  id: "s1",
  full_name: "Asha Ramanathan",
  email: "asha@psgtech.edu",
  roll_number: "TEC001",
  campus_id: "c1",
  passing_year: 2027,
};

function connect() {
  setSupabaseClient(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
  );
}

/** Every row links to the student's record, so the list needs a router. */
const render = (ui: ReactNode) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const refused = (message: string) =>
  http.get(`${BASE}/rest/v1/students`, () =>
    HttpResponse.json({ code: "42501", message }, { status: 401 }),
  );

describe("ExistingStudentsList", () => {
  afterEach(() => setSupabaseClient(undefined));

  it("says the roster could not be read, rather than that nobody is enrolled", async () => {
    connect();
    // `.then(({ data }) => setStudents(data ?? []))`: PostgREST answers with an
    // error and supabase-js still resolves, so an outage arrived as an empty
    // list and this card told the administrator the roster had no students.
    server.use(refused("permission denied for table students"));

    render(<ExistingStudentsList campuses={CAMPUS} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("We could not read the students already on record.");
    expect(screen.queryByText(/no students have been added yet/i)).toBeNull();
    // The heading stops counting rows it was never given.
    expect(screen.getByRole("heading", { name: /^existing students$/i })).toBeDefined();
  });

  it("reads the roster again when the administrator asks it to", async () => {
    connect();
    let first = true;
    server.use(
      http.get(`${BASE}/rest/v1/students`, () => {
        if (first) {
          first = false;
          return HttpResponse.json({ code: "42501", message: "the read failed" }, { status: 401 });
        }
        return HttpResponse.json([ASHA]);
      }),
    );

    const user = userEvent.setup({ delay: null });
    render(<ExistingStudentsList campuses={CAMPUS} />);

    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: /load the roster again/i }));

    expect(await screen.findByText("Asha Ramanathan")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { name: /existing students \(1\)/i })).toBeDefined();
  });
});
