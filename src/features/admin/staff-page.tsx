import { Badge, Button, Card, DataTable, PageHeader } from "@components/ui";
import { campusScopeFor, requiresCampusAssignment, validateCampusSelection } from "@domain/staff";
import { APP_ROLES, type AppRole } from "@domain/types";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { CampusOption, StaffMember, StaffRepository } from "./staff-repository";

/** Students arrive by roster import, so they are never an invitable role. */
const INVITABLE = APP_ROLES.filter((r) => r !== "student");

const label = (role: AppRole) => role.replaceAll("_", " ");

/**
 * Invite staff.
 *
 * The invitation row is the login allowlist: sending one creates an account
 * waiting to happen. The role is therefore chosen explicitly, and a
 * campus-scoped role cannot be invited without a campus - such an account
 * would sign in successfully and then see nothing at all.
 */
export function StaffPage({ repository }: { repository: StaffRepository }) {
  const [staff, setStaff] = useState<readonly StaffMember[] | null>(null);
  const [campuses, setCampuses] = useState<readonly CampusOption[]>([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("campus_placement_coordinator");
  const [campusIds, setCampusIds] = useState<readonly string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Search & filter state
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const refresh = useCallback(async () => {
    setStaff(await repository.list());
  }, [repository]);

  useEffect(() => {
    void refresh();
    void repository.campuses().then(setCampuses);
  }, [refresh, repository]);

  const needsCampus = requiresCampusAssignment(role);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setProblem(null);

    if (fullName.trim() === "" || email.trim() === "") {
      setProblem("A full name and an email address are required.");
      return;
    }
    const selection = validateCampusSelection(role, campusIds);
    if (!selection.ok) {
      setProblem(selection.error);
      return;
    }

    setSaving(true);
    try {
      await repository.invite({
        fullName,
        email,
        role,
        campusIds: needsCampus ? campusIds : [],
      });
      setFullName("");
      setEmail("");
      setCampusIds([]);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the invitation.");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(target: string, isActive: boolean) {
    setError(null);
    try {
      await repository.setActive(target, isActive);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update that staff member.");
    }
  }

  async function changeRole(target: string, newRole: AppRole) {
    setError(null);
    setBusy(target);
    try {
      await repository.changeRole(target, newRole);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change that role.");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function mapCampus(target: string, campusId: string) {
    if (campusId === "") return;
    setError(null);
    setBusy(target);
    try {
      await repository.setCampuses(target, [campusId]);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change that campus.");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(target: string) {
    setError(null);
    setBusy(target);
    try {
      await repository.remove(target);
      setConfirming(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove that staff member.");
      setConfirming(null);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  function toggleCampus(id: string) {
    setCampusIds((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  }

  const filteredStaff = useMemo(() => {
    if (staff === null) return null;
    return staff.filter((m) => {
      if (search.trim() !== "") {
        const q = search.toLowerCase();
        const match = m.fullName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (roleFilter !== "" && m.role !== roleFilter) return false;
      if (statusFilter === "active" && !m.isActive) return false;
      if (statusFilter === "deactivated" && m.isActive) return false;
      if (statusFilter === "pending" && m.acceptedAt !== null) return false;
      return true;
    });
  }, [staff, search, roleFilter, statusFilter]);

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle="An invitation is a login. Only invited addresses can sign in."
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Invite Staff Card */}
      <Card className="mb-6 p-6">
        <h2 className="mb-4 text-base font-semibold text-ink-900">Invite new staff member</h2>
        <form onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="staff-name" className="mb-1 block text-sm font-medium text-ink-700">
                Full name
              </label>
              <input
                id="staff-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. John Doe"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label htmlFor="staff-email" className="mb-1 block text-sm font-medium text-ink-700">
                Email
              </label>
              <input
                id="staff-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@faceprep.in"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label htmlFor="staff-role" className="mb-1 block text-sm font-medium text-ink-700">
                Role
              </label>
              <select
                id="staff-role"
                value={role}
                onChange={(e) => setRole(e.target.value as AppRole)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm capitalize text-ink-900 focus:border-brand-500 focus:outline-hidden"
              >
                {INVITABLE.map((r) => (
                  <option key={r} value={r}>
                    {label(r)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {needsCampus && (
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-medium text-ink-700">
                Campuses for this role
              </legend>
              <div className="flex flex-wrap gap-3">
                {campuses.map((campus) => (
                  <label key={campus.id} className="flex items-center gap-2 text-sm text-ink-700">
                    <input
                      type="checkbox"
                      checked={campusIds.includes(campus.id)}
                      onChange={() => toggleCampus(campus.id)}
                    />
                    {campus.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {problem !== null && <p className="mt-3 text-sm text-destructive">{problem}</p>}

          <div className="mt-5">
            <Button type="submit" disabled={saving}>
              {saving ? "Sending…" : "Send invitation"}
            </Button>
          </div>
        </form>
      </Card>

      {/* Staff Directory Header & Filters */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">
            Staff directory {staff !== null ? `(${staff.length})` : ""}
          </h2>
          <p className="text-xs text-ink-500">
            Active permissions, role assignments, and campus scopes
          </p>
        </div>

        {staff !== null && staff.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink-800 placeholder:text-ink-400 focus:border-brand-500 focus:outline-hidden"
            />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink-800 focus:border-brand-500 focus:outline-hidden"
            >
              <option value="">All roles</option>
              {INVITABLE.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink-800 focus:border-brand-500 focus:outline-hidden"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
              <option value="pending">Pending sign-in</option>
            </select>
            {(search !== "" || roleFilter !== "" || statusFilter !== "") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setRoleFilter("");
                  setStatusFilter("");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        )}
      </div>

      {staff === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading staff…
        </p>
      ) : staff.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-ink-700">No staff invited yet.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 border border-line bg-surface shadow-xs">
          <DataTable
            caption="Staff directory"
            columns={["Staff member", "Role", "Assigned campus", "Status", "Actions"]}
          >
            {filteredStaff !== null && filteredStaff.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-ink-500">
                  No staff match your search or filter.
                </td>
              </tr>
            ) : (
              filteredStaff?.map((member) => (
                <tr
                  key={member.email}
                  className="border-t border-line hover:bg-surface-muted/30 transition-colors"
                >
                  {/* Staff Member Info */}
                  <td className="px-4 py-3 align-top min-w-[200px]">
                    <div className="font-semibold text-ink-900">{member.fullName}</div>
                    <div className="text-xs text-ink-500 font-mono mt-0.5">{member.email}</div>
                  </td>

                  {/* Role Selector */}
                  <td className="px-4 py-3 align-top min-w-[170px]">
                    <label className="sr-only" htmlFor={`role-${member.email}`}>
                      Role for {member.fullName}
                    </label>
                    <select
                      id={`role-${member.email}`}
                      value={member.role}
                      disabled={busy === member.email}
                      onChange={(e) => void changeRole(member.email, e.target.value as AppRole)}
                      className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink-800 capitalize shadow-xs focus:border-brand-500 focus:outline-hidden"
                    >
                      {INVITABLE.map((r) => (
                        <option key={r} value={r}>
                          {label(r)}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Campus Mapping */}
                  <td className="px-4 py-3 align-top min-w-[200px]">
                    {campusScopeFor(member.role) === "one" && (
                      <div>
                        <label className="sr-only" htmlFor={`campus-${member.email}`}>
                          Campus for {member.fullName}
                        </label>
                        <select
                          id={`campus-${member.email}`}
                          value={member.campuses[0]?.id ?? ""}
                          disabled={busy === member.email}
                          onChange={(e) => void mapCampus(member.email, e.target.value)}
                          className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink-800 shadow-xs focus:border-brand-500 focus:outline-hidden"
                        >
                          <option value="">Select a campus…</option>
                          {campuses.map((campus) => (
                            <option key={campus.id} value={campus.id}>
                              {campus.name}
                            </option>
                          ))}
                        </select>
                        {member.campuses.length === 0 && (
                          <p className="mt-1 text-xs font-medium text-destructive">
                            No campus mapped — they cannot see any students yet.
                          </p>
                        )}
                      </div>
                    )}
                    {campusScopeFor(member.role) === "many" && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-neutral-100 text-ink-700">
                        {member.campuses.length > 0
                          ? member.campuses.map((c) => c.name).join(", ")
                          : "Assigned campuses"}
                      </span>
                    )}
                    {campusScopeFor(member.role) === "none" && (
                      <span className="text-xs text-ink-400">—</span>
                    )}
                  </td>

                  {/* Status Badges */}
                  <td className="px-4 py-3 align-top whitespace-nowrap min-w-[130px]">
                    <div className="flex flex-col gap-1 items-start">
                      {member.isActive ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="danger">Deactivated</Badge>
                      )}
                      {member.acceptedAt === null && (
                        <span className="text-xs text-ink-500">Not signed in yet</span>
                      )}
                      {!member.isActive && <span className="sr-only"> · Deactivated</span>}
                    </div>
                  </td>

                  {/* Actions & Confirmation */}
                  <td className="px-4 py-3 align-top text-right min-w-[220px]">
                    {confirming === member.email ? (
                      <div className="flex flex-col items-end gap-1.5 text-right">
                        <p className="text-xs font-semibold text-destructive">
                          Permanently remove {member.fullName}? Their sign-in stops working.
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy === member.email}
                            onClick={() => void remove(member.email)}
                          >
                            Yes, remove
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        {member.isActive ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy === member.email}
                            onClick={() => void setActive(member.email, false)}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            aria-label={`Activate ${member.fullName}`}
                            disabled={busy === member.email}
                            onClick={() => void setActive(member.email, true)}
                          >
                            Activate
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={`Remove ${member.fullName}`}
                          disabled={busy === member.email}
                          onClick={() => setConfirming(member.email)}
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </DataTable>
        </Card>
      )}
    </div>
  );
}
