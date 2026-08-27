// @vitest-environment jsdom

import { ApprovalError, type ApprovalRepository } from "@lib/approval-repository";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PifApprovalQueue } from "./pif-approval-queue";

/** Each card links to /drives/:id (N1), so a router must be present. */
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

/**
 * The Delivery Head's queue against real data.
 *
 * Two irreversible things happen here: offer_category is set (immutable
 * afterwards, §3.3) and rejection becomes permanent (§3.1). The screen must
 * make both plain BEFORE the click, and must never invent its own version of
 * the banding rule.
 */
const pif = {
  id: "d1",
  companyName: "Goldman Sachs",
  roleTitle: "Analyst",
  ctcMinLpa: 18,
  ctcMaxLpa: 22,
  driveType: "placement" as const,
  onHold: false,
  createdAt: "2026-08-01T09:00:00Z",
  // J1/J2/J3 (2026-08-18): what the Delivery Head is actually approving.
  jobDescriptionUrl: null as string | null,
  jobDescriptionName: null as string | null,
  shift: "Day shift",
  joining: "Immediate joining",
  // 2026-08-27: what an internship is paid.
  stipendMinMonthly: null as number | null,
  stipendMaxMonthly: null as number | null,
};

function repo(overrides: Partial<ApprovalRepository> = {}): ApprovalRepository {
  return {
    pending: async () => [pif],
    decide: async () => undefined,
    ...overrides,
  };
}

describe("PifApprovalQueue", () => {
  it("lists PIFs awaiting approval", async () => {
    render(<PifApprovalQueue repository={repo()} />);
    expect(await screen.findByText("Goldman Sachs")).toBeDefined();
  });

  it("says so plainly when nothing is waiting", async () => {
    render(<PifApprovalQueue repository={repo({ pending: async () => [] })} />);
    expect(await screen.findByText(/nothing awaiting approval/i)).toBeDefined();
  });

  it("suggests an offer category using the real domain rule", async () => {
    render(<PifApprovalQueue repository={repo()} />);
    // ₹18-22 LPA bands to Super Dream via classifyOfferCategory.
    const select = (await screen.findByLabelText(/offer category/i)) as HTMLSelectElement;
    expect(select.value).toBe("super_dream");
  });

  it("bands a ₹6.5-9 LPA drive as Dream", async () => {
    render(
      <PifApprovalQueue
        repository={repo({
          pending: async () => [{ ...pif, ctcMinLpa: 6.5, ctcMaxLpa: 9 }],
        })}
      />,
    );
    const select = (await screen.findByLabelText(/offer category/i)) as HTMLSelectElement;
    expect(select.value).toBe("dream");
  });

  it("warns that the category cannot be changed later", async () => {
    render(<PifApprovalQueue repository={repo()} />);
    expect(await screen.findByText(/cannot be changed/i)).toBeDefined();
  });

  it("approves with the category on screen", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifApprovalQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /approve/i }));

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0]?.[2]).toEqual({
      decision: "approve",
      offerCategory: "super_dream",
    });
  });

  it("will not reject without a reason, and says why", async () => {
    const decide = vi.fn();
    const user = userEvent.setup();
    render(<PifApprovalQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /reject/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(decide).not.toHaveBeenCalled();
  });

  it("rejects with a reason once given", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifApprovalQueue repository={repo({ decide })} />);

    await user.type(await screen.findByLabelText(/rejection reason/i), "Duplicate of PIF-204");
    await user.click(screen.getByRole("button", { name: /reject/i }));

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0]?.[2]).toEqual({
      decision: "reject",
      reason: "Duplicate of PIF-204",
    });
  });

  it("surfaces a refusal from the rules rather than swallowing it", async () => {
    const decide = vi.fn().mockRejectedValue(new ApprovalError("Only a submitted PIF can be…"));
    const user = userEvent.setup();
    render(<PifApprovalQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /approve/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("Goldman Sachs")).toBeDefined();
  });

  it("flags a held drive, which cannot go live even once approved", async () => {
    render(
      <PifApprovalQueue repository={repo({ pending: async () => [{ ...pif, onHold: true }] })} />,
    );
    expect(await screen.findByText(/on hold/i)).toBeDefined();
  });
});

/**
 * UAT 2026-08-27 (live): the Delivery Head opened PIF approvals and got
 * "Could not load the queue". Nothing had failed on the wire — one of the two
 * waiting PIFs was a cap-only internship (0056) with no CTC, and suggesting a
 * category for it threw, which took the ENTIRE queue down. Every other PIF in
 * the organisation became un-approvable because of one row.
 *
 * Two rules come out of that, both tested here:
 *   1. A PIF the screen cannot classify still LISTS — one unusual row must
 *      never be able to hide the others.
 *   2. With no CTC there is no suggestion, so the Delivery Head must choose.
 *      Defaulting to Regular would have written an immutable (§3.3) category
 *      that nobody actually decided.
 */
describe("PifApprovalQueue — a PIF with no CTC (cap-only internship)", () => {
  const capOnly = {
    ...pif,
    id: "d2",
    companyName: "ABCD Infosys",
    roleTitle: "Junior Associate",
    ctcMinLpa: null,
    ctcMaxLpa: null,
    driveType: "internship" as const,
  };

  /**
   * SPEC CHANGE 2026-08-27 (approved): an INTERNSHIP now classifies itself,
   * so it is no longer an example of "nothing to suggest". The rule those
   * cases prove — no silent default, because §3.3 makes the category
   * immutable — is unchanged, and is proved here on the drive that still has
   * nothing to suggest: a full-time PIF whose CTC the AE has not filled in.
   */
  const noCtcYet = {
    ...capOnly,
    id: "d3",
    companyName: "ABCD Pending",
    driveType: "placement" as const,
  };

  it("still loads the queue — the live bug", async () => {
    render(<PifApprovalQueue repository={repo({ pending: async () => [capOnly] })} />);

    expect(await screen.findByText("ABCD Infosys")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not let one unclassifiable PIF hide the rest of the queue", async () => {
    render(<PifApprovalQueue repository={repo({ pending: async () => [capOnly, pif] })} />);

    expect(await screen.findByText("ABCD Infosys")).toBeDefined();
    expect(screen.getByText("Goldman Sachs")).toBeDefined();
  });

  it("suggests nothing, rather than silently suggesting Regular for ever", async () => {
    render(<PifApprovalQueue repository={repo({ pending: async () => [noCtcYet] })} />);

    const select = (await screen.findByLabelText(/offer category/i)) as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("refuses to approve until a category is chosen, and says why", async () => {
    const decide = vi.fn();
    const user = userEvent.setup();
    render(<PifApprovalQueue repository={repo({ pending: async () => [noCtcYet], decide })} />);

    await user.click(await screen.findByRole("button", { name: /approve/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/offer category must be set/i);
    expect(decide).not.toHaveBeenCalled();
  });

  it("approves once the Delivery Head has chosen the category themselves", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifApprovalQueue repository={repo({ pending: async () => [noCtcYet], decide })} />);

    await user.selectOptions(await screen.findByLabelText(/offer category/i), "regular");
    await user.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0]?.[2]).toEqual({ decision: "approve", offerCategory: "regular" });
  });

  it("never prints an empty range where a number should be", async () => {
    render(<PifApprovalQueue repository={repo({ pending: async () => [capOnly] })} />);

    expect(await screen.findByText(/no CTC or stipend recorded/i)).toBeDefined();
    expect(screen.queryByText(/₹—/)).toBeNull();
    expect(screen.queryByText(/null/)).toBeNull();
  });
});

/**
 * Karthik, 2026-08-27: "while approving internship PIF, stipend mentioned has
 * to be shown to delivery head. this is currently missing" and "add one more
 * there, as Internship".
 *
 * The Delivery Head approves the COMMERCIALS of a role. For an internship the
 * stipend is the only number there is, and it was not on the screen at all.
 */
describe("PifApprovalQueue — an internship", () => {
  const intern = {
    ...pif,
    id: "d-int",
    companyName: "ABCD Infosys",
    driveType: "internship" as const,
    ctcMinLpa: null,
    ctcMaxLpa: null,
    stipendMinMonthly: 15000,
    stipendMaxMonthly: 20000,
  };

  it("shows the stipend — the only number an internship has", async () => {
    render(<PifApprovalQueue repository={repo({ pending: async () => [intern] })} />);
    expect(await screen.findByText(/₹15,000–20,000 \/ month/)).toBeDefined();
  });

  it("tags the drive with its type", async () => {
    render(<PifApprovalQueue repository={repo({ pending: async () => [intern] })} />);
    expect(await screen.findByText("Internship", { selector: "span" })).toBeDefined();
  });

  it("offers Internship as the only category it can carry", async () => {
    render(<PifApprovalQueue repository={repo({ pending: async () => [intern] })} />);

    const select = (await screen.findByLabelText(/offer category/i)) as HTMLSelectElement;
    const options = [...select.options].filter((o) => o.value !== "").map((o) => o.value);
    expect(options).toEqual(["internship"]);
    expect(select.value).toBe("internship");
  });

  it("approves it as an internship without asking the Delivery Head to choose", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PifApprovalQueue repository={repo({ pending: async () => [intern], decide })} />);

    await user.click(await screen.findByRole("button", { name: /approve/i }));

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0]?.[2]).toEqual({
      decision: "approve",
      offerCategory: "internship",
    });
  });

  it("never offers the internship category to a full-time drive", async () => {
    render(<PifApprovalQueue repository={repo()} />);

    const select = (await screen.findByLabelText(/offer category/i)) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).not.toContain("internship");
  });

  it("shows a convertible drive both numbers — both are being approved", async () => {
    render(
      <PifApprovalQueue
        repository={repo({
          pending: async () => [
            {
              ...pif,
              driveType: "internship_convertible" as const,
              stipendMinMonthly: 18000,
              stipendMaxMonthly: null,
            },
          ],
        })}
      />,
    );

    expect(await screen.findByText(/₹18,000 \/ month/)).toBeDefined();
    expect(screen.getByText(/₹18–22 LPA/)).toBeDefined();
  });

  it("says so plainly when a drive records no pay at all", async () => {
    render(
      <PifApprovalQueue
        repository={repo({
          pending: async () => [{ ...intern, stipendMinMonthly: null, stipendMaxMonthly: null }],
        })}
      />,
    );

    expect(await screen.findByText(/no CTC or stipend recorded/i)).toBeDefined();
  });
});

/**
 * J1/J2/J3 (2026-08-18), answer 10: the JD belongs on the screen where the
 * role is approved. Approving a drive from a company name and a CTC is
 * approving a job title.
 */
describe("PifApprovalQueue — the JD, the shift and the joining timeline", () => {
  it("offers the attached JD as a link, named as the recruiter named it", async () => {
    render(
      <PifApprovalQueue
        repository={repo({
          pending: async () => [
            {
              ...pif,
              jobDescriptionUrl: "https://signed/jd",
              jobDescriptionName: "GS-Analyst-JD.pdf",
            },
          ],
        })}
      />,
    );

    const link = await screen.findByRole("link", { name: /GS-Analyst-JD\.pdf/ });
    expect(link.getAttribute("href")).toBe("https://signed/jd");
  });

  it("says so plainly when no JD was attached, rather than showing a dead link", async () => {
    render(<PifApprovalQueue repository={repo()} />);

    expect(await screen.findByText(/no job description attached/i)).toBeDefined();
    expect(screen.queryByRole("link", { name: /\.pdf/ })).toBeNull();
  });

  it("shows the shift and the joining timeline beside the decision", async () => {
    render(
      <PifApprovalQueue
        repository={repo({
          pending: async () => [
            {
              ...pif,
              shift: "Night shift (9pm – 6am)",
              joining: "Joining later — Joining July 2027",
            },
          ],
        })}
      />,
    );

    expect(await screen.findByText("Night shift (9pm – 6am)")).toBeDefined();
    expect(screen.getByText("Joining later — Joining July 2027")).toBeDefined();
  });
});
