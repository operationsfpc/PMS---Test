import { Badge, Button, Card, DataTable, PageHeader } from "@components/ui";
import { ABSENCE_LIMIT } from "@domain/attendance";
import { ROUND_ATTENDEES } from "@lib/mock-data";
import { useState } from "react";

/**
 * Attendance marking — PRD §15.
 *
 * Only students SCHEDULED for this round appear (decision Q9/Q10). Select all
 * and unselect all are explicit requirements. Prior-absence counts are shown
 * inline because the third absence triggers a disbarment review, and the
 * coordinator should know that before they click.
 */
export function AttendancePage() {
  const [present, setPresent] = useState<readonly string[]>(["a1", "a2"]);

  const toggle = (id: string): void =>
    setPresent((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const absentees = ROUND_ATTENDEES.filter((a) => !present.includes(a.id));

  return (
    <>
      <PageHeader
        title="Attendance — Zoho Corporation"
        subtitle="Round 2: Technical interview · 4 Aug 2026, 10:00 AM · Seminar Hall B"
        actions={
          <>
            <Button variant="secondary">Show QR for self check-in</Button>
            <Button>Save attendance</Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink-700">
            <strong>{present.length}</strong> present ·{" "}
            <strong className="text-danger-700">{absentees.length}</strong> absent ·{" "}
            {ROUND_ATTENDEES.length} scheduled
          </p>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPresent(ROUND_ATTENDEES.map((a) => a.id))}
            >
              Select all
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPresent([])}>
              Unselect all
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-2">
        <DataTable
          caption="Students scheduled for this round"
          columns={["Present", "Student", "Roll number", "Prior absences", "Status"]}
        >
          {ROUND_ATTENDEES.map((a) => {
            const isPresent = present.includes(a.id);
            const wouldReachLimit = !isPresent && a.priorAbsences + 1 >= ABSENCE_LIMIT;
            return (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-500"
                    checked={isPresent}
                    onChange={() => toggle(a.id)}
                    aria-label={`Mark ${a.name} present`}
                  />
                </td>
                <td className="px-3 py-3 font-medium text-ink-900">{a.name}</td>
                <td className="px-3 py-3 text-ink-500">{a.rollNumber}</td>
                <td className="px-3 py-3">
                  <span className={a.priorAbsences >= 2 ? "font-semibold text-danger-700" : ""}>
                    {a.priorAbsences} of {ABSENCE_LIMIT}
                  </span>
                </td>
                <td className="px-3 py-3">
                  {isPresent ? (
                    <Badge tone="success">Present</Badge>
                  ) : wouldReachLimit ? (
                    <Badge tone="danger">Absent — triggers review</Badge>
                  ) : (
                    <Badge tone="neutral">Absent</Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </DataTable>
      </Card>

      <p className="mt-4 text-xs text-ink-500">
        Only students scheduled for this round are listed. QR self check-ins stay provisional until
        you confirm them. Every override is audit-logged.
      </p>
    </>
  );
}
