// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorPanel } from "./error-panel";

/**
 * A container that fails must say so AND hand the reader the way out. Every
 * screen that reported a failed load used to stop at the sentence — "Refresh
 * the page", "Please try again" — which is an instruction, not a control.
 */
describe("ErrorPanel", () => {
  it("says what failed and offers the retry that was asked for", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorPanel onRetry={onRetry}>We could not load your drives.</ErrorPanel>);

    expect(screen.getByRole("alert").textContent).toContain("We could not load your drives.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("takes the retry words a screen needs, when 'Try again' would not say it", () => {
    render(
      <ErrorPanel onRetry={() => undefined} retryLabel="Reload the queue">
        Could not load the queue.
      </ErrorPanel>,
    );

    expect(screen.getByRole("button", { name: "Reload the queue" })).toBeDefined();
  });

  it("gives no button where there is nothing to reload", () => {
    render(<ErrorPanel>The shortlist is closed.</ErrorPanel>);

    expect(screen.getByRole("alert").textContent).toContain("The shortlist is closed.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
