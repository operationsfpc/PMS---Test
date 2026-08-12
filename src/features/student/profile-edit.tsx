import { FormSection, TextField } from "@components/form";
import { Button, PageHeader } from "@components/ui";
import {
  canRemoveCertificate,
  canUploadCertificate,
  certificateStanding,
  validateCertificates,
} from "@domain/certificates";
import {
  MAX_OTHER_PROFILES,
  normaliseProfileLinks,
  type ProfileLink,
  validateProfileLinks,
} from "@domain/profile-links";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type {
  StudentCertificate,
  StudentCertificatesRepository,
  StudentProfileRepository,
  StudentProfileValues,
} from "./profile-repository";

/**
 * The parts of a verified record that are still the student's own.
 *
 * Reached from the registration form once it has been approved: the record
 * itself is read-only there, because §7.2 has already judged eligibility
 * against it, but skills, certificates and links go stale and are nobody
 * else's to keep current. R10 draws that line and this screen sits entirely on
 * one side of it - there is no marks field here, and there never should be.
 *
 * Rebuilt 2026-08-06 against two things the student said:
 *
 * "skills and achievements editing page, want it to have similar look and feel
 * to the original student registration form. already submitted details should
 * be fetched and shown and they should be able to edit it." It was one flat
 * card of ten identical boxes, and the two profile groups the SRF collects -
 * other profiles, and certificates - were not on it at all.
 *
 * "i am not able to add certifications." The box named "Certifications" wrote
 * free text to a column `submit_srf` stopped writing in 0035, because a claim
 * in free text can be neither verified nor de-duplicated (F9/F17). What
 * replaced it is a name and a document, and it lives below.
 */

const EMPTY: StudentProfileValues = {
  technicalSkills: "",
  areasOfInterest: "",
  areasOfExpertise: "",
  projects: "",
  achievements: "",
  linkedin: "",
  github: "",
  leetcode: "",
  hackerrank: "",
  otherProfiles: [],
};

const LINKS = [
  { field: "linkedin", label: "LinkedIn" },
  { field: "github", label: "GitHub" },
  { field: "leetcode", label: "LeetCode" },
  { field: "hackerrank", label: "HackerRank" },
] as const;

/**
 * A profile row with an identity of its own.
 *
 * NOT keyed by array index. Removing the second profile would otherwise carry
 * its input state onto the third - the same trap `useFieldArray` exists to
 * avoid on the registration form.
 */
interface ProfileRow extends ProfileLink {
  readonly key: string;
}

/**
 * Monotonic for the life of the tab. A key only has to be unique within its
 * own list, and a counter that never rewinds cannot hand a new row the key of
 * one just removed.
 */
let rowCount = 0;
function nextKey(): string {
  rowCount += 1;
  return `profile-${rowCount}`;
}

function Problems({ problems }: { problems: readonly string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul role="alert" className="mt-3 flex flex-col gap-1">
      {problems.map((problem) => (
        <li key={problem} className="text-xs font-medium text-danger-700">
          {problem}
        </li>
      ))}
    </ul>
  );
}

export function ProfileEditPage({
  repository,
  certificates,
}: {
  repository: StudentProfileRepository;
  certificates: StudentCertificatesRepository;
}) {
  const [values, setValues] = useState<StudentProfileValues>(EMPTY);
  const [profiles, setProfiles] = useState<readonly ProfileRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [profileProblems, setProfileProblems] = useState<readonly string[]>([]);

  /** What is already on file, and the row being added to it. */
  const [onFile, setOnFile] = useState<readonly StudentCertificate[]>([]);
  const [certificateName, setCertificateName] = useState("");
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [certificateProblems, setCertificateProblems] = useState<readonly string[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    void repository.load().then((current) => {
      if (current !== null) {
        setValues(current);
        setProfiles(current.otherProfiles.map((link) => ({ ...link, key: nextKey() })));
      }
      setLoaded(true);
    });
  }, [repository]);

  const refresh = useCallback(async () => {
    setOnFile(await certificates.list());
  }, [certificates]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // TextField is a plain <input>, so this takes the event rather than a value.
  const set = (field: keyof StudentProfileValues) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  const setProfile = (index: number, change: Partial<ProfileLink>) =>
    setProfiles((current) => current.map((p, i) => (i === index ? { ...p, ...change } : p)));

  async function submit(event: FormEvent) {
    event.preventDefault();

    // Both halves or neither, capped, no two called the same thing. The rule
    // is the domain's - this screen only reports it.
    const found = validateProfileLinks(profiles);
    setProfileProblems(found);
    if (found.length > 0) return;

    setSaving(true);
    setState("idle");
    setProblem(null);
    try {
      await repository.save({ ...values, otherProfiles: normaliseProfileLinks(profiles) });
      setState("saved");
    } catch (cause) {
      setState("failed");
      setProblem(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * One certificate, one upload (F9).
   *
   * Checked here so the student is told before a file is sent, and enforced by
   * `one_certificate_per_name` (0034) so no screen can forget it.
   */
  async function addCertificate() {
    const decision = canUploadCertificate(
      certificateName,
      onFile.map((c) => c.name),
    );

    const found = [
      ...(decision.allowed ? [] : [decision.reason]),
      ...validateCertificates([{ name: certificateName, hasFile: certificateFile !== null }]),
    ];

    setCertificateProblems(found);
    if (found.length > 0 || certificateFile === null) return;

    setUploading(true);
    try {
      await certificates.add(certificateName.trim(), certificateFile);
      setCertificateName("");
      setCertificateFile(null);
      await refresh();
    } catch (cause) {
      // Deliberately keeps what the student typed: making them retype the
      // name is how a second, slightly different copy gets created.
      setCertificateProblems([
        cause instanceof Error ? cause.message : "Could not upload your certificate.",
      ]);
    } finally {
      setUploading(false);
    }
  }

  async function removeCertificate(id: string) {
    try {
      await certificates.remove(id);
      await refresh();
    } catch (cause) {
      setCertificateProblems([
        cause instanceof Error ? cause.message : "Could not remove this certificate.",
      ]);
    }
  }

  if (!loaded) {
    return (
      <p role="status" className="text-sm text-ink-500">
        Loading your profile…
      </p>
    );
  }

  return (
    <div>
      <PageHeader
        title="My skills, certificates and links"
        subtitle="Your verified academic record is not editable here — ask your Campus Placement Coordinator if anything in it is wrong."
      />

      <p className="mb-4">
        <Link
          to="/srf"
          className="text-sm font-semibold text-brand-600 underline underline-offset-4"
        >
          Back to my registration form
        </Link>
      </p>

      <form onSubmit={submit} className="flex flex-col gap-6">
        <FormSection
          id="additional"
          title="Skills and achievements"
          step={1}
          description="Be specific — this feeds shortlisting."
        >
          <div className="flex flex-col gap-4">
            <TextField
              label="Technical skills"
              placeholder="React, Python, SQL…"
              value={values.technicalSkills}
              onChange={set("technicalSkills")}
            />
            <TextField
              label="Areas of interest"
              placeholder="Backend engineering, data…"
              value={values.areasOfInterest}
              onChange={set("areasOfInterest")}
            />
            <TextField
              label="Areas of expertise"
              placeholder="Where you are genuinely strong"
              value={values.areasOfExpertise}
              onChange={set("areasOfExpertise")}
            />
            <TextField
              label="Projects"
              placeholder="Title, stack, and what you built"
              value={values.projects}
              onChange={set("projects")}
            />
            <TextField
              label="Achievements"
              value={values.achievements}
              onChange={set("achievements")}
            />
          </div>
        </FormSection>

        <FormSection
          id="certificates"
          title="Certificates"
          step={2}
          description="A name and the document behind it. Each one is uploaded once."
        >
          {onFile.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {onFile.map((certificate) => (
                <li
                  key={certificate.id}
                  // Names the row for a screen reader, so "Remove" below it is
                  // never an unattributed button in a list of identical ones.
                  aria-label={certificate.name}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink-900">
                      {certificate.name}
                    </span>
                    {/* A certificate is a claim until a coordinator has
                        checked it, so the student is told which of theirs
                        have been - and what to fix on one that was not. */}
                    <span
                      className={`block text-xs ${
                        certificate.status === "verified"
                          ? "text-brand-600"
                          : certificate.status === "rejected"
                            ? "text-danger-700"
                            : "text-ink-500"
                      }`}
                    >
                      {certificateStanding(certificate.status, certificate.rejectionReason).label}
                    </span>
                    {certificateStanding(certificate.status, certificate.rejectionReason).reason !==
                      null && (
                      <span className="block text-xs text-ink-700">
                        {
                          certificateStanding(certificate.status, certificate.rejectionReason)
                            .reason
                        }
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    {certificate.url !== null && (
                      <a
                        href={certificate.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View ${certificate.name}`}
                        className="text-sm font-semibold text-brand-600 underline underline-offset-4"
                      >
                        View
                      </a>
                    )}
                    {/* Q4: verified data is no longer the student's to
                        change, and removing it would destroy the
                        coordinator's record of having checked it. Enforced
                        by RLS in 0038; hidden here so it is not offered. */}
                    {canRemoveCertificate(certificate.status).allowed && (
                      <button
                        type="button"
                        aria-label={`Remove ${certificate.name}`}
                        onClick={() => void removeCertificate(certificate.id)}
                        className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-danger-700 hover:bg-danger-50"
                      >
                        Remove
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-500">
              No certificates yet. Add the ones a recruiter would want to see.
            </p>
          )}

          <div className="mt-4 grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1.5fr]">
            <TextField
              label="Certificate name"
              placeholder="e.g. AWS Cloud Practitioner"
              value={certificateName}
              onChange={(e) => setCertificateName(e.target.value)}
            />
            <div>
              <label
                htmlFor="new-certificate-file"
                className="mb-1.5 block text-sm font-medium text-ink-700"
              >
                Upload certificate
              </label>
              <input
                id="new-certificate-file"
                type="file"
                // The same list the SRF accepts: a certificate is as likely to
                // be photographed as scanned.
                accept="application/pdf,image/*"
                onChange={(e) => setCertificateFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm"
              />
            </div>
          </div>

          <Problems problems={certificateProblems} />

          <div className="mt-3">
            {/* type="button": this is its own action, not part of the save. */}
            <Button type="button" disabled={uploading} onClick={() => void addCertificate()}>
              {uploading ? "Uploading…" : "Add certificate"}
            </Button>
          </div>
        </FormSection>

        <FormSection id="profiles" title="Professional profiles" step={3}>
          <div className="flex flex-col gap-4">
            {LINKS.map(({ field, label }) => (
              <TextField key={field} label={label} value={values[field]} onChange={set(field)} />
            ))}
          </div>

          <div className="mt-6">
            <p className="mb-1 text-sm font-medium text-ink-700">Other profiles</p>
            <p className="mb-3 text-xs text-ink-500">
              Anything else worth showing a recruiter — Kaggle, Codeforces, Behance, your own site.
              Give it a name, then paste the link or your username.
            </p>

            {profiles.length > 0 && (
              <div className="flex flex-col gap-3">
                {profiles.map((profile, index) => (
                  <div
                    key={profile.key}
                    className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1.5fr_auto]"
                  >
                    <TextField
                      label={`Profile ${index + 1} name`}
                      placeholder="e.g. Kaggle"
                      value={profile.label}
                      onChange={(e) => setProfile(index, { label: e.target.value })}
                    />
                    <TextField
                      label={`Profile ${index + 1} link or username`}
                      placeholder="kaggle.com/asha — or just asha_r"
                      value={profile.value}
                      onChange={(e) => setProfile(index, { value: e.target.value })}
                    />
                    <button
                      type="button"
                      aria-label={`Remove profile ${index + 1}`}
                      onClick={() =>
                        setProfiles((current) => current.filter((_, i) => i !== index))
                      }
                      className="self-end rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-danger-700 hover:bg-danger-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Problems problems={profileProblems} />

            {profiles.length < MAX_OTHER_PROFILES && (
              <button
                type="button"
                onClick={() =>
                  setProfiles((current) => [...current, { label: "", value: "", key: nextKey() }])
                }
                className="mt-3 rounded-lg border border-dashed border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-500 transition-colors hover:bg-brand-50"
              >
                Add another profile
              </button>
            )}
          </div>
        </FormSection>

        {state === "saved" && <p className="text-sm text-ink-700">Saved.</p>}
        {state === "failed" && problem !== null && (
          <p className="text-sm text-destructive">{problem}</p>
        )}

        <div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}
