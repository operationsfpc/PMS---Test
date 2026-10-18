import { StudentIdentity } from "@components/student-identity";
import { Button, Card } from "@components/ui";
import { useState } from "react";
import { DeclineForm, Evidence } from "./decline-form";
import type {
  ParticipationQueueView,
  SelfPlacementClassification,
} from "./participation-queue-contract";
import { QueueShell } from "./queue-shell";

/**
 * Off-campus offer approvals. Its own screen since F2 (UAT 2026-08-06).
 *
 * Approving is what creates the `offers` row, and with it a number the college
 * reports. There is no drive behind an off-campus offer, so the letter is the
 * only evidence there is — and a decline has to say what was wrong with it
 * (F1), because the student cannot otherwise fix anything.
 */
export function OffCampusQueue({ view }: { view: ParticipationQueueView }) {
  const [declining, setDeclining] = useState<string | null>(null);
  // D6: the classification is the coordinator's, per request. No default -
  // "mandatory for coordinator to select" was the instruction, and a
  // pre-filled rung would be approved without being read.
  const [kinds, setKinds] = useState<Record<string, SelfPlacementClassification["driveType"]>>({});
  const [categories, setCategories] = useState<
    Record<string, NonNullable<SelfPlacementClassification["offerCategory"]>>
  >({});
  const [stipends, setStipends] = useState<Record<string, string>>({});

  return (
    <QueueShell
      view={view}
      title="Off-campus offers"
      subtitle="Approving records the offer AND places the student on the category ladder — equal and lower categories close to them (a self-placed internship uses up the one-internship allowance)."
      empty="Nothing waiting for approval."
      isEmpty={(pending) => pending.selfPlacements.length === 0}
    >
      {(pending, run) => (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {pending.selfPlacements.map((placement) => (
              <li
                key={placement.id}
                className="flex flex-wrap items-start justify-between gap-4 p-4"
              >
                <StudentIdentity
                  name={placement.studentName}
                  rollNumber={placement.rollNumber}
                  college={placement.college}
                  studentId={placement.studentId}
                  detail={`${placement.companyName} · ₹${placement.ctcLpa} LPA`}
                >
                  <Evidence
                    url={placement.offerLetterUrl}
                    label="offer letter"
                    missing="No offer letter was uploaded with this request."
                  />
                </StudentIdentity>

                {declining === placement.id ? (
                  <DeclineForm
                    label={`${placement.studentName}'s off-campus offer`}
                    onCancel={() => setDeclining(null)}
                    onDecline={(reason) => {
                      run(
                        () => view.declineSelfPlacement(placement.id, reason),
                        `${placement.studentName}'s ${placement.companyName} offer was declined with a reason, so nothing was recorded.`,
                      );
                      setDeclining(null);
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
                      Offer type
                      <select
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink-900"
                        value={kinds[placement.id] ?? ""}
                        onChange={(e) =>
                          setKinds((k) => ({
                            ...k,
                            [placement.id]: e.target
                              .value as SelfPlacementClassification["driveType"],
                          }))
                        }
                      >
                        <option value="" disabled>
                          Select…
                        </option>
                        <option value="placement">Job (placement)</option>
                        <option value="internship">Internship</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
                      Category
                      <select
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink-900 disabled:opacity-50"
                        value={categories[placement.id] ?? ""}
                        disabled={kinds[placement.id] === "internship"}
                        onChange={(e) =>
                          setCategories((c) => ({
                            ...c,
                            [placement.id]: e.target.value as NonNullable<
                              SelfPlacementClassification["offerCategory"]
                            >,
                          }))
                        }
                      >
                        <option value="" disabled>
                          Select…
                        </option>
                        <option value="regular">Regular (≤ ₹5 LPA)</option>
                        <option value="dream">Dream (₹5–10 LPA)</option>
                        <option value="super_dream">Super Dream (&gt; ₹10 LPA)</option>
                      </select>
                    </label>
                    {kinds[placement.id] === "internship" && (
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
                        Stipend (&#8377;/month)
                        <input
                          type="number"
                          min="0"
                          className="w-28 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink-900"
                          placeholder="e.g. 15000"
                          value={stipends[placement.id] ?? ""}
                          onChange={(e) =>
                            setStipends((s) => ({ ...s, [placement.id]: e.target.value }))
                          }
                        />
                      </label>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDeclining(placement.id)}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        // There is no drive behind an off-campus offer, so the
                        // letter is the only evidence an approval has to stand
                        // on. The line above the row already says it is missing.
                        placement.offerLetterUrl === null ||
                        kinds[placement.id] === undefined ||
                        (kinds[placement.id] === "placement" &&
                          categories[placement.id] === undefined) ||
                        (kinds[placement.id] === "internship" && !stipends[placement.id])
                      }
                      onClick={() => {
                        const driveType = kinds[placement.id];
                        if (driveType === undefined) return;
                        run(
                          () =>
                            view.approveSelfPlacement(placement.id, {
                              driveType,
                              offerCategory:
                                driveType === "internship"
                                  ? null
                                  : (categories[placement.id] ?? null),
                              stipendMonthly:
                                driveType === "internship" ? Number(stipends[placement.id]) : null,
                            }),
                          `${placement.studentName}'s offer from ${placement.companyName} is recorded, and holds them on the category ladder.`,
                        );
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </QueueShell>
  );
}
