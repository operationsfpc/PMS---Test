import { Badge, Button, Card, PageHeader } from "@components/ui";
import type { OfferCategory } from "@domain/offer-category";
import { useCallback, useEffect, useState } from "react";
import { ApplyError } from "./apply-repository";

/** One row as the student sees it. R5/R6 have already been applied upstream. */
export interface OpenDrive {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly ctcLabel: string;
  readonly offerCategory: OfferCategory | null;
  readonly applicationEnd: string;
  readonly canApply: boolean;
  /** Student-facing prose, already translated from R6's refusal code. */
  readonly refusal: string | null;
  readonly applied: boolean;
}

export interface DrivesView {
  openDrives(): Promise<readonly OpenDrive[]>;
  apply(driveId: string): Promise<void>;
}

const CATEGORY_LABEL: Record<OfferCategory, string> = {
  regular: "Regular",
  dream: "Dream",
  super_dream: "Super Dream",
};

/**
 * The student's open drives.
 *
 * Anything hidden by R5 - the category ladder, the internship cap, opt-out,
 * disbarment, failed eligibility - never reaches this list. Showing a student
 * a drive they can never apply to is worse than not showing it.
 *
 * Mobile-first: students are on phones (PRD §21.2), so this is a stacked card
 * list rather than a table.
 */
export function DrivesList({ view }: { view: DrivesView }) {
  const [rows, setRows] = useState<readonly OpenDrive[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await view.openDrives());
      setError(null);
    } catch {
      setError("Could not load your drives. Please try again.");
      setRows(null);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(drive: OpenDrive) {
    setBusyId(drive.id);
    setError(null);
    try {
      await view.apply(drive.id);
      setRows((current) =>
        (current ?? []).map((r) => (r.id === drive.id ? { ...r, applied: true } : r)),
      );
    } catch (caught) {
      setError(
        caught instanceof ApplyError ? caught.message : "Could not submit your application.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Open drives"
        subtitle="Drives you are eligible for. Applying cannot be withdrawn."
      />

      {error !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {error}
          </p>
        </Card>
      )}

      {rows === null ? (
        error === null ? (
          <p role="status" className="p-6 text-sm text-neutral-500">
            Loading your drives…
          </p>
        ) : null
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            No drives are open to you right now. You will be notified when one is.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((drive) => (
            <Card key={drive.id} className="p-5">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h2 className="font-[Raleway] text-lg font-bold text-ink-900">
                  {drive.companyName}
                </h2>
                {drive.offerCategory !== null && (
                  <Badge tone="brand">{CATEGORY_LABEL[drive.offerCategory]}</Badge>
                )}
                {drive.applied && <Badge tone="success">Applied</Badge>}
              </div>
              <p className="text-sm text-ink-500">
                {drive.roleTitle} · {drive.ctcLabel}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                Applications close {new Date(drive.applicationEnd).toLocaleDateString("en-IN")}
              </p>

              {drive.applied ? null : drive.canApply ? (
                <div className="mt-4">
                  <Button
                    disabled={busyId === drive.id}
                    aria-label={`Apply to ${drive.companyName}`}
                    onClick={() => void apply(drive)}
                  >
                    {busyId === drive.id ? "Applying…" : "Apply"}
                  </Button>
                  <p className="mt-2 text-xs text-[#FF7200]">
                    An application cannot be withdrawn once submitted.
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[#DD4820]">{drive.refusal}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
