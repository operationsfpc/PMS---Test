import { Card } from "@components/ui";
import { describeBoard, type SchoolBoard, type SchoolLevel } from "@domain/boards";
import { certificateStanding } from "@domain/certificates";
import type { SrfAccess } from "@domain/srf-access";
import { Link } from "react-router";
import { AddSemester, type AddSemesterView } from "./add-semester";
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

/**
 * The board in one line, or "Not recorded".
 *
 * Never blank: five students registered before boards were collected, and an
 * empty value reads as a claim about the student rather than a gap in the
 * record. The wording is the domain's.
 */
const board = (
  value: string | null | undefined,
  state: string | null | undefined,
  other: string | null | undefined,
  level: SchoolLevel,
): string =>
  describeBoard(
    value === null || value === undefined || value === ""
      ? null
      : { board: value as SchoolBoard, state: state ?? null, other: other ?? null },
    level,
  );

const shown = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  return value.trim() === "" ? "—" : value;
};

export function SrfSummary({
  profile,
  access,
  addSemester,
}: {
  profile: SrfProfile;
  access: SrfAccess;
  /** F13. Absent only where there is no backend to add against (tests). */
  addSemester?: AddSemesterView;
}) {
  const semesters = profile.semesters ?? [];
  const certificates = profile.certificates ?? [];

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
          {/* The board is shown back for the same reason it is collected: it is
              checked against the marksheet, and a figure the student cannot see
              is a figure they cannot correct. */}
          <Row
            label="10th board"
            value={board(
              profile.tenthBoard,
              profile.tenthBoardState,
              profile.tenthBoardOther,
              "tenth",
            )}
          />
          <Row label="10th percentage" value={shown(profile.tenthPercentage)} />
          <Row label="12th school" value={shown(profile.twelfthInstitution)} />
          <Row
            label="12th board"
            value={board(
              profile.twelfthBoard,
              profile.twelfthBoardState,
              profile.twelfthBoardOther,
              "twelfth",
            )}
          />
          <Row label="12th percentage" value={shown(profile.twelfthPercentage)} />
          {/* Only when there is a diploma at all: most students have none, and
              three dashes in a row is not information. */}
          {profile.diplomaMarks !== null && profile.diplomaMarks !== undefined && (
            <>
              <Row label="Diploma college" value={shown(profile.diplomaInstitution)} />
              <Row label="Diploma university / board" value={shown(profile.diplomaUniversity)} />
              <Row label="Diploma marks" value={shown(profile.diplomaMarks)} />
            </>
          )}
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

        {/*
         * F13: results arrive after registration, and the form is locked once
         * verified — for a good reason (§7.2 judges eligibility on verified
         * data). Adding the NEXT semester is the narrower permission: it lands
         * pending, and counts for nothing until a coordinator checks it.
         */}
        {addSemester !== undefined && (
          <div className="mt-5">
            <AddSemester
              srfStatus={profile.srfStatus ?? "registered"}
              programmeLevel={profile.programmeLevel ?? "ug"}
              declaredSemesters={semesters.map((s) => s.semesterNumber)}
              marksScale={profile.marksScale ?? "cgpa"}
              view={addSemester}
            />
          </div>
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
          <Row label="Achievements" value={shown(profile.achievements)} />
        </dl>

        {/*
         * F17: a certificate is a NAME and a DOCUMENT, so there is a LIST of
         * them rather than one line of free text. Reading the superseded
         * `certifications` column here would show a student who uploaded three
         * certificates a dash where they should be - nothing has written it
         * since 0035.
         */}
        <h4 className="mt-5 text-sm font-semibold text-ink-900">Certificates</h4>
        {certificates.length === 0 ? (
          <p className="mt-1 text-sm text-ink-500">No certificates uploaded.</p>
        ) : (
          <ul className="mt-1 divide-y divide-neutral-200">
            {certificates.map((certificate) => {
              const standing = certificateStanding(certificate.status, certificate.rejectionReason);
              return (
                <li key={certificate.name} className="py-2">
                  <p className="text-sm font-medium text-ink-900">{certificate.name}</p>
                  {/* A certificate is a claim until a coordinator has checked
                      it (0038), so the record says which have been. */}
                  <p
                    className={`text-xs ${
                      certificate.status === "verified"
                        ? "text-brand-600"
                        : certificate.status === "rejected"
                          ? "text-danger-700"
                          : "text-ink-500"
                    }`}
                  >
                    {standing.label}
                  </p>
                  {standing.reason !== null && (
                    <p className="text-xs text-ink-700">{standing.reason}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
