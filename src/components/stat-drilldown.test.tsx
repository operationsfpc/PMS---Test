// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { type DrilldownPerson, StatDrilldown } from "./stat-drilldown";

const ASHA: DrilldownPerson = {
  id: "s1",
  name: "Asha Rani",
  rollNumber: "21CSE1042",
  campus: "Main campus",
  programme: "B.Tech CSE",
  cgpa: 8.5,
  status: "Shortlisted",
};
const VIKRAM: DrilldownPerson = {
  ...ASHA,
  id: "s2",
  name: "Vikram Kumar",
  rollNumber: "21CSE1108",
  cgpa: 9.1,
};
const DEEPA: DrilldownPerson = {
  ...ASHA,
  id: "s3",
  name: "Deepa Shree",
  rollNumber: "22ECE0311",
  campus: "Side campus",
  programme: "B.Tech ECE",
  cgpa: 7.05,
  status: "Applied",
};

function renderDrilldown(props: {
  people: readonly DrilldownPerson[];
  onClose?: () => void;
  note?: string;
  href?: string;
  emptyText?: string;
}) {
  render(
    <MemoryRouter>
      <StatDrilldown
        open
        onClose={props.onClose ?? (() => {})}
        eyebrow="Applicants"
        title="Applied to Assistant System Engineer"
        people={props.people}
        {...(props.note === undefined ? {} : { note: props.note })}
        {...(props.href === undefined ? {} : { href: props.href })}
        {...(props.emptyText === undefined ? {} : { emptyText: props.emptyText })}
      />
    </MemoryRouter>,
  );
}

/** The rows the popup is actually showing, minus the table's own chrome. */
function rows(dialog: HTMLElement) {
  return within(dialog)
    .getAllByRole("row")
    .filter((row) => within(row).queryAllByRole("columnheader").length === 0);
}

describe("the count→who popup", () => {
  it("names the people behind the number instead of repeating the number", () => {
    renderDrilldown({ people: [ASHA, VIKRAM, DEEPA] });
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("Asha Rani")).toBeDefined();
    expect(within(dialog).getByText("Vikram Kumar")).toBeDefined();
    expect(within(dialog).getByText("Deepa Shree")).toBeDefined();
    expect(within(dialog).getByText(/3 students/)).toBeDefined();
  });

  it("counts exactly as many rows as the dialog names", () => {
    renderDrilldown({ people: [ASHA, VIKRAM, DEEPA] });
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText(/3 students/)).toBeDefined();
    expect(rows(dialog)).toHaveLength(3);
  });

  it("sends each name to that student's record, and closes behind it", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDrilldown({ people: [ASHA], onClose });
    const dialog = screen.getByRole("dialog");

    const link = within(dialog).getByRole("link", { name: "Asha Rani" });
    expect(link.getAttribute("href")).toBe("/students/s1");

    await user.click(link);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("spells a CGPA the way the roster pages do", () => {
    renderDrilldown({ people: [ASHA] });
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("8.50")).toBeDefined();
  });

  it("drops a column nobody in the list can fill", () => {
    renderDrilldown({
      people: [{ id: "s9", name: "Farida", status: "Absent" }],
    });
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).queryByText("Campus")).toBeNull();
    expect(within(dialog).queryByText("CGPA")).toBeNull();
    expect(within(dialog).queryByText("Roll no.")).toBeNull();
    expect(within(dialog).getByText("Absent")).toBeDefined();
  });

  it("says so in words when the count turned out to hold nobody", () => {
    renderDrilldown({ people: [], emptyText: "No applications yet." });
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("No applications yet.")).toBeDefined();
    expect(within(dialog).queryByRole("row")).toBeNull();
  });

  it("filters a count that spans more than one group, and recounts the header", async () => {
    const user = userEvent.setup();
    renderDrilldown({
      people: [
        { ...ASHA, group: "Main campus" },
        { ...VIKRAM, group: "Main campus" },
        { ...DEEPA, group: "Side campus" },
      ],
    });
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("tab", { name: "Side campus (1)" }));

    expect(within(dialog).getByText(/1 student\b/)).toBeDefined();
    expect(within(dialog).getByText("Deepa Shree")).toBeDefined();
    expect(within(dialog).queryByText("Asha Rani")).toBeNull();
    expect(rows(dialog)).toHaveLength(1);
  });

  it("keeps one quiet list when the whole count is one group", () => {
    renderDrilldown({
      people: [
        { ...ASHA, group: "Main campus" },
        { ...VIKRAM, group: "Main campus" },
      ],
    });

    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("offers the same list with more room, and closes on the way out", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDrilldown({ people: [ASHA], onClose, href: "/central/students" });
    const dialog = screen.getByRole("dialog");

    const footer = within(dialog).getByRole("link", { name: /open this list in all students/i });
    expect(footer.getAttribute("href")).toBe("/central/students");

    await user.click(footer);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
