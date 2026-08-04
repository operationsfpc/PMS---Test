// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileField, TextField, UPLOAD_ACCEPT, UPLOAD_MAX_MB } from "./form";

/**
 * Requested 2026-08-04: every upload field must state its limits up front.
 *
 * The cap is enforced by storage (0010 sets it at 5 MB) and the input already
 * restricted the picker to PDFs, but neither was ever written down where a
 * student could read it. They found out by having an upload rejected.
 */
/**
 * Requested 2026-08-04: "whenever data is mandatory it has to be called out",
 * and "when file is not submitted, reason has to be highlighted".
 *
 * The asterisk existed but was aria-hidden, so it was called out to sighted
 * users only. And no upload field could show an error at all - a student who
 * left a marksheet out was told the form failed, but never which one.
 */
describe("mandatory fields", () => {
  it("says it is required, not just in red", () => {
    render(<TextField label="Mobile number" required />);

    // By ROLE and accessible name: that is the name a screen reader announces,
    // and unlike getByLabelText it excludes the decorative asterisk.
    expect(screen.getByRole("textbox", { name: /mobile number\s*\(required\)/i })).toBeDefined();
  });

  it("marks the control required for assistive technology too", () => {
    render(<TextField label="Mobile number" required />);

    expect(screen.getByLabelText(/mobile number/i).getAttribute("aria-required")).toBe("true");
  });

  it("leaves an optional field unmarked", () => {
    render(<TextField label="WhatsApp number" />);

    expect(screen.getByLabelText("WhatsApp number")).toBeDefined();
  });
});

describe("a field that failed validation", () => {
  it("shows the reason and ties it to the control", () => {
    render(<TextField label="Mobile number" required error="Enter a valid 10-digit number" />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/10-digit/i);
    expect(screen.getByLabelText(/mobile number/i).getAttribute("aria-invalid")).toBe("true");
  });

  it("says which upload is missing, on the upload itself", () => {
    render(<FileField label="10th marksheet" required error="Your 10th marksheet is required." />);

    expect(screen.getByRole("alert").textContent).toMatch(/10th marksheet is required/i);
    expect(screen.getByLabelText(/10th marksheet/i).getAttribute("aria-invalid")).toBe("true");
  });
});

describe("FileField", () => {
  it("states the size limit and the accepted formats", () => {
    render(<FileField label="10th marksheet" />);

    const hint = screen.getByText(new RegExp(`${UPLOAD_MAX_MB}\\s*MB`, "i"));
    expect(hint).toBeDefined();
    expect(hint.textContent).toMatch(/pdf/i);
  });

  it("keeps a caller's own hint as well as the limits", () => {
    render(<FileField label="Resume" hint="Use your most recent one." />);

    expect(screen.getByText(/most recent one/i)).toBeDefined();
    expect(screen.getByText(new RegExp(`${UPLOAD_MAX_MB}\\s*MB`, "i"))).toBeDefined();
  });

  it("restricts the file picker to the formats it advertises", () => {
    render(<FileField label="10th marksheet" />);

    expect(screen.getByLabelText(/10th marksheet/i).getAttribute("accept")).toBe(UPLOAD_ACCEPT);
  });
});
