// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VisitPane, type VisitPaneRole } from "./visit-pane";

const ROLES: VisitPaneRole[] = [
  { id: "d-1", label: "Software Engineer", count: 18, content: <p>Priya Menon</p> },
  { id: "d-2", label: "QA Analyst", count: 5, content: <p>Rahul Verma</p> },
];

function show(props: {
  roles: readonly VisitPaneRole[];
  activeId?: string;
  onClose?: () => void;
  description?: string;
}) {
  render(
    <VisitPane
      open
      company="TCS"
      onClose={props.onClose ?? (() => {})}
      roles={props.roles}
      {...(props.activeId === undefined ? {} : { activeId: props.activeId })}
      {...(props.description === undefined ? {} : { description: props.description })}
    />,
  );
}

describe("the company visit pane", () => {
  it("names the company once and puts every role beside it as a tab", () => {
    show({ roles: ROLES });
    const dialog = screen.getByRole("dialog");

    expect(screen.getAllByRole("heading", { name: "TCS" })).toHaveLength(1);
    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Software Engineer (18)", "QA Analyst (5)"]);
  });

  it("opens on the role the reader asked for and mounts only that roster", () => {
    show({ roles: ROLES, activeId: "d-2" });
    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("tab", { name: "QA Analyst (5)" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(within(dialog).getByText("Rahul Verma")).toBeDefined();
    expect(within(dialog).queryByText("Priya Menon")).toBeNull();
  });

  it("swaps the roster when the other role's tab is picked", async () => {
    show({ roles: ROLES });
    const dialog = screen.getByRole("dialog");

    await userEvent.click(within(dialog).getByRole("tab", { name: "QA Analyst (5)" }));

    expect(within(dialog).getByText("Rahul Verma")).toBeDefined();
    expect(within(dialog).queryByText("Priya Menon")).toBeNull();
  });

  /**
   * A long roster scrolls. When the tabs sat in the scrolling body they slid
   * out of view with it, leaving the reader in one role's students with no way
   * to reach the other and no way to see which visit they were in — so the
   * strip belongs inside the header, which stays pinned.
   */
  it("pins the role tabs with the company so a long roster cannot scroll them away", () => {
    show({ roles: ROLES });
    const dialog = screen.getByRole("dialog");

    const tablist = within(dialog).getByRole("tablist");
    const header = dialog.querySelector(".sticky");
    if (header === null) throw new Error("no pinned header in the pane");
    expect(header.contains(tablist)).toBe(true);
    expect(tablist.getAttribute("aria-label")).toBe("TCS roles");
  });

  it("says a single role in the pane rather than opening a tab of one", () => {
    const [software] = ROLES;
    if (software === undefined) throw new Error("fixture missing");
    show({ roles: [software] });
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).queryByRole("tablist")).toBeNull();
    expect(within(dialog).getByText("Software Engineer")).toBeDefined();
    expect(within(dialog).getByText("Priya Menon")).toBeDefined();
  });

  it("describes the visit under the company, once", () => {
    show({ roles: ROLES, description: "Nitesh · 12 Nov · Online" });

    expect(screen.getAllByText("Nitesh · 12 Nov · Online")).toHaveLength(1);
  });

  it("tells the page when the reader is done with the visit", async () => {
    const onClose = vi.fn();
    show({ roles: ROLES, onClose });

    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape, so the keyboard leaves the same way it came", async () => {
    const onClose = vi.fn();
    show({ roles: ROLES, onClose });

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
