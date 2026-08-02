import { Button, Card, PageHeader } from "@components/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { CampusListItem, CampusRepository, NewCampus } from "./campus-repository";

// Order is the reading order of the form: identity, then place, then who to
// call. City sits beside State because one qualifies the other.
const FIELDS = [
  { name: "name", label: "Campus name", type: "text", wide: false },
  { name: "code", label: "Code", type: "text", wide: false },
  { name: "cityName", label: "City", type: "text", wide: false },
  { name: "state", label: "State", type: "text", wide: false },
  { name: "address", label: "Address", type: "text", wide: true },
  { name: "primaryContactName", label: "Primary contact name", type: "text", wide: false },
  { name: "primaryContactEmail", label: "Primary contact email", type: "email", wide: false },
  { name: "primaryContactPhone", label: "Primary contact phone", type: "tel", wide: false },
] as const;

type FieldName = (typeof FIELDS)[number]["name"];

const EMPTY: Record<FieldName, string> = {
  name: "",
  cityName: "",
  state: "",
  code: "",
  address: "",
  primaryContactName: "",
  primaryContactEmail: "",
  primaryContactPhone: "",
};

/**
 * Manage campuses.
 *
 * Every field is mandatory because the database says so - a campus with no
 * primary contact is a campus nobody can chase when a drive goes wrong. The
 * form validates before writing so the admin sees "required", not a raw
 * constraint name.
 */
export function CampusPage({ repository }: { repository: CampusRepository }) {
  const [campuses, setCampuses] = useState<readonly CampusListItem[] | null>(null);
  const [values, setValues] = useState<Record<FieldName, string>>(EMPTY);
  const [missing, setMissing] = useState<readonly FieldName[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setCampuses(await repository.list());
  }, [repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const blank = FIELDS.map((f) => f.name).filter((name) => values[name].trim() === "");
    setMissing(blank);
    if (blank.length > 0) return;

    setSaving(true);
    try {
      await repository.create(values as unknown as NewCampus);
      setValues(EMPTY);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the campus.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    setError(null);
    try {
      await repository.setActive(id, false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the campus.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Campuses"
        subtitle="A campus must exist before its roster can be imported."
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <Card className="mb-6 p-6">
        <form onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <div key={field.name} className={field.wide ? "sm:col-span-2" : undefined}>
                <label
                  htmlFor={`campus-${field.name}`}
                  className="mb-1 block text-sm font-medium text-ink-700"
                >
                  {field.label}
                </label>
                <input
                  id={`campus-${field.name}`}
                  type={field.type}
                  value={values[field.name]}
                  onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                />
                {missing.includes(field.name) && (
                  <p className="mt-1 text-xs text-destructive">{field.label} is required.</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-5">
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add campus"}
            </Button>
          </div>
        </form>
      </Card>

      {campuses === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading campuses…
        </p>
      ) : campuses.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">No campuses yet. Add the first one above.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-neutral-200">
          {campuses.map((campus) => (
            <div key={campus.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-medium text-ink-900">{campus.name}</p>
                <p className="text-sm text-ink-500">
                  {campus.code} · {campus.cityName}, {campus.state}
                  {campus.isActive ? "" : " · Inactive"}
                </p>
              </div>
              {campus.isActive && (
                <Button variant="secondary" size="sm" onClick={() => void deactivate(campus.id)}>
                  Deactivate
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
