import { Button } from "@components/ui";
import { campusScopeFor, validateCampusSelection } from "@domain/staff";
import type { AppRole } from "@domain/types";
import { useEffect, useState } from "react";
import type { CampusOption, StaffMember } from "./staff-repository";

const label = (role: AppRole) => role.replaceAll("_", " ");

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return (name.slice(0, 2) || "ST").toUpperCase();
}

const ORG_WIDE_ROLES: readonly AppRole[] = [
  "admin",
  "ceo",
  "delivery_head",
  "central_placement_coordinator",
  "account_executive",
  "enterprise_relations",
  "er_head",
];

const SINGLE_CAMPUS_ROLES: readonly AppRole[] = ["campus_placement_coordinator"];

const MULTI_CAMPUS_ROLES: readonly AppRole[] = ["campus_manager", "key_account_manager"];

export interface EditStaffModalProps {
  readonly member: StaffMember;
  readonly campuses: readonly CampusOption[];
  readonly onClose: () => void;
  readonly onSave: (role: AppRole, campusIds: readonly string[]) => Promise<void>;
  readonly isCurrentAdmin?: boolean;
}

export function EditStaffModal({
  member,
  campuses,
  onClose,
  onSave,
  isCurrentAdmin = false,
}: EditStaffModalProps) {
  const [selectedRole, setSelectedRole] = useState<AppRole>(member.role);
  const [selectedCampusIds, setSelectedCampusIds] = useState<readonly string[]>(
    member.campuses.map((c) => c.id),
  );
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const scope = campusScopeFor(selectedRole);

  function handleRoleChange(newRole: AppRole) {
    setSelectedRole(newRole);
    setProblem(null);
    const newScope = campusScopeFor(newRole);
    if (newScope === "none") {
      setSelectedCampusIds([]);
    } else if (newScope === "one" && selectedCampusIds.length > 1) {
      setSelectedCampusIds(selectedCampusIds.slice(0, 1));
    }
  }

  function toggleCampus(id: string) {
    setProblem(null);
    if (scope === "one") {
      setSelectedCampusIds([id]);
    } else {
      setSelectedCampusIds((current) =>
        current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
      );
    }
  }

  function selectAllCampuses() {
    setProblem(null);
    setSelectedCampusIds(campuses.map((c) => c.id));
  }

  function clearAllCampuses() {
    setProblem(null);
    setSelectedCampusIds([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);

    const check = validateCampusSelection(selectedRole, selectedCampusIds);
    if (!check.ok) {
      setProblem(check.error);
      return;
    }

    setSaving(true);
    try {
      await onSave(selectedRole, scope === "none" ? [] : selectedCampusIds);
      onClose();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Failed to save staff updates.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${member.fullName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-ink-900">Edit Staff Member</h2>
            <p className="text-xs text-ink-500 font-mono mt-0.5">
              {member.fullName} · {member.email}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-muted hover:text-ink-700 transition-colors"
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {problem && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive font-medium"
            >
              {problem}
            </div>
          )}

          {/* Section 1: Staff Details */}
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-muted/30 p-3">
            <div
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 border border-brand-200/70 text-brand-700 font-bold text-xs shadow-2xs select-none"
            >
              {getInitials(member.fullName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-ink-900 text-sm break-words [overflow-wrap:anywhere]">
                {member.fullName}
              </div>
              <div className="text-xs text-ink-500 font-mono break-all">{member.email}</div>
            </div>
            <div className="shrink-0">
              <span className="inline-flex items-center rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-ink-700 border border-line capitalize">
                Current: {label(member.role)}
              </span>
            </div>
          </div>

          {/* Section 2: Role Assignment */}
          <div>
            <label
              htmlFor="edit-staff-role"
              className="block text-xs font-semibold text-ink-700 uppercase tracking-wider mb-1.5"
            >
              Role Assignment
            </label>
            <div className="relative">
              <select
                id="edit-staff-role"
                aria-label={`Role for ${member.fullName}`}
                value={selectedRole}
                disabled={isCurrentAdmin || saving}
                onChange={(e) => handleRoleChange(e.target.value as AppRole)}
                className="h-10 w-full appearance-none rounded-lg border border-line bg-surface px-3 pr-8 text-sm font-medium text-ink-900 capitalize shadow-2xs transition-colors hover:border-brand-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-hidden disabled:opacity-50 cursor-pointer"
              >
                <optgroup label="Organisation-Wide (All Organisations)">
                  {ORG_WIDE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {label(r)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Single Organisation Scope">
                  {SINGLE_CAMPUS_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {label(r)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Multiple Organisations Scope">
                  {MULTI_CAMPUS_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {label(r)}
                    </option>
                  ))}
                </optgroup>
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-ink-400">
                <svg
                  aria-hidden="true"
                  className="h-4 w-4"
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
            {isCurrentAdmin && (
              <p className="mt-1 text-xs text-ink-500">
                You cannot change your own role. Ask another Admin.
              </p>
            )}
          </div>

          {/* Section 3: Organisation Scope / Permissions */}
          <div className="pt-1">
            {scope === "none" && (
              <div className="rounded-xl border border-brand-200/80 bg-brand-50/60 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 mt-0.5">
                    <svg
                      aria-hidden="true"
                      className="h-4.5 w-4.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                      />
                    </svg>
                  </div>
                  <div className="text-xs">
                    <h4 className="font-semibold text-brand-950 text-sm">
                      All Organisations (Org-wide Read & Write)
                    </h4>
                    <p className="mt-1 text-brand-800 leading-relaxed">
                      This role operates across <strong>all organisations and campuses</strong> in
                      the system. They have system-wide access to read and manage student records,
                      drives, and reports across every institution without campus-specific
                      restrictions.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {scope === "one" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="edit-staff-campus"
                    className="block text-xs font-semibold text-ink-700 uppercase tracking-wider"
                  >
                    Assigned Organisation / Campus <span className="text-destructive">*</span>
                  </label>
                  <span className="text-xs text-ink-500">Single campus exclusive</span>
                </div>
                <div className="relative">
                  <select
                    id="edit-staff-campus"
                    aria-label={`Campus for ${member.fullName}`}
                    value={selectedCampusIds[0] ?? ""}
                    onChange={(e) => setSelectedCampusIds(e.target.value ? [e.target.value] : [])}
                    disabled={saving}
                    className="h-10 w-full appearance-none rounded-lg border border-line bg-surface px-3 pr-8 text-sm text-ink-900 shadow-2xs transition-colors hover:border-brand-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-hidden disabled:opacity-50 cursor-pointer"
                  >
                    <option value="">Select an organisation / campus…</option>
                    {campuses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-ink-400">
                    <svg
                      aria-hidden="true"
                      className="h-4 w-4"
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
                <p className="text-xs text-ink-500">
                  Campus placement coordinators manage one institution exclusively. Their
                  verification queue only receives students from this campus.
                </p>
              </div>
            )}

            {scope === "many" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ink-700 uppercase tracking-wider">
                      Assigned Organisations <span className="text-destructive">*</span>
                    </span>
                    <span className="text-xs font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full border border-brand-200">
                      {selectedCampusIds.length === campuses.length
                        ? "All Organisations"
                        : `${selectedCampusIds.length} of ${campuses.length} selected`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={selectAllCampuses}>
                      Select all (All Organisations)
                    </Button>
                    <Button size="sm" variant="secondary" onClick={clearAllCampuses}>
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto rounded-lg border border-line bg-surface-muted/20 p-2 sm:grid-cols-2">
                  {campuses.map((campus) => {
                    const isChecked = selectedCampusIds.includes(campus.id);
                    return (
                      <label
                        key={campus.id}
                        className={`flex items-center gap-2 rounded-md p-2 text-xs font-medium cursor-pointer transition-colors ${
                          isChecked
                            ? "bg-brand-50 text-brand-900 font-semibold border border-brand-200"
                            : "hover:bg-surface-muted text-ink-700"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCampus(campus.id)}
                          className="rounded border-line text-brand-600 focus:ring-brand-500"
                        />
                        <span className="truncate">{campus.name}</span>
                      </label>
                    );
                  })}
                </div>
                {selectedCampusIds.length === 0 && (
                  <p className="text-xs font-medium text-destructive">
                    At least one campus is required for this role.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={saving}>
              Save changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
