// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import { type ColumnDef, ShadcnDataTable } from "./data-table";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";
import { TablePager } from "./table-pager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Button, StatCard } from "./ui";

describe("Sheet Component", () => {
  it("opens and displays content when trigger is clicked and closes on close button", async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Open Drawer</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Student Details</SheetTitle>
            <SheetDescription>Verify marksheet proofs below</SheetDescription>
          </SheetHeader>
          <div>Drawer body content</div>
          <SheetFooter>
            <SheetClose>Dismiss</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.queryByText("Student Details")).toBeNull();

    await user.click(screen.getByRole("button", { name: /open drawer/i }));

    expect(screen.getByText("Student Details")).toBeDefined();
    expect(screen.getByText("Verify marksheet proofs below")).toBeDefined();
    expect(screen.getByText("Drawer body content")).toBeDefined();

    // Dismiss button
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() => {
      expect(screen.queryByText("Student Details")).toBeNull();
    });
  });
  /**
   * UAT 2026-10-18: "the Drive Progress section and its popup are partially
   * hidden." The drawer used to scroll as one block, so a roster long enough to
   * scroll took the company name, the role tabs and the close button off the top
   * with it. jsdom cannot measure a scroll, but it can hold the structure that
   * makes sticking possible: the panel must not be the scroll container, and the
   * header and footer must stick inside the one that is.
   */
  it("keeps the heading and the footer stuck while the body scrolls", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Wipro</SheetTitle>
          </SheetHeader>
          <div>34 students</div>
          <SheetFooter>
            <SheetClose>Dismiss</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );

    const panel = screen.getByRole("dialog");
    const body = panel.querySelector(".overflow-y-auto");
    expect(body).not.toBeNull();
    expect(panel.className).not.toContain("overflow-y-auto");
    expect(panel.className).toContain("overflow-hidden");

    const header = screen.getByText("Wipro").closest(".sticky");
    const footer = screen.getByRole("button", { name: /dismiss/i }).closest(".sticky");
    expect(header).not.toBeNull();
    expect(footer).not.toBeNull();
    // Both must live inside the scrolling region, or they cannot stick to it.
    expect(body?.contains(header)).toBe(true);
    expect(body?.contains(footer)).toBe(true);
    expect(header?.className).toContain("top-0");
    expect(footer?.className).toContain("bottom-0");
  });
});

describe("DataTable controls", () => {
  const PEOPLE: readonly ColumnDef<{ id: string; name: string }>[] = [
    { id: "name", header: "Student", accessorKey: "name", sortable: true },
  ];

  it("sorts from a real button, and says which way the column is ordered", async () => {
    const user = userEvent.setup();
    render(
      <ShadcnDataTable
        data={[
          { id: "1", name: "Zoya" },
          { id: "2", name: "Asha" },
        ]}
        columns={PEOPLE}
      />,
    );

    // A click handler on the cell itself was mouse-only: reachable by a pointer,
    // invisible to a keyboard.
    const sort = screen.getByRole("button", { name: /^student$/i });
    expect(screen.getByRole("columnheader", { name: /student/i })).toBeDefined();
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("none");

    await user.click(sort);
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("ascending");

    await user.click(sort);
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("descending");
  });

  /**
   * Clearing the search puts the reader back at the top of the full list: the
   * box and the pager live in one frame, so page 3 of a narrowed list was
   * reopening page 3 of the whole roster.
   */
  it("starts the full list at page one when the search is cleared", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`,
      name: i === 29 ? "Zoya" : `Student ${i}`,
    }));
    render(<ShadcnDataTable data={many} columns={PEOPLE} defaultPageSize={10} />);

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 3")).toBeDefined();

    await user.type(screen.getByPlaceholderText("Search records…"), "Zoya");
    expect(screen.getByText("Page 1 of 1")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /clear search/i }));
    expect(screen.getByText("Page 1 of 3")).toBeDefined();
  });

  /**
   * 2026-10-31: the pager used to be `sticky bottom-0`, so a scrolled roster
   * parked it mid-list with the last row painted in the strip beneath it
   * ("Sneha Pillai" beside "Page 1 of 9"). In a filled frame the table card is
   * the only scroll box: the search and the pager are siblings of it and can
   * never overlap a row.
   */
  it("scrolls the rows while the search and the pager stay in frame", () => {
    render(<ShadcnDataTable data={[{ id: "1", name: "Asha" }]} columns={PEOPLE} fit />);

    const scroller = screen.getByRole("region", { name: "Data table" });
    expect(scroller.contains(screen.getByRole("table"))).toBe(true);
    expect(scroller.contains(screen.getByPlaceholderText("Search records…"))).toBe(false);
    expect(scroller.contains(screen.getByRole("button", { name: /previous/i }))).toBe(false);
  });
});

describe("TablePager", () => {
  it("says the range and the page, and pages forward", async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    render(<TablePager page={0} pageSize={25} total={51} onPage={onPage} unit="students" />);

    expect(screen.getByText(/showing 1 to 25 of 51 students/i)).toBeDefined();
    expect(screen.getByText("Page 1 of 3")).toBeDefined();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it("clamps a page the list has shrunk past", () => {
    render(<TablePager page={8} pageSize={25} total={30} onPage={() => {}} />);

    expect(screen.getByText("Page 2 of 2")).toBeDefined();
    expect(screen.getByText(/showing 26 to 30 of 30 records/i)).toBeDefined();
  });
});

describe("AlertDialog Component", () => {
  it("opens confirmation modal and triggers confirm action", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <AlertDialog>
        <AlertDialogTrigger>Reject Drive</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The drive will be permanently rejected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Pending</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={onConfirm}>
              Confirm Rejection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    expect(screen.queryByText("Are you sure?")).toBeNull();

    await user.click(screen.getByRole("button", { name: /reject drive/i }));

    expect(screen.getByText("Are you sure?")).toBeDefined();
    expect(screen.getByText(/this action cannot be undone/i)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /confirm rejection/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.queryByText("Are you sure?")).toBeNull();
    });
  });
});

describe("Tabs Component", () => {
  it("switches active tab panels when tabs are selected", async () => {
    const user = userEvent.setup();

    render(
      <Tabs defaultValue="yet-to-publish">
        <TabsList>
          <TabsTrigger value="yet-to-publish">Yet to Publish</TabsTrigger>
          <TabsTrigger value="live">Live Drives</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>
        <TabsContent value="yet-to-publish">Cockpit Drives List</TabsContent>
        <TabsContent value="live">Active Live Drives</TabsContent>
        <TabsContent value="completed">Past Drives Archive</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("Cockpit Drives List")).toBeDefined();
    expect(screen.queryByText("Active Live Drives")).toBeNull();

    await user.click(screen.getByRole("tab", { name: /live drives/i }));

    expect(screen.queryByText("Cockpit Drives List")).toBeNull();
    expect(screen.getByText("Active Live Drives")).toBeDefined();
  });
});

describe("Accordion Component", () => {
  const roster = (multiple?: boolean) => (
    <Accordion {...(multiple === undefined ? {} : { multiple })}>
      <AccordionItem value="tcs">
        <AccordionTrigger>TCS · 3 roles</AccordionTrigger>
        <AccordionContent>
          <p>Backend Engineer panel</p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="infy">
        <AccordionTrigger>Infosys · 2 roles</AccordionTrigger>
        <AccordionContent>
          <p>Systems Engineer panel</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );

  /**
   * The panel is the element that carries `hidden`, and it is the direct parent
   * of the row list. Querying it by role would ask testing-library to see
   * through the very attribute under test.
   */
  const isClosed = (inside: string) =>
    (screen.getByText(inside).parentElement as HTMLElement).hasAttribute("hidden");

  it("hides panels until their trigger is pressed, then wires aria-expanded", async () => {
    const user = userEvent.setup();
    render(roster());

    const trigger = screen.getByRole("button", { name: /tcs/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(isClosed("Backend Engineer panel")).toBe(true);

    await user.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(isClosed("Backend Engineer panel")).toBe(false);
  });

  it("closes the previous panel in single mode", async () => {
    const user = userEvent.setup();
    render(roster());

    await user.click(screen.getByRole("button", { name: /tcs/i }));
    await user.click(screen.getByRole("button", { name: /infosys/i }));

    // One at a time: opening Infosys closed TCS.
    expect(isClosed("Backend Engineer panel")).toBe(true);
    expect(isClosed("Systems Engineer panel")).toBe(false);
  });

  it("keeps both open when the accordion allows multiple panels", async () => {
    const user = userEvent.setup();
    render(roster(true));

    await user.click(screen.getByRole("button", { name: /tcs/i }));
    await user.click(screen.getByRole("button", { name: /infosys/i }));

    expect(isClosed("Backend Engineer panel")).toBe(false);
    expect(isClosed("Systems Engineer panel")).toBe(false);
  });

  it("collapses again when the open trigger is pressed a second time", async () => {
    const user = userEvent.setup();
    render(roster());

    const trigger = screen.getByRole("button", { name: /tcs/i });
    await user.click(trigger);
    await user.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(isClosed("Backend Engineer panel")).toBe(true);
  });
});

describe("Button loading state", () => {
  it("cannot be pressed while it is loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button isLoading onClick={onClick}>
        Publish drive
      </Button>,
    );

    const button = screen.getByRole("button", { name: /publish drive/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows the spinner and keeps the label so the button does not resize", () => {
    render(<Button isLoading>Save venue</Button>);
    const button = screen.getByRole("button", { name: /save venue/i });
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.textContent).toBe("Save venue");
  });
});

describe("Pressable StatCard", () => {
  it("opens the people behind the number when given a handler", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<StatCard label="Placed" value={42} hint="on campus" onClick={onClick} />);

    const card = screen.getByRole("button", { name: /placed/i });
    expect(card.getAttribute("aria-haspopup")).toBe("dialog");

    await user.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("stays a plain figure with no handler", () => {
    render(<StatCard label="Offers" value={7} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Offers")).toBeDefined();
  });
});

describe("Sheet focus and scrolling", () => {
  const drawer = (
    <Sheet>
      <SheetTrigger>Open shortlist</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Shortlisted students</SheetTitle>
        </SheetHeader>
        <button type="button">Row link</button>
        <SheetFooter>
          <SheetClose>Done</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );

  it("moves focus into the drawer, traps Tab, and restores it on close", async () => {
    const user = userEvent.setup();
    render(drawer);

    const trigger = screen.getByRole("button", { name: /open shortlist/i });
    await user.click(trigger);

    const panel = screen.getByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");

    // Tab from the last control wraps to the first, and never escapes to the page.
    const done = within(panel).getByRole("button", { name: /done/i });
    done.focus();
    await user.tab();
    expect(panel.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
  });
});

describe("ShadcnDataTable Component", () => {
  interface TestCandidate {
    id: string;
    name: string;
    cgpa: number;
    branch: string;
  }

  const sampleData: TestCandidate[] = [
    { id: "1", name: "Asha Ramanathan", cgpa: 8.7, branch: "CSE" },
    { id: "2", name: "Karthik Raja", cgpa: 9.1, branch: "IT" },
    { id: "3", name: "Bala Murugan", cgpa: 7.4, branch: "ECE" },
    { id: "4", name: "Deepa S", cgpa: 8.2, branch: "CSE" },
  ];

  const columns: ColumnDef<TestCandidate>[] = [
    { id: "name", header: "Candidate Name", accessorKey: "name", sortable: true },
    { id: "cgpa", header: "CGPA", accessorKey: "cgpa", sortable: true },
    { id: "branch", header: "Branch", accessorKey: "branch", sortable: true },
  ];

  it("renders table with columns and data", () => {
    render(<ShadcnDataTable data={sampleData} columns={columns} />);

    expect(screen.getByText("Candidate Name")).toBeDefined();
    expect(screen.getByText("CGPA")).toBeDefined();
    expect(screen.getByText("Branch")).toBeDefined();
    expect(screen.getByText("Asha Ramanathan")).toBeDefined();
    expect(screen.getByText("Karthik Raja")).toBeDefined();
  });

  it("filters rows dynamically with search query", async () => {
    const user = userEvent.setup();
    render(
      <ShadcnDataTable data={sampleData} columns={columns} searchPlaceholder="Search students…" />,
    );

    const searchInput = screen.getByPlaceholderText("Search students…");
    await user.type(searchInput, "Bala");

    expect(screen.getByText("Bala Murugan")).toBeDefined();
    expect(screen.queryByText("Asha Ramanathan")).toBeNull();
    expect(screen.queryByText("Karthik Raja")).toBeNull();
  });

  it("sorts rows when clicking sortable column header", async () => {
    const user = userEvent.setup();
    render(<ShadcnDataTable data={sampleData} columns={columns} />);

    // Click CGPA header to sort ascending
    await user.click(screen.getByText("CGPA"));

    const cells = screen.getAllByRole("cell");
    // Row 1 CGPA should be 7.4 (Bala Murugan lowest)
    expect(cells.some((c) => c.textContent === "7.4")).toBe(true);

    // Click again to sort descending
    await user.click(screen.getByText("CGPA"));
    // Row 1 CGPA should now be 9.1 (Karthik Raja highest)
    expect(cells.some((c) => c.textContent === "9.1")).toBe(true);
  });

  it("supports multi-row selection and triggers selection callback", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(
      <ShadcnDataTable
        data={sampleData}
        columns={columns}
        enableSelection
        onSelectionChange={onSelectionChange}
      />,
    );

    const row1Checkbox = screen.getByRole("checkbox", { name: /select row 1/i });
    await user.click(row1Checkbox);

    expect(onSelectionChange).toHaveBeenCalled();
    expect(screen.getByText(/1 selected/i)).toBeDefined();

    // Select all visible
    const selectAllCheckbox = screen.getByRole("checkbox", { name: /select all visible rows/i });
    await user.click(selectAllCheckbox);

    expect(screen.getByText(/4 selected/i)).toBeDefined();
  });

  /**
   * 2026-10-29 UAT: the "See who" drawer kept the old page number when the
   * list shrank under it (the group tabs), printing "Page 2 of 1" over nothing.
   */
  it("returns to a page that exists when the rows shrink under it", async () => {
    const user = userEvent.setup();
    const many: TestCandidate[] = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      name: `Candidate ${i}`,
      cgpa: 7,
      branch: "CSE",
    }));

    const { rerender } = render(
      <ShadcnDataTable data={many} columns={columns} defaultPageSize={10} />,
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 3 of 3")).toBeDefined();

    rerender(<ShadcnDataTable data={many.slice(0, 4)} columns={columns} defaultPageSize={10} />);

    await waitFor(() => expect(screen.getByText("Page 1 of 1")).toBeDefined());
    expect(screen.queryByText("Page 3 of 1")).toBeNull();
    expect(screen.getByText("Candidate 0")).toBeDefined();
  });
});
