import { Card } from "@components/ui";
import type { SrfAccess } from "@domain/srf-access";
import { Link } from "react-router";
import type { SrfProfile } from "./srf-profile";

/**
 * The registration form, once it is no longer a form.
 *
 * A submitted record is EVIDENCE: a coordinator is comparing it, line by line,
 * against uploaded marksheets. Showing it as inputs invites a student to
 * change a figure while it is being checked, and after approval it is worse
 * than that - §7.2 judges eligibility on verified data, so an edit silently
 * invalidates every shortlist the record has already been measured for.
 *
 * So this renders the same information as text. Nothing here is focusable, and
 * there is no submit.
 */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 py-2">
      <dt className="text-sm text-ink-500">{label}</dt>
      <dd className="text-sm font-medium text-ink-900">{value}</dd>
    </div>
  );
}

const shown = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  return value.trim() === "" ? "—" : value;
};

export function SrfSummary({ profile, access }: { profile: SrfProfile; access: SrfAccess }) {
  const semesters = profile.semesters ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <h2 className="font-heading text-lg font-semibold text-ink-900">{access.headline}</h2>
        <p className="mt-1 text-sm text-ink-700">{access.detail}</p>

        {access.canEdit && (
          <p className="mt-4">
            {/*
             * Deliberately not "edit your form". R10 keeps verified academic
             * data with the coordinator; what this opens is the part that is
             * still the student's own, and saying so prevents the support
             * ticket that follows a link promising more than it gives.
             */}
            <Link
              to="/student/profile"
              className="text-sm font-semibold text-brand-600 underline underline-offset-4 hover:text-brand-700"
            >
              Update my skills, projects and links
            </Link>
          </p>
        )}
      </Card>

      <Card className="p-6">
        <h3 className="font-heading text-base font-semibold text-ink-900">Personal details</h3>
        <dl className="mt-2 divide-y divide-neutral-200">
          <Row label="Full name" value={shown(profile.fullName)} />
          <Row label="Roll number" value={shown(profile.rollNumber)} />
          <Row label="Email ID" value={shown(profile.email)} />
          <Row label="Mobile number" value={shown(profile.mobile)} />
          <Row label="WhatsApp number" value={shown(profile.whatsapp)} />
          <Row label="Alternate contact number" value={shown(profile.alternateContact)} />
        </dl>
      </Card>

      <Card className="p-6">
        <h3 className="font-heading text-base font-semibold text-ink-900">Academic record</h3>
        <dl className="mt-2 divide-y divide-neutral-200">
          <Row label="Degree" value={shown(profile.degree)} />
          <Row label="Branch" value={shown(profile.branch)} />
          <Row label="Year of passing" value={shown(profile.passingYear)} />
          <Row label="10th school" value={shown(profile.tenthInstitution)} />
          <Row label="10th percentage" value={shown(profile.tenthPercentage)} />
          <Row label="12th school" value={shown(profile.twelfthInstitution)} />
          <Row label="12th percentage" value={shown(profile.twelfthPercentage)} />
        </dl>

        {semesters.length > 0 && (
          <>
            <h4 className="mt-5 text-sm font-semibold text-ink-900">Semester-wise marks</h4>
            <dl className="mt-1 divide-y divide-neutral-200">
              {semesters.map((s) => (
                <Row
                  key={s.semesterNumber}
                  label={`Semester ${s.semesterNumber}`}
                  value={`${shown(s.marks)} · ${s.currentArrears} standing, ${s.historyOfArrears} history`}
                />
              ))}
            </dl>
          </>
        )}
      </Card>

      <Card className="p-6">
        <h3 className="font-heading text-base font-semibold text-ink-900">
          Skills and achievements
        </h3>
        <dl className="mt-2 divide-y divide-neutral-200">
          <Row label="Technical skills" value={shown(profile.technicalSkills)} />
          <Row label="Areas of interest" value={shown(profile.areasOfInterest)} />
          <Row label="Areas of expertise" value={shown(profile.areasOfExpertise)} />
          <Row label="Projects" value={shown(profile.projects)} />
          <Row label="Certifications" value={shown(profile.certifications)} />
          <Row label="Achievements" value={shown(profile.achievements)} />
        </dl>
      </Card>
    </div>
  );
}
