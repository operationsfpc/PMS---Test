import { Card } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { PifMultiForm } from "./pif-multi-form";
import {
  type CompanySuggestion,
  createSupabasePifRepository,
  type PifRepository,
} from "./pif-repository";
import type { MultiRolePifValues } from "./pif-schema";

/**
 * The AE's screen for raising a whole recruitment event at once — the event
 * and every role under it, committed together through the atomic
 * `save_company_drive_with_roles` RPC.
 *
 * Like the single-role PIF, a submission leaves the AE's hands entirely: the
 * Delivery Head approves or rejects it, and rejection is permanent (§3.1).
 */
export function PifMultiPage({ repository }: { repository?: PifRepository }) {
  const [repo] = useState<PifRepository>(
    () => repository ?? createSupabasePifRepository(supabase()),
  );
  const [outcome, setOutcome] = useState<"draft" | "submitted" | null>(null);
  const [roleCount, setRoleCount] = useState(0);
  /** The assessed-skills catalogue for the mandatory-skills pickers. */
  const [skillAreas, setSkillAreas] = useState<readonly string[]>([]);
  const [existingCompanies, setExistingCompanies] = useState<readonly CompanySuggestion[]>([]);

  useEffect(() => {
    void repo.skillAreas().then(setSkillAreas);
    if (repo.existingCompanies) {
      void repo.existingCompanies().then(setExistingCompanies);
    }
  }, [repo]);

  async function submit(values: MultiRolePifValues) {
    await repo.submitCompanyDrive(values);
    setRoleCount((values.roles ?? []).length);
    setOutcome("submitted");
  }

  async function saveDraft(values: MultiRolePifValues) {
    await repo.saveCompanyDriveDraft(values);
    setRoleCount((values.roles ?? []).length);
    setOutcome("draft");
  }

  if (outcome === "submitted") {
    return (
      <Card className="p-6">
        <h1 className="font-[Raleway] text-xl font-bold text-[#3D3777]">
          Company drive submitted for approval
        </h1>
        <p className="mt-2 text-sm text-ink-700">
          {roleCount} role{roleCount === 1 ? "" : "s"} raised under one recruitment event. The
          Delivery Head will review them together and set the offer category for each. A rejected
          submission cannot be edited or resubmitted — a fresh one would be needed.
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
      <PifMultiForm
        onSubmit={submit}
        onSaveDraft={saveDraft}
        skillAreas={skillAreas}
        existingCompanies={existingCompanies}
      />
    </>
  );
}
