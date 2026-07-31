import { Badge, Button, Card, DataTable, PageHeader } from "@components/ui";
import { APPLICANTS } from "@lib/mock-data";
import { useState } from "react";

/**
 * Central CPC — internal shortlisting workspace. PRD §13.
 *
 * Two things the UI must never get wrong:
 *  1. Shortlist status and ranking rationale are INTERNAL ONLY — never shown to
 *     students. The banner states this so nobody screenshots it into a chat.
 *  2. The recommendation is advisory. The human decision is what ships, and the
 *     pair (recommendation, decision) is logged so quality can be reviewed.
 */
export function ShortlistingWorkspace() {
  const [selected, setSelected] = useState<readonly string[]>(["a1", "a2"]);

  const toggle = (id: string): void =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <>
      <PageHeader
        title="Shortlisting — Zoho Corporation"
        subtitle="Member Technical Staff · 4 campuses · Applications closed 30 Jun"
        actions={
          <>
            <Button variant="secondary">Forward all applicants</Button>
            <Button>Export {selected.length} to recruiter</Button>
          </>
        }
      />

      <div
        role="note"
        className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-600"
      >
        <strong>Internal only.</strong> Ranking, scores and rationale are never visible to students.
        Your final decision and the recommendation that preceded it are both audit-logged.
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          ["Applicants", String(APPLICANTS.length)],
          ["Selected for export", String(selected.length)],
          ["Ranking method", "Rule-based"],
        ].map(([label, value]) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-ink-500">{label}</p>
            <p className="font-heading text-lg font-bold text-ink-900">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-2">
        <DataTable
          caption="Ranked applicants"
          columns={["Include", "Rank", "Student", "CGPA", "Aptitude", "Coding", "Score", "Why"]}
        >
          {APPLICANTS.map((a, i) => (
            <tr key={a.id} className="border-b border-line align-top last:border-0">
              <td className="px-3 py-3">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-500"
                  checked={selected.includes(a.id)}
                  onChange={() => toggle(a.id)}
                  aria-label={`Include ${a.name} in the recruiter export`}
                />
              </td>
              <td className="px-3 py-3 font-semibold text-ink-500">#{i + 1}</td>
              <td className="px-3 py-3">
                <p className="font-medium text-ink-900">{a.name}</p>
                <p className="text-xs text-ink-500">{a.rollNumber}</p>
              </td>
              <td className="px-3 py-3 text-ink-700">{a.cgpa}</td>
              <td className="px-3 py-3 text-ink-700">{a.aptitude}</td>
              <td className="px-3 py-3 text-ink-700">{a.coding}</td>
              <td className="px-3 py-3">
                <Badge tone={a.score >= 80 ? "success" : a.score >= 70 ? "warning" : "neutral"}>
                  {a.score}
                </Badge>
              </td>
              <td className="max-w-[16rem] px-3 py-3 text-xs text-ink-500">{a.rationale}</td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
