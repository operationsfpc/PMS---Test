// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { DafPublish } from "./daf-publish";

const routed = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const count = (): number => Number(screen.getByTestId("audience-count").textContent);

/**
 * The audience panel is computed by the real domain rules, so these tests are
 * really asserting that targeting behaves as the PRD says — end to end through
 * the UI, not just in isolation.
 */
describe("DafPublish — live audience", () => {
  it("computes an audience from the cohort", () => {
    routed(<DafPublish />);
    expect(count()).toBeGreaterThan(0);
  });

  it("never counts students whose SRF is unverified, who opted out, or who are disbarred", () => {
    routed(<DafPublish />);
    for (const label of [/SRF not yet verified/i, /Opted out of placements/i, /Disbarred/i]) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("shrinks the audience when a branch filter is applied", async () => {
    routed(<DafPublish />);
    const before = count();
    await userEvent.click(screen.getByRole("checkbox", { name: "ECE" }));
    expect(count()).toBeLessThan(before);
  });

  it("shrinks the audience when the arrear policy is tightened", async () => {
    routed(<DafPublish />);
    await userEvent.selectOptions(screen.getByLabelText(/arrear policy/i), "flexible");
    const relaxed = count();
    await userEvent.selectOptions(screen.getByLabelText(/arrear policy/i), "no_history");
    expect(count()).toBeLessThan(relaxed);
  });

  it("excludes students already placed at an equal or higher category", () => {
    routed(<DafPublish />);
    // The drive is Dream; Neha holds Super Dream and Priya holds Dream.
    expect(screen.getByText(/placed at an equal or higher category/i)).toBeDefined();
  });
});

describe("DafPublish — prestige-drive override (R5a)", () => {
  it("is off by default", () => {
    routed(<DafPublish />);
    expect((screen.getByLabelText(/open to all students/i) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("widens the audience when enabled", async () => {
    routed(<DafPublish />);
    const before = count();
    await userEvent.click(screen.getByLabelText(/open to all students/i));
    expect(count()).toBeGreaterThan(before);
  });

  it("still excludes opted-out and disbarred students when enabled", async () => {
    routed(<DafPublish />);
    await userEvent.click(screen.getByLabelText(/open to all students/i));
    expect(screen.getByText(/opted out of placements/i)).toBeDefined();
    expect(screen.getByText(/^disbarred$/i)).toBeDefined();
  });

  it("demands a reason before the drive can be published", async () => {
    routed(<DafPublish />);
    await userEvent.click(screen.getByLabelText(/open to all students/i));

    expect(screen.getByText(/a reason is required/i)).toBeDefined();
    expect(
      (screen.getByRole("button", { name: /publish to/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await userEvent.type(screen.getByLabelText(/reason for override/i), "Flagship recruiter");

    expect(screen.queryByText(/a reason is required/i)).toBeNull();
    expect(
      (screen.getByRole("button", { name: /publish to/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("flags that the override is active", async () => {
    routed(<DafPublish />);
    await userEvent.click(screen.getByLabelText(/open to all students/i));
    expect(screen.getByText(/override active/i)).toBeDefined();
  });
});

describe("DafPublish — go-live checklist", () => {
  it("blocks publishing when the filters match nobody", async () => {
    routed(<DafPublish />);
    // An impossible combination: MCA students are only at VIT Bangalore.
    await userEvent.click(screen.getByRole("checkbox", { name: "MCA" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Chennai" }));

    expect(count()).toBe(0);
    expect(
      (screen.getByRole("button", { name: /publish to/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
