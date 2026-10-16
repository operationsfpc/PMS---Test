/**
 * Two ways a read goes wrong that this codebase used to be silent about.
 *
 * 1. PostgREST answers with an `error` and supabase-js still resolves, so a
 *    view that destructured `{ data }` alone carried on with `data === null`
 *    and rendered "No students yet" over a broken query. The CEO's dashboard
 *    said the organisation had placed nobody.
 * 2. Every select is capped at 1000 rows unless it asks for a slice. A 6,000
 *    student roster read as 1,000, and the funnel, the placement rate and every
 *    campus row were computed on whichever thousand arrived first.
 *
 * `readAll` pages past the cap and throws on a failed read, so the screen can
 * say "this did not load" instead of showing a confident wrong number.
 */
export class PostgrestReadError extends Error {}

/** What one page of a select returns: rows, or the reason it has none. */
interface ReadPage<T> {
  readonly data: readonly T[] | null;
  readonly error: { readonly message: string } | null;
}

/** PostgREST's own default, and the cap supabase-js will not raise for you. */
const PAGE_SIZE = 1000;

/**
 * How many ids go into one `in=(...)` list. Each id is a UUID in the URL, so
 * 200 of them plus the select string stays comfortably inside what the edge
 * gateway accepts — and a URL it refuses comes back as an empty list, not an
 * error you can read.
 */
const ID_BATCH = 200;

/**
 * Read every row a select can answer, a page at a time.
 *
 * `select` is given the range to ask for, because a builder cannot be reused
 * after `.range()`: `client.from("students").select(COLS)` has to be rebuilt
 * for each page.
 */
export async function readAll<T>(
  select: (from: number, to: number) => PromiseLike<ReadPage<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const gathered: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await select(from, from + pageSize - 1);
    if (error !== null) throw new PostgrestReadError(error.message);

    const page = (data ?? []) as readonly T[];
    gathered.push(...page);
    // A short page is the last one. PostgREST gives no total, so this is how
    // the end is known.
    if (page.length < pageSize) return gathered;
  }
}

export function chunk<T>(items: readonly T[], size: number = ID_BATCH): readonly T[][] {
  if (items.length === 0) return [];
  const batches: T[][] = [];
  for (let at = 0; at < items.length; at += size) {
    batches.push(items.slice(at, at + size));
  }
  return batches;
}

/**
 * Read rows for a long list of ids — offers for every student on a 6,000
 * roster, applications for each of them — batching the `in` filter so the
 * request stays addressable, and paging each batch so nothing is dropped.
 *
 * `build` takes the batch and returns the range-applying function, because the
 * `.in()` is fixed for the batch while `.range()` is not.
 */
export async function readAllByIds<T>(
  ids: readonly string[],
  build: (batch: readonly string[]) => (from: number, to: number) => PromiseLike<ReadPage<T>>,
  batchSize: number = ID_BATCH,
): Promise<T[]> {
  const gathered: T[] = [];
  for (const batch of chunk(ids, batchSize)) {
    gathered.push(...(await readAll(build(batch))));
  }
  return gathered;
}

/**
 * A read failure the reader can act on.
 *
 * The view layers above throw with the sentence already written for the user
 * (`AeOverviewError`, "Could not read the placement figures."); a rejection
 * with nothing to say is the one case a screen has to phrase itself. Every
 * overview page asks the same question, so they share the answer.
 */
export const describeReadFailure = (cause: unknown, fallback: string): string =>
  cause instanceof Error && cause.message !== "" ? cause.message : fallback;

/**
 * A select that answers with rows this file knows nothing about.
 *
 * The feature views read PostgREST results as `Array<Record<string, unknown>>`
 * and narrow at the point of use — that is how they already work, and the
 * embedded relations (`degrees(name)`) are typed by supabase-js as whatever its
 * parser felt like that day. These two shapes the query for that convention so
 * no view has to cast a page, and none can forget to.
 */
interface LoosePage {
  readonly data: readonly unknown[] | null;
  readonly error: { readonly message: string } | null;
}

export async function readAllRows(
  select: (from: number, to: number) => PromiseLike<LoosePage>,
): Promise<Array<Record<string, unknown>>> {
  return (await readAll(select)) as Array<Record<string, unknown>>;
}

export async function readAllRowsByIds(
  ids: readonly string[],
  build: (batch: readonly string[]) => (from: number, to: number) => PromiseLike<LoosePage>,
): Promise<Array<Record<string, unknown>>> {
  return (await readAllByIds(ids, build)) as Array<Record<string, unknown>>;
}
