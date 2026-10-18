import { DrivePicker } from "@components/drive-picker";
import { ErrorPanel } from "@components/error-panel";
import { Card } from "@components/ui";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { usePickerDrives } from "@lib/use-picker-drives";
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

  // M1 (2026-08-21): this page dead-ended with no drive list at all —
  // reported as "final selection page is not getting populated".
  const { drives, failed, retry } = usePickerDrives(driveId === null);

  if (driveId === null) {
    if (failed) {
      return (
        <ErrorPanel onRetry={() => void retry()}>
          We could not load the drives to choose from.
        </ErrorPanel>
      );
    }
    if (drives === null) {
      return (
        <Card className="p-6">
          <p role="status" className="text-sm text-ink-500">
            Loading drives…
          </p>
        </Card>
      );
    }
    return (
      <DrivePicker
        drives={drives}
        makeLink={(id) => `/central/offers?drive=${id}`}
        prompt="Choose a drive to declare its final selections against."
      />
    );
  }

  return <OfferPage driveId={driveId} view={view} />;
}
