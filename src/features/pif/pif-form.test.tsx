// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PIF_SECTIONS, PifForm } from "./pif-form";

/**
 * The AE's PIF form.
 *
 * Sections 1-4 only. The Delivery Head's offer category and the Central CPC's
 * targeting are not the AE's to set, and must not appear here at all - §3.3
 * makes offer_category immutable once approval sets it.
 */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
  await user.type(screen.getByLabelText(/contact email/i), "karthik@zoho.com");
  await user.type(screen.getByLabelText(/role title/i), "Member Technical Staff");
  await user.selectOptions(screen.getByLabelText(/role category/i), "software_technical");
  await user.type(screen.getByLabelText(/job description/i), "Build backend services.");
  await user.type(screen.getByLabelText(/number of openings/i), "25");
  await user.type(screen.getByLabelText(/work location/i), "Chennai");
  await user.type(screen.getByLabelText(/minimum ctc/i), "6.5");
  /**
   * The rounds, NAMED (2026-08-18). A count told the Central CPC how many boxes
   * to invent and told a student nothing: "Round 2" is not something you can
   * prepare for.
   */
  await user.click(screen.getByRole("button", { name: /add round/i }));
  await user.type(screen.getByLabelText(/round 1 name/i), "Aptitude test");
  await user.click(screen.getByRole("checkbox", { name: /2027/ }));
}

describe("PifForm", () => {
  it("shows every AE-owned section", () => {
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);
    for (const section of PIF_SECTIONS) {
      expect(screen.getByRole("heading", { level: 2, name: section.title })).toBeDefined();
    }
  });

  it("never offers the offer category - that is the Delivery Head's decision", () => {
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);
    expect(screen.queryByLabelText(/offer category/i)).toBeNull();
  });

  it("refuses to submit an empty PIF and says what is missing", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    expect(await screen.findByText(/company name is required/i)).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a complete PIF", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      companyName: "Zoho Corporation",
      roleCategory: "software_technical",
      ctcMinLpa: 6.5,
      eligiblePassingYears: [2027],
    });
  });

  it("saves a half-finished draft without demanding the rest", async () => {
    const onSaveDraft = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={onSaveDraft} />);

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledTimes(1));
    expect(onSaveDraft.mock.calls[0]?.[0]).toMatchObject({ companyName: "Zoho Corporation" });
  });

  it("will not save a draft with no company name at all", async () => {
    const onSaveDraft = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={onSaveDraft} />);

    await user.click(screen.getByRole("button", { name: /save draft/i }));

    expect(await screen.findByText(/company name is required/i)).toBeDefined();
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it("surfaces a failure without losing what the AE typed", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Network down"));
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect((screen.getByLabelText(/company name/i) as HTMLInputElement).value).toBe(
      "Zoho Corporation",
    );
  });

  /**
   * A blanket "could not save" made a real production failure impossible to
   * diagnose: the repository knew exactly what went wrong and the form threw
   * that away. The AE cannot act on "try again" when the answer is "you are not
   * permitted to do this".
   */
  it("shows the reason it failed, not a blanket apology", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error("You do not have permission to raise a PIF."));
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("You do not have permission to raise a PIF.");
    expect(alert.textContent).toContain("Your entries are still here");
  });
});

/**
 * F7, F11 and F12 (UAT 2026-08-06) — three things the PIF was not collecting.
 */
describe("PifForm — what the recruiter actually said", () => {
  const show = () => render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

  /**
   * F12: "Under eligibility criteria the Minimum overall CGPA must be
   * acceptable of both percentage and GPA."
   */
  it("lets the cutoff be stated as a percentage or a CGPA", () => {
    show();

    const scale = screen.getByLabelText(/cutoff scale/i) as HTMLSelectElement;
    expect(scale.value).toBe("cgpa");
    expect(screen.getByRole("option", { name: /percentage/i })).toBeDefined();
  });

  it("submits the cutoff on the scale the AE chose", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText(/cutoff scale/i), "percentage");
    await user.type(screen.getByLabelText(/minimum overall/i), "65");
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      minOverallCgpa: 65,
      minOverallCgpaScale: "percentage",
    });
  });

  it("refuses a CGPA of 65, which is the mistake the scale exists to catch", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.type(screen.getByLabelText(/minimum overall/i), "65");
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    expect(await screen.findByText(/10-point scale/i)).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /** F11: the Central CPC was typing the round list from an email. */
  it("collects the rounds by name and sends them", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      rounds: [{ sequence: 1, name: "Aptitude test" }],
    });
  });

  /**
   * F7: "If its one interview process, multiple designations only one PIF is
   * required, if multiple interview process for multiple designations then
   * multiple PIF is required."
   */
  it("says when a second PIF is needed and when it is not", () => {
    show();

    expect(screen.getByText(/one interview process/i)).toBeDefined();
    expect(screen.getByText(/raise a separate pif/i)).toBeDefined();
  });

  it("collects further designations covered by the same interview process", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /add another designation/i }));
    await user.type(screen.getByLabelText("Designation 1"), "Associate Engineer");
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      additionalDesignations: ["Associate Engineer"],
    });
  });

  it("drops a designation row the AE added and left blank", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /add another designation/i }));
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ additionalDesignations: [] });
  });

  it("removes a designation row", async () => {
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole("button", { name: /add another designation/i }));
    await user.click(screen.getByRole("button", { name: /remove designation 1/i }));

    expect(screen.queryByLabelText("Designation 1")).toBeNull();
  });
});

/**
 * A defect found on 2026-08-06 while adding F12's cutoff scale.
 *
 * `onClick={run("submit")}` CALLS `run` during render. `run` set
 * `intent.current` as a side effect, so whichever button rendered last won -
 * and that was "Save draft". Every press of "Submit for approval" was
 * therefore validated against `pifDraftSchema`, which requires a company name
 * and nothing else.
 *
 * The consequence was silent: an AE could hand the Delivery Head a PIF with no
 * role, no CTC, no eligibility and no passing years, and the only sign was an
 * approval queue full of empty forms.
 */
describe("PifForm \u2014 submit validates as a submission, not as a draft", () => {
  it("refuses to submit a PIF that only has a company name", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    expect(await screen.findByText(/role title is required/i)).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still saves that same PIF as a draft", async () => {
    const onSaveDraft = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={onSaveDraft} />);

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled());
  });

  /** Submitting after a draft save must not inherit the draft's leniency. */
  it("does not let a draft save loosen the next submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    expect(await screen.findByText(/role title is required/i)).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

/**
 * A second defect, found the moment the first one stopped hiding it.
 *
 * `setValueAs` is handed the DEFAULT value - `null` - for a field nobody typed
 * in, and `Number(null)` is 0. So every blank optional number was submitted as
 * a real zero: a maximum CTC of 0, which then failed "cannot be below the
 * minimum" on an otherwise complete PIF, and a CGPA cutoff of 0 recorded as a
 * cutoff rather than as "none set".
 */
describe("PifForm \u2014 a blank number is not a zero", () => {
  it("sends no maximum CTC when the AE left it blank", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]?.ctcMaxLpa).toBeNull();
  });

  it("sends no CGPA cutoff when the AE set none", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]?.minOverallCgpa).toBeNull();
    expect(onSubmit.mock.calls[0]?.[0]?.minTenthPercentage).toBeNull();
  });
});

/**
 * The AE NAMES the rounds (2026-08-18, Karthik's answer to Q4):
 * "AE name them on the PIF with Round Number - Round 1 - Aptitude Test;
 * Round 2 - Interview; etc.," and "these are logical rounds to which students
 * can progress."
 *
 * A count told the Central CPC how many boxes to invent and told a student
 * nothing at all: "Round 2" is not something you can prepare for. The AE heard
 * the process from the company, so the names are theirs to record.
 */
describe("the rounds the AE was told about", () => {
  it("asks for a name per round, numbered", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /add round/i }));

    expect(screen.getByLabelText(/round 1 name/i)).toBeDefined();
  });

  it("numbers each new round after the last", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /add round/i }));
    await user.click(screen.getByRole("button", { name: /add round/i }));

    expect(screen.getByLabelText(/round 2 name/i)).toBeDefined();
  });

  it("renumbers what is left when a round is removed, leaving no gap", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /add round/i }));
    await user.click(screen.getByRole("button", { name: /add round/i }));
    await user.type(screen.getByLabelText(/round 1 name/i), "Aptitude test");
    await user.type(screen.getByLabelText(/round 2 name/i), "Interview");

    await user.click(screen.getByRole("button", { name: /remove round 1/i }));

    expect((screen.getByLabelText(/round 1 name/i) as HTMLInputElement).value).toBe("Interview");
    expect(screen.queryByLabelText(/round 2 name/i)).toBeNull();
  });

  it("submits the rounds in order, with their names", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
    await fillRequired(user);

    await user.click(screen.getByRole("button", { name: /add round/i }));
    await user.type(screen.getByLabelText(/round 2 name/i), "Technical interview");
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const values = onSubmit.mock.calls[0]?.[0] as { rounds: unknown };
    expect(values.rounds).toEqual([
      { sequence: 1, name: "Aptitude test" },
      { sequence: 2, name: "Technical interview" },
    ]);
  });

  it("refuses a submission whose round has no name", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
    await fillRequired(user);

    // A second round, added and left unnamed.
    await user.click(screen.getByRole("button", { name: /add round/i }));
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText(/name every round/i)).toBeDefined();
  });
});
