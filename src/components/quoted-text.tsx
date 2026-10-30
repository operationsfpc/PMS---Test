import { Button } from "@components/ui";
import { useState } from "react";
import { DrilldownModal } from "./drilldown-modal";

/**
 * Past this many characters the row shows a clamp instead of the whole text.
 * Long enough for a real explanation; short enough that one pasted block
 * cannot take the queue.
 */
const PREVIEW_CHARACTERS = 240;

/**
 * Someone's own words — an opt-out reason, in full — kept to a readable size.
 *
 * These arrive from a free-text box, so one can run for thousands of
 * characters or be a single unbroken string. Printed whole it buries every row
 * after it; cut with an ellipsis it hides the words a decision rests on. The
 * preview stays in the row and the popup holds every character, so nothing is
 * dropped and nothing overflows.
 */
export function QuotedText({
  text,
  title,
  subject,
  triggerLabel = "Read the full reason",
}: {
  text: string;
  /** The popup's heading, e.g. "Opt-out reason". */
  title: string;
  /** Whose words these are, so a screen showing several names what opens. */
  subject?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const isLong = text.length > PREVIEW_CHARACTERS;
  const quoted = `“${text}”`;

  return (
    <div className="min-w-0">
      <p
        className={`mt-1 whitespace-pre-wrap break-words text-sm text-ink-700 [overflow-wrap:anywhere] ${
          isLong ? "line-clamp-3" : ""
        }`}
      >
        {quoted}
      </p>
      {isLong && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1"
          aria-label={subject === undefined ? triggerLabel : `${triggerLabel} — ${subject}`}
          onClick={() => setOpen(true)}
        >
          {triggerLabel}
        </Button>
      )}
      {open && (
        <DrilldownModal eyebrow="In full" title={title} onClose={() => setOpen(false)}>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-900 [overflow-wrap:anywhere]">
            {quoted}
          </p>
        </DrilldownModal>
      )}
    </div>
  );
}
