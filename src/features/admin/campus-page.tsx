import { ErrorPanel } from "@components/error-panel";
import { Badge, Button, Card, DataTable, PageHeader } from "@components/ui";
import { useAsyncAction } from "@lib/use-async-action";
import { type FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CampusProgrammes, type CampusProgrammesView } from "./campus-programmes";
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
export function CampusPage({
  repository,
  /**
   * F6: degrees and branches are no longer a page of their own. They are the
   * college's, for a passing year, and are maintained here. Optional so the
   * screen still renders where there is no backend to read them from.
   */
  programmes,
}: {
  repository: CampusRepository;
  programmes?: CampusProgrammesView;
}) {
  // Kept closed by default: a list of ten colleges, each with its programmes
  // expanded, is not a list of colleges any more.
  const [openProgrammes, setOpenProgrammes] = useState<string | null>(null);
  const [campuses, setCampuses] = useState<readonly CampusListItem[] | null>(null);
  const [values, setValues] = useState<Record<FieldName, string>>(EMPTY);
  const [missing, setMissing] = useState<readonly FieldName[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The LIST read failing — kept apart from `error`, which is about a save. */
  const [listProblem, setListProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  // Keyed per college: the list shows ten of them at once, and deactivating
  // one must not look like it is deactivating all of them.
  const actions = useAsyncAction();

  // Search & filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      setCampuses(await repository.list());
      setListProblem(null);
    } catch (cause) {
      // `void refresh()` had no catch: a refused read left `campuses` null and
      // the list said "Loading campuses…" for ever. An outage is not a spinner,
      // and it is not the same complaint as a save that failed.
      setListProblem(cause instanceof Error ? cause.message : "Could not load the campuses.");
    }
  }, [repository]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    void refresh();
  }, [refresh, attempt]);

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
      setShowAddForm(false);
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

  const filteredCampuses = useMemo(() => {
    if (campuses === null) return null;
    return campuses.filter((c) => {
      if (search.trim() !== "") {
        const q = search.toLowerCase();
        const match =
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.cityName.toLowerCase().includes(q) ||
          c.state.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (statusFilter === "active" && !c.isActive) return false;
      if (statusFilter === "inactive" && c.isActive) return false;
      return true;
    });
  }, [campuses, search, statusFilter]);

  return (
    <div>
      <PageHeader
        title="Campuses"
        subtitle="A campus must exist before its roster can be imported."
        actions={
          <Button
            variant={showAddForm ? "secondary" : "primary"}
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? "Close campus form" : "Add new campus"}
          </Button>
        }
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Add Campus Form Card (always available or toggleable) */}
      <Card className={`mb-6 p-6 ${showAddForm ? "block" : "hidden sm:block"}`}>
        <h2 className="mb-4 text-base font-semibold text-ink-900">Add new campus</h2>
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
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-hidden"
                />
                {missing.includes(field.name) && (
                  <p className="mt-1 text-xs text-destructive">{field.label} is required.</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Button type="submit" isLoading={saving}>
              Add campus
            </Button>
            {showAddForm && (
              <Button variant="secondary" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>

      {/* Directory Header and Search Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">
            Campuses directory {campuses !== null ? `(${campuses.length})` : ""}
          </h2>
          <p className="text-xs text-ink-500">
            Registered partner campuses, location details, and affiliated degree programmes
          </p>
        </div>

        {campuses !== null && campuses.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campuses by name, code, or city…"
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink-800 placeholder:text-ink-400 focus:border-brand-500 focus:outline-hidden min-w-[240px]"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink-800 focus:border-brand-500 focus:outline-hidden"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            {(search !== "" || statusFilter !== "") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        )}
      </div>

      {listProblem !== null ? (
        <ErrorPanel
          onRetry={() => {
            setListProblem(null);
            setAttempt((count) => count + 1);
          }}
          retryLabel="Load the campuses again"
        >
          {listProblem} Until they load, no campus can be added to or taken from.
        </ErrorPanel>
      ) : campuses === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading campuses…
        </p>
      ) : campuses.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-ink-700">No campuses yet. Add the first one above.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 border border-line bg-surface shadow-xs">
          <DataTable
            caption="Campuses directory"
            columns={["Campus", "Location", "Primary contact", "Status", "Actions"]}
          >
            {filteredCampuses !== null && filteredCampuses.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-ink-500">
                  No campuses match your search or filter.
                </td>
              </tr>
            ) : (
              filteredCampuses?.map((campus) => (
                <Fragment key={campus.id}>
                  <tr className="border-t border-line hover:bg-surface-muted/30 transition-colors">
                    {/* Campus Name and Code */}
                    <td className="px-4 py-3 align-top min-w-[200px]">
                      <div className="font-semibold text-ink-900">{campus.name}</div>
                      <div className="text-xs text-ink-500 mt-0.5 font-mono">
                        <span className="font-medium">{campus.code}</span>
                        {!campus.isActive && " · Inactive"}
                      </div>
                    </td>

                    {/* Location & Address */}
                    <td className="px-4 py-3 align-top min-w-[180px]">
                      <div className="text-sm text-ink-800 font-medium">
                        {campus.cityName}, {campus.state}
                      </div>
                      {campus.address && (
                        <div
                          className="text-xs text-ink-500 mt-0.5 line-clamp-1"
                          title={campus.address}
                        >
                          {campus.address}
                        </div>
                      )}
                    </td>

                    {/* Primary Contact Person */}
                    <td className="px-4 py-3 align-top min-w-[200px]">
                      {campus.primaryContactName ? (
                        <div>
                          <div className="text-sm font-medium text-ink-900">
                            {campus.primaryContactName}
                          </div>
                          <div className="text-xs text-ink-500 mt-0.5 font-mono">
                            {campus.primaryContactEmail}
                            {campus.primaryContactPhone ? ` · ${campus.primaryContactPhone}` : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-400">—</span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="px-4 py-3 align-top whitespace-nowrap min-w-[110px]">
                      {campus.isActive ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Inactive</Badge>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 align-top text-right min-w-[240px]">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {programmes !== undefined && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={openProgrammes === campus.id}
                            onClick={() =>
                              setOpenProgrammes(openProgrammes === campus.id ? null : campus.id)
                            }
                          >
                            {openProgrammes === campus.id
                              ? "Hide programmes"
                              : `Programmes at ${campus.name}`}
                          </Button>
                        )}
                        {campus.isActive && (
                          <Button
                            variant="secondary"
                            size="sm"
                            // Ten rows, ten identical "Deactivate" buttons.
                            aria-label={`Deactivate ${campus.name}`}
                            isLoading={actions.isPending(`deactivate:${campus.id}`)}
                            onClick={() =>
                              void actions.run(
                                () => deactivate(campus.id),
                                `deactivate:${campus.id}`,
                              )
                            }
                          >
                            Deactivate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded Programmes Sub-Panel */}
                  {programmes !== undefined && openProgrammes === campus.id && (
                    <tr key={`${campus.id}-programmes`} className="bg-surface-muted/30">
                      <td colSpan={5} className="p-4 border-t border-line">
                        <CampusProgrammes
                          campusId={campus.id}
                          campusName={campus.name}
                          view={programmes}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </DataTable>
        </Card>
      )}
    </div>
  );
}
