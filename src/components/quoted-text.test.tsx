// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QuotedText } from "./quoted-text";

const LONG = "jk;kfdgghghjklhljk;".repeat(60);

/**
 * 2026-10-30: reasons arrive from a free-text box, and one of them can run for
 * thousands of characters. In full it buries the row; the preview keeps the
 * row readable and the popup keeps every character.
 */
describe("QuotedText", () => {
  it("prints a short quotation in place, with nothing to open", () => {
    render(<QuotedText text="Joining the family business" title="Opt-out reason" />);

    expect(screen.getByText(/joining the family business/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /read the full reason/i })).toBeNull();
  });

  /** A queue holds several people's reasons, so the trigger names whose it opens. */
  it("names whose words the trigger opens", () => {
    render(<QuotedText text={LONG} title="Opt-out reason" subject="Priya Ramesh" />);

    expect(
      screen.getByRole("button", { name: "Read the full reason — Priya Ramesh" }),
    ).toBeDefined();
  });

  it("opens the whole text in a popup, and closes it again", async () => {
    const user = userEvent.setup();
    render(<QuotedText text={LONG} title="Opt-out reason" />);

    await user.click(screen.getByRole("button", { name: /read the full reason/i }));

    const dialog = screen.getByRole("dialog", { name: "Opt-out reason" });
    expect(dialog.textContent).toContain(LONG);

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
