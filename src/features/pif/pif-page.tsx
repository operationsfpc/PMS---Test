import { ErrorPanel } from "@components/error-panel";
import { Card } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { PifForm } from "./pif-form";
import {
  type CompanySuggestion,
  createSupabasePifRepository,
  type PifRepository,
} from "./pif-repository";
import type { MultiRolePifValues, PifFormValues } from "./pif-schema";

/**
 * The AE's screen for raising a drive: ONE form, one company visit, with every
 * role under it added by "+ Add another role".
 *
 * The form decides what it produced and this page only routes it — one role is
 * a plain drive row, two or more are the grouped values sent to the atomic
 * `save_company_drive_with_roles` RPC, so the visit and its roles commit or
 * fail together.
 *
 * A submitted PIF leaves the AE's hands entirely: the Delivery Head approves
 * or rejects it, and rejection is permanent (§3.1). The confirmation says so,
 * because an AE who expects to edit it later will be surprised.
 */

/** One role arrives flat; several arrive grouped, with a `roles` array on them. */
function isGrouped(values: PifFormValues | MultiRolePifValues): values is MultiRolePifValues {
  return Array.isArray((values as MultiRolePifValues).roles);
}

export function PifPage({ repository }: { repository?: PifRepository }) {
  const [searchParams] = useSearchParams();
  const companyNameParam = searchParams.get("companyName");
  const companyDriveIdParam = searchParams.get("companyDriveId");
  const companyIdParam = searchParams.get("companyId");
  const tentativeDateParam = searchParams.get("tentativeDate");

  const [repo] = useState<PifRepository>(
    () => repository ?? createSupabasePifRepository(supabase()),
  );
  const [outcome, setOutcome] = useState<"draft" | "submitted" | null>(null);
  /** How many roles went up as one visit; null means a single drive row. */
  const [outcomeRoles, setOutcomeRoles] = useState<number | null>(null);
  /**
   * B1 (UAT 2026-08-19): once saved, the draft's id travels with the session
   * so every further save — and the final submit — lands on the SAME row.
   * Without it, save-then-submit left an orphan draft on every drives list.
   */
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  /** The same rule for a multi-role visit, whose row is the EVENT, not a role. */
  const [eventDraftId, setEventDraftId] = useState<string | undefined>(undefined);
  /** The assessed-skills catalogue for the mandatory-skills picker (part A). */
  const [skillAreas, setSkillAreas] = useState<readonly string[]>([]);
  const [existingCompanies, setExistingCompanies] = useState<readonly CompanySuggestion[]>([]);

  /**
   * Both catalogues feed the form, and both used to be read with a bare
   * `.then()`. A rejected one left the picker empty, which reads as "the
   * college assesses no skills" or "no company has ever been on record" —
   * never as the failed read it is.
   */
  const [catalogueProblem, setCatalogueProblem] = useState<string | null>(null);

  const loadCatalogue = useCallback(async () => {
    const missing: string[] = [];
    try {
      setSkillAreas(await repo.skillAreas());
    } catch {
      missing.push("the assessed-skills catalogue");
    }
    if (repo.existingCompanies !== undefined) {
      try {
        setExistingCompanies(await repo.existingCompanies());
      } catch {
        missing.push("the companies already on record");
      }
    }
    setCatalogueProblem(
      missing.length === 0
        ? null
        : `We could not read ${missing.join(" and ")}. The form still works, but what those lists offer will be missing from it.`,
    );
  }, [repo]);

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  const initialValues = useMemo<Partial<MultiRolePifValues>>(() => {
    const init: Partial<MultiRolePifValues> = {};
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

  async function write(values: PifFormValues | MultiRolePifValues, intent: "draft" | "submitted") {
    if (isGrouped(values)) {
      // An event the AE picked in the drive selector outranks the visit this
      // session last saved: they have said, explicitly, where these go.
      const target = values.id ?? eventDraftId;
      const saved =
        intent === "draft"
          ? await repo.saveCompanyDriveDraft(values, target)
          : await repo.submitCompanyDrive(values, target);
      setEventDraftId(saved.eventId === "" ? undefined : saved.eventId);
      setOutcomeRoles((values.roles ?? []).length);
      setOutcome(intent);
      return;
    }
    const saved =
      intent === "draft"
        ? await repo.saveDraft(values, draftId)
        : await repo.submit(values, draftId);
    setDraftId(saved.id);
    setOutcomeRoles(null);
    setOutcome(intent);
  }

  const getCompanyEvents = repo.getCompanyEvents?.bind(repo);

  if (outcome === "submitted") {
    return (
      <Card className="p-6">
        <h1 className="font-heading text-xl font-bold text-brand-500">
          {outcomeRoles === null
            ? "PIF submitted for approval"
            : "Company drive submitted for approval"}
        </h1>
        <p className="mt-2 text-sm text-ink-700">
          {outcomeRoles === null ? (
            <>
              The Delivery Head will review it and set the offer category. A rejected PIF cannot be
              edited or resubmitted — a fresh one would be needed.
            </>
          ) : (
            <>
              {outcomeRoles} role{outcomeRoles === 1 ? "" : "s"} raised under one recruitment event.
              The Delivery Head will review them together and set the offer category for each. A
              rejected submission cannot be edited or resubmitted — a fresh one would be needed.
            </>
          )}
        </p>
      </Card>
    );
  }

  return (
    <>
      {outcome === "draft" && (
        <Card className="mb-4 border border-gold-500 bg-gold-50 p-4">
          <p role="status" className="text-sm text-ink-900">
            Draft saved. It has not gone to the Delivery Head yet.
          </p>
        </Card>
      )}
      {catalogueProblem !== null && (
        <div className="mb-4">
          <ErrorPanel onRetry={() => void loadCatalogue()}>{catalogueProblem}</ErrorPanel>
        </div>
      )}
      <PifForm
        onSubmit={(values) => write(values, "submitted")}
        onSaveDraft={(values) => write(values, "draft")}
        skillAreas={skillAreas}
        initialValues={initialValues}
        existingCompanies={existingCompanies}
        {...(getCompanyEvents ? { getCompanyEvents } : {})}
      />
    </>
  );
}
