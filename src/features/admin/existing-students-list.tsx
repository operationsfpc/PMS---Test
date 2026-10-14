import { Card } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import type { CampusOption } from "./roster-import-page";

interface Student {
  readonly id: string;
  readonly full_name: string;
  readonly email: string;
  readonly roll_number: string | null;
  readonly campus_id: string;
  readonly passing_year: number | null;
}

/**
 * Shows existing students below the import form, so administrators can see who
 * has already been added without leaving the page.
 */
export function ExistingStudentsList({ campuses }: { campuses: readonly CampusOption[] }) {
  const [students, setStudents] = useState<readonly Student[] | null>(null);
  const [filterCampus, setFilterCampus] = useState<string>("");

  useEffect(() => {
    let active = true;
    void supabase()
      .from("students")
      .select("id, full_name, email, roll_number, campus_id, passing_year")
      .order("full_name")
      .then(({ data }) => {
        if (active) {
          setStudents((data ?? []) as Student[]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = filterCampus
    ? students?.filter((s) => s.campus_id === filterCampus) ?? []
    : students ?? [];

  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? "Unknown";

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-[Raleway] text-base font-bold text-ink-900">
          Existing students ({filtered.length})
        </h2>
        <div className="flex items-center gap-2">
          <label htmlFor="campus-filter" className="text-sm font-medium text-ink-700">
            Campus:
          </label>
          <select
            id="campus-filter"
            value={filterCampus}
            onChange={(e) => setFilterCampus(e.target.value)}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="">All campuses</option>
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {students === null ? (
        <p role="status" className="text-sm text-neutral-500">
          Loading students…
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-500">
          {filterCampus ? "No students at this campus yet." : "No students have been added yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase text-ink-500">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Roll No</th>
                <th className="py-2 pr-4">Campus</th>
                <th className="py-2">Passing Year</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-line/50">
                  <td className="py-2 pr-4 text-ink-900">{s.full_name}</td>
                  <td className="py-2 pr-4 text-ink-700">{s.email}</td>
                  <td className="py-2 pr-4 text-ink-700">{s.roll_number ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink-700">{campusName(s.campus_id)}</td>
                  <td className="py-2 text-ink-700">{s.passing_year ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
