// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StaffPage } from "./staff-page";
import type { StaffRepository } from "./staff-repository";

/**
 * Inviting staff.
 *
 * Until this screen exists the founding Admin is the only account that can
 * ever sign in, so no coordinator, AE or Delivery Head can do anything. The
 * invitation row is the login allowlist: writing one creates an account, so
 * the screen must be explicit about the role being granted.
 */
function repo(overrides: Partial<StaffRepository> = {}): StaffRepository {
  return {
    list: async () => [],
    campuses: async () => [{ id: "c1", name: "Alliance University" }],
    invite: async () => undefined,
    setActive: async () => undefined,
    changeRole: async () => undefined,
    remove: async () => undefined,
    setCampuses: async () => undefined,
    ...overrides,
  };
}

const EXISTING = [
  {
    email: "cpc@faceprep.in",
    fullName: "CPC One",
    role: "campus_placement_coordinator" as const,
    acceptedAt: null,
    isActive: true,
    campuses: [],
  },
];

/**
 * Correcting a mistake. An invitation is a login, so an Admin who picks the
 * wrong role or the wrong address has created the wrong account - and until
 * now had no way to undo it without database access.
 */
describe("changing a staff member's role", () => {
  it("offers each member's current role, and saves a change to it", async () => {
    const changeRole = vi.fn();
    const user = userEvent.setup();
    render(<StaffPage repository={repo({ list: async () => EXISTING, changeRole })} />);

    const select = await screen.findByRole("combobox", { name: /role for cpc one/i });
    expect((select as HTMLSelectElement).value).toBe("campus_placement_coordinator");

    await user.selectOptions(select, "delivery_head");

    await waitFor(() =>
      expect(changeRole).toHaveBeenCalledWith("cpc@faceprep.in", "delivery_head"),
    );
  });

  it("shows why a refused change was refused", async () => {
    const user = userEvent.setup();
    render(
      <StaffPage
        repository={repo({
          list: async () => EXISTING,
          changeRole: async () => {
            throw new Error("This is the last Admin. Promote someone else to Admin first.");
          },
        })}
      />,
    );

    const select = await screen.findByRole("combobox", { name: /role for cpc one/i });
    await user.selectOptions(select, "delivery_head");

    expect((await screen.findByRole("alert")).textContent).toMatch(/last admin/i);
  });
});

describe("removing a staff member", () => {
  /**
   * Removal revokes a login and cannot be undone from this screen, so it asks
   * first. A misclick next to "Deactivate" must not delete an account.
   */
  it("asks for confirmation before revoking a login", async () => {
    const remove = vi.fn();
    const user = userEvent.setup();
    render(<StaffPage repository={repo({ list: async () => EXISTING, remove })} />);

    await user.click(await screen.findByRole("button", { name: /remove cpc one/i }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(/permanently remove/i)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /yes, remove/i }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("cpc@faceprep.in"));
  });

  it("lets the Admin back out", async () => {
    const remove = vi.fn();
    const user = userEvent.setup();
    render(<StaffPage repository={repo({ list: async () => EXISTING, remove })} />);

    await user.click(await screen.findByRole("button", { name: /remove cpc one/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByText(/permanently remove/i)).toBeNull();
  });

  it("explains when the person's work is still on record", async () => {
    const user = userEvent.setup();
    render(
      <StaffPage
        repository={repo({
          list: async () => EXISTING,
          remove: async () => {
            throw new Error("drives or results are still attributed to them. Deactivate instead.");
          },
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /remove cpc one/i }));
    await user.click(screen.getByRole("button", { name: /yes, remove/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/deactivate/i);
  });
});

describe("StaffPage", () => {
  it("lists who has been invited and whether they have signed in yet", async () => {
    render(<StaffPage repository={repo({ list: async () => EXISTING })} />);

    expect(await screen.findByText("cpc@faceprep.in")).toBeDefined();
    expect(screen.getByText(/not signed in yet/i)).toBeDefined();
  });

  it("invites a staff member with their role", async () => {
    const invite = vi.fn();
    const user = userEvent.setup();
    render(<StaffPage repository={repo({ invite })} />);

    await user.type(await screen.findByLabelText(/full name/i), "Meera Iyer");
    await user.type(screen.getByLabelText(/email/i), "meera@faceprep.in");
    await user.selectOptions(screen.getByLabelText(/role/i), "delivery_head");
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    await waitFor(() => expect(invite).toHaveBeenCalledTimes(1));
    expect(invite).toHaveBeenCalledWith({
      fullName: "Meera Iyer",
      email: "meera@faceprep.in",
      role: "delivery_head",
      campusIds: [],
    });
  });

  it("never offers 'student' as an invitable role", async () => {
    render(<StaffPage repository={repo()} />);

    const select = await screen.findByLabelText(/role/i);
    expect(
      Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value")),
    ).not.toContain("student");
  });

  /**
   * A campus-scoped role with no campus can see nothing at all.
   *
   * The wording differs by role since 2026-08-05, and deliberately: a
   * coordinator is mapped to ONE campus, so "at least one" would describe a
   * choice they do not have. Both are refused; they are told different things.
   */
  it("requires a campus for a campus-scoped role, and writes nothing without one", async () => {
    const invite = vi.fn();
    const user = userEvent.setup();
    render(<StaffPage repository={repo({ invite })} />);

    await user.type(await screen.findByLabelText(/full name/i), "Ravi Kumar");
    await user.type(screen.getByLabelText(/email/i), "ravi@faceprep.in");
    await user.selectOptions(screen.getByLabelText(/role/i), "campus_placement_coordinator");
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    expect(await screen.findByText(/one campus/i)).toBeDefined();
    expect(invite).not.toHaveBeenCalled();
  });

  it("still asks a multi-campus role for at least one", async () => {
    const invite = vi.fn();
    const user = userEvent.setup();
    render(<StaffPage repository={repo({ invite })} />);

    await user.type(await screen.findByLabelText(/full name/i), "Ravi Kumar");
    await user.type(screen.getByLabelText(/email/i), "ravi@faceprep.in");
    await user.selectOptions(screen.getByLabelText(/role/i), "campus_manager");
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    expect(await screen.findByText(/at least one campus/i)).toBeDefined();
    expect(invite).not.toHaveBeenCalled();
  });

  it("sends the chosen campuses for a campus-scoped role", async () => {
    const invite = vi.fn();
    const user = userEvent.setup();
    render(<StaffPage repository={repo({ invite })} />);

    await user.type(await screen.findByLabelText(/full name/i), "Ravi Kumar");
    await user.type(screen.getByLabelText(/email/i), "ravi@faceprep.in");
    await user.selectOptions(screen.getByLabelText(/role/i), "campus_placement_coordinator");
    await user.click(await screen.findByRole("checkbox", { name: /alliance university/i }));
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    await waitFor(() => expect(invite).toHaveBeenCalledTimes(1));
    expect(invite).toHaveBeenCalledWith(
      expect.objectContaining({ role: "campus_placement_coordinator", campusIds: ["c1"] }),
    );
  });

  it("deactivates a staff member rather than deleting them", async () => {
    const setActive = vi.fn();
    const user = userEvent.setup();
    render(<StaffPage repository={repo({ list: async () => EXISTING, setActive })} />);

    await user.click(await screen.findByRole("button", { name: /deactivate/i }));

    await waitFor(() => expect(setActive).toHaveBeenCalledWith("cpc@faceprep.in", false));
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("surfaces a failed invitation instead of pretending it worked", async () => {
    const user = userEvent.setup();
    render(
      <StaffPage
        repository={repo({
          invite: async () => {
            throw new Error("That email has already been invited.");
          },
        })}
      />,
    );

    await user.type(await screen.findByLabelText(/full name/i), "Dup Person");
    await user.type(screen.getByLabelText(/email/i), "cpc@faceprep.in");
    await user.selectOptions(screen.getByLabelText(/role/i), "account_executive");
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/already been invited/i);
  });
});

/**
 * Mapping a coordinator to their campus.
 *
 * Found in production 2026-08-05: the only Campus Placement Coordinator was
 * mapped to no campus, so their verification queue was empty however many
 * students had submitted, and the screen gave no hint why. Campuses could only
 * be chosen while INVITING, so there was no way to put it right.
 *
 * A coordinator is for one campus alone, so this is a choice, not a list.
 */
describe("mapping an existing staff member to a campus", () => {
  const CPC = [
    {
      email: "cpc@faceprep.in",
      fullName: "CPC One",
      role: "campus_placement_coordinator" as const,
      acceptedAt: "2026-01-01",
      isActive: true,
      campuses: [{ id: "c1", name: "Alliance University" }],
    },
  ];

  const CAMPUSES = [
    { id: "c1", name: "Alliance University" },
    { id: "c2", name: "SDNB Vaishnav College for Women" },
  ];

  it("shows the campus a coordinator is mapped to", async () => {
    render(
      <StaffPage repository={repo({ list: async () => CPC, campuses: async () => CAMPUSES })} />,
    );

    // Asserted on the row's own control, not on the text: the invite form
    // above lists every campus name too, so findByText would pass on that and
    // prove nothing about the mapping.
    const select = await screen.findByRole("combobox", { name: /campus for cpc one/i });
    expect((select as HTMLSelectElement).value).toBe("c1");
  });

  /** The production state. Silence here is what made it invisible for a day. */
  it("says plainly when a coordinator has no campus, and why it matters", async () => {
    render(
      <StaffPage
        repository={repo({
          list: async () => [{ ...CPC[0], campuses: [] }] as typeof CPC,
          campuses: async () => CAMPUSES,
        })}
      />,
    );

    expect(await screen.findByText(/no campus/i)).toBeDefined();
  });

  it("maps them to a campus the Admin picks", async () => {
    const setCampuses = vi.fn();
    const user = userEvent.setup();
    render(
      <StaffPage
        repository={repo({ list: async () => CPC, campuses: async () => CAMPUSES, setCampuses })}
      />,
    );

    const select = await screen.findByRole("combobox", { name: /campus for cpc one/i });
    await user.selectOptions(select, "c2");

    await waitFor(() => expect(setCampuses).toHaveBeenCalledWith("cpc@faceprep.in", ["c2"]));
  });

  /** One campus alone: a multi-select would offer authority we do not grant. */
  it("offers a coordinator a single choice, not a set of checkboxes", async () => {
    render(
      <StaffPage repository={repo({ list: async () => CPC, campuses: async () => CAMPUSES })} />,
    );

    const select = await screen.findByRole("combobox", { name: /campus for cpc one/i });
    expect((select as HTMLSelectElement).multiple).toBe(false);
  });

  it("does not offer a campus to a role that has none", async () => {
    render(
      <StaffPage
        repository={repo({
          list: async () => [
            {
              email: "ceo@faceprep.in",
              fullName: "The CEO",
              role: "ceo" as const,
              acceptedAt: "2026-01-01",
              isActive: true,
              campuses: [],
            },
          ],
          campuses: async () => CAMPUSES,
        })}
      />,
    );

    await screen.findByText("The CEO");
    expect(screen.queryByRole("combobox", { name: /campus for the ceo/i })).toBeNull();
  });
});
