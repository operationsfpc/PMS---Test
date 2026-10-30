import { Button, Card, PageHeader } from "@components/ui";
import { parseCsv } from "@domain/csv";
import type { EmailHolder } from "@domain/email-identity";
import { parseRoster, ROSTER_COLUMNS, type RosterParseResult } from "@domain/roster-import";
import { supabase } from "@lib/supabase";
import { useId, useState } from "react";
import {
  createSupabaseRosterRepository,
  RosterError,
  type RosterRepository,
} from "./roster-repository";

export interface CampusOption {
  readonly id: string;
  readonly name: string;
}

/**
 * Roster import.
 *
 * Every accepted row becomes a login (migration 0009); every rejected row is a
 * student who cannot sign in at all. So nothing is written until the
 * administrator has seen both lists, and rejections are shown with their
 * spreadsheet row number rather than summarised as a count.
 *
 * CSV only for now. The template is .xlsx, but reading it needs a spreadsheet
 * library, and adding a dependency is a decision to take deliberately rather
 * than in passing. "Save as CSV" is one step in Excel.
 */
/** Real downloads go through a Blob; tests hand in a spy. */
function browserDownload(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function RosterImportPage({
  repository,
  campuses,
  taken = new Map(),
  download = browserDownload,
}: {
  repository?: RosterRepository;
  campuses: readonly CampusOption[];
  download?: (filename: string, text: string) => void;
  /**
   * Addresses already claimed by a student or staff member (0040), keyed by
   * the normalised address. Surfaces a clash HERE, per row, rather than as one
   * batch failure the administrator cannot locate in a file of hundreds.
   */
  taken?: ReadonlyMap<string, EmailHolder>;
}) {
  const [repo] = useState<RosterRepository>(
    () => repository ?? createSupabaseRosterRepository(supabase()),
  );
  const fileId = useId();
  const campusId = useId();

  const [parsed, setParsed] = useState<RosterParseResult | null>(null);
  const [campus, setCampus] = useState(campuses[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    setDone(null);
    setError(null);
    setParsed(null);
    if (file === undefined) return;

    const result = parseRoster(parseCsv(await file.text()), taken);
    if (result.fatal !== null) {
      setError(result.fatal);
      return;
    }
    setParsed(result);
  }

  async function runImport() {
    if (parsed === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await repo.importStudents(campus, parsed.accepted);
      setDone(result.imported);
      setParsed(null);
    } catch (caught) {
      setError(caught instanceof RosterError ? caught.message : "Could not import the roster.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Add students"
        subtitle="Students can only sign in once they have been added here."
      />

      {error !== null && (
        <Card className="mb-4 border border-danger-500 bg-danger-50 p-4">
          <p role="alert" className="text-sm text-danger-500">
            {error}
          </p>
        </Card>
      )}

      {done !== null && (
        <Card className="mb-4 border border-success-500/30 bg-success-50 p-4">
          <p role="status" className="text-sm text-ink-900">
            Imported {done} student{done === 1 ? "" : "s"}. They can now sign in with the Google
            account on their roster row.
          </p>
        </Card>
      )}

      <Card className="mb-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={campusId} className="mb-1 block text-sm font-medium text-ink-900">
              Campus
            </label>
            <select
              id={campusId}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
            >
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={fileId} className="mb-1 block text-sm font-medium text-ink-900">
              Roster file (CSV)
            </label>
            <input
              id={fileId}
              type="file"
              accept=".csv,text/csv"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <p className="mt-1 text-xs text-ink-500">
              Columns, in order: {ROSTER_COLUMNS.join(", ")}
            </p>
            {/*
             * 2026-08-17 (Karthik): "put a sample CSV file there with just the
             * first row (headings) filled... this is more for reference."
             *
             * The import refuses a file whose columns are not in this exact
             * order, so retyping the header by hand is a failed import waiting
             * to happen with no obvious cause. Built FROM `ROSTER_COLUMNS`, so
             * a column added later cannot leave the template handing out a
             * header that looks official and no longer works.
             */}
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => download("add-students-template.csv", `${ROSTER_COLUMNS.join(",")}\n`)}
            >
              Download sample CSV
            </Button>
            <p className="mt-1 text-xs text-ink-500">
              Headings only — fill in one student per row underneath.
            </p>
          </div>
        </div>
      </Card>

      {parsed !== null && (
        <>
          <Card className="mb-4 p-5">
            {/* One text node per sentence: a screen reader announces it as a
                sentence, and it can be asserted on as one. */}
            <p className="text-sm font-semibold text-ink-900">
              {`${parsed.accepted.length} student${parsed.accepted.length === 1 ? "" : "s"} ready to import.`}
            </p>
            {parsed.rejected.length > 0 && (
              <p className="mt-1 text-sm text-danger-500">
                {`${parsed.rejected.length} row${parsed.rejected.length === 1 ? "" : "s"} cannot be imported.`}
              </p>
            )}

            {parsed.accepted.length > 0 && (
              <div className="mt-4">
                <Button disabled={busy || campus === ""} onClick={() => void runImport()}>
                  {busy
                    ? "Importing…"
                    : `Import ${parsed.accepted.length} student${parsed.accepted.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            )}
          </Card>

          {parsed.rejected.length > 0 && (
            <Card className="mb-4 border border-destructive/40 bg-destructive/5 p-5">
              <h2 className="mb-3 font-heading text-base font-bold text-destructive">
                Rows that cannot be imported ({parsed.rejected.length})
              </h2>
              <ul className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                {parsed.rejected.map((r) => (
                  <li
                    key={`${r.row}-${r.reason}`}
                    className="text-sm text-ink-800 bg-surface border border-destructive/20 rounded-lg p-2.5 shadow-2xs"
                  >
                    <strong className="text-destructive mr-1.5">Row {r.row}:</strong>
                    <span>{r.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-600">
                These students will not be able to sign in. Correct the file and import again —
                students already imported are left untouched.
              </p>
            </Card>
          )}
        </>
      )}
    </>
  );
}
