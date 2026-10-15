// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PifPage } from "./pif-page";
import type { PifRepository } from "./pif-repository";

/**
 * The AE's drive-raising screen. There is ONE form — a company visit with its
 * roles under it — and the page's whole job is to route what the form produced:
 * one role is a plain drive row, two or more go up as one event through the
 * atomic RPC. A second form or a mode toggle would ask the AE to decide, up
 * front, something they only know by the time they have filled the first role.
 */
function renderPage(params = "") {
  const mocks = {
    skillAreas: vi.fn().mockResolvedValue([]),
    existingCompanies: vi.fn().mockResolvedValue([]),
    submit: vi.fn().mockResolvedValue({ id: "drive-1", status: "submitted" }),
    saveDraft: vi.fn().mockResolvedValue({ id: "drive-1", status: "draft" }),
    submitCompanyDrive: vi
      .fn()
      .mockResolvedValue({ eventId: "event-1", roleIds: ["r-1", "r-2"], status: "submitted" }),
    saveCompanyDriveDraft: vi
      .fn()
      .mockResolvedValue({ eventId: "event-1", roleIds: ["r-1", "r-2"], status: "draft" }),
  };
  render(
    <MemoryRouter initialEntries={[`/ae/pif${params}`]}>
      <PifPage repository={mocks as unknown as PifRepository} />
    </MemoryRouter>,
  );
  return mocks;
}

/** Everything the submit gate asks of one role. */
async function fillRoleOne(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: /^full time$/i }));
  await user.type(screen.getByLabelText(/minimum ctc/i), "6.5");
  await user.type(screen.getByLabelText(/role title/i), "Member Technical Staff");
  await user.selectOptions(screen.getByLabelText(/role category/i), "software_technical");
  await user.type(screen.getByLabelText(/number of openings/i), "25");
  await user.type(screen.getByLabelText(/work location/i), "Chennai");
  await user.click(screen.getByRole("button", { name: /add round/i }));
  await user.type(screen.getByLabelText(/round 1 name/i), "Aptitude test");
  await user.click(screen.getByRole("checkbox", { name: /2027/ }));
  await user.click(screen.getByRole("radio", { name: /immediate joining/i }));
}

/** The same, in the second block — every role-level control now appears twice. */
async function fillRoleTwo(user: ReturnType<typeof userEvent.setup>) {
  const second = (found: HTMLElement[]) => found[1] as HTMLElement;
  await user.click(second(screen.getAllByRole("radio", { name: /^full time$/i })));
  await user.type(second(screen.getAllByLabelText(/minimum ctc/i)), "7");
  await user.type(second(screen.getAllByLabelText(/role title/i)), "Support Engineer");
  await user.selectOptions(
    second(screen.getAllByLabelText(/role category/i)),
    "technical_support_it_ops",
  );
  await user.type(second(screen.getAllByLabelText(/number of openings/i)), "4");
  await user.type(second(screen.getAllByLabelText(/work location/i)), "Chennai");
  await user.click(second(screen.getAllByRole("button", { name: /add round/i })));
  await user.type(second(screen.getAllByLabelText(/round 1 name/i)), "HR round");
  await user.click(second(screen.getAllByRole("checkbox", { name: /2027/ })));
}

describe("PifPage — one form, roles added under one visit", () => {
  it("shows the single PIF with its add-role button and no mode to pick", async () => {
    renderPage();
    // The page asks for the company list on mount; the answer arrives after
    // this test's own work, so it has to land inside act().
    await act(async () => {});

    expect(screen.getByRole("heading", { name: /position information form/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /add another role/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /multiple roles under one event/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /multi-role company drive/i })).toBeNull();
  });

  it("routes one role to the plain drive row, not to the event RPC", async () => {
    const repo = renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await fillRoleOne(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(repo.submit).toHaveBeenCalledTimes(1));
    expect(repo.submitCompanyDrive).not.toHaveBeenCalled();
    expect(repo.submit.mock.calls[0]?.[0]).toMatchObject({
      companyName: "Zoho Corporation",
      roleTitle: "Member Technical Staff",
    });
  });

  it("routes two roles through the atomic event RPC, together", async () => {
    const repo = renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await fillRoleOne(user);
    await user.click(screen.getByRole("button", { name: /add another role/i }));
    await fillRoleTwo(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    await waitFor(() => expect(repo.submitCompanyDrive).toHaveBeenCalledTimes(1));
    expect(repo.submit).not.toHaveBeenCalled();
    const values = repo.submitCompanyDrive.mock.calls[0]?.[0] as {
      roles: Array<{ roleTitle: string }>;
    };
    expect(values.roles.map((r) => r.roleTitle)).toEqual([
      "Member Technical Staff",
      "Support Engineer",
    ]);
  });

  it("confirms a submitted single PIF and says it cannot be edited after a rejection", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await fillRoleOne(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    expect(
      await screen.findByRole("heading", { name: /pif submitted for approval/i }),
    ).toBeDefined();
    expect(screen.getByText(/cannot be edited or resubmitted/i)).toBeDefined();
  });

  it("confirms a submitted drive by saying how many roles went up as one visit", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await fillRoleOne(user);
    await user.click(screen.getByRole("button", { name: /add another role/i }));
    await fillRoleTwo(user);
    await user.click(screen.getByRole("button", { name: /submit for approval/i }));

    expect(
      await screen.findByRole("heading", { name: /company drive submitted for approval/i }),
    ).toBeDefined();
    expect(screen.getByText(/2 roles raised under one recruitment event/i)).toBeDefined();
  });

  /**
   * B1: a draft is ONE row for its whole life. Save twice, or save then submit,
   * and the second write must land on the row the first one created — otherwise
   * an orphan draft is left on the AE's, the Delivery Head's and the CPC's list.
   */
  it("saves every further single-role draft onto the same drive row", async () => {
    const repo = renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(repo.saveDraft).toHaveBeenCalledTimes(1));
    expect(repo.saveDraft.mock.calls[0]?.[1]).toBeUndefined();

    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(repo.saveDraft).toHaveBeenCalledTimes(2));
    expect(repo.saveDraft.mock.calls[1]?.[1]).toBe("drive-1");
  });

  it("keeps a multi-role visit on the event its first draft created", async () => {
    const repo = renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await user.click(screen.getByRole("button", { name: /add another role/i }));
    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(repo.saveCompanyDriveDraft).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(repo.saveCompanyDriveDraft).toHaveBeenCalledTimes(2));
    expect(repo.saveCompanyDriveDraft.mock.calls[1]?.[1]).toBe("event-1");
  });

  it("says a saved draft has not gone to the Delivery Head yet", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    expect(await screen.findByText(/draft saved\. it has not gone/i)).toBeDefined();
  });
});

describe("PifPage — arriving from a company or a drive", () => {
  it("carries the linked company, drive and date into the form", async () => {
    renderPage("?companyName=Zoho%20Corporation&companyDriveId=e-9&tentativeDate=2026-11-15");
    await act(async () => {});

    expect((screen.getByLabelText(/company name/i) as HTMLInputElement).value).toBe(
      "Zoho Corporation",
    );
    expect((screen.getByLabelText(/tentative drive date/i) as HTMLInputElement).value).toBe(
      "2026-11-15",
    );
  });
});
