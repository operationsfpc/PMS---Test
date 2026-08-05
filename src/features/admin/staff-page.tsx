import { Button, Card, PageHeader } from "@components/ui";
import { campusScopeFor, requiresCampusAssignment, validateCampusSelection } from "@domain/staff";
import { APP_ROLES, type AppRole } from "@domain/types";
import { type FormEvent, useCallback, useEffect, useState } from "react";
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
    // The domain decides how many campuses this role may hold, so inviting a
    // coordinator to two is refused here for the same reason the repository
    // refuses it: the mapping is where their authority to verify comes from.
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

  /**
   * F8 (UAT 2026-08-06): deactivating used to be a one-way door on this
   * screen. The only route back was the database, so a misclick cost somebody
   * their login until an engineer intervened.
   */
  async function setActive(target: string, isActive: boolean) {
    setError(null);
    try {
      await repository.setActive(target, isActive);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update that staff member.");
    }
  }

  /**
   * The domain refuses self-demotion and the removal of the last Admin, so the
   * reason it gives is shown verbatim - it is the only explanation the Admin
   * will get, and "could not update" would send them looking in the wrong place.
   */
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

  /**
   * Maps a coordinator to a campus. One campus, so this replaces rather than
   * adds - and an empty choice is simply not sent, because the domain would
   * refuse it and "none" is never a mapping anyone wants on purpose.
   */
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

      <Card className="mb-6 p-6">
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
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
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
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
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
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm capitalize"
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

      {staff === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading staff…
        </p>
      ) : staff.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">No staff invited yet.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-neutral-200">
          {staff.map((member) => (
            <div key={member.email} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">{member.fullName}</p>
                <p className="text-sm text-ink-500">
                  <span>{member.email}</span>
                  {member.acceptedAt === null && " · Not signed in yet"}
                  {member.isActive ? "" : " · Deactivated"}
                </p>
                {/*
                 * Said out loud, because silence here cost a day: a
                 * coordinator with no campus signs in perfectly well and then
                 * sees an empty verification queue with no explanation.
                 */}
                {campusScopeFor(member.role) !== "none" && member.campuses.length === 0 && (
                  <p className="text-sm text-destructive">
                    No campus mapped — they cannot see any students yet.
                  </p>
                )}
              </div>

              {confirming === member.email ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-destructive">
                    Permanently remove {member.fullName}? Their sign-in stops working.
                  </p>
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
              ) : (
                <>
                  {campusScopeFor(member.role) === "one" && (
                    <>
                      <label className="sr-only" htmlFor={`campus-${member.email}`}>
                        Campus for {member.fullName}
                      </label>
                      <select
                        id={`campus-${member.email}`}
                        value={member.campuses[0]?.id ?? ""}
                        disabled={busy === member.email}
                        onChange={(e) => void mapCampus(member.email, e.target.value)}
                        className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm"
                      >
                        <option value="">Select a campus…</option>
                        {campuses.map((campus) => (
                          <option key={campus.id} value={campus.id}>
                            {campus.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  <label className="sr-only" htmlFor={`role-${member.email}`}>
                    Role for {member.fullName}
                  </label>
                  <select
                    id={`role-${member.email}`}
                    value={member.role}
                    disabled={busy === member.email}
                    onChange={(e) => void changeRole(member.email, e.target.value as AppRole)}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm capitalize"
                  >
                    {INVITABLE.map((r) => (
                      <option key={r} value={r}>
                        {label(r)}
                      </option>
                    ))}
                  </select>

                  {member.isActive ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void setActive(member.email, false)}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    // Named, because a queue of deactivated staff needs the
                    // buttons told apart by a screen reader as well as by eye.
                    <Button
                      size="sm"
                      aria-label={`Activate ${member.fullName}`}
                      onClick={() => void setActive(member.email, true)}
                    >
                      Activate
                    </Button>
                  )}

                  <Button
                    variant="danger"
                    size="sm"
                    aria-label={`Remove ${member.fullName}`}
                    onClick={() => setConfirming(member.email)}
                  >
                    Remove
                  </Button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
