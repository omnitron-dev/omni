/**
 * What went wrong, in words, when the error itself has none.
 *
 * The commonest failure a daemon meets — the database is unreachable —
 * arrives as an `AggregateError`, because Node resolves a host to several
 * addresses and fails on each. That error's own `message` is the EMPTY
 * STRING; the reasons live in `.errors`, and `${err.message}` prints nothing
 * at all.
 *
 * Measured: `sync.service` logged «Failed to ingest sync entry» 76 659 times
 * in one hour with `error: ""` in every record, while the cause — OrbStack
 * down, so the master's own Postgres never came up — was named in three lines
 * of the file next to it.
 *
 * This lived as a private function in `commands/doctor.ts`, which meant the
 * one place that most needed it did not have it. A sibling with the same job
 * and a deeper walk (`cause`, error codes, recursion) lives in
 * `@omnitron-dev/titan-database`'s `utils/describe-error.ts`; if these two
 * ever need to agree on more than they do now, that is the one to keep.
 */
export function describeError(err: unknown): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  const e = err as { message?: string; errors?: Array<{ message?: string; code?: string }>; code?: string };

  // An AggregateError's own `message` is empty — the reason hides in
  // `errors[]`. Identical reasons (one per resolved address) collapse.
  if (Array.isArray(e.errors) && e.errors.length > 0) {
    const reasons = e.errors.map((x) => x.message || x.code).filter(Boolean) as string[];
    const inner = [...new Set(reasons)].join('; ');
    if (inner) return e.code ? `${inner} (${e.code})` : inner;
  }
  if (e.message) return e.code ? `${e.message} (${e.code})` : e.message;
  return e.code ?? 'unknown error';
}
