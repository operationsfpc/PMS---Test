import { Card } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { PifForm } from "./pif-form";
import { PifMultiForm } from "./pif-multi-form";
import {
  type CompanySuggestion,
  createSupabasePifRepository,
  type PifRepository,
} from "./pif-repository";
import type { MultiRolePifValues, PifFormValues } from "./pif-schema";

type Mode = "single" | "multi";

const MODES: readonly { value: Mode; label: string }[] = [
  { value: "single", label: "One role" },
  { value: "multi", label: "Multiple roles under one event" },
];

/**
 * The AE's screen for raising a drive. One page, two modes: a single-role PIF,
 * or a whole recruitment event with several roles committed together through
 * the atomic `save_company_drive_with_roles` RPC.
 *
 * A submitted PIF leaves the AE's hands entirely: the Delivery Head approves
 * or rejects it, and rejection is permanent (§3.1). The confirmation says so,
 * because an AE who expects to edit it later will be surprised.
 */
export function PifPage({ repository }: { repository?: PifRepository }) {
  const [searchParams] = useSearchParams();
  const companyNameParam = searchParams.get("companyName");
  const companyDriveIdParam = searchParams.get("companyDriveId");
  const companyIdParam = searchParams.get("companyId");
  const tentativeDateParam = searchParams.get("tentativeDate");

  const [repo] = useState<PifRepository>(
    () => repository ?? createSupabasePifRepository(supabase()),
  );
  const [mode, setMode] = useState<Mode>(() =>
    searchParams.get("mode") === "multi" ? "multi" : "single",
  );
  const [outcome, setOutcome] = useState<"draft" | "submitted" | null>(null);
  const [outcomeMode, setOutcomeMode] = useState<Mode>("single");
  const [roleCount, setRoleCount] = useState(0);
  /**
   * B1 (UAT 2026-08-19): once saved, the draft's id travels with the session
   * so every further save — and the final submit — lands on the SAME row.
   * Without it, save-then-submit left an orphan draft on every drives list.
   */
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  /** The assessed-skills catalogue for the mandatory-skills picker (part A). */
  const [skillAreas, setSkillAreas] = useState<readonly string[]>([]);
  const [existingCompanies, setExistingCompanies] = useState<readonly CompanySuggestion[]>([]);

  useEffect(() => {
    void repo.skillAreas().then(setSkillAreas);
    if (repo.existingCompanies) {
      void repo.existingCompanies().then(setExistingCompanies);
    }
  }, [repo]);

  const initialValues = useMemo<Partial<PifFormValues>>(() => {
    const init: Partial<PifFormValues> = {};
    if (companyNameParam && companyNameParam.trim() !== "") {
      init.companyName = companyNameParam.trim();
    }
    if (companyDriveIdParam && companyDriveIdParam.trim() !== "") {
      init.companyDriveId = companyDriveIdParam.trim();
    }
    if (companyIdParam && companyIdParam.trim() !== "") {
      init.companyId = companyIdParam.trim();
    }
    if (tentativeDateParam && tentativeDateParam.trim() !== "") {
      init.tentativeDate = tentativeDateParam.trim();
    }
    return init;
  }, [companyNameParam, companyDriveIdParam, companyIdParam, tentativeDateParam]);

  function switchMode(next: Mode) {
    if (next === mode) return;
    // The banner belongs to whichever form produced it — switching forms
    // must not show the other form's stale status.
    setOutcome(null);
    setMode(next);
  }

  async function submitSingle(values: PifFormValues) {
    await repo.submit(values, draftId);
    setOutcomeMode("single");
    setOutcome("submitted");
  }

  async function saveDraftSingle(values: PifFormValues) {
    const saved = await repo.saveDraft(values, draftId);
    setDraftId(saved.id);
    setOutcomeMode("single");
    setOutcome("draft");
  }

  async function submitMulti(values: MultiRolePifValues) {
    await repo.submitCompanyDrive(values);
    setRoleCount((values.roles ?? []).length);
    setOutcomeMode("multi");
    setOutcome("submitted");
  }

  async function saveDraftMulti(values: MultiRolePifValues) {
    await repo.saveCompanyDriveDraft(values);
    setRoleCount((values.roles ?? []).length);
    setOutcomeMode("multi");
    setOutcome("draft");
  }

  if (outcome === "submitted") {
    return (
      <Card className="p-6">
        <h1 className="font-[Raleway] text-xl font-bold text-[#3D3777]">
          {outcomeMode === "multi"
            ? "Company drive submitted for approval"
            : "PIF submitted for approval"}
        </h1>
        <p className="mt-2 text-sm text-ink-700">
          {outcomeMode === "multi" ? (
            <>
              {roleCount} role{roleCount === 1 ? "" : "s"} raised under one recruitment event. The
              Delivery Head will review them together and set the offer category for each. A
              rejected submission cannot be edited or resubmitted — a fresh one would be needed.
            </>
          ) : (
            <>
              The Delivery Head will review it and set the offer category. A rejected PIF cannot be
              edited or resubmitted — a fresh one would be needed.
            </>
          )}
        </p>
      </Card>
    );
  }

  const getCompanyEvents = repo.getCompanyEvents?.bind(repo);

  return (
    <>
      <fieldset aria-label="What this PIF covers" className="mb-4 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            onClick={() => switchMode(m.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              mode === m.value
                ? "bg-[#3D3777] text-white shadow-sm"
                : "border border-line bg-surface text-ink-700 hover:border-brand-300"
            }`}
          >
            {m.label}
          </button>
        ))}
      </fieldset>
      {outcome === "draft" && (
        <Card className="mb-4 border border-[#FFB800] bg-[#FFF9E8] p-4">
          <p role="status" className="text-sm text-ink-900">
            Draft saved. It has not gone to the Delivery Head yet.
          </p>
        </Card>
      )}
      {mode === "multi" ? (
        <PifMultiForm
          onSubmit={submitMulti}
          onSaveDraft={saveDraftMulti}
          skillAreas={skillAreas}
          existingCompanies={existingCompanies}
        />
      ) : (
        <PifForm
          onSubmit={submitSingle}
          onSaveDraft={saveDraftSingle}
          skillAreas={skillAreas}
          initialValues={initialValues}
          existingCompanies={existingCompanies}
          {...(getCompanyEvents ? { getCompanyEvents } : {})}
        />
      )}
    </>
  );
}
