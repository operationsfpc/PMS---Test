// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

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
});
