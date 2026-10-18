// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./ui";

/**
 * The one control every role's screens press.
 *
 * Its contract is that a press in flight is a press that cannot happen: a
 * double click on a declaration, a shortlist or a PIF is the duplicate row a
 * coordinator then has to find and delete.
 */
describe("Button", () => {
  it("holds the press still while it is in flight, and says so to a reader", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button isLoading onClick={onClick}>
        Declare selected
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Declare selected" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("cannot be re-enabled by a caller that passes its own state gate", () => {
    // `disabled={closed !== null}` is a STATE rule and `isLoading` is a
    // DOUBLE-PRESS rule. Read together with `??` the first switched the second
    // off, so a gated button became clickable again the moment it spun.
    render(
      <Button isLoading disabled={false}>
        Declare selected
      </Button>,
    );

    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("stays enabled when neither rule applies", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Declare selected</Button>);

    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
