// @vitest-environment jsdom
import { act, render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auto-save must stop when the student stops typing.
 *
 * Found in the live audit log, 2026-08-05, while investigating a different
 * fault: ONE student sitting on the registration form produced ~50 UPDATEs a
 * minute against `students`, unbroken for 35 minutes - about 1,800 audit rows
 * for a form nobody was touching. Every save writes an audit entry, so this is
 * an append-only table growing at a write a second per open tab.
 *
 * The cause is the identity of the injected `saveDraft`. It is a DEFAULT
 * PARAMETER of the component, so it is a brand-new function on every render,
 * and it sits in the auto-save effect's dependency array:
 *
 *   save -> setDraftState/setDraftSavedAt -> re-render -> new saveDraft
 *        -> effect re-runs -> 1s timer -> save -> ...
 *
 * The existing page tests could never catch it, because they all pass
 * `saveDraft` in as a stable `vi.fn()` - which is exactly the one case where
 * the identity does not change. This file drives the real default path and
 * mocks the module underneath it, so what is under test is the code that
 * actually runs in production.
 */

const saveSrfDraft = vi.fn().mockResolvedValue(true);

vi.mock("./srf-api", () => ({
  saveSrfDraft: (values: unknown) => saveSrfDraft(values),
  submitSrf: vi.fn(),
  SrfSubmitError: class extends Error {},
}));

const { SrfPage } = await import("./srf-page");

const render = (ui: React.ReactNode) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const ROSTER = {
  fullName: "Asha Rao",
  rollNumber: "21CSE1042",
  email: "asha@example.edu",
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  draft: null,
};

/** Long enough for several debounce windows to come and go. */
const idle = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

beforeEach(() => saveSrfDraft.mockClear());

describe("SRF auto-save", () => {
  it("saves once after the student stops typing", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} />);

    await user.type(screen.getByLabelText(/^mobile number/i), "9876543210");
    await idle(1200);

    expect(saveSrfDraft).toHaveBeenCalledTimes(1);
  });

  /**
   * The regression itself. Four more seconds pass and the student does
   * nothing; four more writes must not appear.
   */
  it("does not keep writing while the student sits still", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} />);

    await user.type(screen.getByLabelText(/^mobile number/i), "9876543210");
    await idle(1200);
    const afterFirstSave = saveSrfDraft.mock.calls.length;

    await idle(4000);

    expect(saveSrfDraft.mock.calls.length).toBe(afterFirstSave);
  });

  /** It must still be a working auto-save, not one switched off to go green. */
  it("saves again when the student types something new", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} />);

    await user.type(screen.getByLabelText(/^mobile number/i), "9876543210");
    await idle(1200);

    await user.type(screen.getByLabelText(/technical skills/i), "TypeScript");
    await idle(1200);

    expect(saveSrfDraft).toHaveBeenCalledTimes(2);
    expect(saveSrfDraft.mock.calls.at(-1)?.[0]).toMatchObject({
      technicalSkills: "TypeScript",
    });
  });
});
