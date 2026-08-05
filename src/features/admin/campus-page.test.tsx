// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CampusPage } from "./campus-page";
import type { CampusProgrammesView } from "./campus-programmes";
import type { CampusRepository } from "./campus-repository";

/**
 * Managing campuses.
 *
 * This screen is what unblocks the whole product: with no campus there is no
 * roster, so no student, so no drive. It therefore must not depend on any
 * other setup step existing first - notably the city, which is typed rather
 * than picked, because a dropdown of cities would be empty on day one and
 * recreate exactly the deadlock this screen exists to break.
 */
function repo(overrides: Partial<CampusRepository> = {}): CampusRepository {
  return {
    list: async () => [],
    create: async () => undefined,
    setActive: async () => undefined,
    ...overrides,
  };
}

const EXISTING = [
  {
    id: "c1",
    name: "Alliance University",
    code: "ALU",
    cityName: "Chennai",
    state: "Tamil Nadu",
    isActive: true,
  },
];

async function fillCampusForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/campus name/i), "VIT Bangalore");
  await user.type(screen.getByLabelText(/^city/i), "Bengaluru");
  await user.type(screen.getByLabelText(/state/i), "Karnataka");
  await user.type(screen.getByLabelText(/code/i), "VITB");
  await user.type(screen.getByLabelText(/address/i), "Whitefield");
  await user.type(screen.getByLabelText(/contact name/i), "Rahul Nair");
  await user.type(screen.getByLabelText(/contact email/i), "rahul@vit.edu");
  await user.type(screen.getByLabelText(/contact phone/i), "9840000002");
}

describe("CampusPage", () => {
  it("lists the campuses that already exist, with their city", async () => {
    render(<CampusPage repository={repo({ list: async () => EXISTING })} />);

    expect(await screen.findByText("Alliance University")).toBeDefined();
    expect(screen.getByText(/Chennai/)).toBeDefined();
  });

  it("says so plainly when no campus exists yet", async () => {
    render(<CampusPage repository={repo()} />);

    expect(await screen.findByText(/no campuses yet/i)).toBeDefined();
  });

  it("creates a campus with every mandatory field", async () => {
    const create = vi.fn();
    const user = userEvent.setup();
    render(<CampusPage repository={repo({ create })} />);

    await fillCampusForm(user);
    await user.click(screen.getByRole("button", { name: /add campus/i }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      name: "VIT Bangalore",
      cityName: "Bengaluru",
      state: "Karnataka",
      code: "VITB",
      address: "Whitefield",
      primaryContactName: "Rahul Nair",
      primaryContactEmail: "rahul@vit.edu",
      primaryContactPhone: "9840000002",
    });
  });

  it("refuses to submit an incomplete campus, and writes nothing", async () => {
    const create = vi.fn();
    const user = userEvent.setup();
    render(<CampusPage repository={repo({ create })} />);

    await user.type(screen.getByLabelText(/campus name/i), "Half Filled College");
    await user.click(screen.getByRole("button", { name: /add campus/i }));

    // Every missing field is named, not just the first - the admin should not
    // have to resubmit seven times to discover seven blanks.
    const complaints = await screen.findAllByText(/required/i);
    expect(complaints.length).toBe(7);
    expect(create).not.toHaveBeenCalled();
  });

  it("retires a campus by deactivating it, never by deleting it", async () => {
    const setActive = vi.fn();
    const user = userEvent.setup();
    render(<CampusPage repository={repo({ list: async () => EXISTING, setActive })} />);

    await user.click(await screen.findByRole("button", { name: /deactivate/i }));

    await waitFor(() => expect(setActive).toHaveBeenCalledWith("c1", false));
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("surfaces a failed save instead of pretending it worked", async () => {
    const user = userEvent.setup();
    render(
      <CampusPage
        repository={repo({
          create: async () => {
            throw new Error("That campus code is already taken.");
          },
        })}
      />,
    );

    await fillCampusForm(user);
    await user.click(screen.getByRole("button", { name: /add campus/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/code is already taken/i);
  });
});

/**
 * F6 (UAT 2026-08-06): "A separate page for degree and branches is not
 * required for the admin ... This can be added or edited later under the
 * colleges created."
 */
describe("CampusPage — programmes live under the college", () => {
  const programmes = (): CampusProgrammesView => ({
    programmes: async () => [{ id: "p1", degree: "B.E", branch: "CSE", passingYear: 2027 }],
    options: async () => [{ degree: "B.E", branches: ["CSE"] }],
    add: async () => undefined,
    remove: async () => undefined,
  });

  it("offers each college's programmes without leaving the page", async () => {
    const user = userEvent.setup();
    render(
      <CampusPage repository={repo({ list: async () => EXISTING })} programmes={programmes()} />,
    );

    await user.click(
      await screen.findByRole("button", { name: /programmes at Alliance University/i }),
    );

    expect(await screen.findByText("B.E — CSE")).toBeDefined();
  });

  it("keeps them closed until asked, so a list of ten colleges stays a list", async () => {
    render(
      <CampusPage repository={repo({ list: async () => EXISTING })} programmes={programmes()} />,
    );

    await screen.findByText("Alliance University");
    expect(screen.queryByText("B.E — CSE")).toBeNull();
  });
});
