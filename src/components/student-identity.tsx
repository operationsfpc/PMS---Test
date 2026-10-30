import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * Who a row is about: the name, which opens that student's record, the roll
 * number that tells two same-named rows apart, and the college they belong to.
 *
 * Several staff screens list students side by side — rounds and results,
 * shortlisting, attendance, offers. A coordinator reading two of them about
 * the same cohort should not find the same three facts placed or worded
 * differently, which is why this exists once rather than four times.
 */
export function StudentIdentity({
  name,
  rollNumber,
  college,
  studentId,
  detail,
  children,
}: {
  readonly name: string;
  readonly rollNumber: string;
  readonly college?: string | null | undefined;
  readonly studentId?: string | null | undefined;
  readonly detail?: string | null | undefined;
  /** Anything the row adds beneath the identity — a slot editor, a CGPA line. */
  readonly children?: ReactNode;
}) {
  return (
    <div className="min-w-0 break-words [overflow-wrap:anywhere]">
      <p className="font-medium text-ink-900">
        {studentId != null && studentId !== "" ? (
          <Link to={`/students/${studentId}`} className="hover:underline">
            {name}
          </Link>
        ) : (
          name
        )}
      </p>
      {/* A bare "1" under a name is a roll number only to whoever already
          knows the system. Every staff row goes through here, so the words
          belong on this line rather than on eight screens. */}
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-500">
        {rollNumber !== "" && <span>Roll {rollNumber}</span>}
        {college != null && college !== "" && (
          <span
            title="College campus"
            className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700"
          >
            <span className="sr-only">College: </span>
            {college}
          </span>
        )}
      </p>
      {detail != null && detail !== "" && <p className="text-xs text-ink-500">{detail}</p>}
      {children}
    </div>
  );
}
