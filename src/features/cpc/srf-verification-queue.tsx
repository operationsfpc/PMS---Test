import { Badge, Button, Card, DataTable, PageHeader } from "@components/ui";
import { PENDING_SRFS } from "@lib/mock-data";

/**
 * CPC — SRF verification queue. PRD §4.2, §17.2.
 *
 * The coordinator's job is to check entered marks against uploaded marksheets,
 * so the marksheet link sits next to the figure it justifies. Arrear history is
 * surfaced separately from standing arrears because drives filter on both.
 */
export function SrfVerificationQueue() {
  return (
    <>
      <PageHeader
        title="Verification queue"
        subtitle="Alliance University · Verify entered marks against uploaded marksheets."
        actions={<Button variant="secondary">Bulk import semester data</Button>}
      />

      <Card className="mb-4 p-4">
        <p className="text-sm text-ink-700">
          <strong>{PENDING_SRFS.length}</strong> registration forms awaiting verification. Students
          cannot receive or apply to any drive until approved.
        </p>
      </Card>

      <Card className="p-2">
        <DataTable
          caption="Registration forms awaiting verification"
          columns={[
            "Student",
            "Degree",
            "Overall CGPA",
            "Standing arrears",
            "Arrear history",
            "Marksheets",
            "Submitted",
            "Decision",
          ]}
        >
          {PENDING_SRFS.map((s) => (
            <tr key={s.id} className="border-b border-line last:border-0">
              <td className="px-3 py-3">
                <p className="font-medium text-ink-900">{s.name}</p>
                <p className="text-xs text-ink-500">{s.rollNumber}</p>
              </td>
              <td className="px-3 py-3 text-ink-700">
                {s.degree} {s.branch}
              </td>
              <td className="px-3 py-3 font-medium text-ink-900">{s.cgpa}</td>
              <td className="px-3 py-3">
                {s.currentArrears > 0 ? (
                  <Badge tone="danger">{s.currentArrears}</Badge>
                ) : (
                  <span className="text-ink-500">0</span>
                )}
              </td>
              <td className="px-3 py-3">
                {s.historyOfArrears > 0 ? (
                  <Badge tone="warning">{s.historyOfArrears}</Badge>
                ) : (
                  <span className="text-ink-500">0</span>
                )}
              </td>
              <td className="px-3 py-3">
                <a
                  href="#preview"
                  className="text-sm font-medium text-brand-500 underline underline-offset-2"
                >
                  View 4 files
                </a>
              </td>
              <td className="px-3 py-3 text-xs text-ink-500">{s.submittedAt}</td>
              <td className="px-3 py-3">
                <div className="flex gap-2">
                  <Button size="sm">Approve</Button>
                  <Button size="sm" variant="danger">
                    Reject
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <p className="mt-4 text-xs text-ink-500">
        Rejection requires a reason and the student may resubmit. Approval locks the academic
        figures — only a coordinator can change them afterwards.
      </p>
    </>
  );
}
