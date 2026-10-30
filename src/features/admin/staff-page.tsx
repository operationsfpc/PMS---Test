import { ErrorPanel } from "@components/error-panel";
import { Badge, Button, Card, PageHeader } from "@components/ui";
import { campusScopeFor, requiresCampusAssignment, validateCampusSelection } from "@domain/staff";
import { APP_ROLES, type AppRole } from "@domain/types";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { EditStaffModal } from "./edit-staff-modal";
import { RemoveStaffModal } from "./remove-staff-modal";
import type { CampusOption, StaffMember, StaffRepository } from "./staff-repository";

/** Students arrive by roster import, so they are never an invitable role. */
const INVITABLE = APP_ROLES.filter((r) => r !== "student");

const label = (role: AppRole) => role.replaceAll("_", " ");

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return (name.slice(0, 2) || "ST").toUpperCase();
}

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
  /** The staff list or its campus options failing — never the same complaint as a write. */
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmingMember, setConfirmingMember] = useState<StaffMember | null>(null);
  const [editingMember, setEditingMember] = useState<StaffMember | null>(null);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Search & filter state
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      setStaff(await repository.list());
      setReadProblem(null);
    } catch (cause) {
      // An empty table and a refused read are different answers, and `void
      // refresh()` used to swallow the difference into an unhandled rejection.
      // It is kept apart from `error`, which is about a write: every action here
      // re-reads the list afterwards, and a successful re-read must not wipe the
      // reason the action was refused.
      setReadProblem(cause instanceof Error ? cause.message : "Could not load the staff list.");
    }
  }, [repository]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    void refresh();
    repository
      .campuses()
      .then(setCampuses)
      .catch(() => setReadProblem("Could not load the campuses staff can be assigned to."));
  }, [refresh, repository, attempt]);

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

  async function remove(target: string) {
    setError(null);
    setBusy(target);
    try {
      await repository.remove(target);
      setConfirmingMember(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove that staff member.");
      setConfirmingMember(null);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveEdit(newRole: AppRole, newCampusIds: readonly string[]) {
    if (!editingMember) return;
    const target = editingMember.email;
    setError(null);
    setBusy(target);
    try {
      if (editingMember.role !== newRole) {
        await repository.changeRole(target, newRole);
      }
      const scope = campusScopeFor(newRole);
      if (scope !== "none") {
        await repository.setCampuses(target, newCampusIds);
      } else if (editingMember.campuses.length > 0) {
        await repository.setCampuses(target, []);
      }
      setEditingMember(null);
      setToastMessage(`Updated permissions for ${editingMember.fullName}.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update staff member.");
      await refresh();
      throw cause;
    } finally {
      setBusy(null);
    }
  }

  async function handleResendInvite(targetEmail: string) {
    setError(null);
    setResendingEmail(targetEmail);
    try {
      if (repository.resendInvite) {
        await repository.resendInvite(targetEmail);
      }
      setToastMessage(`Invitation successfully queued and resent to ${targetEmail}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resend the invitation.");
    } finally {
      setResendingEmail(null);
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

      {readProblem !== null && (
        <div className="mb-4">
          <ErrorPanel
            onRetry={() => {
              setReadProblem(null);
              setAttempt((count) => count + 1);
            }}
            retryLabel="Load the staff list again"
          >
            {readProblem} Until it loads, the list below cannot be trusted to be complete.
          </ErrorPanel>
        </div>
      )}

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      {toastMessage !== null && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-success-800"
        >
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-success-700 hover:text-success-900 text-xs font-bold"
          >
            ✕
          </button>
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
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-hidden"
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
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-hidden"
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
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm capitalize text-ink-900 focus:border-brand-500 focus:outline-hidden"
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

          {problem !== null && <p className="mt-3 text-sm text-danger-700">{problem}</p>}

          <div className="mt-5">
            <Button type="submit" isLoading={saving}>
              Send invitation
            </Button>
          </div>
        </form>
      </Card>

      {/* Staff Directory Header & Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-ink-900">
            Staff directory {staff !== null ? `(${staff.length})` : ""}
          </h2>
          <p className="text-xs text-ink-500">
            Active permissions, role assignments, and campus scopes
          </p>
        </div>

        {staff !== null && staff.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-ink-400">
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter staff by name or email…"
                className="h-8.5 w-44 sm:w-56 rounded-lg border border-line bg-surface pl-8 pr-3 text-xs text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-hidden"
              />
            </div>
            <div className="relative">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="h-8.5 appearance-none rounded-lg border border-line bg-surface pl-3 pr-7 text-xs font-medium text-ink-800 capitalize focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-hidden cursor-pointer"
              >
                <option value="">All roles</option>
                {INVITABLE.map((r) => (
                  <option key={r} value={r}>
                    {label(r)}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-ink-400">
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </span>
            </div>
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-8.5 appearance-none rounded-lg border border-line bg-surface pl-3 pr-7 text-xs font-medium text-ink-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-hidden cursor-pointer"
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="deactivated">Deactivated</option>
                <option value="pending">Pending sign-in</option>
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-ink-400">
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </span>
            </div>
            {(search !== "" || roleFilter !== "" || statusFilter !== "") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setRoleFilter("");
                  setStatusFilter("");
                }}
                className="h-8.5 text-xs text-ink-500 hover:text-ink-800"
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
        <Card className="p-8 text-center">
          <p className="text-sm text-ink-700">No staff invited yet.</p>
        </Card>
      ) : (
        <div className="rounded-xl border border-line bg-surface shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left text-sm">
              <caption className="sr-only">Staff directory</caption>
              <thead>
                <tr className="border-b border-line bg-surface-muted/60 text-xs font-semibold uppercase tracking-wider text-ink-500">
                  <th scope="col" className="px-4 py-3.5">
                    Staff member
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Role
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Assigned campus
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filteredStaff !== null && filteredStaff.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-sm text-ink-500">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-ink-400 mb-2">
                        <svg
                          aria-hidden="true"
                          className="h-5 w-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                          />
                        </svg>
                      </div>
                      No staff match your search or filter.
                    </td>
                  </tr>
                ) : (
                  filteredStaff?.map((member) => {
                    const initials = getInitials(member.fullName);
                    return (
                      <tr key={member.email} className="transition-colors hover:bg-surface-muted">
                        {/* Staff Member Info with Avatar */}
                        <td className="px-4 py-3.5 align-middle min-w-[220px]">
                          <div className="flex items-center gap-3">
                            <div
                              aria-hidden="true"
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 border border-brand-200/70 text-brand-700 font-bold text-xs shadow-2xs select-none"
                            >
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-ink-900 leading-snug break-words [overflow-wrap:anywhere]">
                                {member.fullName}
                              </div>
                              <div className="text-xs text-ink-500 font-mono break-all mt-0.5">
                                {member.email}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Role */}
                        <td className="px-4 py-3.5 align-middle whitespace-nowrap min-w-[170px]">
                          <span className="inline-flex items-center rounded-md bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800 border border-brand-200/70 capitalize shadow-2xs">
                            {label(member.role)}
                          </span>
                        </td>

                        {/* Campus Mapping */}
                        <td className="px-4 py-3.5 align-middle min-w-[210px]">
                          {campusScopeFor(member.role) === "one" && (
                            <div className="max-w-[220px]">
                              {member.campuses.length > 0 ? (
                                <span className="text-xs font-semibold text-ink-900 break-words block [overflow-wrap:anywhere]">
                                  {member.campuses[0]?.name}
                                </span>
                              ) : (
                                <p className="text-xs font-medium text-danger-700">
                                  No campus mapped — they cannot see any students yet.
                                </p>
                              )}
                            </div>
                          )}
                          {campusScopeFor(member.role) === "many" && (
                            <div className="flex flex-col gap-1 items-start max-w-[230px]">
                              {member.campuses.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {member.campuses.slice(0, 2).map((c) => (
                                    <span
                                      key={c.id}
                                      className="inline-flex items-center rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 border border-brand-200/70"
                                    >
                                      {c.name}
                                    </span>
                                  ))}
                                  {member.campuses.length > 2 && (
                                    <span className="inline-flex items-center rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-600 border border-line">
                                      +{member.campuses.length - 2} more
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs font-medium text-danger-700">
                                  No campuses assigned
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingMember(member)}
                              >
                                Manage campuses ({member.campuses.length})
                              </Button>
                            </div>
                          )}
                          {campusScopeFor(member.role) === "none" && (
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200/80 shadow-2xs">
                              <svg
                                aria-hidden="true"
                                className="h-3.5 w-3.5 text-slate-500 shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                                />
                              </svg>
                              <span>All organisations (Org-wide)</span>
                            </span>
                          )}
                        </td>

                        {/* Status Badges */}
                        <td className="px-4 py-3.5 align-middle whitespace-nowrap min-w-[130px]">
                          <div className="flex flex-col gap-1 items-start">
                            {member.isActive ? (
                              <Badge tone="success">
                                <span className="h-1.5 w-1.5 rounded-full bg-success-500 inline-block mr-1" />
                                Active
                              </Badge>
                            ) : (
                              <Badge tone="danger">
                                <span className="h-1.5 w-1.5 rounded-full bg-danger-500 inline-block mr-1" />
                                Deactivated
                              </Badge>
                            )}
                            {member.acceptedAt === null && (
                              <Badge tone="warning">Not signed in yet</Badge>
                            )}
                            {!member.isActive && <span className="sr-only"> · Deactivated</span>}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 align-middle text-right min-w-[260px]">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label={`Edit ${member.fullName}`}
                              disabled={busy === member.email}
                              onClick={() => setEditingMember(member)}
                              className="inline-flex items-center gap-1.5 shadow-2xs font-medium text-xs text-ink-700 hover:text-ink-900"
                            >
                              <svg
                                aria-hidden="true"
                                className="h-3.5 w-3.5 text-brand-600 shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                />
                              </svg>
                              <span>Edit</span>
                            </Button>
                            {member.acceptedAt === null && (
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Resend invite to ${member.fullName}`}
                                isLoading={resendingEmail === member.email}
                                disabled={busy === member.email || resendingEmail === member.email}
                                onClick={() => void handleResendInvite(member.email)}
                              >
                                Resend invite
                              </Button>
                            )}
                            {member.isActive ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busy === member.email}
                                onClick={() => void setActive(member.email, false)}
                                className="shadow-2xs text-ink-600 hover:text-ink-900"
                              >
                                Deactivate
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                aria-label={`Activate ${member.fullName}`}
                                disabled={busy === member.email}
                                onClick={() => void setActive(member.email, true)}
                                className="bg-brand-500 text-white hover:bg-brand-600 shadow-2xs"
                              >
                                Activate
                              </Button>
                            )}
                            <Button
                              variant="danger"
                              size="sm"
                              aria-label={`Remove ${member.fullName}`}
                              disabled={busy === member.email}
                              onClick={() => setConfirmingMember(member)}
                              className="inline-flex items-center gap-1 shadow-2xs"
                            >
                              Remove
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingMember && (
        <EditStaffModal
          member={editingMember}
          campuses={campuses}
          onClose={() => setEditingMember(null)}
          onSave={handleSaveEdit}
        />
      )}

      {confirmingMember && (
        <RemoveStaffModal
          member={confirmingMember}
          onClose={() => setConfirmingMember(null)}
          onConfirm={() => remove(confirmingMember.email)}
        />
      )}
    </div>
  );
}
