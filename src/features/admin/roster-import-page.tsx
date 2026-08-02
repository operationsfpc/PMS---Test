import { Button, Card, PageHeader } from "@components/ui";
import { parseCsv } from "@domain/csv";
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
export function RosterImportPage({
  repository,
  campuses,
}: {
  repository?: RosterRepository;
  campuses: readonly CampusOption[];
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

    const result = parseRoster(parseCsv(await file.text()));
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
        title="Import student roster"
        subtitle="Students can only sign in if they are on the roster."
      />

      {error !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {error}
          </p>
        </Card>
      )}

      {done !== null && (
        <Card className="mb-4 border border-[#1EE0E1] bg-[#ECF1F0] p-4">
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
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
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
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <p className="mt-1 text-xs text-ink-500">
              Columns, in order: {ROSTER_COLUMNS.join(", ")}
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
              <p className="mt-1 text-sm text-[#DD4820]">
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
            <Card className="p-5">
              <h2 className="mb-3 font-[Raleway] text-base font-bold text-[#DD4820]">
                Rows that cannot be imported
              </h2>
              <ul className="flex flex-col gap-2">
                {parsed.rejected.map((r) => (
                  <li key={`${r.row}-${r.reason}`} className="text-sm text-ink-700">
                    <strong>Row {r.row}:</strong> {r.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-500">
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
