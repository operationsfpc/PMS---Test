import { TextField } from "@components/form";
import { Button, Card, PageHeader } from "@components/ui";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import type { StudentProfileRepository, StudentProfileValues } from "./profile-repository";

/**
 * The parts of a verified record that are still the student's own.
 *
 * Reached from the registration form once it has been approved: the record
 * itself is read-only there, because §7.2 has already judged eligibility
 * against it, but skills and links go stale and are nobody else's to keep
 * current. R10 draws that line and this screen sits entirely on one side of
 * it - there is no marks field here, and there never should be.
 */

const EMPTY: StudentProfileValues = {
  technicalSkills: "",
  areasOfInterest: "",
  areasOfExpertise: "",
  projects: "",
  certifications: "",
  achievements: "",
  linkedin: "",
  github: "",
  leetcode: "",
  hackerrank: "",
};

export function ProfileEditPage({ repository }: { repository: StudentProfileRepository }) {
  const [values, setValues] = useState<StudentProfileValues>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void repository.load().then((current) => {
      if (current !== null) setValues(current);
      setLoaded(true);
    });
  }, [repository]);

  // TextField is a plain <input>, so this takes the event rather than a value.
  const set = (field: keyof StudentProfileValues) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setState("idle");
    setProblem(null);
    try {
      await repository.save(values);
      setState("saved");
    } catch (cause) {
      setState("failed");
      setProblem(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally {
      setSaving(false);
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
        title="My skills and links"
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

      <form onSubmit={submit}>
        <Card className="flex flex-col gap-4 p-6">
          <TextField
            label="Technical skills"
            value={values.technicalSkills}
            onChange={set("technicalSkills")}
          />
          <TextField
            label="Areas of interest"
            value={values.areasOfInterest}
            onChange={set("areasOfInterest")}
          />
          <TextField
            label="Areas of expertise"
            value={values.areasOfExpertise}
            onChange={set("areasOfExpertise")}
          />
          <TextField label="Projects" value={values.projects} onChange={set("projects")} />
          <TextField
            label="Certifications"
            value={values.certifications}
            onChange={set("certifications")}
          />
          <TextField
            label="Achievements"
            value={values.achievements}
            onChange={set("achievements")}
          />
          <TextField label="LinkedIn" value={values.linkedin} onChange={set("linkedin")} />
          <TextField label="GitHub" value={values.github} onChange={set("github")} />
          <TextField label="LeetCode" value={values.leetcode} onChange={set("leetcode")} />
          <TextField label="HackerRank" value={values.hackerrank} onChange={set("hackerrank")} />
        </Card>

        {state === "saved" && <p className="mt-3 text-sm text-ink-700">Saved.</p>}
        {state === "failed" && problem !== null && (
          <p className="mt-3 text-sm text-destructive">{problem}</p>
        )}

        <div className="mt-5">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}
