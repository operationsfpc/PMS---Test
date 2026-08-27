// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DriveTypeFilter } from "./drive-type-filter";

/**
 * Karthik, 2026-08-27: "let us add a filter on top of this page to select
 * drives of a particular type."
 *
 * One control, shared by every list that shows drives, so the buckets cannot
 * come to mean different things on different screens.
 */
describe("DriveTypeFilter", () => {
  it("offers All and the three types, in business order", async () => {
    render(<DriveTypeFilter value="" onChange={() => undefined} />);

    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["All", "Full time", "Internship → Full time", "Internship"]);
  });

  it("shows which one is chosen, to a screen reader and not only to the eye", () => {
    render(<DriveTypeFilter value="internship" onChange={() => undefined} />);

    expect(screen.getByRole("button", { name: "Internship" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("reports the type that was clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DriveTypeFilter value="" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Internship → Full time" }));

    expect(onChange).toHaveBeenCalledWith("internship_convertible");
  });

  it("clears back to All", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DriveTypeFilter value="internship" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "All" }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("counts what is in each bucket when the counts are given", () => {
    render(
      <DriveTypeFilter
        value=""
        onChange={() => undefined}
        counts={{ "": 24, placement: 12, internship_convertible: 10, internship: 2 }}
      />,
    );

    expect(screen.getByRole("button", { name: /^Internship 2$/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /^All 24$/ })).toBeDefined();
  });

  it("is a group with a name, so the chips are not four loose buttons", () => {
    render(<DriveTypeFilter value="" onChange={() => undefined} />);
    expect(screen.getByRole("group", { name: /drive type/i })).toBeDefined();
  });
});
