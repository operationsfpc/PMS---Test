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
    <div className="min-w-0">
      <p className="font-medium text-ink-900">
        {studentId != null && studentId !== "" ? (
          <Link to={`/students/${studentId}`} className="hover:underline">
            {name}
          </Link>
        ) : (
          name
        )}
      </p>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-500">
        <span>{rollNumber}</span>
        {college != null && college !== "" && (
          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
            {college}
          </span>
        )}
      </p>
      {detail != null && detail !== "" && <p className="text-xs text-ink-500">{detail}</p>}
      {children}
    </div>
  );
}
