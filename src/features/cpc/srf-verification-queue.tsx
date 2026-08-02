import { Badge, Button, Card, DataTable, PageHeader } from "@components/ui";
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
export function SrfVerificationQueue({ repository }: { repository?: VerificationRepository }) {
  const [rows, setRows] = useState<readonly PendingSrf[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

          <Card className="p-2">
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
                "Marksheets",
                "Decision",
              ]}
            >
              {rows.map((student) => (
                <tr key={student.id} className="border-t border-neutral-200">
                  <td className="px-3 py-2 text-sm font-medium">{student.fullName}</td>
                  <td className="px-3 py-2 text-sm">{student.rollNumber}</td>
                  <td className="px-3 py-2 text-sm">{student.overallCgpa ?? "—"}</td>
                  <td className="px-3 py-2 text-sm">{student.tenthPercentage ?? "—"}</td>
                  <td className="px-3 py-2 text-sm">{student.twelfthPercentage ?? "—"}</td>
                  <td className="px-3 py-2 text-sm">{student.currentArrears}</td>
                  <td className="px-3 py-2 text-sm">
                    {student.historyOfArrears > 0 ? (
                      <Badge tone="warning">{student.historyOfArrears}</Badge>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {student.documents.length === 0 ? (
                      <span className="text-[#DD4820]">None uploaded</span>
                    ) : (
                      <span className="flex flex-wrap gap-2">
                        {student.documents.map((doc) => (
                          <a
                            key={doc.url}
                            href={doc.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#3D3777] underline"
                          >
                            {doc.label}
                          </a>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      disabled={busyId === student.id}
                      aria-label={`Approve ${student.fullName}`}
                      onClick={() => void approve(student)}
                    >
                      {busyId === student.id ? "Saving…" : "Approve"}
                    </Button>
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
