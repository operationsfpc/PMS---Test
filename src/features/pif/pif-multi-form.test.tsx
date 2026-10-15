// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PifMultiForm } from "./pif-multi-form";

/**
 * The multi-role PIF: ONE recruitment event, SEVERAL roles, committed
 * together through the atomic `save_company_drive_with_roles` RPC. The event
 * and its roles live or die together — a half-raised event with roles missing
 * is exactly what the atomic boundary exists to prevent.
 */
async function fillEventAndRole(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
  await user.click(screen.getByRole("radio", { name: /^full time$/i }));
  await user.type(screen.getByLabelText(/minimum ctc/i), "6.5");
  await user.type(screen.getByLabelText(/role title/i), "Member Technical Staff");
  await user.selectOptions(screen.getByLabelText(/role category/i), "software_technical");
  await user.type(screen.getByLabelText(/number of openings/i), "25");
  await user.type(screen.getByLabelText(/work location/i), "Chennai");
  await user.click(screen.getByRole("button", { name: /add round/i }));
  await user.type(screen.getByLabelText(/round 1 name/i), "Aptitude test");
  await user.click(screen.getByRole("checkbox", { name: /2027/ }));
  await user.click(screen.getByRole("radio", { name: /immediate joining/i }));
}

describe("PifMultiForm", () => {
  it("renders the event section and one role card", () => {
    render(<PifMultiForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    expect(screen.getByText(/roles under this event/i)).toBeDefined();
    expect(screen.getByText("Role 1")).toBeDefined();
    expect(screen.queryByText("Role 2")).toBeNull();
  });

  it("adds and removes role cards", async () => {
    const user = userEvent.setup();
    render(<PifMultiForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /add another role/i }));
    expect(screen.getByText("Role 2")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /remove role 2/i }));
    expect(screen.queryByText("Role 2")).toBeNull();
  });

  it("refuses to submit an empty form and says what is missing", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PifMultiForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    expect(await screen.findByText(/company name is required/i)).toBeDefined();
    expect(await screen.findByText(/role title is required/i)).toBeDefined();
    expect(await screen.findByText(/choose the drive type/i)).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("saves a half-finished draft without demanding the rest", async () => {
    const onSaveDraft = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifMultiForm onSubmit={vi.fn()} onSaveDraft={onSaveDraft} />);

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledTimes(1));
    const values = onSaveDraft.mock.calls[0]?.[0] as { roles: unknown[] };
    expect(values.roles).toHaveLength(1);
  });

  it("submits a complete event with its role", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifMultiForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillEventAndRole(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]?.[0] as {
      companyName: string;
      roles: Array<{ roleTitle: string; ctcMinLpa: number; rounds: unknown[] }>;
    };
    expect(values.companyName).toBe("Zoho Corporation");
    expect(values.roles).toHaveLength(1);
    expect(values.roles[0]?.roleTitle).toBe("Member Technical Staff");
    expect(values.roles[0]?.ctcMinLpa).toBe(6.5);
    expect(values.roles[0]?.rounds).toEqual([{ sequence: 1, name: "Aptitude test" }]);
  });

  it("shows the per-role joining comment only for the option the event chose", async () => {
    const user = userEvent.setup();
    render(<PifMultiForm onSubmit={vi.fn()} onSaveDraft={vi.fn()} />);

    expect(screen.queryByLabelText(/comments on immediate joining/i)).toBeNull();

    await user.click(screen.getByRole("radio", { name: /immediate joining/i }));
    expect(screen.getByLabelText(/comments on immediate joining/i)).toBeDefined();

    await user.click(screen.getByRole("radio", { name: /joining later/i }));
    expect(screen.getByLabelText(/comments on joining later/i)).toBeDefined();
    expect(screen.queryByLabelText(/comments on immediate joining/i)).toBeNull();
  });

  it("carries the per-role skills pick into the submission", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const catalogue = ["AI skills", "Aptitude", "Communication skills"];
    const user = userEvent.setup();
    render(<PifMultiForm onSubmit={onSubmit} onSaveDraft={vi.fn()} skillAreas={catalogue} />);

    await fillEventAndRole(user);
    await user.click(screen.getByRole("checkbox", { name: "Aptitude" }));
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]?.[0] as {
      roles: Array<{ mandatorySkills: string }>;
    };
    expect(values.roles[0]?.mandatorySkills).toBe("Aptitude");
  });

  it("shows a failure reason without losing what the AE typed", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error("Only Account Executives may create or edit drives."));
    const user = userEvent.setup();
    render(<PifMultiForm onSubmit={onSubmit} onSaveDraft={vi.fn()} />);

    await fillEventAndRole(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Only Account Executives");
    expect((screen.getByLabelText(/company name/i) as HTMLInputElement).value).toBe(
      "Zoho Corporation",
    );
  });
});
