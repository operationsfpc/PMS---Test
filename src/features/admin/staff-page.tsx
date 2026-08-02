import { Button, Card, PageHeader } from "@components/ui";
import { requiresCampusAssignment } from "@domain/staff";
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
    if (needsCampus && campusIds.length === 0) {
      setProblem("Select at least one campus for this role.");
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

  async function deactivate(target: string) {
    setError(null);
    try {
      await repository.setActive(target, false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update that staff member.");
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
            <div key={member.email} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-medium text-ink-900">{member.fullName}</p>
                <p className="text-sm text-ink-500">
                  <span>{member.email}</span> ·{" "}
                  <span className="capitalize">{label(member.role)}</span>
                  {member.acceptedAt === null && " · Not signed in yet"}
                  {member.isActive ? "" : " · Deactivated"}
                </p>
              </div>
              {member.isActive && (
                <Button variant="secondary" size="sm" onClick={() => void deactivate(member.email)}>
                  Deactivate
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
