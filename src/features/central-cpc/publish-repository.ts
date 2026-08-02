import { canGoLive, type DriveReadiness } from "@domain/drive-lifecycle";
import type { DriveStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class PublishError extends Error {}

export interface PublishRepository {
  publish(driveId: string, current: DriveStatus, readiness: DriveReadiness): Promise<void>;
}

export type GetActorId = () => Promise<string | null>;

/**
 * Takes an approved drive live.
 *
 * Publishing is the moment students can see and apply to a drive, so it is the
 * last point at which an incomplete or held drive can be stopped cheaply.
 * `canGoLive` decides; this only reports and writes. Every missing field is
 * surfaced together, because the Central CPC completing a half-finished PIF
 * needs the whole list rather than one field per attempt.
 */
export function createSupabasePublishRepository(
  client: SupabaseClient,
  getActorId: GetActorId = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
): PublishRepository {
  return {
    async publish(driveId, current, readiness) {
      const verdict = canGoLive(current, readiness);
      if (!verdict.ok) {
        throw new PublishError(verdict.reasons.join(" "));
      }

      const actorId = await getActorId();
      if (actorId === null) {
        throw new PublishError("Your session has expired. Please sign in again.");
      }

      const { error } = await client
        .from("drives")
        .update({
          status: "live",
          published_by: actorId,
          published_at: new Date().toISOString(),
        })
        .eq("id", driveId)
        .select("id, status")
        .single();

      if (error !== null) {
        throw new PublishError("Could not publish the drive. Please try again.");
      }
    },
  };
}
