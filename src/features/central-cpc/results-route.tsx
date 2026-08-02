import { Card } from "@components/ui";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { ResultsPage } from "./results-page";
import { createSupabaseResultsView } from "./results-view";

/**
 * Route wrapper for round results.
 *
 * The round arrives as `?round=`. Without one there is nothing to record, and
 * defaulting to "the latest round" would risk writing results against the
 * wrong one.
 */
export function ResultsRoute() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const roundId = params.get("round");

  const [view] = useState(() =>
    createSupabaseResultsView(
      supabase(),
      async () => {
        const { data } = await supabase().auth.getSession();
        return data.session?.user.id ?? null;
      },
      async () => (auth.status === "signed-in" ? auth.role : "student"),
    ),
  );

  if (roundId === null) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-700">Choose a round from the drive to record its results.</p>
      </Card>
    );
  }

  return <ResultsPage roundId={roundId} view={view} />;
}
