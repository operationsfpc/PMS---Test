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
      // SPEC CHANGE 2026-08-27 (approved): a declaration now states which of
      // the two figures it carries. A salaried offer has no stipend, and says
      // so rather than leaving the reader to infer it from an absence.
      stipendMonthly: null,
      // Spec B (2026-08-24): the declaration carries the letter slot.
      letter: null,
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

/**
 * Spec B (approved 2026-08-24): the recruiter's offer letter, filed with the
 * declaration — or after it (answer 1d).
 */
describe("OfferPage — the offer letter", () => {
  const [UNDECLARED, DECLARED] = CANDIDATES as [
    (typeof CANDIDATES)[number],
    (typeof CANDIDATES)[number],
  ];
  const withLetters = (over: Partial<OfferView> = {}) =>
    view({
      candidates: async () => [
        { ...UNDECLARED, letterName: null, letterUrl: null },
        { ...DECLARED, letterName: "Zoho-offer.pdf", letterUrl: "/signed/offer.pdf" },
      ],
      ...over,
    });

  it("offers an optional letter input on an undeclared row", async () => {
    render(<OfferPage driveId="d1" view={withLetters()} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByLabelText(/offer letter \(optional/i)).toBeDefined();
  });

  it("sends the chosen letter with the declaration", async () => {
    const declare = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<OfferPage driveId="d1" view={withLetters({ declare })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li") as HTMLElement;
    const letter = new File(["x"], "letter.pdf", { type: "application/pdf" });
    await user.upload(within(row).getByLabelText(/offer letter \(optional/i), letter);
    await user.click(within(row).getByRole("button", { name: /declare selected/i }));

    await waitFor(() => expect(declare).toHaveBeenCalled());
    const sent = (declare.mock.calls.at(0) as unknown[] | undefined)?.at(0) as { letter?: File };
    expect(sent.letter?.name).toBe("letter.pdf");
  });

  it("shows a declared row's letter as a link", async () => {
    render(<OfferPage driveId="d1" view={withLetters()} />);

    const row = (await screen.findByText("Arjun Menon")).closest("li") as HTMLElement;
    const link = within(row).getByRole("link", { name: /Zoho-offer\.pdf/ });
    expect(link.getAttribute("href")).toBe("/signed/offer.pdf");
  });

  it("offers attach-later on a declared row with no letter (answer 1d)", async () => {
    const attachLetter = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(
      <OfferPage
        driveId="d1"
        view={withLetters({
          candidates: async () => [{ ...DECLARED, letterName: null, letterUrl: null }],
          attachLetter,
        })}
      />,
    );

    const row = (await screen.findByText("Arjun Menon")).closest("li") as HTMLElement;
    const letter = new File(["x"], "late.pdf", { type: "application/pdf" });
    await user.upload(within(row).getByLabelText(/attach offer letter/i), letter);

    await waitFor(() => expect(attachLetter).toHaveBeenCalledWith("s2", "d1", letter));
  });
});

/**
 * 🔴 Karthik, 2026-08-27: "go with option 1" — an internship offer records a
 * stipend, not a CTC.
 *
 * P10 let the DRIVE go live on a stipend alone. This screen still demanded
 * "CTC (LPA)" and refused anything ≤ 0, so the two live offers on the XYZ
 * internship — a drive paying ₹15,000 a month — were recorded at ₹10 and ₹12
 * LPA. The coordinator did not mistype; the box would take nothing else.
 */
describe("declaring an offer on an internship drive", () => {
  const INTERNSHIP = {
    driveId: "d1",
    companyName: "XYZ",
    roleTitle: "Jr. Software engineer",
    driveType: "internship" as const,
    offerCategory: "internship" as const,
    suggestedCtcLpa: 0,
    suggestedStipendMonthly: 15000,
  };

  const internshipView = (overrides: Partial<OfferView> = {}): OfferView => ({
    drive: async () => INTERNSHIP,
    candidates: async () => CANDIDATES,
    declare: async () => undefined,
    ...overrides,
  });

  it("asks for a monthly stipend, never a CTC", async () => {
    render(<OfferPage driveId="d1" view={internshipView()} />);

    expect(await screen.findByLabelText(/stipend.*month/i)).toBeDefined();
    expect(screen.queryByLabelText(/CTC/i)).toBeNull();
  });

  it("pre-fills the stipend the drive itself records", async () => {
    render(<OfferPage driveId="d1" view={internshipView()} />);

    const field = await screen.findByLabelText<HTMLInputElement>(/stipend.*month/i);
    expect(field.value).toBe("15000");
  });

  it("declares the stipend and no CTC at all", async () => {
    const declare = vi.fn();
    const user = userEvent.setup();
    render(<OfferPage driveId="d1" view={internshipView({ declare })} />);

    await user.click(await screen.findByRole("button", { name: /declare selected/i }));

    await waitFor(() => expect(declare).toHaveBeenCalled());
    expect(declare.mock.calls[0]?.[0]).toMatchObject({
      stipendMonthly: 15000,
      ctcLpa: null,
    });
  });

  it("refuses to declare an internship with no stipend, and says which figure", async () => {
    const declare = vi.fn();
    const user = userEvent.setup();
    render(<OfferPage driveId="d1" view={internshipView({ declare })} />);

    const field = await screen.findByLabelText(/stipend.*month/i);
    await user.clear(field);
    await user.click(screen.getByRole("button", { name: /declare selected/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/stipend/i);
    expect(declare).not.toHaveBeenCalled();
  });

  it("still asks a salaried drive for a CTC", async () => {
    render(<OfferPage driveId="d1" view={view()} />);

    expect(await screen.findByLabelText(/CTC/i)).toBeDefined();
    expect(screen.queryByLabelText(/stipend/i)).toBeNull();
  });
});
