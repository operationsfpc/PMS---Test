import { Badge, Button, Card, PageHeader, StatCard } from "@components/ui";
import { COCKPIT_DRIVES } from "@lib/mock-data";
import { Link } from "react-router";

/**
 * Central CPC — operational cockpit. PRD §17.4.
 * Organised as a work queue: what needs me, and what is it blocked on.
 */
export function DriveCockpit() {
  return (
    <>
      <PageHeader
        title="Drive cockpit"
        subtitle="Every live and pending drive across your campuses."
        actions={
          <>
            <Button variant="secondary">Bulk import semester data</Button>
            <Button variant="secondary">Absence monitor</Button>
          </>
        }
      />

      <section aria-label="Summary" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Awaiting completion" value={1} tone="warning" hint="Cannot go live yet" />
        <StatCard label="Live drives" value={3} tone="brand" />
        <StatCard label="Shortlists pending" value={1} tone="warning" />
        <StatCard label="Disbarment reviews" value={2} tone="danger" hint="3+ absences" />
      </section>

      <h2 className="mb-3 text-lg text-ink-900">Drives</h2>
      <div className="flex flex-col gap-3">
        {COCKPIT_DRIVES.map((d) => (
          <Card key={d.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <p className="font-heading font-bold text-ink-900">{d.company}</p>
                  <Badge tone={d.tone}>{d.status}</Badge>
                  {d.onHold === true && <Badge tone="warning">Cannot publish while on hold</Badge>}
                </div>
                <p className="text-sm text-ink-500">{d.role}</p>
                <p className="mt-1 text-xs text-ink-500">{d.detail}</p>
              </div>
              {d.id === "d1" ? (
                <Link
                  to="/central/publish"
                  className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
                >
                  {d.action}
                </Link>
              ) : (
                <Button variant="secondary">{d.action}</Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
