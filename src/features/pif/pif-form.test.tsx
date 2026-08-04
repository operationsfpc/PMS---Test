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
