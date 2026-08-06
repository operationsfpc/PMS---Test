// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddSemester, type AddSemesterView } from "./add-semester";

/**
 * F13 (UAT 2026-08-06): "there has to be a '+' button for students to add
 * their semesters and the marks against those semesters, however, these marks
 * have to be verified. This is required, as students might get subsequent
 * semester results after they have registered to placements ... But this
 * should be visible only after approval from Campus PC."
 *
 * The form itself locks on approval, for a good reason: §7.2 judges
 * eligibility on VERIFIED data, so a student editing a checked figure silently
 * invalidates every shortlist it has been measured for. Adding the NEXT
 * semester takes nothing away from anyone — it arrives pending, and
 * `academicStandingFrom` counts only verified rows.
 */
function view(overrides: Partial<AddSemesterView> = {}): AddSemesterView {
  return {
    add: async () => undefined,
    ...overrides,
  };
}

const props = {
  srfStatus: "srf_approved" as const,
  programmeLevel: "ug" as const,
  declaredSemesters: [1, 2, 3, 4],
  marksScale: "cgpa" as const,
};

describe("AddSemester", () => {
  it("offers to add the semester after the student's last", async () => {
    render(<AddSemester {...props} view={view()} />);

    expect(screen.getByRole("button", { name: /add semester 5/i })).toBeDefined();
  });

  it("says nothing until the coordinator has verified the form", () => {
    render(<AddSemester {...props} srfStatus="srf_submitted" view={view()} />);

    expect(screen.queryByRole("button", { name: /add semester/i })).toBeNull();
  });

  it("is absent on a form that was never submitted", () => {
    render(<AddSemester {...props} srfStatus="registered" declaredSemesters={[]} view={view()} />);

    expect(screen.queryByRole("button", { name: /add semester/i })).toBeNull();
  });

  it("offers nothing once the programme is complete", () => {
    render(
      <AddSemester {...props} programmeLevel="pg" declaredSemesters={[1, 2, 3, 4]} view={view()} />,
    );

    expect(screen.queryByRole("button", { name: /add semester/i })).toBeNull();
  });

  it("asks for the marks, the arrears and the marksheet", async () => {
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view()} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));

    expect(screen.getByLabelText(/^marks \(/i)).toBeDefined();
    expect(screen.getByLabelText(/standing arrears/i)).toBeDefined();
    expect(screen.getByLabelText(/history of arrears/i)).toBeDefined();
    expect(screen.getByLabelText(/marksheet/i)).toBeDefined();
  });

  it("sends what the student declared, for the semester it offered", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view({ add })} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.type(screen.getByLabelText(/^marks \(/i), "8.4");
    await user.type(screen.getByLabelText(/standing arrears/i), "1");
    await user.type(screen.getByLabelText(/history of arrears/i), "2");
    await user.upload(
      screen.getByLabelText(/marksheet/i),
      new File(["sheet"], "sem5.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /^submit/i }));

    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add.mock.calls[0]?.[0]).toMatchObject({
      semesterNumber: 5,
      marks: 8.4,
      currentArrears: 1,
      historyOfArrears: 2,
    });
    expect(add.mock.calls[0]?.[0].marksheet).toBeInstanceOf(File);
  });

  /** The marksheet is what makes verification mean anything. */
  it("will not submit a semester with no marksheet behind it", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view({ add })} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.type(screen.getByLabelText(/^marks \(/i), "8.4");
    await user.click(screen.getByRole("button", { name: /^submit/i }));

    expect(add).not.toHaveBeenCalled();
    expect(await screen.findByText(/upload the marksheet/i)).toBeDefined();
  });

  it("refuses marks that are not on the student's own scale", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view({ add })} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.type(screen.getByLabelText(/^marks \(/i), "65");
    await user.upload(
      screen.getByLabelText(/marksheet/i),
      new File(["sheet"], "sem5.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /^submit/i }));

    expect(add).not.toHaveBeenCalled();
    expect(await screen.findByText(/10-point scale/i)).toBeDefined();
  });

  it("accepts 65 from a student whose college reports percentages", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    render(<AddSemester {...props} marksScale="percentage" view={view({ add })} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.type(screen.getByLabelText(/^marks \(/i), "65");
    await user.upload(
      screen.getByLabelText(/marksheet/i),
      new File(["sheet"], "sem5.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /^submit/i }));

    await waitFor(() => expect(add).toHaveBeenCalled());
  });

  /** F13: "these marks have to be verified" — said before it is submitted. */
  it("says the marks will not count until a coordinator verifies them", async () => {
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view()} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));

    expect(screen.getByText(/not verified/i)).toBeDefined();
  });

  it("confirms once it is sent, and stops offering the same semester", async () => {
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view()} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.type(screen.getByLabelText(/^marks \(/i), "8.4");
    await user.upload(
      screen.getByLabelText(/marksheet/i),
      new File(["sheet"], "sem5.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /^submit/i }));

    expect((await screen.findByRole("status")).textContent).toMatch(/semester 5/i);
    expect(screen.queryByRole("button", { name: /add semester 5/i })).toBeNull();
  });

  it("surfaces a failure instead of pretending it was sent", async () => {
    const user = userEvent.setup();
    render(
      <AddSemester
        {...props}
        view={view({
          add: async () => {
            throw new Error("Semester 5 is already on your record.");
          },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.type(screen.getByLabelText(/^marks \(/i), "8.4");
    await user.upload(
      screen.getByLabelText(/marksheet/i),
      new File(["sheet"], "sem5.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /^submit/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/already on your record/i);
  });

  it("lets the student back out without submitting", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view({ add })} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(add).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /add semester 5/i })).toBeDefined();
  });
});

/**
 * Several at once (2026-08-06): "while adding additional semester marks, have
 * option to upload for multiple additional semesters. up to total of 10 for UG
 * and up to total of 4 for PG."
 *
 * A student who registered in their third year and comes back holding two more
 * marksheets had to submit one, wait for the screen to settle, and start
 * again. Each row still carries its own marksheet — that is what makes
 * verification mean anything, and it does not get cheaper in bulk.
 */
const row = (semester: number) =>
  within(screen.getByRole("group", { name: `Semester ${semester}` }));

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  semester: number,
  marks: string,
): Promise<void> {
  const fields = row(semester);
  await user.type(fields.getByLabelText(/^marks \(/i), marks);
  await user.upload(
    fields.getByLabelText(/marksheet/i),
    new File(["sheet"], `sem${semester}.pdf`, { type: "application/pdf" }),
  );
}

describe("AddSemester — more than one semester", () => {
  it("sends each semester the student filled in, in the order results arrive", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view({ add })} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.click(screen.getByRole("button", { name: /add semester 6/i }));
    await fill(user, 5, "8.4");
    await fill(user, 6, "9");
    await user.click(screen.getByRole("button", { name: /^submit/i }));

    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls[0]?.[0]).toMatchObject({ semesterNumber: 5, marks: 8.4 });
    expect(add.mock.calls[1]?.[0]).toMatchObject({ semesterNumber: 6, marks: 9 });
  });

  it("names the semester on every row, so two marksheets cannot be swapped", async () => {
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view()} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.click(screen.getByRole("button", { name: /add semester 6/i }));

    expect(row(5).getByLabelText(/marksheet/i)).toBeDefined();
    expect(row(6).getByLabelText(/marksheet/i)).toBeDefined();
  });

  it("stops a postgraduate at four semesters in total, not four at a time", async () => {
    const user = userEvent.setup();
    render(<AddSemester {...props} programmeLevel="pg" declaredSemesters={[1, 2]} view={view()} />);

    await user.click(screen.getByRole("button", { name: /add semester 3/i }));
    await user.click(screen.getByRole("button", { name: /add semester 4/i }));

    expect(screen.queryByRole("button", { name: /add semester/i })).toBeNull();
  });

  it("stops an undergraduate at ten in total", async () => {
    const user = userEvent.setup();
    render(<AddSemester {...props} declaredSemesters={[1, 2, 3, 4, 5, 6, 7, 8]} view={view()} />);

    await user.click(screen.getByRole("button", { name: /add semester 9/i }));
    await user.click(screen.getByRole("button", { name: /add semester 10/i }));

    expect(screen.queryByRole("button", { name: /add semester/i })).toBeNull();
  });

  it("lets the student drop a row they opened by mistake", async () => {
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view()} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.click(screen.getByRole("button", { name: /add semester 6/i }));
    await user.click(screen.getByRole("button", { name: /remove semester 6/i }));

    expect(screen.queryByRole("group", { name: "Semester 6" })).toBeNull();
    expect(screen.getByRole("group", { name: "Semester 5" })).toBeDefined();
  });

  /**
   * Nothing is sent until every row is complete. Sending the good ones and
   * reporting the bad one would leave the student guessing which half landed.
   */
  it("names the incomplete row and sends none of them", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view({ add })} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.click(screen.getByRole("button", { name: /add semester 6/i }));
    await fill(user, 5, "8.4");
    await user.click(screen.getByRole("button", { name: /^submit/i }));

    expect(add).not.toHaveBeenCalled();
    // Named precisely: "enter the marks" on its own no longer says which of
    // the two marksheets in the student's hand it is talking about.
    expect(await screen.findByText(/semester 6: enter the marks/i)).toBeDefined();
  });

  it("confirms both, and offers the one after them", async () => {
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view()} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.click(screen.getByRole("button", { name: /add semester 6/i }));
    await fill(user, 5, "8.4");
    await fill(user, 6, "9");
    await user.click(screen.getByRole("button", { name: /^submit/i }));

    expect((await screen.findByRole("status")).textContent).toMatch(/semesters 5 and 6/i);
    expect(screen.getByRole("button", { name: /add semester 7/i })).toBeDefined();
  });

  /**
   * Each semester is its own write. A failure on the second one has already
   * committed the first, so the screen must say which landed rather than
   * offering to send both again.
   */
  it("keeps only what did not land when one of them fails", async () => {
    const add = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Semester 6 is already on your record."));
    const user = userEvent.setup();
    render(<AddSemester {...props} view={view({ add })} />);

    await user.click(screen.getByRole("button", { name: /add semester 5/i }));
    await user.click(screen.getByRole("button", { name: /add semester 6/i }));
    await fill(user, 5, "8.4");
    await fill(user, 6, "9");
    await user.click(screen.getByRole("button", { name: /^submit/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/already on your record/i);
    expect(screen.queryByRole("group", { name: "Semester 5" })).toBeNull();
    expect(screen.getByRole("group", { name: "Semester 6" })).toBeDefined();
  });
});
