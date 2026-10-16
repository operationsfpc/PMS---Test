import { Button } from "@components/ui";
import { useEffect, useState } from "react";
import type { StaffMember } from "./staff-repository";

export interface RemoveStaffModalProps {
  readonly member: StaffMember;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<void>;
}

export function RemoveStaffModal({ member, onClose, onConfirm }: RemoveStaffModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleRemove() {
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that staff member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Remove ${member.fullName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="h-1.5 w-full bg-destructive" />

        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-ink-900">Remove Staff Member</h3>
              <p className="text-xs text-ink-500 font-mono">{member.email}</p>
            </div>
          </div>

          <p className="text-sm text-ink-700 leading-relaxed">
            Are you sure you want to permanently remove{" "}
            <strong className="text-ink-900">{member.fullName}</strong>? Their sign-in stops working
            and their permissions will be revoked immediately.
          </p>

          <p className="mt-3 rounded-lg border border-line bg-surface-muted/40 p-3 text-xs text-ink-600 leading-relaxed">
            <strong>Audit Note:</strong> If this person is attributed to historical placement
            drives, offers, or results, the database preserves their attribution and prevents
            deletion. In that case, deactivate them instead.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive font-medium"
            >
              {error}
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleRemove} disabled={busy}>
              {busy ? "Removing…" : "Yes, remove"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
