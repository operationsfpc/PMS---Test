import { ErrorPanel } from "@components/error-panel";
import { Card } from "@components/ui";
import { type EmailHolder, normaliseEmail } from "@domain/email-identity";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { ExistingStudentsList } from "./existing-students-list";
import { type CampusOption, RosterImportPage } from "./roster-import-page";

/**
 * Route wrapper: loads the campuses an administrator may add students into.
 *
 * With no campuses there is nothing to add against, so that case is stated
 * plainly rather than rendering a form with an empty dropdown.
 */
export function AdminRosterPage() {
  const [campuses, setCampuses] = useState<readonly CampusOption[] | null>(null);
  /** The campus read failing — reported apart from "this firm has no campuses". */
  const [campusesProblem, setCampusesProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [taken, setTaken] = useState<ReadonlyMap<string, EmailHolder>>(new Map());
  /** Set when the addresses already on record could not be read. */
  const [guardProblem, setGuardProblem] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    let active = true;
    void supabase()
      .from("campuses")
      .select("id, name")
      .order("name")
      .then(({ data, error }) => {
        if (!active) return;
        // Read past, an outage arrived as `[]` and the page told the
        // administrator that no campuses had been set up.
        if (error !== null) {
          setCampusesProblem("We could not read the campuses. Please try again.");
          return;
        }
        setCampusesProblem(null);
        setCampuses((data ?? []).map((c) => ({ id: c.id as string, name: c.name as string })));
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  /**
   * Every address already spoken for (0040). The database refuses a clash
   * outright, so this exists to name the offending ROW at preview time rather
   * than failing a file of hundreds with one unattributable error.
   *
   * Staff invitations are read as well as profiles: somebody invited but not
   * yet signed in holds their address just as firmly.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase().from("students").select("email"),
      supabase().from("profiles").select("email"),
      supabase().from("staff_invitations").select("email"),
    ]).then(([students, profiles, invitations]) => {
      if (!active) return;
      // An empty map here is not "every address is free" — it is the preview
      // check being off, and the administrator is told so before they upload.
      if (students.error !== null || profiles.error !== null || invitations.error !== null) {
        setGuardProblem(
          "We could not read the email addresses already on record, so a clash will not be caught until the import runs.",
        );
        return;
      }
      setGuardProblem(null);
      const claimed = new Map<string, EmailHolder>();
      for (const row of profiles.data ?? [])
        claimed.set(normaliseEmail(String(row.email)), "staff");
      for (const row of invitations.data ?? [])
        claimed.set(normaliseEmail(String(row.email)), "staff");
      // Students last is deliberate: an address held by BOTH is the P8 state,
      // and calling it a student clash would send an administrator to the
      // wrong screen to fix it.
      for (const row of students.data ?? []) {
        const email = normaliseEmail(String(row.email));
        if (!claimed.has(email)) claimed.set(email, "student");
      }
      setTaken(claimed);
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (campusesProblem !== null) {
    return (
      <div className="p-6">
        <ErrorPanel onRetry={() => setAttempt((count) => count + 1)} retryLabel="Load them again">
          {campusesProblem} Until they load, no roster can be imported.
        </ErrorPanel>
      </div>
    );
  }

  if (campuses === null) {
    return (
      <p role="status" className="p-6 text-sm text-neutral-500">
        Loading campuses…
      </p>
    );
  }

  if (campuses.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-700">
          No campuses have been set up yet. A campus must exist before students can be added against
          it.
        </p>
      </Card>
    );
  }

  return (
    <>
      {guardProblem !== null && (
        <div className="mb-4">
          <ErrorPanel>{guardProblem}</ErrorPanel>
        </div>
      )}
      <RosterImportPage campuses={campuses} taken={taken} />
      <ExistingStudentsList campuses={campuses} />
    </>
  );
}
