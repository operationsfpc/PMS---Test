// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CampusProgrammes, type CampusProgrammesView } from "./campus-programmes";

/**
 * F6 (UAT 2026-08-06): "A separate page for degree and branches is not
 * required for the admin. This is always mapped to colleges for a particular
 * year of Passing. Degree+Branch is one field. This can be added or edited
 * later under the colleges created."
 *
 * So this lives under a college, not on a page of its own, and everything it
 * adds is that college's.
 */
function view(overrides: Partial<CampusProgrammesView> = {}): CampusProgrammesView {
  return {
    programmes: async () => [
      { id: "p1", degree: "B.E", branch: "CSE", passingYear: 2027 },
      { id: "p2", degree: "B.E", branch: "ECE", passingYear: 2027 },
      { id: "p3", degree: "MBA", branch: "", passingYear: 2026 },
    ],
    options: async () => [
      { degree: "B.E", branches: ["CSE", "ECE", "Mechanical"] },
      { degree: "MBA", branches: [] },
    ],
    add: async () => undefined,
    remove: async () => undefined,
    ...overrides,
  };
}

const show = () => render(<CampusProgrammes campusId="c1" campusName="Alliance" view={view()} />);

describe("CampusProgrammes", () => {
  it("lists what this college runs, as one field per programme", async () => {
    show();

    expect(await screen.findByText("B.E — CSE")).toBeDefined();
    expect(screen.getByText("B.E — ECE")).toBeDefined();
  });

  it("does not leave a dangling separator on a degree with no branches", async () => {
    show();

    // "MBA" is also an option in the degree picker, so this asks the LIST:
    // the entry must read "MBA", never "MBA — ".
    await screen.findByText("B.E — CSE");
    const entries = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");

    expect(entries.some((text) => text.startsWith("MBA2026"))).toBe(true);
    expect(entries.some((text) => text.includes("MBA —"))).toBe(false);
  });

  /** The year is what makes it a cohort rather than a catalogue entry. */
  it("says which passing year each programme is for", async () => {
    show();

    const row = (await screen.findByText("B.E — CSE")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(row.textContent).toMatch(/2027/);
  });

  it("groups the list by passing year, newest cohort first", async () => {
    show();

    const years = (await screen.findAllByRole("heading", { level: 4 })).map((h) => h.textContent);
    expect(years).toEqual(["2027", "2026"]);
  });

  it("says so plainly when the college runs nothing yet", async () => {
    render(
      <CampusProgrammes
        campusId="c1"
        campusName="Alliance"
        view={view({ programmes: async () => [] })}
      />,
    );

    expect(await screen.findByText(/no programmes/i)).toBeDefined();
  });

  it("adds a programme for this college and a passing year", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    render(<CampusProgrammes campusId="c1" campusName="Alliance" view={view({ add })} />);

    await user.selectOptions(await screen.findByLabelText(/degree/i), "B.E");
    await user.selectOptions(screen.getByLabelText(/branch/i), "Mechanical");
    await user.clear(screen.getByLabelText(/year of passing/i));
    await user.type(screen.getByLabelText(/year of passing/i), "2028");
    await user.click(screen.getByRole("button", { name: /add programme/i }));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        campusId: "c1",
        degree: "B.E",
        branch: "Mechanical",
        passingYear: 2028,
      }),
    );
  });

  /** The branches offered must be the chosen degree's, or the pair is nonsense. */
  it("offers only the branches that belong to the chosen degree", async () => {
    const user = userEvent.setup();
    show();

    await user.selectOptions(await screen.findByLabelText(/degree/i), "MBA");

    const branch = screen.getByLabelText(/branch/i) as HTMLSelectElement;
    expect(within(branch).queryByRole("option", { name: "CSE" })).toBeNull();
  });

  it("refuses to add a programme with no degree, in the domain's words", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    render(<CampusProgrammes campusId="c1" campusName="Alliance" view={view({ add })} />);

    await screen.findByLabelText(/degree/i);
    await user.clear(screen.getByLabelText(/year of passing/i));
    await user.type(screen.getByLabelText(/year of passing/i), "2028");
    await user.click(screen.getByRole("button", { name: /add programme/i }));

    expect(add).not.toHaveBeenCalled();
    expect(await screen.findByText(/enter the degree/i)).toBeDefined();
  });

  it("refuses an implausible passing year", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    render(<CampusProgrammes campusId="c1" campusName="Alliance" view={view({ add })} />);

    await user.selectOptions(await screen.findByLabelText(/degree/i), "B.E");
    await user.clear(screen.getByLabelText(/year of passing/i));
    await user.type(screen.getByLabelText(/year of passing/i), "1900");
    await user.click(screen.getByRole("button", { name: /add programme/i }));

    expect(add).not.toHaveBeenCalled();
    expect(await screen.findByText(/realistic year/i)).toBeDefined();
  });

  it("removes a programme the college no longer runs", async () => {
    const remove = vi.fn();
    const user = userEvent.setup();
    render(<CampusProgrammes campusId="c1" campusName="Alliance" view={view({ remove })} />);

    await user.click(await screen.findByRole("button", { name: /remove B\.E — CSE for 2027/i }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("p1"));
  });

  it("says why nothing happened when the write fails", async () => {
    const user = userEvent.setup();
    render(
      <CampusProgrammes
        campusId="c1"
        campusName="Alliance"
        view={view({
          remove: async () => {
            throw new Error("Students are already registered against it.");
          },
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /remove B\.E — CSE for 2027/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/already registered/i);
  });
});
