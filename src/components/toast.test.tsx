// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, type ToastTone, useAppToast } from "./toast";

/**
 * Toasts sit top-right and leave on their own — confirmations in 6s, refusals
 * in 10s — but the countdown rests while the pointer is on the card so a list
 * of required fixes can be read to the end.
 */

function Fire({
  tone = "success",
  title = "Saved",
  duration,
  issues,
}: {
  tone?: ToastTone;
  title?: string;
  duration?: number;
  issues?: readonly string[];
}) {
  const { toast } = useAppToast();
  return (
    <button type="button" onClick={() => toast({ tone, title, duration, issues })}>
      fire
    </button>
  );
}

function show(props: Parameters<typeof Fire>[0] = {}) {
  render(
    <ToastProvider>
      <Fire {...props} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "fire" }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toast placement", () => {
  it("pins the stack to the top-right corner", () => {
    show();

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region.className).toContain("fixed");
    expect(region.className).toContain("top-4");
    expect(region.className).toContain("right-4");
  });
});

describe("auto-close", () => {
  it("closes a confirmation after six seconds", () => {
    show({ title: "Saved" });

    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(screen.getByText("Saved")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("lets a refusal stay ten seconds, then closes it too", () => {
    show({ tone: "danger", title: "Could not save" });

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.getByText("Could not save")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Could not save")).toBeNull();
  });

  it("honours a duration the caller chose", () => {
    show({ title: "Quick", duration: 1500 });

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText("Quick")).toBeNull();
  });

  it("closes at once when dismissed", () => {
    show({ title: "Saved" });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Saved")).toBeNull();
  });
});

describe("reading time", () => {
  it("pauses the countdown while the pointer rests on the card", () => {
    show({ title: "Saved" });
    const card = screen.getByText("Saved").closest('[role="status"]');
    expect(card).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    // React derives enter/leave from over/out, so those are the events to fire.
    fireEvent.mouseOver(card as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText("Saved")).toBeDefined();

    fireEvent.mouseOut(card as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByText("Saved")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Saved")).toBeNull();
  });
});

describe("the refusal contract the PIF flow depends on", () => {
  it("announces a refusal as an alert and lists its required fixes", () => {
    show({
      tone: "danger",
      title: "Could not save",
      issues: ["Company name is required"],
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not save");
    expect(alert.textContent).toContain("Required fixes (1):");
    expect(alert.textContent).toContain("Company name is required");
  });
});
