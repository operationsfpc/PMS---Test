import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

/**
 * A number the pane prints, and what it counts.
 *
 * 2026-10-18: the tab read "Software Engineer (18)" and the lone heading "18".
 * Eighteen of what — applicants, shortlists, students in the room? Only the
 * page knows, so the page says, in the form that reads for its own value:
 * `unit` is "applicant" for 1 and "applicants" for 18.
 */
export interface VisitPaneCount {
  readonly value: number;
  readonly unit: string;
}

/** One role of a company visit, listed as its own tab in the pane. */
export interface VisitPaneRole {
  /** The tab's key. The drive's own id keeps it stable across renders. */
  readonly id: string;
  readonly label: string;
  /** How many the role holds. Read inside the tab, because a count that belongs
   * to the visit would have to be summed across roles — and stages never sum. */
  readonly count?: VisitPaneCount | undefined;
  /** Only when the visit mixes types, so the tab has to say which one this is. */
  readonly badge?: ReactNode | undefined;
  readonly content: ReactNode;
}

/** Two people on a visit is what the tablist is for; one is a heading. */
const MIN_TABS = 2;

function UsersGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 20h5v-2a4 4 0 00-4-4h-1M9 16H4a4 4 0 014-4h1m0 13v-2a4 4 0 00-4-4M9 4a4 4 0 118 0 4 4 0 01-8 0z"
      />
    </svg>
  );
}

/**
 * The side pane for one company visit.
 *
 * A visit's roles each hold a roster, and a coordinator reads one roster at a
 * time — so the roles are tabs, not cards stacked in a scroll, and only the
 * selected role's students are mounted. The company is named once, in the
 * header, whatever the number of roles under it.
 *
 * It is the right-hand `Sheet`, portalled over the page: the app's own sidebar
 * stays where it is and navigation is never covered by a second one.
 */
export function VisitPane({
  open,
  onClose,
  company,
  eyebrow = "Company visit",
  description,
  roles,
  activeId,
}: {
  open: boolean;
  onClose: () => void;
  company: string;
  eyebrow?: string;
  description?: string | undefined;
  roles: readonly VisitPaneRole[];
  activeId?: string | undefined;
}) {
  const [single] = roles;
  const isVisit = roles.length >= MIN_TABS;
  const active = roles.find((role) => role.id === activeId) ?? roles[0];

  /**
   * The heading, with the role strip inside it when there is one. The tabs ride
   * in the sticky header rather than below it because they are how the reader
   * changes role, and a control that scrolls out of view above a long roster is
   * a control that says "scroll back to the top to do your job".
   */
  const header = (tabs: ReactNode) => (
    <SheetHeader>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-600">
        <UsersGlyph />
        {eyebrow}
      </p>
      <SheetTitle>{company}</SheetTitle>
      {description === undefined || description === "" ? null : (
        <SheetDescription>{description}</SheetDescription>
      )}
      {tabs}
    </SheetHeader>
  );

  const tabStrip = (
    <div className="-mb-1 overflow-x-auto pt-1">
      <TabsList aria-label={`${company} roles`}>
        {roles.map((role) => (
          <TabsTrigger key={role.id} value={role.id}>
            {role.label}
            {role.count === undefined ? null : ` (${role.count.value} ${role.count.unit})`}
            {role.badge === undefined ? null : <span className="ml-2">{role.badge}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side="right" size="2xl">
        {isVisit ? (
          <Tabs defaultValue={active?.id}>
            {header(tabStrip)}
            {roles.map((role) => (
              <TabsContent key={role.id} value={role.id} className="mt-4">
                {role.content}
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <>
            {header(null)}
            {single === undefined ? (
              <p className="text-sm text-ink-500">This visit has no roles to list.</p>
            ) : (
              <div className="mt-4">
                <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-heading font-bold text-ink-900">{single.label}</span>
                  {single.badge ?? null}
                  {single.count === undefined ? null : (
                    <span className="text-ink-500">
                      {single.count.value} {single.count.unit}
                    </span>
                  )}
                </p>
                {single.content}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
