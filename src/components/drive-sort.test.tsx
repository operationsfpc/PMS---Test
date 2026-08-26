// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DriveSort } from "./drive-sort";

/**
 * The one sort control every drive list uses.
 *
 * 2026-08-26 (Karthik): "add the Oldest First and Newest First sort buttons to
 * the Live Drives section" — which existed on the publish queue and the drive
 * picker and nowhere else. Extracted rather than copied a third time: three
 * copies of a control is three chances for one of them to keep the old
 * default after the default changes.
 */
describe("DriveSort", () => {
  it("offers both orders", () => {
    render(<DriveSort value="newest" onChange={vi.fn()} />);

    const select = screen.getByLabelText(/sort/i);
    expect(screen.getByRole("option", { name: /newest first/i })).toBeDefined();
    expect(screen.getByRole("option", { name: /oldest first/i })).toBeDefined();
    expect((select as HTMLSelectElement).value).toBe("newest");
  });

  it("reports the order the reader chose", async () => {
    const onChange = vi.fn();
    render(<DriveSort value="newest" onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText(/sort/i), "oldest");

    expect(onChange).toHaveBeenCalledWith("oldest");
  });

  /** Newest is the default, so it is the option a reader sees first. */
  it("lists newest first, because that is the default", () => {
    render(<DriveSort value="newest" onChange={vi.fn()} />);

    const options = screen.getAllByRole("option");
    expect(options[0]?.textContent).toMatch(/newest first/i);
  });
});
