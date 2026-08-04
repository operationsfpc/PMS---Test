// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileField, UPLOAD_ACCEPT, UPLOAD_MAX_MB } from "./form";

/**
 * Requested 2026-08-04: every upload field must state its limits up front.
 *
 * The cap is enforced by storage (0010 sets it at 5 MB) and the input already
 * restricted the picker to PDFs, but neither was ever written down where a
 * student could read it. They found out by having an upload rejected.
 */
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
