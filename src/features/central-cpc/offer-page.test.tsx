// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OfferPage, type OfferView } from "./offer-page";

/**
 * Declaring the final selection.
 *
 * Domain model 6: being placed is an EXPLICIT declaration, never inferred
 * from the last round - a recruiter's final round is not always their final
 * word, and inferring it would place students who were never offered
 * anything. This row is the input to R3, R4 and R9, so its shape decides what
 * every one of those rules sees.
 */
const DRIVE = {
  driveId: "d1",
  companyName: "Zoho",
  roleTitle: "MTS",
  driveType: "placement" as const,
  offerCategory: "dream" as const,
  suggestedCtcLpa: 7.5,
};

const CANDIDATES = [
  {
    applicationId: "app1",
    studentId: "s1",
    studentName: "Priya Ramesh",
    rollNumber: "21CSE1042",
    declared: false,
  },
  {
    applicationId: "app2",
    studentId: "s2",
    studentName: "Arjun Menon",
    rollNumber: "21CSE9001",
    declared: true,
  },
];

function view(overrides: Partial<OfferView> = {}): OfferView {
  return {
    drive: async () => DRIVE,
    candidates: async () => CANDIDATES,
    declare: async () => undefined,
    ...overrides,
  };
}

describe("OfferPage", () => {
  it("lists the students who reached the final round", async () => {
    render(<OfferPage driveId="d1" view={view()} />);

    expect(await screen.findByText("Priya Ramesh")).toBeDefined();
    expect(screen.getByRole("heading", { name: /Zoho/ })).toBeDefined();
  });

  it("pre-fills the CTC from the drive but lets it be changed per student", async () => {
    const declare = vi.fn();
    const user = userEvent.setup();
    render(<OfferPage driveId="d1" view={view({ declare })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");

    const ctc = within(row).getByLabelText(/ctc/i);
    expect((ctc as HTMLInputElement).value).toBe("7.5");

    await user.clear(ctc);
    await user.type(ctc, "9.25");
    await user.click(within(row).getByRole("button", { name: /declare/i }));

    await waitFor(() => expect(declare).toHaveBeenCalledTimes(1));
    expect(declare).toHaveBeenCalledWith({
      studentId: "s1",
      driveId: "d1",
      companyName: "Zoho",
      roleTitle: "MTS",
      driveType: "placement",
      offerCategory: "dream",
      ctcLpa: 9.25,
    });
  });

  it("shows who has already been declared, and does not offer to do it twice", async () => {
    render(<OfferPage driveId="d1" view={view()} />);

    const row = (await screen.findByText("Arjun Menon")).closest("li");
    if (row === null) throw new Error("row not found");

    expect(within(row).getByText(/declared/i)).toBeDefined();
    expect(within(row).queryByRole("button", { name: /declare/i })).toBeNull();
  });

  it("refuses a CTC that is not a positive number", async () => {
    const declare = vi.fn();
    const user = userEvent.setup();
    render(<OfferPage driveId="d1" view={view({ declare })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");

    await user.clear(within(row).getByLabelText(/ctc/i));
    await user.type(within(row).getByLabelText(/ctc/i), "-3");
    await user.click(within(row).getByRole("button", { name: /declare/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(declare).not.toHaveBeenCalled();
  });

  it("surfaces a rejected declaration instead of pretending it worked", async () => {
    const user = userEvent.setup();
    render(
      <OfferPage
        driveId="d1"
        view={view({
          declare: async () => {
            throw new Error("This student has already been declared selected for this drive.");
          },
        })}
      />,
    );

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.click(within(row).getByRole("button", { name: /declare/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/already been declared/i);
  });
});
