import { Card } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { PifForm } from "./pif-form";
import { createSupabasePifRepository, type PifRepository } from "./pif-repository";
import type { PifFormValues } from "./pif-schema";

/**
 * The AE's screen for raising a drive.
 *
 * A submitted PIF leaves the AE's hands entirely: the Delivery Head approves
 * or rejects it, and rejection is permanent (§3.1). The confirmation says so,
 * because an AE who expects to edit it later will be surprised.
 */
export function PifPage({ repository }: { repository?: PifRepository }) {
  const [repo] = useState<PifRepository>(
    () => repository ?? createSupabasePifRepository(supabase()),
  );
  const [outcome, setOutcome] = useState<"draft" | "submitted" | null>(null);
  /**
   * B1 (UAT 2026-08-19): once saved, the draft's id travels with the session
   * so every further save — and the final submit — lands on the SAME row.
   * Without it, save-then-submit left an orphan draft on every drives list.
   */
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  /** The assessed-skills catalogue for the mandatory-skills picker (part A). */
  const [skillAreas, setSkillAreas] = useState<readonly string[]>([]);

  useEffect(() => {
    void repo.skillAreas().then(setSkillAreas);
  }, [repo]);

  async function submit(values: PifFormValues) {
    await repo.submit(values, draftId);
    setOutcome("submitted");
  }

  async function saveDraft(values: PifFormValues) {
    const saved = await repo.saveDraft(values, draftId);
    setDraftId(saved.id);
    setOutcome("draft");
  }

  if (outcome === "submitted") {
    return (
      <Card className="p-6">
        <h1 className="font-[Raleway] text-xl font-bold text-[#3D3777]">
          PIF submitted for approval
        </h1>
        <p className="mt-2 text-sm text-ink-700">
          The Delivery Head will review it and set the offer category. A rejected PIF cannot be
          edited or resubmitted — a fresh one would be needed.
        </p>
      </Card>
    );
  }

  return (
    <>
      {outcome === "draft" && (
        <Card className="mb-4 border border-[#FFB800] bg-[#FFF9E8] p-4">
          <p role="status" className="text-sm text-ink-900">
            Draft saved. It has not gone to the Delivery Head yet.
          </p>
        </Card>
      )}
      <PifForm onSubmit={submit} onSaveDraft={saveDraft} skillAreas={skillAreas} />
    </>
  );
}
