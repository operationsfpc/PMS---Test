import { Card } from "@components/ui";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { OfferPage } from "./offer-page";
import { createSupabaseOfferView } from "./offer-view";

/** Route wrapper for final selection. The drive arrives as `?drive=`. */
export function OfferRoute() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const driveId = params.get("drive");

  const [view] = useState(() =>
    createSupabaseOfferView(
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
        <p className="text-sm text-ink-700">
          Choose a drive to declare its final selections against.
        </p>
      </Card>
    );
  }

  return <OfferPage driveId={driveId} view={view} />;
}
