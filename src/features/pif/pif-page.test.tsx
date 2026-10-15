// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PifPage } from "./pif-page";
import type { PifRepository } from "./pif-repository";

/**
 * The two ways to raise work live on ONE page: a single-role PIF, or a whole
 * recruitment event with several roles. The mode is a toggle, not a second
 * page — an AE should not have to know which nav item to have clicked.
 */
function renderPage() {
  const repo = {
    skillAreas: vi.fn().mockResolvedValue([]),
    existingCompanies: vi.fn().mockResolvedValue([]),
    submit: vi.fn().mockResolvedValue({ id: "drive-1" }),
    saveDraft: vi.fn().mockResolvedValue({ id: "drive-1" }),
    submitCompanyDrive: vi.fn().mockResolvedValue({ id: "event-1" }),
    saveCompanyDriveDraft: vi.fn().mockResolvedValue({ id: "event-1" }),
  } as unknown as PifRepository;
  render(
    <MemoryRouter>
      <PifPage repository={repo} />
    </MemoryRouter>,
  );
  return repo;
}

describe("PifPage — one page, two modes", () => {
  it("opens on the single-role PIF with the multi-role option beside it", () => {
    renderPage();

    const single = screen.getByRole("button", { name: "One role" });
    const multi = screen.getByRole("button", { name: /multiple roles under one event/i });
    expect(single.getAttribute("aria-pressed")).toBe("true");
    expect(multi.getAttribute("aria-pressed")).toBe("false");

    expect(screen.getByRole("heading", { name: /position information form/i })).toBeDefined();
    expect(screen.queryByRole("heading", { name: /multi-role company drive/i })).toBeNull();
  });

  it("switches to the multi-role form and back without remounting the page", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /multiple roles under one event/i }));

    expect(screen.getByRole("heading", { name: /multi-role company drive/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /add another role/i })).toBeDefined();
    expect(screen.queryByRole("heading", { name: /position information form/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: "One role" }));
    expect(screen.getByRole("heading", { name: /position information form/i })).toBeDefined();
  });

  it("does not show the single form's draft banner on the multi-role form", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/company name/i), "Zoho Corporation");
    await user.click(screen.getByRole("button", { name: /save draft/i }));
    expect(await screen.findByText(/draft saved/i)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /multiple roles under one event/i }));

    expect(screen.queryByText(/draft saved/i)).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /multi-role company drive/i })).toBeDefined(),
    );
  });
});
