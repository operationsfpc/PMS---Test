import { type BodySegment, linkifyBody } from "@domain/notifications";

/**
 * Spec C (2026-08-21, approved 2026-08-24): one renderer for notification
 * bodies, shared by the notifications page and the dashboard panel — a URL
 * must never be a link on one screen and dead text on the other.
 */
export function NotificationBody({ body }: { body: string }) {
  return (
    <>
      {linkifyBody(body).map((segment: BodySegment, index) =>
        segment.kind === "link" ? (
          <a
            // Position is identity here: segments are a pure split of one string.
            // biome-ignore lint/suspicious/noArrayIndexKey: stable pure split
            key={index}
            href={segment.text}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#3D3777] underline underline-offset-2"
          >
            {segment.text}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable pure split
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
