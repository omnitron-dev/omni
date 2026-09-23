/**
 * omnitron logs [app] [-n N] [-f] [--file] [--level LEVEL] [--grep PATTERN]
 *
 * With no app (or `omnitron`): the daemon's own log, `~/.omnitron/logs/omnitron.log`.
 * With an app this daemon runs: its latest records from the daemon, or — when
 * those hold fewer than N matches — its log file, the one the daemon names.
 * With an app another machine runs: the rows its node synced to this master.
 *
 * `-n` counts MATCHES. A file is read backwards until N records pass the
 * filters (or 128 MB have been searched), and the command says which file it
 * read and when that file was last written.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log, prism } from '@xec-sh/kit';
import { createDaemonClient, type DaemonClient } from '../daemon/daemon-client.js';
import { OMNITRON_HOME } from '../config/defaults.js';
import type { AppDiagnosticsDto, LogEntryDto } from '../config/types.js';
import type { IStackInfo } from '../shared/dto/project.js';
import { NODE_STACK } from '../project/node-app-config.js';
import { BackwardAssembler, LineAssembler, LEVEL_RANK, levelRank, type KnownLevel, type LogRecord } from '../monitoring/log-line.js';
import { emitJson, emitError, isJsonMode } from './output.js';
import { describeAbsence } from './daemon-required.js';

const LOG_DIR = path.join(OMNITRON_HOME, 'logs');
const PROJECTS_DIR = path.join(OMNITRON_HOME, 'projects');

/** The daemon's own name among log sources — `LogManager.getLogDir` reserves it. */
const DAEMON_LOG_NAME = 'omnitron';

/** How far back a file is searched for N matches before the command says it stopped. */
const FILE_SEARCH_LIMIT = 128 * 1024 * 1024;
const FILE_CHUNK = 256 * 1024;

/** The daemon keeps up to 1000 records per app; a filtered read asks for all of them. */
const CAPTURED_WINDOW = 1000;
/** Stored rows fetched when filtering them — a window, said so when it falls short. */
const STORED_WINDOW = 5000;
const FOLLOW_WINDOW = 200;
const FOLLOW_INTERVAL_MS = 1000;

export interface LogsOptions {
  lines?: number;
  follow?: boolean;
  file?: boolean;
  /** Minimum log level to display (e.g. 'warn' shows warn + error + fatal) */
  level?: string;
  /** Grep pattern — only show entries whose message matches */
  grep?: string;
}

/** What the options ask for, once they have been checked. */
interface Wanted {
  lines: number;
  /** Pino rank of `--level`, or null for no level filter. */
  minLevel: number | null;
  pattern: RegExp | null;
}

type Match = (entry: LogEntryDto) => boolean;

/** Where the printed records came from — said on screen and in `--json`. */
interface Source {
  source: 'daemon' | 'file' | 'stored';
  file?: string;
  modified?: string;
  nodes?: Array<{ id: string | null; name: string }>;
  note?: string;
}

export async function logsCommand(appName?: string, options: LogsOptions = {}): Promise<void> {
  const checked = readOptions(options);
  if (!checked.ok) {
    refuse(checked.error, appName);
    return;
  }
  const wanted = checked.wanted;
  const match = matcher(wanted);

  // In JSON mode, --follow is unsupported (no streaming JSON contract);
  // fail fast with a structured error.
  if (options.follow && isJsonMode()) {
    emitError('logs --follow is not supported in --json mode (use file-tail or jq instead)');
    return;
  }

  // The daemon's own log. The help has always promised this for a bare
  // `omnitron logs`; it printed the apps' buffers instead — 193 paysys and 7
  // storage records out of 200, not one daemon line.
  if (!appName || appName === DAEMON_LOG_NAME) {
    const file = path.join(LOG_DIR, wanted.minLevel !== null && wanted.minLevel >= LEVEL_RANK.error ? 'omnitron.error.log' : 'omnitron.log');
    await showFile(DAEMON_LOG_NAME, file, wanted, match, options.follow ?? false);
    return;
  }

  const client = createDaemonClient();
  const absence = await client.whyUnreachable();
  if (absence) {
    await client.disconnect();
    // The fallback is right whatever the reason, but the reason still belongs
    // on screen: reading the files is a different answer from reading the
    // daemon, and an operator who thinks the daemon is down when it is merely
    // busy will not know why the tail stops where it does.
    if (!isJsonMode()) log.info(`${describeAbsence(absence)} — reading from log files`);
    await showDerivedFile(appName, wanted, match, options.follow ?? false);
    return;
  }

  try {
    const diag = await inspectApp(client, appName);

    if (diag) {
      // An app this daemon runs. Its file is the one the daemon names — never
      // a path guessed from the name: `~/.omnitron/logs/main/app.log` exists
      // on this host, last written weeks ago, and `logs main -l error` printed
      // its May errors as the answer while the live `error.log` held 27 089.
      const logFile = wanted.minLevel !== null && wanted.minLevel >= LEVEL_RANK.error ? diag.logPaths.error : diag.logPaths.app;
      if (options.file) {
        await client.disconnect();
        await showFile(diag.name, logFile, wanted, match, options.follow ?? false);
        return;
      }

      const window = wanted.minLevel !== null || wanted.pattern ? CAPTURED_WINDOW : wanted.lines;
      const captured = await client.getLogs({ name: diag.name, lines: window });
      const hits = captured.filter(match);

      if (hits.length >= wanted.lines) {
        report(diag.name, { source: 'daemon' }, hits.slice(-wanted.lines), new Map());
      } else {
        // The daemon's records are the live end of the file, not the record.
        // Fewer matches there than asked for — a restart emptied them, or the
        // filter is narrow — is exactly when the file has the answer.
        readAndReport(diag.name, logFile, wanted, match);
      }

      if (options.follow) {
        await follow(() => client.getLogs({ name: diag.name, lines: FOLLOW_WINDOW }), captured, match, new Map(), client);
      }
      await client.disconnect();
      return;
    }

    // Not an app the daemon runs now: what is stored about it, which for an
    // app on a node is what that node synced here.
    const window = wanted.minLevel !== null || wanted.pattern ? STORED_WINDOW : wanted.lines;
    let stored = await client.getLogs({ name: appName, lines: window });
    let note: string | undefined;
    let fetch = () => client.getLogs({ name: appName, lines: FOLLOW_WINDOW });

    if (!stored.some((e) => typeof e.data?.['sourceNode'] === 'string')) {
      // Only this machine's own records, or none: an app that ran here left
      // its file, and the file is the record.
      const derived = derivedLogFile(appName, wanted.minLevel !== null && wanted.minLevel >= LEVEL_RANK.error ? 'error' : 'app');
      if (derived) {
        await client.disconnect();
        await showDerivedFile(appName, wanted, match, options.follow ?? false);
        return;
      }
    }

    if (stored.length === 0) {
      const mapped = await mapStackName(client, appName);
      if (mapped) {
        const ofStack = (entries: LogEntryDto[]) => entries.filter((e) => mapped.nodeIds.has(String(e.data?.['sourceNode'])));
        stored = ofStack(await client.getLogs({ name: mapped.reportedAs, lines: window }));
        note = `${appName} runs on its stack's node as ${mapped.reportedAs}`;
        fetch = async () => ofStack(await client.getLogs({ name: mapped.reportedAs, lines: FOLLOW_WINDOW }));
      }
    }

    if (stored.length > 0) {
      const names = await nodeNames(client);
      const hits = stored.filter(match);
      const nodes = [...new Set(stored.map((e) => (e.data?.['sourceNode'] as string | null | undefined) ?? null))].map((id) => ({
        id,
        name: id === null ? 'this machine' : (names.get(id) ?? id),
      }));
      const shortfall = hits.length < wanted.lines && stored.length >= window ? `searched the last ${stored.length} stored records` : undefined;
      report(appName, { source: 'stored', nodes, ...(note || shortfall ? { note: [note, shortfall].filter(Boolean).join('; ') } : {}) }, hits.slice(-wanted.lines), names);
      if (options.follow) await follow(fetch, stored, match, names, client);
      await client.disconnect();
      return;
    }

    await client.disconnect();
    if (emitJson({ app: appName, source: 'stored', count: 0, entries: [] })) return;
    log.info(
      `No log entries found for "${appName}" — the daemon does not run it, holds no records for it, and it left no log file`,
    );
  } catch (err) {
    await client.disconnect();
    emitError((err as Error).message, { app: appName });
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const LEVEL_NAMES = Object.keys(LEVEL_RANK) as KnownLevel[];

/**
 * Check the options before anything is read.
 *
 * `--grep '('` used to escape as a raw `SyntaxError` stack (the pattern was
 * compiled outside every `try`), and `--level bogus` silently disabled the
 * level filter — a query that asks for nothing recognisable answered as if
 * it had asked for everything. Both are refused now, with what IS accepted.
 */
function readOptions(options: LogsOptions): { ok: true; wanted: Wanted } | { ok: false; error: string } {
  const lines = options.lines ?? 50;
  if (!Number.isInteger(lines) || lines < 1) {
    return { ok: false, error: `-n must be a whole number of records, 1 or more (got ${String(options.lines)})` };
  }

  let minLevel: number | null = null;
  if (options.level !== undefined) {
    const rank = levelRank(options.level.trim().toLowerCase());
    if (rank === undefined) {
      return { ok: false, error: `Unknown level '${options.level}' — use one of ${LEVEL_NAMES.join(', ')}` };
    }
    minLevel = rank;
  }

  let pattern: RegExp | null = null;
  if (options.grep !== undefined) {
    try {
      pattern = new RegExp(options.grep, 'i');
    } catch (err) {
      return { ok: false, error: `Invalid --grep pattern '${options.grep}': ${(err as Error).message}` };
    }
  }

  return { ok: true, wanted: { lines, minLevel, pattern } };
}

/**
 * The filter a record must pass.
 *
 * A level filter keeps records at or above it. A record whose level could not
 * be read (`unknown`) has no place in that order, so it is shown only when no
 * `--level` is given — it is not `info`, which is what it used to be called.
 */
function matcher(wanted: Wanted): Match {
  return (entry) => {
    if (wanted.minLevel !== null) {
      const rank = levelRank(entry.level);
      if (rank === undefined || rank < wanted.minLevel) return false;
    }
    return !wanted.pattern || wanted.pattern.test(entry.message);
  };
}

function refuse(message: string, appName?: string): void {
  emitError(message, appName ? { app: appName } : undefined);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Where an app's records are
// ---------------------------------------------------------------------------

/** The daemon's diagnostics for a name it runs, or null for one it does not. */
async function inspectApp(client: DaemonClient, appName: string): Promise<AppDiagnosticsDto | null> {
  try {
    return await client.inspect({ name: appName });
  } catch {
    return null;
  }
}

interface NodesReader {
  listNodes(): Promise<Array<{ id: string; name: string; host: string }>>;
}

interface StackReader {
  getStack(data: { project: string; stack: string }): Promise<IStackInfo>;
}

/** Node id → the name the operator gave it. Empty when the daemon keeps no node list. */
async function nodeNames(client: DaemonClient): Promise<Map<string, string>> {
  try {
    const nodes = await (await client.service<NodesReader>('OmnitronNodes')).listNodes();
    return new Map(nodes.map((n) => [n.id, n.name]));
  } catch {
    return new Map();
  }
}

/**
 * A stack's name for an app on a remote stack → the name its node reports.
 *
 * A node runs what it is given under its own stack, `<project>/deployed/<app>`,
 * and its synced rows carry that name — so `daos/test/main` has no rows under
 * its own name. The stack's config says which hosts are its nodes (and which
 * apps each runs); the node list says which node ids those hosts are. Rows are
 * then taken from those nodes only: another remote stack of the same project
 * reports the same `<project>/deployed/<app>` from ITS nodes, and answering a
 * question about one deployment with another's lines is the failure
 * `resolveAppName` refuses for the same reason.
 */
async function mapStackName(client: DaemonClient, name: string): Promise<{ reportedAs: string; nodeIds: Set<string> } | null> {
  const parts = name.split('/');
  if (parts.length < 3) return null;
  const [project, stack, ...rest] = parts as [string, string, ...string[]];
  const app = rest.join('/');
  if (stack === NODE_STACK) return null;

  try {
    const info = await (await client.service<StackReader>('OmnitronProject')).getStack({ project, stack });
    if (!info || info.type === 'local') return null;
    const hosts = new Set((info.config?.nodes ?? []).filter((n) => !n.apps || n.apps.includes(app)).map((n) => n.host));
    if (hosts.size === 0) return null;
    const nodes = await (await client.service<NodesReader>('OmnitronNodes')).listNodes();
    const nodeIds = new Set(nodes.filter((n) => hosts.has(n.host)).map((n) => n.id));
    return nodeIds.size > 0 ? { reportedAs: `${project}/${NODE_STACK}/${app}`, nodeIds } : null;
  } catch {
    return null;
  }
}

/**
 * The file an app writes, derived from its name, for when the daemon cannot
 * be asked (or does not run the app now).
 *
 * Derived the way `LogManager.getLogDir` writes: a qualified name under its
 * project and stack; a bare name under the one project stack that has it, and
 * only failing that under the standalone directory. The legacy flat `<app>.log`
 * and the daemon's own log are never an app's answer — both used to be probed,
 * and `logs main` read `~/.omnitron/logs/main/app.log` (last written Sep 7)
 * while `main` was writing under `projects/daos/dev/`.
 */
export function derivedLogFile(
  appName: string,
  kind: 'app' | 'error',
  roots: { projects: string; logs: string } = { projects: PROJECTS_DIR, logs: LOG_DIR },
): { file: string } | { ambiguous: string[] } | null {
  const fileName = kind === 'error' ? 'error.log' : 'app.log';
  const parts = appName.split('/');
  if (parts.length >= 3) {
    const [project, stack, ...rest] = parts as [string, string, ...string[]];
    const dir = path.join(roots.projects, project, stack, 'logs', rest.join('/'));
    return fs.existsSync(path.join(dir, 'app.log')) ? { file: path.join(dir, fileName) } : null;
  }

  const found: string[] = [];
  for (const project of listDirs(roots.projects)) {
    for (const stack of listDirs(path.join(roots.projects, project))) {
      const dir = path.join(roots.projects, project, stack, 'logs', appName);
      if (fs.existsSync(path.join(dir, 'app.log'))) found.push(dir);
    }
  }
  if (found.length === 1) return { file: path.join(found[0]!, fileName) };
  if (found.length > 1) return { ambiguous: found };

  const standalone = path.join(roots.logs, appName);
  return fs.existsSync(path.join(standalone, 'app.log')) ? { file: path.join(standalone, fileName) } : null;
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

async function showDerivedFile(appName: string, wanted: Wanted, match: Match, following: boolean): Promise<void> {
  const kind = wanted.minLevel !== null && wanted.minLevel >= LEVEL_RANK.error ? 'error' : 'app';
  const derived = derivedLogFile(appName, kind);
  if (!derived) {
    if (emitJson({ app: appName, source: 'file', count: 0, entries: [] })) return;
    log.info(`No log file found for app "${appName}" — nothing under ${PROJECTS_DIR}/<project>/<stack>/logs/${appName} or ${LOG_DIR}/${appName}`);
    return;
  }
  if ('ambiguous' in derived) {
    refuse(`App name '${appName}' is ambiguous — logs exist under ${derived.ambiguous.join(', ')}. Use the full <project>/<stack>/<app> name.`, appName);
    return;
  }
  await showFile(appName, derived.file, wanted, match, following);
}

// ---------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------

interface FileRead {
  entries: LogEntryDto[];
  scannedBytes: number;
  whole: boolean;
  size: number;
  modified: Date;
}

function toEntry(app: string, record: LogRecord): LogEntryDto {
  const data = record.data ?? (record.source ? { source: record.source } : undefined);
  const child = record.data?.['childProcess'];
  return {
    timestamp: record.time,
    app: typeof child === 'string' ? child : app,
    level: record.level,
    message: record.message || record.raw || '',
    ...(data ? { data } : {}),
  };
}

/**
 * The last `want` records of a file that pass `match`, oldest first.
 *
 * Read backwards in chunks until that many are found or `limit` bytes have
 * been searched. This read a fixed `lines × 3` raw lines and filtered after:
 * with the default 50 that is 150 lines — a minute and a half of the daemon's
 * log at 100 lines a minute — so `logs omnitron --level error --grep "Failed
 * to run task"` found nothing while the line sat 6 504 lines back.
 */
function readMatches(file: string, app: string, want: number, match: Match, limit = FILE_SEARCH_LIMIT): FileRead {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const found: LogEntryDto[] = [];
    let done = false;
    const assembler = new BackwardAssembler(stat.mtimeMs, (record) => {
      if (done) return;
      const entry = toEntry(app, record);
      if (match(entry)) {
        found.push(entry);
        if (found.length >= want) done = true;
      }
    });

    let pos = stat.size;
    let carry: Buffer = Buffer.alloc(0);
    let scanned = 0;
    while (pos > 0 && !done && scanned < limit) {
      const len = Math.min(FILE_CHUNK, pos);
      pos -= len;
      const chunk = Buffer.alloc(len);
      fs.readSync(fd, chunk, 0, len, pos);
      scanned += len;

      const buf = carry.length > 0 ? Buffer.concat([chunk, carry]) : chunk;
      let start = 0;
      if (pos > 0) {
        // The first line of this chunk may begin in the chunk before it.
        const nl = buf.indexOf(0x0a);
        if (nl === -1) {
          carry = buf;
          continue;
        }
        carry = buf.subarray(0, nl);
        start = nl + 1;
      } else {
        carry = Buffer.alloc(0);
      }

      const lines = buf.subarray(start).toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0 && !done; i--) {
        const line = lines[i]!;
        if (line === '' && i === lines.length - 1) continue;
        assembler.pushEarlier(line);
      }
    }
    // Indented lines at the very start of the file belong to a record that
    // began before it (a rotation). Past the search limit, their header is
    // simply further back, and they are left alone.
    if (!done && pos === 0) assembler.finish();

    return { entries: found.reverse(), scannedBytes: scanned, whole: pos === 0, size: stat.size, modified: stat.mtime };
  } finally {
    fs.closeSync(fd);
  }
}

function describeRead(file: string, read: FileRead, want: number): Source {
  const note =
    read.entries.length >= want
      ? undefined
      : read.whole
        ? `${read.entries.length} matching in the whole file`
        : `${read.entries.length} matching in the last ${Math.round(read.scannedBytes / (1024 * 1024))} MB of ${Math.round(read.size / (1024 * 1024))} MB`;
  return { source: 'file', file, modified: read.modified.toISOString(), ...(note ? { note } : {}) };
}

/** Read a file for N matches and print them, saying which file and how fresh it is. */
function readAndReport(app: string, file: string, wanted: Wanted, match: Match): FileRead | null {
  if (!fs.existsSync(file)) {
    if (emitJson({ app, source: 'file', file, count: 0, entries: [] })) return null;
    log.info(`No log entries found — ${file} does not exist`);
    return null;
  }
  const read = readMatches(file, app, wanted.lines, match);
  report(app, describeRead(file, read, wanted.lines), read.entries, new Map());
  return read;
}

async function showFile(app: string, file: string, wanted: Wanted, match: Match, following: boolean): Promise<void> {
  const read = readAndReport(app, file, wanted, match);
  if (following) await followFile(app, file, match, read?.size ?? 0);
}

// ---------------------------------------------------------------------------
// Following
// ---------------------------------------------------------------------------

/** What identifies a record across two reads of the same window. */
function fingerprint(e: LogEntryDto): string {
  return `${e.timestamp}\u0000${e.app}\u0000${e.level}\u0000${e.message}`;
}

/**
 * The records of `current` that `previous` had not shown.
 *
 * Both are windows onto one append-only sequence, so `previous`'s tail
 * reappears in `current` and everything after it is new. `-f` used to keep
 * the records with a timestamp above the last one printed — which printed the
 * same old lines every second while they were dated at the read, and still
 * drops a record that arrives after one with a later stamp from another
 * process of the same app (`main`'s file: .528 followed by .516).
 */
function unseen(previous: LogEntryDto[], current: LogEntryDto[]): LogEntryDto[] {
  const tail = previous.slice(-8).map(fingerprint);
  if (tail.length === 0) return current;
  const keys = current.map(fingerprint);
  for (let p = 0; p < keys.length; p++) {
    let aligned = true;
    for (let i = 0; i < tail.length; i++) {
      const at = p - (tail.length - 1 - i);
      if (at < 0) continue;
      if (keys[at] !== tail[i]) {
        aligned = false;
        break;
      }
    }
    if (aligned) return current.slice(p + 1);
  }
  return current;
}

async function follow(
  fetch: () => Promise<LogEntryDto[]>,
  seen: LogEntryDto[],
  match: Match,
  names: Map<string, string>,
  client: DaemonClient,
): Promise<void> {
  let previous = seen;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    try {
      const current = await fetch();
      const fresh = unseen(previous, current).filter(match);
      previous = current;
      if (fresh.length > 0) printEntries(fresh, names);
    } catch {
      // Connection lost — keep asking.
    }
    timer = setTimeout(() => void tick(), FOLLOW_INTERVAL_MS);
  };
  timer = setTimeout(() => void tick(), FOLLOW_INTERVAL_MS);

  process.on('SIGINT', () => {
    if (timer) clearTimeout(timer);
    void client.disconnect();
    process.exit(0);
  });
  await new Promise(() => {});
}

/** Print what is appended to a file, from `from` on — a rotated file starts over. */
async function followFile(app: string, file: string, match: Match, from: number): Promise<void> {
  let pos = from;
  let carry: Buffer = Buffer.alloc(0);
  const assembler = new LineAssembler((_key, record) => {
    const entry = toEntry(app, record);
    if (match(entry)) printEntries([entry], new Map());
  });

  let timer: NodeJS.Timeout | null = null;
  const tick = () => {
    try {
      const size = fs.statSync(file).size;
      if (size < pos) {
        pos = 0;
        carry = Buffer.alloc(0);
      }
      if (size > pos) {
        const fd = fs.openSync(file, 'r');
        try {
          while (pos < size) {
            const len = Math.min(FILE_CHUNK * 4, size - pos);
            const chunk = Buffer.alloc(len);
            fs.readSync(fd, chunk, 0, len, pos);
            pos += len;
            const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
            const nl = buf.lastIndexOf(0x0a);
            if (nl === -1) {
              carry = buf;
              continue;
            }
            carry = buf.subarray(nl + 1);
            for (const line of buf.subarray(0, nl).toString('utf8').split('\n')) assembler.push(file, line);
          }
        } finally {
          fs.closeSync(fd);
        }
        assembler.sealAll();
      }
    } catch {
      // Mid-rotation the file can be briefly absent.
    }
    timer = setTimeout(tick, FOLLOW_INTERVAL_MS);
  };
  timer = setTimeout(tick, FOLLOW_INTERVAL_MS);

  process.on('SIGINT', () => {
    if (timer) clearTimeout(timer);
    process.exit(0);
  });
  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** One answer: its source said once, then its records. */
function report(app: string, source: Source, entries: LogEntryDto[], names: Map<string, string>): void {
  if (emitJson({ app, ...source, count: entries.length, entries })) return;

  if (source.source === 'file') {
    log.info(`${source.file} — last written ${source.modified}${source.note ? ` (${source.note})` : ''}`);
  } else if (source.source === 'stored') {
    const from = (source.nodes ?? []).map((n) => (n.id === null ? n.name : `node ${n.name}${n.name === n.id ? '' : ` (${n.id.slice(0, 8)})`}`));
    log.info(`Records for ${app} from ${from.join(', ')}${source.note ? ` — ${source.note}` : ''}`);
  }

  if (entries.length === 0) {
    log.info('No log entries found');
    return;
  }
  printEntries(entries, names);
}

const utcDay = (ts: number): string => (Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '');

/**
 * Print records, with the date when it is not today.
 *
 * Times printed as a bare `16:29:11` — so records from 2026-05-28 in an
 * abandoned file read as this afternoon's. A batch that is not all from
 * today (UTC, as the times are) prints the date on every line.
 */
function printEntries(entries: LogEntryDto[], names: Map<string, string>): void {
  const today = utcDay(Date.now());
  const dated = entries.some((e) => utcDay(e.timestamp) !== today);
  for (const entry of entries) printLogEntry(entry, dated, names);
}

function printLogEntry(entry: LogEntryDto, dated: boolean, names: Map<string, string>): void {
  const iso = Number.isFinite(entry.timestamp) ? new Date(entry.timestamp).toISOString() : '????-??-??T??:??:??.???Z';
  const time = dated ? `${iso.slice(0, 10)} ${iso.slice(11, 23)}` : iso.slice(11, 23);
  const level = formatLevel(entry.level);
  const node = entry.data?.['sourceNode'];
  const where = typeof node === 'string' ? `${entry.app}@${names.get(node) ?? node.slice(0, 8)}` : entry.app;
  const app = prism.cyan(`[${where}]`);

  // Show relevant data fields inline for richer context
  let extra = '';
  if (entry.data) {
    const d = entry.data;
    const fields: string[] = [];
    if (d['module']) fields.push(`module=${d['module']}`);
    if (d['serviceName']) fields.push(`service=${d['serviceName']}`);
    const err = d['err'] as Record<string, unknown> | undefined;
    if (err?.['message']) fields.push(`err=${err['message']}`);
    if (d['error'] && typeof d['error'] === 'string') fields.push(`err=${d['error']}`);
    if (fields.length > 0) extra = ` ${prism.dim(fields.join(' '))}`;
  }

  console.log(`${prism.dim(time)} ${level} ${app} ${entry.message}${extra}`);
}

function formatLevel(level: string): string {
  const label = level.toUpperCase().padEnd(7);
  switch (level) {
    case 'fatal':
    case 'error':
      return prism.red(label);
    case 'warn':
      return prism.yellow(label);
    case 'info':
      return prism.green(label);
    case 'debug':
    case 'trace':
    case 'unknown':
      return prism.dim(label);
    default:
      return label;
  }
}

/** Test-only — the pieces the courts reach directly. */
export const __test = { readOptions, derivedLogFile, readMatches, unseen, printEntries };
