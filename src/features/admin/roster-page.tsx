import { Card } from "@components/ui";
import { type EmailHolder, normaliseEmail } from "@domain/email-identity";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { type CampusOption, RosterImportPage } from "./roster-import-page";

/**
 * Route wrapper: loads the campuses an administrator may add students into.
 *
 * With no campuses there is nothing to add against, so that case is stated
 * plainly rather than rendering a form with an empty dropdown.
 */
export function AdminRosterPage() {
  const [campuses, setCampuses] = useState<readonly CampusOption[] | null>(null);
  const [taken, setTaken] = useState<ReadonlyMap<string, EmailHolder>>(new Map());

  useEffect(() => {
    let active = true;
    void supabase()
      .from("campuses")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        if (active) {
          setCampuses((data ?? []).map((c) => ({ id: c.id as string, name: c.name as string })));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Every address already spoken for (0040). The database refuses a clash
   * outright, so this exists to name the offending ROW at preview time rather
   * than failing a file of hundreds with one unattributable error.
   *
   * Staff invitations are read as well as profiles: somebody invited but not
   * yet signed in holds their address just as firmly.
   */
  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase().from("students").select("email"),
      supabase().from("profiles").select("email"),
      supabase().from("staff_invitations").select("email"),
    ]).then(([students, profiles, invitations]) => {
      if (!active) return;
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
  }, []);

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

  return <RosterImportPage campuses={campuses} taken={taken} />;
}
