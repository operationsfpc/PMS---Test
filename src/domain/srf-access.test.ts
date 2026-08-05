import { describe, expect, it } from "vitest";
import { srfAccess } from "./srf-access";
import { SRF_STATUSES } from "./types";

/**
 * What a student may do with their own registration form, by status.
 *
 * Reworked 2026-08-05: "in his my registration form tab, it should say that
 * awaiting verification. at that time, no edit of forms should be possible. he
 * should just be able to see what he has submitted. if it is rejected, he
 * should be able to edit and resubmit. after approval, he should be able to
 * see the details he has entered. from there, there should be a place to go
 * and edit it, by clicking a link."
 *
 * Until now the form was editable at every status, which is not a cosmetic
 * problem: §7.2 requires eligibility to be evaluated against VERIFIED data, so
 * a student who edits after approval invalidates every shortlist their record
 * has already been judged for - silently, because nothing re-runs.
 */
describe("srfAccess", () => {
  it("lets a student fill in a form they have not sent yet", () => {
    for (const status of ["invited", "registered"] as const) {
      expect(srfAccess(status).mode).toBe("edit");
    }
  });

  describe("once submitted", () => {
    const access = srfAccess("srf_submitted");

    it("is read-only: it is being checked, and must not move underneath", () => {
      expect(access.mode).toBe("view");
    });

    it("says it is awaiting verification", () => {
      expect(access.headline).toMatch(/awaiting verification/i);
    });

    it("offers no way to edit, not even a request", () => {
      expect(access.canEdit).toBe(false);
    });
  });

  describe("when it comes back rejected", () => {
    const access = srfAccess("srf_rejected");

    /** A1: rejection is not terminal. Correcting it IS the next step. */
    it("is editable again, so the student can correct it and resubmit", () => {
      expect(access.mode).toBe("edit");
    });

    it("says what has happened rather than looking like a fresh form", () => {
      expect(access.headline).toMatch(/sent back|changes needed|rejected/i);
    });
  });

  describe("once approved", () => {
    const access = srfAccess("srf_approved");

    it("shows the student what was verified, rather than a form", () => {
      expect(access.mode).toBe("view");
    });

    it("says it is verified", () => {
      expect(access.headline).toMatch(/verified|approved/i);
    });

    /**
     * The asked-for link. It does NOT reopen the whole form: R10 keeps
     * verified academic data with the coordinator, so what a student may still
     * change themselves is their skills, projects and links.
     */
    it("offers a way through to the parts they may still change", () => {
      expect(access.canEdit).toBe(true);
    });

    it("does not offer to reopen verified academic data", () => {
      expect(access.editableFields).not.toContain("tenth_marks");
      expect(access.editableFields).not.toContain("verified_semester_data");
    });

    it("offers the profile fields that are theirs to keep current", () => {
      expect(access.editableFields).toContain("technical_skills");
      expect(access.editableFields).toContain("projects");
      expect(access.editableFields).toContain("resumes");
    });
  });

  it("answers for every status, so a new one cannot slip through unhandled", () => {
    for (const status of SRF_STATUSES) {
      const access = srfAccess(status);
      expect(["edit", "view"]).toContain(access.mode);
      expect(access.headline.length).toBeGreaterThan(0);
    }
  });

  /** A form being edited is never also a form the coordinator is checking. */
  it("never offers an edit link on a form that is already editable", () => {
    for (const status of SRF_STATUSES) {
      const access = srfAccess(status);
      if (access.mode === "edit") expect(access.canEdit).toBe(false);
    }
  });
});
