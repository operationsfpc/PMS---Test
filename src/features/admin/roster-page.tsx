import { Card } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { type CampusOption, RosterImportPage } from "./roster-import-page";

/**
 * Route wrapper: loads the campuses an administrator may import into.
 *
 * With no campuses there is nothing to import against, so that case is stated
 * plainly rather than rendering a form with an empty dropdown.
 */
export function AdminRosterPage() {
  const [campuses, setCampuses] = useState<readonly CampusOption[] | null>(null);

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
          No campuses have been set up yet. A campus must exist before a roster can be imported
          against it.
        </p>
      </Card>
    );
  }

  return <RosterImportPage campuses={campuses} />;
}
