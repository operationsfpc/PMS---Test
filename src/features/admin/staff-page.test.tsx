// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
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

    await user.click(await screen.findByRole("button", { name: /edit cpc one/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit cpc one/i });
    const select = within(dialog).getByRole("combobox", { name: /role for cpc one/i });
    expect((select as HTMLSelectElement).value).toBe("campus_placement_coordinator");

    await user.selectOptions(select, "delivery_head");
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));

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

    await user.click(await screen.findByRole("button", { name: /edit cpc one/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit cpc one/i });
    const select = within(dialog).getByRole("combobox", { name: /role for cpc one/i });
    await user.selectOptions(select, "delivery_head");
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));

    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/last admin/i);
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
    const user = userEvent.setup();
    render(
      <StaffPage repository={repo({ list: async () => CPC, campuses: async () => CAMPUSES })} />,
    );

    await user.click(await screen.findByRole("button", { name: /edit cpc one/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit cpc one/i });
    const select = within(dialog).getByRole("combobox", { name: /campus for cpc one/i });
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

    await user.click(await screen.findByRole("button", { name: /edit cpc one/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit cpc one/i });
    const select = within(dialog).getByRole("combobox", { name: /campus for cpc one/i });
    await user.selectOptions(select, "c2");
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(setCampuses).toHaveBeenCalledWith("cpc@faceprep.in", ["c2"]));
  });

  /** One campus alone: a multi-select would offer authority we do not grant. */
  it("offers a coordinator a single choice, not a set of checkboxes", async () => {
    const user = userEvent.setup();
    render(
      <StaffPage repository={repo({ list: async () => CPC, campuses: async () => CAMPUSES })} />,
    );

    await user.click(await screen.findByRole("button", { name: /edit cpc one/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit cpc one/i });
    const select = within(dialog).getByRole("combobox", { name: /campus for cpc one/i });
    expect((select as HTMLSelectElement).multiple).toBe(false);
  });

  it("does not offer a campus to a role that has none", async () => {
    const user = userEvent.setup();
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

    await user.click(await screen.findByRole("button", { name: /edit the ceo/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit the ceo/i });
    expect(within(dialog).queryByRole("combobox", { name: /campus for the ceo/i })).toBeNull();
  });
});

/**
 * F8 (UAT 2026-08-06): "In Admin- Staff page - if a role is added and
 * deactivated, we should also have activate button for the same role /
 * profile."
 *
 * Deactivating was a one-way door on the screen. The only route back was the
 * database, which meant a misclick cost somebody their login until an engineer
 * intervened.
 */
describe("reactivating a deactivated staff member", () => {
  const deactivated = (over: Record<string, unknown> = {}) => ({
    fullName: "Meera Iyer",
    email: "meera@faceprep.in",
    role: "campus_placement_coordinator" as const,
    campuses: [{ id: "c1", name: "Alliance University" }],
    acceptedAt: "2026-08-01T00:00:00Z",
    isActive: false,
    ...over,
  });

  it("offers an Activate button for a deactivated staff member", async () => {
    render(<StaffPage repository={repo({ list: async () => [deactivated()] })} />);

    expect(await screen.findByRole("button", { name: /activate meera iyer/i })).toBeDefined();
  });

  it("does not offer to deactivate somebody who already is", async () => {
    render(<StaffPage repository={repo({ list: async () => [deactivated()] })} />);

    await screen.findByRole("button", { name: /activate meera iyer/i });
    expect(screen.queryByRole("button", { name: /^deactivate$/i })).toBeNull();
  });

  it("restores the login when used", async () => {
    const setActive = vi.fn();
    const user = userEvent.setup();
    render(<StaffPage repository={repo({ list: async () => [deactivated()], setActive })} />);

    await user.click(await screen.findByRole("button", { name: /activate meera iyer/i }));

    await waitFor(() => expect(setActive).toHaveBeenCalledWith("meera@faceprep.in", true));
  });

  it("offers no Activate button for somebody who is already active", async () => {
    render(
      <StaffPage repository={repo({ list: async () => [deactivated({ isActive: true })] })} />,
    );

    await screen.findByRole("button", { name: /^deactivate$/i });
    expect(screen.queryByRole("button", { name: /activate meera iyer/i })).toBeNull();
  });

  it("says why nothing happened when the restore fails", async () => {
    const user = userEvent.setup();
    render(
      <StaffPage
        repository={repo({
          list: async () => [deactivated()],
          setActive: async () => {
            throw new Error("Could not update that staff member.");
          },
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /activate meera iyer/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not update/i);
  });
});

describe("EditStaffModal and modern staff actions", () => {
  const MULTI_CAMPUS_STAFF = [
    {
      fullName: "Anand Verma",
      email: "anand@faceprep.in",
      role: "campus_manager" as const,
      campuses: [{ id: "c1", name: "Alliance University" }],
      acceptedAt: null, // pending sign-in
      isActive: true,
    },
  ];

  const CAMPUSES = [
    { id: "c1", name: "Alliance University" },
    { id: "c2", name: "SDNB Vaishnav College for Women" },
  ];

  it("opens Edit modal and updates both role and multi-campus selection", async () => {
    const changeRole = vi.fn();
    const setCampuses = vi.fn();
    const user = userEvent.setup();

    render(
      <StaffPage
        repository={repo({
          list: async () => MULTI_CAMPUS_STAFF,
          campuses: async () => CAMPUSES,
          changeRole,
          setCampuses,
        })}
      />,
    );

    // Open Edit modal via Edit button
    await user.click(await screen.findByRole("button", { name: /edit anand verma/i }));

    // Verify dialog header is visible
    const dialog = await screen.findByRole("dialog", { name: /edit anand verma/i });
    expect(dialog).toBeDefined();

    // Select second campus in checkbox grid within modal
    const sdnbCheckbox = within(dialog).getByRole("checkbox", {
      name: /sdnb vaishnav college for women/i,
    });
    await user.click(sdnbCheckbox);

    // Click Save changes button inside modal
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(setCampuses).toHaveBeenCalledWith("anand@faceprep.in", ["c1", "c2"]),
    );
  });

  it("opens Edit modal from 'Manage campuses' link on multi-campus row", async () => {
    const user = userEvent.setup();

    render(
      <StaffPage
        repository={repo({
          list: async () => MULTI_CAMPUS_STAFF,
          campuses: async () => CAMPUSES,
        })}
      />,
    );

    // Click "Manage campuses"
    await user.click(await screen.findByRole("button", { name: /manage campuses/i }));

    expect(await screen.findByRole("dialog", { name: /edit anand verma/i })).toBeDefined();
  });

  it("resends invite email for staff who have not signed in yet", async () => {
    const resendInvite = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <StaffPage
        repository={repo({
          list: async () => MULTI_CAMPUS_STAFF,
          campuses: async () => CAMPUSES,
          resendInvite,
        })}
      />,
    );

    const resendBtn = await screen.findByRole("button", { name: /resend invite to anand verma/i });
    await user.click(resendBtn);

    await waitFor(() => expect(resendInvite).toHaveBeenCalledWith("anand@faceprep.in"));
    expect(await screen.findByText(/invitation successfully queued and resent/i)).toBeDefined();
  });
});
