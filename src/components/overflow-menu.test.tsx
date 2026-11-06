// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OverflowMenu } from "./overflow-menu";

/**
 * 2026-11-06: the three dots that hold a screen's less-pressed actions.
 *
 * The rule the whole component exists to keep: an action hidden behind the
 * dots is still a control the user can find, read and refuse. So the trigger
 * names what the popup is about, a greyed item says why in the item itself,
 * and nothing stays open over the thing it just opened.
 */
function menu(items: Parameters<typeof OverflowMenu>[0]["items"]) {
  return render(<OverflowMenu label="Round and drive actions" items={items} />);
}

const OPEN = [
  { label: "Manage rounds…", onSelect: () => undefined },
  { label: "Mark drive completed…", onSelect: () => undefined },
];

describe("OverflowMenu", () => {
  it("keeps its items to itself until the dots are pressed", async () => {
    const user = userEvent.setup();
    menu(OPEN);

    expect(screen.queryByRole("menuitem")).toBeNull();
    await user.click(screen.getByRole("button", { name: /round and drive actions/i }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("runs the action it was given and shuts itself", async () => {
    const manage = vi.fn();
    const user = userEvent.setup();
    menu([{ label: "Manage rounds…", onSelect: manage }, ...OPEN.slice(1)]);

    await user.click(screen.getByRole("button", { name: /round and drive actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /manage rounds/i }));

    expect(manage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("says the reason inside a greyed item, and fires nothing", async () => {
    const write = vi.fn();
    const user = userEvent.setup();
    menu([
      {
        label: "Mark drive completed…",
        onSelect: write,
        disabled: true,
        note: "Nothing to complete — this drive was never published.",
      },
    ]);

    await user.click(screen.getByRole("button", { name: /round and drive actions/i }));
    const item = (await screen.findByRole("menuitem", {
      name: /mark drive completed/i,
    })) as HTMLButtonElement;

    expect(item.disabled).toBe(true);
    expect(item.textContent).toMatch(/nothing to complete — this drive was never published/i);
    await user.click(item);
    expect(write).not.toHaveBeenCalled();
  });

  it("spins the item whose own read is still out", async () => {
    const user = userEvent.setup();
    menu([{ label: "Manage rounds…", onSelect: () => undefined, pending: true }]);

    await user.click(screen.getByRole("button", { name: /round and drive actions/i }));
    const item = screen.getByRole("menuitem", { name: /manage rounds/i });
    expect(item.getAttribute("aria-busy")).toBe("true");
    expect(item.querySelector("svg")).not.toBeNull();
  });

  it("waits for the popup an item opens, and does not leave the wait unsaid", async () => {
    const user = userEvent.setup();
    let settle: () => void = () => undefined;
    const read = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const openDialog = vi.fn(() => read);
    menu([{ label: "Manage rounds…", onSelect: openDialog, pending: true }]);

    await user.click(screen.getByRole("button", { name: /round and drive actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /manage rounds/i }));

    // The read is still out: the item that was pressed is still there, spinning.
    expect(screen.getByRole("menuitem", { name: /manage rounds/i }).getAttribute("aria-busy")).toBe(
      "true",
    );

    await act(async () => {
      settle();
      await read;
    });
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("hands the keyboard back on Escape", async () => {
    const user = userEvent.setup();
    menu(OPEN);

    const trigger = screen.getByRole("button", { name: /round and drive actions/i });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menuitem")).toBeNull();
    // A keyboard user must not be dropped at the top of the page.
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the click lands outside it", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <OverflowMenu label="Round and drive actions" items={OPEN} />
        <p>the rest of the page</p>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /round and drive actions/i }));
    await user.click(screen.getByText("the rest of the page"));

    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});
