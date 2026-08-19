// @vitest-environment jsdom
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApprovalError, type ApprovalRepository } from "./approval-repository";
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
  driveType: "placement",
  onHold: false,
  createdAt: "2026-08-01T09:00:00Z",
  // J1/J2/J3 (2026-08-18): what the Delivery Head is actually approving.
  jobDescriptionUrl: null as string | null,
  jobDescriptionName: null as string | null,
  shift: "Day shift",
  joining: "Immediate joining",
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
