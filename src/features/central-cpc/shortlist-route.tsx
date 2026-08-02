import { Card } from "@components/ui";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { ShortlistPage } from "./shortlist-page";
import { createSupabaseShortlistView } from "./shortlist-view";

/** Route wrapper for shortlisting. The drive arrives as `?drive=`. */
export function ShortlistRoute() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const driveId = params.get("drive");

  const [view] = useState(() =>
    createSupabaseShortlistView(
      supabase(),
      async () => {
        const { data } = await supabase().auth.getSession();
        return data.session?.user.id ?? null;
      },
      async () => (auth.status === "signed-in" ? auth.role : "student"),
    ),
  );

  if (driveId === null) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-700">Choose a drive to shortlist its applicants.</p>
      </Card>
    );
  }

  return <ShortlistPage driveId={driveId} view={view} />;
}
