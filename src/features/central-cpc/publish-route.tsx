import { Card } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { DafPublish } from "./daf-publish";
import { createSupabasePublishView } from "./publish-view";

/**
 * Route wrapper: which drive is being published comes from `?drive=`.
 *
 * The cockpit links here with the id. Arriving without one is a dead end
 * rather than an error, so it says where to go instead of failing to load
 * something it was never given.
 */
export function PublishRoute() {
  const [params] = useSearchParams();
  const driveId = params.get("drive");

  const view = useMemo(
    () => (driveId === null ? null : createSupabasePublishView(supabase(), driveId)),
    [driveId],
  );

  if (view === null) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-700">Choose a drive from the drive cockpit to publish it.</p>
      </Card>
    );
  }

  return <DafPublish view={view} />;
}
