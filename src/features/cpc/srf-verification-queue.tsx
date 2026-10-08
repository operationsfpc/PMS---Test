import { Badge, Button, Card, DataTable, PageHeader } from "@components/ui";
import { describeBoard } from "@domain/boards";
import { decideSrf } from "@domain/srf-decision";
import { supabase } from "@lib/supabase";
import { useCallback, useEffect, useState } from "react";
import {
  createSupabaseVerificationRepository,
  type PendingSrf,
  VerificationError,
  type VerificationRepository,
} from "./verification-repository";

/**
 * CPC — SRF verification queue. PRD §4.2, §17.2.
 *
 * The coordinator checks entered marks against uploaded marksheets, so each
 * figure sits next to the document that justifies it. Arrear history is shown
 * separately from standing arrears because drives filter on both (R2).
 *
 * The transition itself is a domain rule; this screen only asks for it and
 * reports what came back.
 */
function formatScoreWithGrade(
  percentage: number | null | undefined,
  grade: string | null | undefined,
): string {
  const hasPct = percentage !== null && percentage !== undefined;
  const hasGrade = grade !== null && grade !== undefined && grade.trim() !== "";
  if (hasPct && hasGrade) return `${percentage}% (Grade: ${grade.trim()})`;
  if (hasPct) return `${percentage}%`;
  if (hasGrade) return `Grade: ${grade.trim()}`;
  return "—";
}

export function SrfVerificationQueue({ repository }: { repository?: VerificationRepository }) {
  const [rows, setRows] = useState<readonly PendingSrf[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * Which student is being sent back, and what they are being told.
   *
   * One at a time, deliberately: a coordinator writes a comment about the form
   * in front of them, and several open boxes is how a comment lands on the
   * wrong student.
   */
  const [sendingBack, setSendingBack] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  // Created once: a new client on every render would refetch endlessly.
  const [repo] = useState<VerificationRepository>(
    () => repository ?? createSupabaseVerificationRepository(supabase()),
  );

  const load = useCallback(async () => {
    try {
      setRows(await repo.pending());
      setError(null);
    } catch (caught) {
      setError(caught instanceof VerificationError ? caught.message : "Could not load the queue.");
      // Deliberately NOT []: an empty queue and a failed load mean opposite
      // things to a coordinator, and must never look the same.
      setRows(null);
    }
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(student: PendingSrf) {
    setBusyId(student.id);
    setError(null);
    try {
      await repo.decide(student.id, "srf_submitted", { decision: "approve" });
      setRows((current) => (current ?? []).filter((r) => r.id !== student.id));
    } catch (caught) {
      setError(
        caught instanceof VerificationError ? caught.message : "Could not save the decision.",
      );
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Sends the form back with the coordinator's comment (2026-08-18).
   *
   * The empty-reason rule is `decideSrf`'s, asked BEFORE the network: the
   * student is told nothing else about why their form came back, so a blank
   * comment would be a form returned with no instruction. The database enforces
   * the same rule; this only stops a pointless request and shows the domain's
   * own words.
   */
  async function sendBack(student: PendingSrf) {
    const decision = { decision: "reject", reason } as const;
    const outcome = decideSrf("srf_submitted", decision);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }

    setBusyId(student.id);
    setError(null);
    try {
      await repo.decide(student.id, "srf_submitted", decision);
      setRows((current) => (current ?? []).filter((r) => r.id !== student.id));
      setSendingBack(null);
      setReason("");
    } catch (caught) {
      setError(
        caught instanceof VerificationError ? caught.message : "Could not save the decision.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Verification queue"
        subtitle="Verify entered marks against uploaded marksheets."
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
            Loading the queue…
          </p>
        ) : null
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            Nothing awaiting verification. Newly submitted forms will appear here.
          </p>
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-4">
            <p className="text-sm text-ink-700">
              <strong>{rows.length}</strong> registration form{rows.length === 1 ? "" : "s"}{" "}
              awaiting verification. Students cannot receive or apply to any drive until approved.
            </p>
          </Card>

          <Card className="overflow-hidden p-0">
            <DataTable
              caption="Registration forms awaiting verification"
              columns={[
                "Student",
                "Roll number",
                "Overall CGPA",
                "10th %",
                "12th %",
                "Standing arrears",
                "Arrear history",
                "School marksheets",
                "Declared semesters",
                "Certificates",
                "Resumes",
                "Decision",
              ]}
            >
              {rows.map((student) => (
                <tr
                  key={student.id}
                  className="border-t border-line hover:bg-surface-muted/30 transition-colors"
                >
                  <td className="align-top px-3 py-3 text-sm min-w-[160px]">
                    <div className="font-semibold text-ink-900">{student.fullName}</div>
                    {/* A resubmission is not a fresh form. Repeating what was
                        asked for is what stops the same defect being missed
                        twice - and the student has already been told it. */}
                    {student.previousRejectionReason !== null &&
                      student.previousRejectionReason.trim() !== "" && (
                        <div className="mt-1.5 rounded bg-[#FFF0EC] border border-[#DD4820]/30 p-1.5 text-xs">
                          <Badge tone="warning">Resubmitted</Badge>
                          <span className="mt-1 block text-xs font-normal text-ink-700">
                            You sent this back: “{student.previousRejectionReason}”
                          </span>
                        </div>
                      )}
                  </td>
                  <td className="align-top px-3 py-3 text-sm font-mono text-ink-700 whitespace-nowrap">
                    {student.rollNumber}
                  </td>
                  <td className="align-top px-3 py-3 text-sm whitespace-nowrap font-medium text-ink-900">
                    {student.overallCgpa ?? "—"}
                  </td>
                  {/* The figure and the board that issued it, together: they are
                      checked against the one document. */}
                  <td className="align-top px-3 py-3 text-sm whitespace-nowrap">
                    <span className="font-medium text-ink-900">
                      {formatScoreWithGrade(student.tenthPercentage, student.tenthGrade)}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {describeBoard(student.tenthBoard, "tenth")}
                    </span>
                  </td>
                  <td className="align-top px-3 py-3 text-sm whitespace-nowrap">
                    <span className="font-medium text-ink-900">
                      {formatScoreWithGrade(student.twelfthPercentage, student.twelfthGrade)}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {describeBoard(student.twelfthBoard, "twelfth")}
                    </span>
                  </td>
                  <td className="align-top px-3 py-3 text-sm text-center whitespace-nowrap">
                    {student.currentArrears > 0 ? (
                      <Badge tone="danger">{student.currentArrears}</Badge>
                    ) : (
                      <span className="text-ink-500">0</span>
                    )}
                  </td>
                  <td className="align-top px-3 py-3 text-sm text-center whitespace-nowrap">
                    {student.historyOfArrears > 0 ? (
                      <Badge tone="warning">{student.historyOfArrears}</Badge>
                    ) : (
                      <span className="text-ink-500">0</span>
                    )}
                  </td>
                  <td className="align-top px-3 py-3 text-sm min-w-[140px]">
                    {student.documents.length === 0 ? (
                      <span className="text-xs text-[#DD4820] font-medium">None uploaded</span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {student.documents.map((doc) => (
                          <a
                            key={doc.url}
                            href={doc.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[#3D3777] font-medium underline hover:text-ink-900"
                          >
                            📄 {doc.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </td>
                  {/* The reason this screen exists: every declared figure
                      beside the document that proves it. */}
                  <td className="align-top px-3 py-3 text-sm min-w-[180px]">
                    {student.semesters.length === 0 ? (
                      <span className="text-xs text-[#DD4820] font-medium">No semesters declared</span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {student.semesters.map((semester) => (
                          <div
                            key={semester.semesterNumber}
                            className="rounded border border-line bg-surface-muted/40 p-1.5 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-ink-700">Semester {semester.semesterNumber}</span>
                              <strong className="font-semibold text-ink-900">{semester.cgpa}</strong>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[11px] text-ink-500">
                              <span>
                                {semester.currentArrears} standing, {semester.historyOfArrears} in history
                              </span>
                              {semester.marksheetUrl === null ? (
                                <span className="text-[#DD4820]">No marksheet</span>
                              ) : (
                                <a
                                  href={semester.marksheetUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Semester ${semester.semesterNumber} marksheet for ${student.fullName}`}
                                  className="text-[#3D3777] font-medium underline"
                                >
                                  Marksheet
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  {/* Certificates column */}
                  <td className="align-top px-3 py-3 text-sm min-w-[160px]">
                    {student.certificates.length === 0 ? (
                      <span className="text-xs text-ink-500">No certificates uploaded</span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {student.certificates.map((certificate) => (
                          <div
                            key={certificate.id}
                            className="rounded border border-line bg-surface-muted/40 p-1.5 text-xs"
                          >
                            <div className="font-medium text-ink-900">{certificate.name}</div>
                            {certificate.fileName !== null && (
                              <div className="text-[11px] text-ink-500 truncate max-w-[150px]">
                                {certificate.fileName}
                              </div>
                            )}
                            <div className="mt-1 flex items-center justify-between">
                              {certificate.status === "pending" ? (
                                certificate.url === null ? (
                                  <span className="text-xs text-[#DD4820]">No document</span>
                                ) : (
                                  <a
                                    href={certificate.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={`Open ${certificate.name} for ${student.fullName}`}
                                    className="text-xs text-[#3D3777] font-medium underline"
                                  >
                                    Open
                                  </a>
                                )
                              ) : (
                                <Badge tone={certificate.status === "verified" ? "success" : "neutral"}>
                                  {certificate.status === "verified" ? "Verified" : "Not accepted"}
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  {/* Resumes column: direct review of category-specific resumes */}
                  <td className="align-top px-3 py-3 text-sm min-w-[170px]">
                    {student.resumes.length === 0 ? (
                      <span className="text-xs text-[#DD4820] font-medium">No resume uploaded</span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {student.resumes.map((resume) => (
                          <div
                            key={resume.roleCategory}
                            className="rounded border border-line bg-surface-muted/40 p-1.5 text-xs"
                          >
                            <div className="font-medium text-ink-900">{resume.label}</div>
                            {resume.fileName !== null && (
                              <div className="text-[11px] text-ink-500 truncate max-w-[150px]">
                                ({resume.fileName})
                              </div>
                            )}
                            <div className="mt-1">
                              {resume.url === null ? (
                                <span className="text-xs text-[#DD4820]">No document</span>
                              ) : (
                                <a
                                  href={resume.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Open ${resume.label} resume for ${student.fullName}`}
                                  className="inline-flex items-center gap-1 text-xs text-[#3D3777] font-medium underline"
                                >
                                  Review
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  {/* Decision column */}
                  <td className="align-top px-3 py-3 min-w-[200px]">
                    {/* Says what the button commits them to */}
                    {student.certificates.some((c) => c.status === "pending") && (
                      <p className="mb-2 text-xs text-ink-500 leading-tight">
                        {(() => {
                          const n = student.certificates.filter(
                            (c) => c.status === "pending",
                          ).length;
                          return `Approving will also verify ${n} certificate${n === 1 ? "" : "s"}.`;
                        })()}
                      </p>
                    )}
                    {sendingBack === student.id ? (
                      <div className="flex flex-col gap-2">
                        <label
                          htmlFor={`reason-${student.id}`}
                          className="text-xs font-medium text-ink-700"
                        >
                          What does this student need to correct?
                        </label>
                        <textarea
                          id={`reason-${student.id}`}
                          rows={3}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-900 focus:border-[#3D3777] focus:outline-none focus:ring-1 focus:ring-[#3D3777]"
                          placeholder="Name what is wrong, and what to change."
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busyId === student.id}
                            onClick={() => void sendBack(student)}
                          >
                            {busyId === student.id ? "Saving…" : "Send back"}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setSendingBack(null);
                              setReason("");
                              setError(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <Button
                          size="sm"
                          disabled={busyId === student.id}
                          aria-label={`Approve ${student.fullName}`}
                          onClick={() => void approve(student)}
                        >
                          {busyId === student.id ? "Saving…" : "Approve"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Send back the form from ${student.fullName}`}
                          onClick={() => {
                            setSendingBack(student.id);
                            setReason("");
                            setError(null);
                          }}
                        >
                          Send back for changes
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </>
      )}
    </>
  );
}
