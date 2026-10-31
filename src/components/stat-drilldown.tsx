import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";
import { type ColumnDef, ShadcnDataTable } from "./data-table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Badge, ButtonLink, type Tone } from "./ui";

/**
 * One person as a drill-down lists them.
 *
 * Every field except the name is optional because the views hand over
 * different slices of a student: a drive's applicant row carries a campus and
 * a CGPA, an absence row carries neither. The popup drops any column nobody in
 * the list can fill, so a coordinator never reads a page of em dashes and
 * learns nothing from it.
 */
export interface DrilldownPerson {
  readonly id: string;
  readonly name: string;
  readonly rollNumber?: string | null;
  readonly campus?: string | null;
  /** Degree and branch together — "B.Tech CSE" — as the roster pages spell it. */
  readonly programme?: string | null;
  readonly cgpa?: number | null;
  /** Where this person stands, spelled by the caller: "Shortlisted", "Absent". */
  readonly status?: string | null;
  /** Which filter tab the person belongs to. Fewer than two tabs, none are drawn. */
  readonly group?: string | null;
}

/** The tab that lists everybody, so a group actually named "All" can't collide with it. */
const ALL = "__all__";

/**
 * Map person status to appropriate brand/feedback tone so placed and shortlisted
 * students stand out with distinctive colors rather than a monochrome grey.
 */
function statusTone(status: string): Tone {
  const s = status.toLowerCase().trim();
  if (
    s === "placed" ||
    s.includes("placed on campus") ||
    s.includes("self-placed") ||
    s === "verified" ||
    s === "approved" ||
    s === "cleared" ||
    s === "active" ||
    s.includes("selected") ||
    s === "offer" ||
    s.includes("accepted")
  ) {
    return "success";
  }
  if (
    s.includes("shortlist") ||
    s === "applied" ||
    s.includes("in round") ||
    s.includes("interview") ||
    s === "form submitted"
  ) {
    return "brand";
  }
  if (
    s.includes("opted out") ||
    s.includes("opt out") ||
    s.includes("reject") ||
    s.includes("absent") ||
    s.includes("hold") ||
    s.includes("failed") ||
    s.includes("disqualif")
  ) {
    return "danger";
  }
  if (
    s.includes("pending") ||
    s.includes("awaiting") ||
    s.includes("review") ||
    s.includes("draft")
  ) {
    return "warning";
  }
  return "neutral";
}

/** An empty string is as good as no value here, and the views hand over both. */
function filled(value: string | null | undefined): string | null {
  return value === null || value === undefined || value === "" ? null : value;
}

function isEmpty(value: string | number | null | undefined): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * The popup behind a count of people: "42 applied" opens to the 42 names.
 *
 * UAT 2026-10-16 asked for it in one sentence — "if it shows a count I need to
 * know who all is there". Every overview printed totals that sent the reader to
 * another page to find out who they were talking about, so a number could never
 * be checked against the room it described. This answers it in place, on the
 * same Sheet/Tabs/table primitives the rest of the design system uses.
 *
 * Presentation only: each page decides what its number counted and maps its own
 * rows onto `DrilldownPerson`.
 */
export function StatDrilldown({
  open,
  onClose,
  eyebrow,
  title,
  people,
  note,
  href,
  linkLabel,
  emptyText = "Nobody is in this count yet.",
}: {
  open: boolean;
  onClose: () => void;
  /** What kind of number was clicked: "Applicants", "Offers". */
  eyebrow: string;
  /** The count's own words, so the popup reads as the card it came from. */
  title: string;
  people: readonly DrilldownPerson[];
  /** One line of context, spelled by the page. Null means the page has none. */
  note?: string | null;
  /** A page holding the same list with more room, e.g. the student directory. */
  href?: string | undefined;
  linkLabel?: string | undefined;
  emptyText?: string | undefined;
}) {
  const [tab, setTab] = useState<string>(ALL);

  /** Tabs only mean something when the count spans more than one group. */
  const groups = useMemo(() => {
    const labels = new Set<string>();
    for (const person of people) {
      const label = filled(person.group);
      if (label !== null) labels.add(label);
    }
    if (labels.size < 2) return [];
    return [
      { key: ALL, label: "All", count: people.length },
      ...[...labels].map((label) => ({
        key: label,
        label,
        count: people.filter((person) => person.group === label).length,
      })),
    ];
  }, [people]);

  const shown = useMemo(() => {
    const group = groups.find((g) => g.key === tab);
    return group === undefined
      ? people
      : people.filter((person) => group.key === ALL || person.group === group.label);
  }, [people, groups, tab]);

  const columns = useMemo(() => {
    const any = (get: (person: DrilldownPerson) => string | number | null | undefined) =>
      people.some((person) => !isEmpty(get(person)));

    const cols: ColumnDef<DrilldownPerson>[] = [
      {
        id: "name",
        header: "Student",
        accessorKey: "name",
        sortable: true,
        cell: (person) => (
          <Link
            to={`/students/${person.id}`}
            onClick={onClose}
            className="font-semibold text-brand-700 underline-offset-2 transition-colors hover:text-brand-900 hover:underline"
          >
            {person.name}
          </Link>
        ),
      },
    ];
    if (any((person) => person.rollNumber)) {
      cols.push({
        id: "rollNumber",
        header: "Roll no.",
        accessorKey: "rollNumber",
        sortable: true,
      });
    }
    if (any((person) => person.campus)) {
      cols.push({ id: "campus", header: "Campus", accessorKey: "campus", sortable: true });
    }
    if (any((person) => person.programme)) {
      cols.push({ id: "programme", header: "Programme", accessorKey: "programme" });
    }
    if (any((person) => person.cgpa)) {
      cols.push({
        id: "cgpa",
        header: "CGPA",
        accessorFn: (person) => person.cgpa,
        sortable: true,
        cell: (person) => {
          if (person.cgpa === null || person.cgpa === undefined) return "—";
          const formatted = person.cgpa.toFixed(2);
          return person.cgpa >= 8.5 ? (
            <span className="font-semibold text-brand-700">{formatted}</span>
          ) : (
            <span>{formatted}</span>
          );
        },
      });
    }
    if (any((person) => person.status)) {
      cols.push({
        id: "status",
        header: "Status",
        cell: (person) => {
          const status = person.status;
          if (typeof status !== "string" || status === "") return "—";
          return <Badge tone={statusTone(status)}>{status}</Badge>;
        },
      });
    }
    return cols;
  }, [people, onClose]);

  const list =
    shown.length === 0 ? (
      <p className="py-8 text-center text-sm text-ink-500">{emptyText}</p>
    ) : (
      <ShadcnDataTable
        data={shown}
        columns={columns}
        defaultPageSize={25}
        stickyPagination
        searchPlaceholder="Search name, roll number or campus…"
        caption={title}
        emptyMessage="No student here matches that search."
      />
    );

  /**
   * The heading, with the filter strip inside it when the count spans more than
   * one group. The filters ride in the sticky header because they are how the
   * reader narrows the list, and a control that scrolls out of view above a long
   * roster is a control that says "scroll back to the top to do your job".
   *
   * The "open this list" link rides here too (2026-10-31): under the table it
   * sat in the strip the sticky pager now owns, so it was covered on exactly
   * the long rosters where it was needed.
   */
  const header = (filters: ReactNode) => (
    <SheetHeader>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand-700">
          {eyebrow}
        </span>
        {href !== undefined && (
          <ButtonLink size="sm" variant="ghost" to={href} onClick={onClose}>
            {linkLabel ?? "Open this list in All students"}
          </ButtonLink>
        )}
      </div>
      <SheetTitle>{title}</SheetTitle>
      {/*
        The header counts what the list below actually shows. A popup that
        opened on "18 shortlisted" and printed 20 rows is worse than no
        popup at all — the reader now doubts every other number on the page.
      */}
      <SheetDescription>
        <span className="font-medium text-ink-700">
          {shown.length} student{shown.length === 1 ? "" : "s"}
        </span>
        {isEmpty(note) ? (
          ""
        ) : (
          <>
            <span className="mx-1.5 text-ink-400">·</span>
            <span className="inline-flex items-center rounded-md border border-success-500/30 bg-success-50 px-2 py-0.5 text-xs font-semibold text-success-700">
              {note}
            </span>
          </>
        )}
      </SheetDescription>
      {filters}
    </SheetHeader>
  );

  const filterStrip = (
    <div className="-mb-1 overflow-x-auto pt-1">
      <TabsList aria-label={`${title} filters`}>
        {groups.map((group) => (
          <TabsTrigger key={group.key} value={group.key}>
            {group.label} ({group.count})
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side="right" size="2xl">
        {groups.length === 0 ? (
          <>
            {header(null)}
            {list}
          </>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            {header(filterStrip)}
            <TabsContent value={tab} className="mt-3">
              {list}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
