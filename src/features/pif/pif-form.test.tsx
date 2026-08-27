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
  // A1 (UAT 2026-08-19): the type comes FIRST — choosing it reveals the
  // compensation fields that belong to it.
  await user.click(screen.getByRole("radio", { name: /^full time$/i }));
  await user.type(screen.getByLabelText(/minimum ctc/i), "6.5");
  await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
  await user.type(screen.getByLabelText(/role title/i), "Member Technical Staff");
  await user.selectOptions(screen.getByLabelText(/role category/i), "software_technical");
  // Two controls now match "job description": the typed one and the PDF.
  await user.type(screen.getByLabelText(/^job description$/i), "Build backend services.");
  await user.type(screen.getByLabelText(/number of openings/i), "25");
  await user.type(screen.getByLabelText(/work location/i), "Chennai");
  /**
   * The rounds, NAMED (2026-08-18). A count told the Central CPC how many boxes
   * to invent and told a student nothing: "Round 2" is not something you can
   * prepare for.
   */
  await user.click(screen.getByRole("button", { name: /add round/i }));
  await user.type(screen.getByLabelText(/round 1 name/i), "Aptitude test");
  await user.click(screen.getByRole("checkbox", { name: /2027/ }));
  // J3 (2026-08-18): the joining choice is required at submit (answer 7).
  await user.click(screen.getByRole("radio", { name: /immediate joining/i }));
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
describe("the off-campus venue on the PIF (UAT 2026-08-21, item 2)", () => {
  it("asks for the venue only when the mode happens off campus", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    expect(screen.queryByRole("radio", { name: /venue not yet confirmed/i })).toBeNull();

    await user.selectOptions(screen.getByLabelText(/drive mode/i), "physical_outside_campus");
    expect(screen.getByRole("radio", { name: /venue not yet confirmed/i })).toBeDefined();

    await user.selectOptions(screen.getByLabelText(/drive mode/i), "on_campus");
    expect(screen.queryByRole("radio", { name: /venue not yet confirmed/i })).toBeNull();
  });

  it("submits with the venue not yet confirmed — the AE is never blocked", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText(/drive mode/i), "physical_outside_campus");
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ venueStatus: "not_yet_confirmed" });
  });

  it("collects a confirmed venue, and clears it when the mode moves back on campus", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText(/drive mode/i), "pooled");
    await user.click(screen.getByRole("radio", { name: /venue confirmed/i }));
    await user.type(screen.getByLabelText(/^venue$/i), "Kamaraj College, Madurai");

    // The mode changes its mind — the typed venue must not survive in hiding.
    await user.selectOptions(screen.getByLabelText(/drive mode/i), "on_campus");
    await user.selectOptions(screen.getByLabelText(/drive mode/i), "pooled");
    expect(
      (screen.getByRole("radio", { name: /venue not yet confirmed/i }) as HTMLInputElement).checked,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: /submit for approval/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      venueStatus: "not_yet_confirmed",
      venue: "",
    });
  });

  it("demands the venue text once the AE says it is confirmed", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText(/drive mode/i), "physical_outside_campus");
    await user.click(screen.getByRole("radio", { name: /venue confirmed/i }));
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    expect(await screen.findByText(/type the venue/i)).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

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

/**
 * J1, J2 and J3 (2026-08-18).
 *
 *   "add an option to ATTACH a JD (job description) as PDF FILE."
 *   "Shift time, instead of a text box, change to radio button."
 *   "in offer rollout and joining timeline, instead of a large text box, have
 *    radio button for immediate joining and joining later."
 */
describe("PifForm — the attached JD, the shift and the joining timeline", () => {
  const pdf = (name = "Zoho-GET-JD.pdf") =>
    new File([new Uint8Array(2048)], name, { type: "application/pdf" });

  describe("the attached JD", () => {
    it("takes the recruiter's PDF and carries it to the submission", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
      await fillRequired(user);

      await user.upload(screen.getByLabelText(/attach the job description/i), pdf());
      await user.click(screen.getByRole("button", { name: /submit for approval/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      const values = onSubmit.mock.calls[0]?.[0] as { jobDescriptionFile: File | null };
      expect(values.jobDescriptionFile?.name).toBe("Zoho-GET-JD.pdf");
    });

    it("names the file it is holding, so the AE can see it attached", async () => {
      const user = userEvent.setup();
      render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

      await user.upload(screen.getByLabelText(/attach the job description/i), pdf());

      expect(await screen.findByText(/Zoho-GET-JD\.pdf/)).toBeDefined();
    });

    it("refuses a file that is not a PDF, before anything is uploaded", async () => {
      const onSubmit = vi.fn();
      // `applyAccept: false` because the picker's own filter is not a rule: a
      // file dragged onto the input, or chosen through "All files", reaches
      // the form regardless of `accept`.
      const user = userEvent.setup({ applyAccept: false });
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
      await fillRequired(user);

      await user.upload(
        screen.getByLabelText(/attach the job description/i),
        new File(["x"], "jd.docx", { type: "application/msword" }),
      );
      await user.click(screen.getByRole("button", { name: /submit for approval/i }));

      expect(await screen.findByText(/must be a PDF/i)).toBeDefined();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("submits with no attachment at all — it is optional (answer 1)", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

      await fillRequired(user);
      await user.click(screen.getByRole("button", { name: /submit for approval/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    });

    /**
     * Answer 2: "keep space to type JD. Field is not mandatory." The typed
     * description survives as the thing a drive card and a CSV can show.
     */
    it("keeps the typed description, and no longer demands it", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

      expect(screen.getByLabelText(/^job description$/i)).toBeDefined();

      await user.click(screen.getByRole("radio", { name: /^full time$/i }));
      await user.type(screen.getByLabelText(/minimum ctc/i), "6.5");
      await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
      await user.type(screen.getByLabelText(/role title/i), "Member Technical Staff");
      await user.selectOptions(screen.getByLabelText(/role category/i), "software_technical");
      await user.type(screen.getByLabelText(/number of openings/i), "25");
      await user.type(screen.getByLabelText(/work location/i), "Chennai");
      await user.click(screen.getByRole("button", { name: /add round/i }));
      await user.type(screen.getByLabelText(/round 1 name/i), "Aptitude test");
      await user.click(screen.getByRole("checkbox", { name: /2027/ }));
      await user.click(screen.getByRole("radio", { name: /immediate joining/i }));
      await user.click(screen.getByRole("button", { name: /submit for approval/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    });
  });

  describe("the shift", () => {
    it("offers the four shifts as radios, and no text box", async () => {
      render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

      for (const shift of ["Day", "Night", "Rotational", "Flexible"]) {
        expect(screen.getByRole("radio", { name: shift })).toBeDefined();
      }
      // The old free-text box is what produced "General" on four live drives.
      expect(screen.queryByRole("textbox", { name: /^shift/i })).toBeNull();
    });

    it("preselects nothing — a preselected Day is an answer nobody gave", () => {
      render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

      for (const shift of ["Day", "Night", "Rotational", "Flexible"]) {
        expect((screen.getByRole("radio", { name: shift }) as HTMLInputElement).checked).toBe(
          false,
        );
      }
    });

    it("asks for the hours only once Night is chosen", async () => {
      const user = userEvent.setup();
      render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

      expect(screen.queryByLabelText(/night shift timing/i)).toBeNull();

      await user.click(screen.getByRole("radio", { name: "Night" }));

      expect(screen.getByLabelText(/night shift timing/i)).toBeDefined();
    });

    it("submits the shift with its hours", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
      await fillRequired(user);

      await user.click(screen.getByRole("radio", { name: "Night" }));
      await user.type(screen.getByLabelText(/night shift timing/i), "9.00 pm – 6.00 am");
      await user.click(screen.getByRole("button", { name: /submit for approval/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
        shiftType: "night",
        shiftNightTiming: "9.00 pm – 6.00 am",
      });
    });

    it("refuses a night shift with no hours", async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
      await fillRequired(user);

      await user.click(screen.getByRole("radio", { name: "Night" }));
      await user.click(screen.getByRole("button", { name: /submit for approval/i }));

      expect(await screen.findByText(/give the hours of the night shift/i)).toBeDefined();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("forgets the hours when the AE switches back to a day shift", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
      await fillRequired(user);

      await user.click(screen.getByRole("radio", { name: "Night" }));
      await user.type(screen.getByLabelText(/night shift timing/i), "9.00 pm – 6.00 am");
      await user.click(screen.getByRole("radio", { name: "Day" }));
      await user.click(screen.getByRole("button", { name: /submit for approval/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
        shiftType: "day",
        shiftNightTiming: "",
      });
    });
  });

  describe("the joining timeline", () => {
    it("offers the two options as radios, and no prose box", () => {
      render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

      expect(screen.getByRole("radio", { name: /immediate joining/i })).toBeDefined();
      expect(screen.getByRole("radio", { name: /joining later/i })).toBeDefined();
      expect(screen.queryByLabelText(/offer rollout and joining timeline/i)).toBeNull();
    });

    it("gives each option its own comments box (answer 6)", async () => {
      const user = userEvent.setup();
      render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

      expect(screen.queryByLabelText(/comments/i)).toBeNull();

      await user.click(screen.getByRole("radio", { name: /immediate joining/i }));
      expect(screen.getByLabelText(/comments on immediate joining/i)).toBeDefined();

      await user.click(screen.getByRole("radio", { name: /joining later/i }));
      expect(screen.getByLabelText(/comments on joining later/i)).toBeDefined();
      expect(screen.queryByLabelText(/comments on immediate joining/i)).toBeNull();
    });

    it("submits the choice and only its own comment", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
      await fillRequired(user);

      await user.type(screen.getByLabelText(/comments on immediate joining/i), "Within 30 days");
      await user.click(screen.getByRole("radio", { name: /joining later/i }));
      await user.type(
        screen.getByLabelText(/comments on joining later/i),
        "Offers Nov 2026, joining July 2027",
      );
      await user.click(screen.getByRole("button", { name: /submit for approval/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
        joiningTimeline: "later",
        joiningLaterNotes: "Offers Nov 2026, joining July 2027",
        // Switching the radio must not carry a note about immediate joining
        // onto a drive that now says next July.
        joiningImmediateNotes: "",
      });
    });

    it("refuses to submit until one of them is chosen (answer 7)", async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
      await fillRequired(user);

      // Undo the choice `fillRequired` made, the only way a radio group can be
      // emptied: re-render is not available, so this asserts on a fresh form.
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
      const forms = screen.getAllByRole("button", { name: /submit for approval/i });
      await user.click(forms[forms.length - 1] as HTMLElement);

      expect(await screen.findByText(/whether joining is immediate or later/i)).toBeDefined();
    });

    it("accepts either option with no comment at all", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);
      await fillRequired(user);

      await user.click(screen.getByRole("button", { name: /submit for approval/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ joiningTimeline: "immediate" });
    });
  });
});

/**
 * UAT 2026-08-19 — A1 (type first) · A2 (compensation follows the type) ·
 * A4 (several contacts, "+") · A5 (no contact → the Central CPC is the POC).
 */
describe("PifForm — drive type first, compensation follows (A1/A2)", () => {
  it("opens with the drive type as the FIRST section", () => {
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings[0]?.textContent).toMatch(/drive type/i);
  });

  it("shows no compensation until the type is chosen", () => {
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    expect(screen.queryByLabelText(/minimum ctc/i)).toBeNull();
    expect(screen.queryByLabelText(/stipend/i)).toBeNull();
    expect(screen.getByText(/choose the type first/i)).toBeDefined();
  });

  it("a placement asks for CTC and never a stipend", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: /^full time$/i }));

    expect(screen.getByLabelText(/minimum ctc/i)).toBeDefined();
    expect(screen.queryByLabelText(/stipend/i)).toBeNull();
  });

  it("an internship asks for a stipend and never a CTC", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: /^internship$/i }));

    expect(screen.getByLabelText(/stipend minimum/i)).toBeDefined();
    expect(screen.queryByLabelText(/minimum ctc/i)).toBeNull();
  });

  it("a convertible internship asks for both", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: /internship → full time/i }));

    expect(screen.getByLabelText(/stipend minimum/i)).toBeDefined();
    expect(screen.getByLabelText(/minimum ctc/i)).toBeDefined();
  });

  it("submits an internship with its stipend", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: /^internship$/i }));
    await user.type(screen.getByLabelText(/stipend minimum/i), "15000");
    await user.type(screen.getByLabelText(/stipend maximum/i), "25000");
    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await user.type(screen.getByLabelText(/role title/i), "Intern");
    await user.selectOptions(screen.getByLabelText(/role category/i), "software_technical");
    await user.type(screen.getByLabelText(/number of openings/i), "10");
    await user.type(screen.getByLabelText(/work location/i), "Chennai");
    await user.click(screen.getByRole("button", { name: /add round/i }));
    await user.type(screen.getByLabelText(/round 1 name/i), "Interview");
    await user.click(screen.getByRole("checkbox", { name: /2027/ }));
    await user.click(screen.getByRole("radio", { name: /immediate joining/i }));
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      driveType: "internship",
      stipendMinMonthly: 15000,
      stipendMaxMonthly: 25000,
    });
  });
});

describe("PifForm — the contacts (A4/A5)", () => {
  it("starts with no contact and says the Central CPC is the point of contact", () => {
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    expect(screen.getByRole("note").textContent).toMatch(/central placement coordinator/i);
  });

  it("adds contacts with the + button and drops the alert once one is real", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /add a contact/i }));
    // An empty row is not a contact — the alert stays.
    expect(screen.getByRole("note")).toBeDefined();

    await user.type(screen.getByLabelText(/contact 1 name/i), "R Karthik");
    expect(screen.queryByRole("note")).toBeNull();

    await user.click(screen.getByRole("button", { name: /add a contact/i }));
    expect(screen.getByLabelText(/contact 2 name/i)).toBeDefined();
  });

  it("sends every contact with the submission", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /add a contact/i }));
    await user.type(screen.getByLabelText(/contact 1 name/i), "R Karthik");
    await user.type(screen.getByLabelText(/contact 1 email/i), "karthik@zoho.com");
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0].contacts).toEqual([
      { name: "R Karthik", designation: "", email: "karthik@zoho.com", phone: "" },
    ]);
  });

  it("removes a contact row", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /add a contact/i }));
    await user.click(screen.getByRole("button", { name: /remove contact 1/i }));

    expect(screen.queryByLabelText(/contact 1 name/i)).toBeNull();
  });
});

/**
 * G2 (UAT 2026-08-20): "no required-field markers anywhere on the form" — an
 * AE could not tell mandatory from optional, and thin PIFs reached the
 * Delivery Head. The submit gate has existed since 18/08; what was missing
 * was the form SAYING which fields it will insist on.
 */
describe("PifForm — required-field markers (G2)", () => {
  it("states the convention once, at the top", () => {
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);
    expect(screen.getByText(/fields marked \* are required to submit/i)).toBeDefined();
  });

  it("marks every unconditionally required field with *", () => {
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    for (const label of [
      /company name \*/i,
      /role title \*/i,
      /role category \*/i,
      /number of openings \*/i,
      /work location\(s\) \*/i,
    ]) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }
    // Radio groups and checkbox groups carry the marker on their legend.
    expect(screen.getByText(/drive type \*/i)).toBeDefined();
    expect(screen.getByText(/offer rollout and joining \*/i)).toBeDefined();
    expect(screen.getByText(/eligible passing years \*/i)).toBeDefined();
  });

  it("marks the compensation the chosen type demands", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: /internship → full time/i }));
    expect(screen.getByLabelText(/minimum ctc \(lpa\) \*/i)).toBeDefined();
    expect(screen.getByLabelText(/stipend minimum \(₹ \/ month\) \*/i)).toBeDefined();
    // The maxima are genuinely optional and carry no marker.
    expect(screen.getByLabelText(/^maximum ctc \(lpa\)$/i)).toBeDefined();
  });

  it("leaves optional fields unmarked", () => {
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);
    expect(screen.getByLabelText(/^industry \/ domain$/i)).toBeDefined();
    expect(screen.getByLabelText(/^job description$/i)).toBeDefined();
  });
});

/**
 * The mandatory-skills picker (spec 2026-08-21 part A, approved 2026-08-24).
 *
 * "Only these skills should be selectable by the account executive when
 * raising the PIF. Anything outside this list he has to call it out as other
 * skills." Free text invited names the ranking could never match — the live
 * "Scored on 0 of 2 required skills" drive is what this replaces.
 */
describe("PifForm — mandatory skills come from the assessed-skills catalogue", () => {
  const catalogue = ["AI skills", "Aptitude", "Communication skills"];

  it("offers a checkbox per assessed skill and no free-text skills input", () => {
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} skillAreas={catalogue} />);

    for (const name of catalogue) {
      expect(screen.getByRole("checkbox", { name })).toBeDefined();
    }
    expect(screen.queryByLabelText(/^mandatory skills$/i)).toBeNull();
  });

  it("submits picked skills and called-out other skills as the stored text", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifForm onSubmit={onSubmit} onSaveDraft={vi.fn()} skillAreas={catalogue} />);

    await fillRequired(user);
    await user.click(screen.getByRole("checkbox", { name: "Aptitude" }));
    await user.type(screen.getByLabelText("Other skill"), "Testing");
    await user.click(screen.getByRole("button", { name: /add other skill/i }));
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]?.mandatorySkills).toBe("Aptitude, Testing");
  });

  it("says an other skill cannot be scored until it is assessed", () => {
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} skillAreas={catalogue} />);
    expect(screen.getByText(/can't be scored until they are assessed/i)).toBeDefined();
  });

  it("removes an added other skill when its chip is dismissed", async () => {
    const user = userEvent.setup();
    render(<PifForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} skillAreas={catalogue} />);

    await user.type(screen.getByLabelText("Other skill"), "Testing");
    await user.click(screen.getByRole("button", { name: /add other skill/i }));
    expect(screen.getByText("Testing")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /remove testing/i }));
    expect(screen.queryByText("Testing")).toBeNull();
  });
});
