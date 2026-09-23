/**
 * `omnitron audit` — who changed this control plane, and what they changed.
 *
 * The table has existed since the first migration and nothing wrote to it,
 * so there was nothing to read and no command to read it with.
 */

import { log, table, prism } from '@xec-sh/kit';

import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IOmnitronAuditService } from '../shared/dto/services.js';
import { ACTOR_TYPES, MAX_AUDIT_PAGE, type AuditQuery, type AuditRow } from '../services/audit.service.js';
import { outcomeOf } from '../shared/audit-outcome.js';
import { emitError, emitJson } from './output.js';

export interface AuditListOptions {
  /**
   * As typed, and checked here. The CLI used to hand over `parseInt`'s
   * answer, which is NaN for `abc` — sent on to Postgres as `LIMIT NaN` — and
   * 0 for `0`, which the service's clamp turned into one row.
   */
  limit?: string | number;
  action?: string;
  resource?: string;
  /** A kind of actor — `user`, `service`, `system` — or an actor's id. */
  actor?: string;
  /** Only entries older than this ISO time. */
  before?: string;
}

/** What `-n` means when it is not given; the CLI's own default says the same. */
const DEFAULT_LIMIT = 50;

/** Input this command refuses before it asks the daemon anything. */
class AuditUsageError extends Error {}

/**
 * A page size as a person typed it, or a refusal that says what one is.
 *
 * Whole digits only: `parseInt` also read `5abc` as 5 and `1e3` as 1. Above
 * the page cap is refused rather than clamped — the service answers at most
 * `MAX_AUDIT_PAGE` rows, and handing back fewer than were asked without a
 * word is how `-n 0` came to mean one row.
 */
export function parseAuditLimit(raw: string | number | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const text = String(raw).trim();
  const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!(n >= 1 && n <= MAX_AUDIT_PAGE)) {
    throw new AuditUsageError(
      `-n takes a whole number of entries, 1 to ${MAX_AUDIT_PAGE} (the most one page holds; --before pages further) — not "${String(raw)}".`,
    );
  }
  return n;
}

/** A clock time anywhere in the text. */
const HAS_TIME = /\d{1,2}:\d{2}/;
/** A zone at the end: `Z`, `+02`, `+02:00`, `-0500`. */
const HAS_ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * `--before`, as the ISO instant the service takes.
 *
 * A time with no zone is refused rather than guessed: JavaScript reads
 * `2026-09-22T21:20:37` in the zone of whoever typed it, and the WHEN column
 * it was copied from is UTC — so the page would start hours away from the
 * row it was taken from, and look right. A bare date is UTC by the same rule,
 * and is taken.
 */
export function parseAuditBefore(raw: string): string {
  const text = raw.trim();
  if (HAS_TIME.test(text) && !HAS_ZONE.test(text)) {
    throw new AuditUsageError(`--before needs a zone — "${text}Z" if you mean UTC, which is what the WHEN column prints.`);
  }
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) {
    throw new AuditUsageError(`--before takes an ISO time such as 2026-09-22T21:20:37Z — not "${raw}".`);
  }
  return at.toISOString();
}

/**
 * The query the options ask for.
 *
 * `--actor` names a KIND of actor or an actor's id, and this is what tells
 * them apart. It was always an id, while the ACTOR column prints the kind for
 * every row that has none — so `--actor system`, typed from the column, was
 * compared with `actorId` on the 171 rows whose id is null, and found none.
 */
export function auditQueryFrom(options: AuditListOptions): AuditQuery & { limit: number } {
  const limit = parseAuditLimit(options.limit);
  const actor = options.actor?.trim();
  return {
    limit,
    ...(options.action ? { action: options.action } : {}),
    ...(options.resource ? { resourceType: options.resource } : {}),
    ...(actor
      ? (ACTOR_TYPES as readonly string[]).includes(actor)
        ? { actorType: actor }
        : { actorId: actor }
      : {}),
    ...(options.before ? { before: parseAuditBefore(options.before) } : {}),
  };
}

/**
 * A row's time as the table prints it: UTC to the second, and so the same
 * width on every row.
 *
 * It was «3m ago» for a recent row and `toLocaleString()` for an older one —
 * two formats in one column, the second in this machine's zone and as wide as
 * its locale made it. And kit sizes a column from its FIRST 100 rows, so with
 * `-n 200` the older rows' dates were cut to `9/22...` — measured on the
 * master: 42 cells in 39 of 178 rows, WHEN in 37 and ACTION (`node.bundle...`)
 * in 5.
 */
export function formatWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : `${at.toISOString().slice(0, 19)}Z`;
}

/** A `details` value the table prints, or `-`. */
function detail(row: AuditRow, key: string): string {
  const value = row.details?.[key];
  // `[object]` is what `scrubDetails` left of a nested value in older rows —
  // not a release id, and not to be printed as one.
  return typeof value === 'string' && value !== '' && value !== '[object]' ? value : '-';
}

interface Cell {
  /** What the width is measured on. */
  readonly text: string;
  /** What is printed: the same text, perhaps coloured. */
  readonly shown: string;
}

const plain = (text: string): Cell => ({ text, shown: text });

const COLUMNS = [
  { key: 'when', header: 'WHEN' },
  { key: 'action', header: 'ACTION' },
  { key: 'resource', header: 'RESOURCE' },
  { key: 'actor', header: 'ACTOR' },
  { key: 'source', header: 'SOURCE' },
  { key: 'release', header: 'RELEASE' },
  { key: 'outcome', header: 'OUTCOME' },
  { key: 'from', header: 'FROM' },
] as const;

type ColumnKey = (typeof COLUMNS)[number]['key'];

function cellsOf(row: AuditRow): Record<ColumnKey, Cell> {
  const outcome = outcomeOf(row);
  return {
    when: plain(formatWhen(row.createdAt)),
    action: plain(row.action),
    resource: plain(row.resourceId ? `${row.resourceType}:${row.resourceId}` : row.resourceType),
    // The id when there is one — `omnitron-local` for the CLI, an account for
    // the console — and otherwise the kind, which `--actor` also takes.
    actor: row.actorId ? plain(row.actorId) : { text: row.actorType, shown: prism.dim(row.actorType) },
    // `boot` and `auto-resume` are the daemon's own starts; `operator` is a
    // person's. Recorded since the service began writing the row, and never
    // printed until now.
    source: plain(detail(row, 'source')),
    release: plain(detail(row, 'release')),
    outcome:
      outcome === 'failed'
        ? { text: outcome, shown: prism.red(outcome) }
        : outcome === 'ok'
          ? { text: outcome, shown: prism.green(outcome) }
          : outcome === 'partial'
            ? { text: outcome, shown: prism.yellow(outcome) }
            : { text: '-', shown: prism.dim('-') },
    from: plain(row.ipAddress ?? '-'),
  };
}

/**
 * The table, with every column as wide as its widest cell in the WHOLE page.
 *
 * Left to itself, kit measures only the first 100 rows (`maxSampleSize` in
 * its `column-width.ts`) and truncates the rest to fit; a column width stated
 * here is used as given.
 */
function renderTable(rows: AuditRow[]): void {
  const cells = rows.map(cellsOf);
  const width = (key: ColumnKey, header: string): number =>
    Math.max(header.length, ...cells.map((c) => [...c[key].text].length));

  table({
    width: 'auto',
    data: cells.map((c) => Object.fromEntries(COLUMNS.map(({ key }) => [key, c[key].shown]))),
    columns: COLUMNS.map(({ key, header }) => ({ key, header, width: width(key, header) })),
  });
}

/** Why each failed row failed, under the table — a column would be as wide as the longest reason. */
function renderFailures(rows: AuditRow[]): void {
  const failed = rows.filter((r) => outcomeOf(r) === 'failed');
  if (failed.length === 0) return;
  log.warn(
    [
      `${failed.length} failed:`,
      ...failed.map((r) => {
        const why = detail(r, 'error') !== '-' ? detail(r, 'error') : detail(r, 'message');
        const what = r.resourceId ? `${r.resourceType}:${r.resourceId}` : r.resourceType;
        return `  ${formatWhen(r.createdAt)}  ${what}  ${why === '-' ? '(no reason recorded)' : why}`;
      }),
    ].join('\n'),
  );
}

export async function auditListCommand(options: AuditListOptions = {}): Promise<void> {
  // Before a connection is opened: a typo in a flag is answered here, in the
  // words of the flag, and not by the database.
  let query: AuditQuery & { limit: number };
  try {
    query = auditQueryFrom(options);
  } catch (err) {
    if (!(err instanceof AuditUsageError)) throw err;
    emitError(err.message);
    process.exitCode = 1;
    return;
  }

  const client = createDaemonClient();
  try {
    const svc = await client.service<IOmnitronAuditService>('OmnitronAudit');

    const { available } = await svc.available();
    if (!available) {
      // A daemon with no omnitron database records nothing, and an empty
      // list would read as "nothing has happened".
      if (emitJson({ available: false, entries: [] })) return;
      log.warn('This daemon has no audit trail — it has no omnitron database to record into.');
      return;
    }

    const rows = await svc.list(query);

    // `--json` was a global flag this command ignored, and the guard in
    // `output.ts` said so with exit 2. The rows as the service returned them,
    // plus the outcome the table prints, so a script filters on the same
    // answer a person reads.
    if (emitJson({ available: true, entries: rows.map((r) => ({ ...r, outcome: outcomeOf(r) })) })) return;

    if (rows.length === 0) {
      log.info('Nothing recorded yet for that query.');
      return;
    }

    renderTable(rows);
    renderFailures(rows);

    if (rows.length === query.limit) {
      // The exact instant, not the WHEN column's second: two rows can share a
      // second, and paging from the rounded one would skip the other.
      log.info(`${rows.length} shown, newest first — older ones: --before ${rows[rows.length - 1]!.createdAt}`);
    }
  } catch (err) {
    emitError(`Failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
