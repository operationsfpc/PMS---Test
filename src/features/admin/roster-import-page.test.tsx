// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RosterImportPage } from "./roster-import-page";
import { RosterError, type RosterRepository } from "./roster-repository";

/**
 * Importing a roster.
 *
 * Every accepted row becomes a login; every rejected row is a student who
 * cannot sign in. So the screen must show BOTH lists before anything is
 * written, and must never import silently.
 */
const HEADER = "roll_number,name,email,degree,branch,passing_year";
const GOOD = `${HEADER}\nTEC001,Asha,asha@example.com,B.E,CSE,2027`;
const MIXED = `${GOOD}\nTEC002,Broken,,B.E,CSE,2027`;

function upload(user: ReturnType<typeof userEvent.setup>, content: string) {
  const file = new File([content], "roster.csv", { type: "text/csv" });
  return user.upload(screen.getByLabelText(/roster file/i), file);
}

function repo(overrides: Partial<RosterRepository> = {}): RosterRepository {
  return { importStudents: async () => ({ imported: 1 }), ...overrides };
}

const campuses = [{ id: "c1", name: "Test Engineering College" }];

describe("RosterImportPage", () => {
  it("previews what will be imported before writing anything", async () => {
    const importStudents = vi.fn();
    const user = userEvent.setup();
    render(<RosterImportPage repository={repo({ importStudents })} campuses={campuses} />);

    await upload(user, GOOD);

    expect(await screen.findByText(/1 student ready to import/i)).toBeDefined();
    expect(importStudents).not.toHaveBeenCalled();
  });

  it("names every rejected row and why, rather than dropping it quietly", async () => {
    const user = userEvent.setup();
    render(<RosterImportPage repository={repo()} campuses={campuses} />);

    await upload(user, MIXED);

    expect(await screen.findByText(/row 3/i)).toBeDefined();
    expect(screen.getByText(/email is missing/i)).toBeDefined();
  });

  it("still imports the good rows when some are rejected", async () => {
    const importStudents = vi.fn().mockResolvedValue({ imported: 1 });
    const user = userEvent.setup();
    render(<RosterImportPage repository={repo({ importStudents })} campuses={campuses} />);

    await upload(user, MIXED);
    await user.click(screen.getByRole("button", { name: /import 1 student/i }));

    await waitFor(() => expect(importStudents).toHaveBeenCalledTimes(1));
    expect(importStudents.mock.calls[0]?.[1]).toHaveLength(1);
  });

  it("refuses a file whose columns do not match the template", async () => {
    const user = userEvent.setup();
    render(<RosterImportPage repository={repo()} campuses={campuses} />);

    await upload(user, "roll,name\n1,Asha");

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("button", { name: /import/i })).toBeNull();
  });

  it("reports the outcome after importing", async () => {
    const user = userEvent.setup();
    render(<RosterImportPage repository={repo()} campuses={campuses} />);

    await upload(user, GOOD);
    await user.click(screen.getByRole("button", { name: /import 1 student/i }));

    expect(await screen.findByText(/imported 1 student/i)).toBeDefined();
  });

  it("surfaces a refusal from the repository", async () => {
    const importStudents = vi
      .fn()
      .mockRejectedValue(new RosterError("These degrees are not set up: B.Tech."));
    const user = userEvent.setup();
    render(<RosterImportPage repository={repo({ importStudents })} campuses={campuses} />);

    await upload(user, GOOD);
    await user.click(screen.getByRole("button", { name: /import 1 student/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/not set up/i)).toBeDefined();
  });
});

/**
 * 0040: one email identifies one person.
 *
 * The preview is where a clash must surface. The database refuses the whole
 * batch, so an administrator who only finds out on import gets one failure for
 * a file of hundreds and no idea which row caused it.
 */
describe("addresses already claimed", () => {
  it("rejects a row whose address belongs to a staff account, before importing", async () => {
    const user = userEvent.setup();
    render(
      <RosterImportPage
        repository={repo()}
        campuses={campuses}
        taken={new Map([["sainaveen@faceprep.in", "staff"]])}
      />,
    );

    await upload(
      user,
      "roll_number,name,email,degree,branch,passing_year\nR1,Sai,sainaveen@faceprep.in,B.E,CSE,2027\n",
    );

    expect(await screen.findByText(/already a staff account/i)).toBeDefined();
    expect(screen.getByText(/1 row cannot be imported/i)).toBeDefined();
  });
});
