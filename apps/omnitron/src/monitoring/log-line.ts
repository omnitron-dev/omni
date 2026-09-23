/**
 * What one line of an application's output says about itself — the single
 * reading of a log line that every consumer of app output shares.
 *
 * There were four readings, one in each consumer, and all four said the same
 * wrong thing about a line that is not JSON: level `info`, time "now".
 *
 *   - `LogManager.parseLine` (the daemon's buffer, read by `omnitron logs`)
 *   - `LogManager.isErrorOrFatal` (which lines reach `error.log`)
 *   - `LogCollectorService.ingestPinoLine` (the `logs` table)
 *   - `commands/logs.ts parseLine` (the file fallback)
 *
 * Measured 2026-09-23. paysys wrote pino-pretty. Its `app.log` held 95
 * «Monero chain has not advanced» records at ERROR and `error.log` held none
 * of them; in the table all 88 such rows of the last day were `info`. On the
 * master, the test node's paysys had 3 `error` rows and 1 264 995 `info` rows
 * in a day, 1 216 292 of them the indented lines of multi-line dumps, each a
 * row of its own. And the time was stamped when the line was READ: `omnitron
 * logs paysys -f` printed 26 distinct lines 304 times in 7 seconds, because
 * every poll re-dated the same lines to the moment of the poll, and `--json
 * logs -n 200` returned 195 records dated at the query while the lines
 * themselves said 08:56:19–09:03:02.
 *
 * So there is one classifier, and what it reads is:
 *
 *   JSON            → parsed as is: its own level, its own time.
 *   a pino-pretty   → level and time from the header. Three headers are in the
 *   header             files on this host: `[16:01:57.981] INFO (` — the time
 *                      of day alone, in the LOCAL zone (pino-pretty's default;
 *                      beside it, a JSON record of the same instant reads
 *                      13:01:57.986Z); `[2026-09-23 08:49:07.229] INFO (` —
 *                      titan's `UTC:yyyy-mm-dd HH:MM:ss.l`, in UTC; and colour
 *                      codes around the level when the writer thought it had a
 *                      terminal. An offset, when a header carries one, is used.
 *   an indented line → the continuation of the record before it, not a
 *                      record of its own. Measured over the six app logs here:
 *                      every indented line follows a pino-pretty header or a
 *                      plain line (a stack under its `Error:`), none follows a
 *                      JSON line; the longest record is 218 lines, 7 KB.
 *   anything else   → level `unknown` — not `info`, which is a claim nothing
 *                      in the line supports — and the time it was CAPTURED,
 *                      stamped once, when the daemon read it from the pipe.
 *
 * Only the daemon can know when it captured a line, so the daemon writes it
 * down: a record that was not JSON is written to the app's file as a JSON
 * line of its own (`fileLineOf`) carrying the level and time decided here,
 * and read back from there as the JSON it now is.
 */

/** A level this module can name. Other JSON level strings are kept as written. */
export type KnownLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Pino's numbers for the levels it names — the file and the filters speak these. */
export const LEVEL_RANK: Readonly<Record<KnownLevel, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** The level of a line that says nothing about its level. */
export const UNKNOWN_LEVEL = 'unknown';

/** The rank of a level, or `undefined` for one that has no place in the order. */
export function levelRank(level: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? LEVEL_RANK[level as KnownLevel] : undefined;
}

/**
 * The level a JSON record states.
 *
 * A number is pino's, read by its thresholds (35 is `warn`, as pino-pretty
 * prints it). A string is the writer's own word: one of pino's names is
 * normalised, anything else is kept as written — «parsed as is» — rather than
 * turned into a level the writer did not say. No level at all is `unknown`.
 */
export function levelOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 10) return 'trace';
    if (value <= 20) return 'debug';
    if (value <= 30) return 'info';
    if (value <= 40) return 'warn';
    if (value <= 50) return 'error';
    return 'fatal';
  }
  if (typeof value === 'string' && value.trim() !== '') return value.trim().toLowerCase();
  return UNKNOWN_LEVEL;
}

const ANSI = /\u001b\[[0-9;]*m/g;

/** Colour is for a terminal; in a record it is noise between the letters. */
export function stripAnsi(text: string): string {
  return text.includes('\u001b[') ? text.replace(ANSI, '') : text;
}

/** How one line reads on its own, before it is joined to anything. */
export type LineClass =
  | {
      kind: 'json';
      level: string;
      /** Epoch ms the record states, or `null` when it states none. */
      time: number | null;
      message: string;
      data: Record<string, unknown>;
    }
  | {
      kind: 'pretty';
      level: string;
      time: number;
      message: string;
      /** pino-pretty's `(name/pid on host)`, when the header has one. */
      source?: string;
    }
  | { kind: 'continuation' }
  | { kind: 'text' };

/** A record: a line, or a header and the lines that continue it. */
export interface LogRecord {
  kind: 'json' | 'pretty' | 'text';
  level: string;
  /** Epoch ms: the record's own time, or the time it was captured. */
  time: number;
  /** False when `time` is the capture (or a neighbour's) time, not the record's own. */
  timeFromLine: boolean;
  message: string;
  /** The parsed fields of a JSON record. */
  data?: Record<string, unknown>;
  /** pino-pretty's `(name/pid on host)`. */
  source?: string;
  /** A JSON record's line exactly as written — the file keeps it verbatim. */
  raw?: string;
  /** Physical lines in the record. */
  lines: number;
}

/**
 * A header with the time of day alone is dated from what it is read beside:
 * the latest instant with that local time of day that is not later than the
 * reference. A line is written before it is captured, and before the record
 * after it in a file — plus this much grace for two clocks on one machine
 * disagreeing a little.
 */
const TIME_OF_DAY_GRACE_MS = 60_000;

const PRETTY_LEVELS: Readonly<Record<string, string>> = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
  // pino-pretty's word for a numeric level it has no name for.
  USERLVL: UNKNOWN_LEVEL,
};

const HEADER = /^\[([^\]]{8,40})\]\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL|USERLVL)\b(?:\s*\(([^)]*)\))?\s*:?\s?(.*)$/;
const TIME_OF_DAY = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:\s?(Z|[+-]\d{2}:?\d{2}))?$/;
const EPOCH_MS = /^\d{13}$/;

function millisOf(fraction: string | undefined): number {
  return fraction ? Number(fraction.padEnd(3, '0')) : 0;
}

function validClock(h: number, m: number, s: number): boolean {
  return h < 24 && m < 60 && s < 60;
}

/** The instant a pino-pretty header's bracket names, or `null` if it names none. */
function headerTime(stamp: string, reference: number): number | null {
  let m = TIME_OF_DAY.exec(stamp);
  if (m) {
    const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validClock(h, mi, s)) return null;
    const ms = millisOf(m[4]);
    const ref = new Date(reference);
    // Local fields through the Date constructor, so a DST change between the
    // two days is the runtime's arithmetic, not this function's.
    let at = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), h, mi, s, ms).getTime();
    if (at > reference + TIME_OF_DAY_GRACE_MS) {
      at = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1, h, mi, s, ms).getTime();
    }
    return at;
  }

  m = DATE_TIME.exec(stamp);
  if (m) {
    const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
    if (!validClock(h, mi, s) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const utc = Date.UTC(y, mo - 1, d, h, mi, s, millisOf(m[7]));
    const zone = m[8];
    // No zone is UTC: that is how titan writes this header, and pino-pretty's
    // own dated formats say `+0000` or carry the offset explicitly.
    if (!zone || zone === 'Z') return utc;
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const offsetMin = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4));
    return utc - sign * offsetMin * 60_000;
  }

  if (EPOCH_MS.test(stamp)) return Number(stamp);
  return null;
}

/** The span a `Date` can hold; a `time` outside it is not a time. */
const MAX_EPOCH_MS = 8.64e15;

/** Epoch ms from a JSON record's `time`, or `null` when it states none usable. */
function jsonTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_EPOCH_MS) return Math.floor(value);
  if (typeof value === 'string') {
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : null;
  }
  return null;
}

/**
 * Read one line.
 *
 * `reference` dates a header that carries the time of day alone: the capture
 * time when the daemon reads a pipe, the next record's time when a file is
 * read backwards.
 */
export function classifyLine(line: string, reference: number): LineClass {
  const text = line.endsWith('\r') ? line.slice(0, -1) : line;

  if (text.length === 0 || text[0] === ' ' || text[0] === '\t') return { kind: 'continuation' };

  if (text[0] === '{') {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const data = parsed as Record<string, unknown>;
        const message = typeof data['msg'] === 'string' ? data['msg'] : typeof data['message'] === 'string' ? data['message'] : '';
        return { kind: 'json', level: levelOf(data['level']), time: jsonTime(data['time']), message, data };
      }
    } catch {
      // A brace that does not open a JSON object is text like any other.
    }
    return { kind: 'text' };
  }

  if (text[0] === '[' || text[0] === '\u001b') {
    const plain = stripAnsi(text);
    const m = HEADER.exec(plain);
    if (m) {
      const time = headerTime(m[1]!, reference);
      if (time !== null) {
        return {
          kind: 'pretty',
          level: PRETTY_LEVELS[m[2]!] ?? UNKNOWN_LEVEL,
          time,
          message: m[4] ?? '',
          ...(m[3] ? { source: m[3] } : {}),
        };
      }
    }
  }

  return { kind: 'text' };
}

/** The record one line opens, dated by `reference` where the line gives no time. */
export function recordOf(klass: Exclude<LineClass, { kind: 'continuation' }>, line: string, reference: number): LogRecord {
  const raw = line.endsWith('\r') ? line.slice(0, -1) : line;
  switch (klass.kind) {
    case 'json':
      return {
        kind: 'json',
        level: klass.level,
        time: klass.time ?? reference,
        timeFromLine: klass.time !== null,
        message: klass.message,
        data: klass.data,
        raw,
        lines: 1,
      };
    case 'pretty':
      return {
        kind: 'pretty',
        level: klass.level,
        time: klass.time,
        timeFromLine: true,
        message: klass.message,
        ...(klass.source ? { source: klass.source } : {}),
        lines: 1,
      };
    case 'text':
      return { kind: 'text', level: UNKNOWN_LEVEL, time: reference, timeFromLine: false, message: stripAnsi(raw), lines: 1 };
  }
}

/** A continuation line as it joins a record: colour stripped, indentation kept. */
function continuationText(line: string): string {
  return stripAnsi(line.endsWith('\r') ? line.slice(0, -1) : line).trimEnd();
}

/** Trailing blank continuation lines end a dump, they are not part of it. */
function trimRecord(record: LogRecord): LogRecord {
  if (record.message.endsWith('\n')) record.message = record.message.replace(/\n+$/, '');
  return record;
}

/**
 * The line a record occupies in an app's log file.
 *
 * A JSON record is written exactly as the app wrote it. Anything else is
 * written as a JSON line of its own — the level this module read (absent when
 * unknown, so `jq 'select(.level >= 50)'` does not take a string for a number),
 * the time it decided, the text — because a raw line in a file carries no time
 * a later reader could recover, and "the time of reading" is the defect this
 * module exists to end. `format` says what the app actually wrote.
 */
export function fileLineOf(record: LogRecord): string {
  if (record.kind === 'json' && record.raw !== undefined) return record.raw;
  const envelope: Record<string, unknown> = {};
  const rank = levelRank(record.level);
  if (rank !== undefined) envelope['level'] = rank;
  envelope['time'] = new Date(record.time).toISOString();
  envelope['msg'] = record.message;
  if (record.source) envelope['source'] = record.source;
  envelope['format'] = record.kind;
  return JSON.stringify(envelope);
}

/**
 * The largest record a dump may grow into before the rest of it starts a new
 * one. The largest measured is 7 KB; this bounds what a runaway writer can
 * make the daemon hold, without dropping a line — the remainder is a record of
 * its own with the same level and time.
 */
const MAX_RECORD_CHARS = 256 * 1024;

interface Held {
  record: LogRecord;
  chars: number;
  lastAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface LineAssemblerOptions {
  /**
   * How long a record that may still be continued is held after its last
   * line. A pino-pretty record is one write; its lines arrive in one read or
   * a few back to back, so this is a bound on waiting, not a guess at pacing.
   */
  idleMs?: number;
  now?: () => number;
}

/**
 * Joins the lines of a capture into records, in order, per key.
 *
 * A JSON line is a whole record and is delivered at once. A header or a plain
 * line is held until a line that is not its continuation arrives, or until
 * nothing has arrived for `idleMs` — then delivered with every indented line
 * after it. The key is what the caller can tell apart; the capture hands the
 * daemon an app's lines without saying which stream each came from, so that is
 * the app.
 */
export class LineAssembler {
  private readonly held = new Map<string, Held>();
  private readonly idleMs: number;
  private readonly now: () => number;

  constructor(
    private readonly deliver: (key: string, record: LogRecord) => void,
    options: LineAssemblerOptions = {},
  ) {
    this.idleMs = options.idleMs ?? 100;
    this.now = options.now ?? Date.now;
  }

  push(key: string, line: string): void {
    const now = this.now();
    const klass = classifyLine(line, now);

    if (klass.kind === 'continuation') {
      this.continueWith(key, line, now);
      return;
    }

    this.seal(key);
    const record = recordOf(klass, line, now);
    if (record.kind === 'json') {
      this.emit(key, record);
      return;
    }
    this.hold(key, record, now);
  }

  /** Deliver every held record now — before a flush, a read, or shutdown. */
  sealAll(): void {
    for (const key of [...this.held.keys()]) this.seal(key);
  }

  dispose(): void {
    this.sealAll();
  }

  private continueWith(key: string, line: string, now: number): void {
    const text = continuationText(line);
    const held = this.held.get(key);

    if (!held) {
      // Nothing to continue: a JSON record is always one line, so an indented
      // line after one — or at the start of a capture — is a record of its
      // own. Further indented lines join it. A blank line is nothing at all.
      if (text.trim() === '') return;
      this.hold(key, { kind: 'text', level: UNKNOWN_LEVEL, time: now, timeFromLine: false, message: text, lines: 1 }, now);
      return;
    }

    if (held.chars + text.length + 1 > MAX_RECORD_CHARS) {
      const { kind, level, time, timeFromLine, source } = held.record;
      this.seal(key);
      this.hold(key, { kind, level, time, timeFromLine, message: text, lines: 1, ...(source ? { source } : {}) }, now);
      return;
    }

    held.record.message += `\n${text}`;
    held.record.lines += 1;
    held.chars += text.length + 1;
    held.lastAt = now;
  }

  private hold(key: string, record: LogRecord, now: number): void {
    const held: Held = { record, chars: record.message.length, lastAt: now, timer: null };
    this.held.set(key, held);
    this.arm(key, held, this.idleMs);
  }

  private arm(key: string, held: Held, delay: number): void {
    held.timer = setTimeout(() => {
      held.timer = null;
      // The verdict waits for this turn's I/O. A daemon busy past `idleMs`
      // still has the rest of the dump sitting in the pipe, and the timer
      // phase runs before the reads — deciding here would split the record
      // exactly when the host is loaded.
      setImmediate(() => {
        if (this.held.get(key) !== held) return;
        const idle = this.now() - held.lastAt;
        if (idle >= this.idleMs) this.seal(key);
        else this.arm(key, held, this.idleMs - idle);
      });
    }, delay);
    held.timer.unref?.();
  }

  private seal(key: string): void {
    const held = this.held.get(key);
    if (!held) return;
    this.held.delete(key);
    if (held.timer) clearTimeout(held.timer);
    this.emit(key, trimRecord(held.record));
  }

  private emit(key: string, record: LogRecord): void {
    try {
      this.deliver(key, record);
    } catch {
      // A consumer's failure must not reach the capture path: a seal can fire
      // from a timer, where a throw would be the daemon's uncaught exception.
      // The orchestrator guards its handlers for the same reason.
    }
  }
}

/**
 * Joins a file's lines into records while reading it BACKWARDS.
 *
 * `omnitron logs` reads a file from its end until it has as many matching
 * records as were asked for, so it meets a dump's indented lines before their
 * header. They are kept until the header arrives. Each record is dated by the
 * one after it where it gives no time of its own — for a time-of-day header,
 * the latest such instant not after it; for a plain line in a file written
 * before the daemon recorded capture times, that record's time — and the last
 * record in the file by the file's modification time. Never by the time of
 * reading.
 */
export class BackwardAssembler {
  private pending: string[] = [];
  private reference: number;

  constructor(
    endReference: number,
    private readonly deliver: (record: LogRecord) => void,
  ) {
    this.reference = endReference;
  }

  /** The line before every line pushed so far. */
  pushEarlier(line: string): void {
    const klass = classifyLine(line, this.reference);
    if (klass.kind === 'continuation') {
      this.pending.push(continuationText(line));
      return;
    }

    const record = recordOf(klass, line, this.reference);
    const after = this.takePending();

    if (record.kind === 'json') {
      // A JSON record is one line: what followed it indented is a record of
      // its own, and it came after this one.
      if (after) this.deliver(this.orphan(after));
      this.reference = record.time;
      this.deliver(record);
      return;
    }

    if (after) {
      record.message = record.message ? `${record.message}\n${after.message}` : after.message;
      record.lines += after.lines;
    }
    this.reference = record.time;
    this.deliver(trimRecord(record));
  }

  /** The start of what was read: indented lines whose header lies before it. */
  finish(): void {
    const after = this.takePending();
    if (after) this.deliver(this.orphan(after));
  }

  private takePending(): { message: string; lines: number } | null {
    if (this.pending.length === 0) return null;
    const lines = this.pending.reverse();
    this.pending = [];
    const message = lines.join('\n').replace(/^\n+|\n+$/g, '');
    return message.trim() === '' ? null : { message, lines: lines.length };
  }

  private orphan(part: { message: string; lines: number }): LogRecord {
    return { kind: 'text', level: UNKNOWN_LEVEL, time: this.reference, timeFromLine: false, message: part.message, lines: part.lines };
  }
}
