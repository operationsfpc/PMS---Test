import { Badge, Button, Card, PageHeader, StatCard } from "@components/ui";

/** Student dashboard — PRD §17.1. VISUAL MOCK. */
export function StudentDashboard() {
  return (
    <>
      <PageHeader title="Welcome back, Priya" subtitle="21CSE1042 · B.E CSE · Batch of 2026" />

      {/* Placed banner — the ladder rule needs explaining, not just enforcing. */}
      <Card className="mb-6 overflow-hidden">
        <div className="fpc-gradient h-1" aria-hidden="true" />
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <Badge tone="success">Placed</Badge>
              <Badge tone="brand">Dream</Badge>
            </div>
            <p className="font-heading text-lg font-bold text-ink-900">
              Freshworks — Associate Software Engineer
            </p>
            <p className="mt-1 text-sm text-ink-500">
              ₹7.5 LPA · Offer letter available · Declared 12 June 2026
            </p>
          </div>
          <Button variant="secondary">Download offer letter</Button>
        </div>
        <p className="border-t border-line bg-brand-50 px-5 py-3 text-xs text-brand-600">
          You will now only see <strong>new</strong> drives above the Dream category. Drives you had
          already applied to continue as normal.
        </p>
      </Card>

      <section aria-label="Summary" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Applications" value={7} />
        <StatCard label="In process" value={2} tone="brand" />
        <StatCard label="Offers" value={1} tone="success" />
        <StatCard label="Absences" value="1 of 3" tone="warning" hint="3 leads to review" />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-lg text-ink-900">Open to you now</h2>
          <div className="flex flex-col gap-3">
            {[
              {
                company: "Goldman Sachs",
                role: "Analyst — Engineering",
                ctc: "₹18–22 LPA",
                category: "Super Dream",
                closes: "Closes in 2 days",
                urgent: true,
              },
              {
                company: "Sprinklr",
                role: "Product Engineer",
                ctc: "₹14 LPA",
                category: "Super Dream",
                closes: "Closes in 6 days",
                urgent: false,
              },
            ].map((d) => (
              <Card key={d.company} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-heading font-bold text-ink-900">{d.company}</p>
                    <p className="text-sm text-ink-500">{d.role}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone="brand">{d.category}</Badge>
                      <span className="text-xs font-medium text-ink-700">{d.ctc}</span>
                      <Badge tone={d.urgent ? "danger" : "neutral"}>{d.closes}</Badge>
                    </div>
                  </div>
                  <Button>Apply</Button>
                </div>
              </Card>
            ))}
          </div>

          <h2 className="mt-6 mb-3 text-lg text-ink-900">In process</h2>
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-heading font-bold text-ink-900">Zoho Corporation</p>
                <p className="text-sm text-ink-500">Member Technical Staff</p>
              </div>
              <Badge tone="warning">Round 3 of 4</Badge>
            </div>
            <ol className="mt-4 flex flex-wrap gap-2">
              {[
                ["Online test", "success"],
                ["Technical interview", "success"],
                ["Managerial interview", "warning"],
                ["HR interview", "neutral"],
              ].map(([name, tone]) => (
                <li key={name}>
                  <Badge tone={tone as "success" | "warning" | "neutral"}>{name}</Badge>
                </li>
              ))}
            </ol>
            <p className="mt-4 rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-700">
              <strong>Managerial interview</strong> · 4 Aug, 10:00 AM · Seminar Hall B
            </p>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-lg text-ink-900">Notifications</h2>
          <Card className="divide-y divide-line">
            {[
              ["Result declared", "You are selected for Round 3 at Zoho.", "1h"],
              ["Attendance recorded", "Marked absent for Accenture Round 1.", "2d"],
              ["New drive", "Goldman Sachs is open to you.", "3d"],
            ].map(([title, body, when]) => (
              <div key={title} className="flex gap-3 p-4">
                <span
                  className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{title}</p>
                  <p className="text-sm text-ink-500">{body}</p>
                  <p className="mt-0.5 text-xs text-ink-300">{when} ago</p>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
