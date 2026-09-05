/**
 * Backup schedule specifications — what a user is allowed to type, and what
 * the daemon is allowed to do with it.
 *
 * The RPC field, the DTO field, the CLI argument and the old parser were all
 * called `cron`, and the parser accepted three English words or a bare number
 * of milliseconds. Everything else fell through to a hardcoded 24 hours. So
 * `0 3 * * *` — the most ordinary nightly-backup expression there is — became
 * "every 24 hours starting whenever the daemon last restarted", silently, and
 * `30 2 * * *` became `parseInt('30 2 * * *')` = **a 30-millisecond timer**:
 * a continuous pg_dump loop, a filling disk, and a retention pass racing it.
 *
 * Two rules follow from that, and they are the point of this module.
 *
 * Cron expressions are parsed as cron. Not approximated by an interval —
 * "daily at 03:00" and "every 86 400 000 ms" are different schedules, and the
 * difference is exactly what an operator picked a cron expression to express.
 *
 * Nothing unrecognised gets a default. A schedule the daemon cannot read is a
 * schedule the operator has to be told about, because the alternative is a
 * backup that runs at a time nobody chose — which looks like it is working.
 */

import { CronExpressionParser } from 'cron-parser';

/** Word forms kept from the original parser; existing schedules use them. */
export const PRESETS: Record<string, number> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
};

/**
 * Floor for the bare-milliseconds form.
 *
 * A backup interval under a minute is not a choice anyone makes; it is what a
 * cron expression looks like after `parseInt` has eaten it. Rejecting the
 * range turns the old failure into a message.
 */
export const MIN_INTERVAL_MS = 60_000;

export type SchedulePlan =
  | { kind: 'interval'; intervalMs: number; spec: string }
  | { kind: 'cron'; expression: string; spec: string };

export class ScheduleParseError extends Error {
  constructor(spec: string, reason: string) {
    super(
      `Cannot read backup schedule ${JSON.stringify(spec)}: ${reason}. ` +
        `Accepted: a cron expression ("0 3 * * *"), a preset (${Object.keys(PRESETS).join(', ')}), ` +
        `or an interval in milliseconds (at least ${MIN_INTERVAL_MS}).`
    );
    this.name = 'ScheduleParseError';
  }
}

/** True when the string is a bare integer — no sign, no units, no padding. */
function isBareInteger(spec: string): boolean {
  return /^\d+$/.test(spec);
}

/**
 * Read a schedule specification.
 *
 * @throws ScheduleParseError — always, rather than falling back to a default.
 */
export function parseSchedule(spec: string): SchedulePlan {
  const trimmed = String(spec ?? '').trim();
  if (!trimmed) throw new ScheduleParseError(spec, 'it is empty');

  const preset = PRESETS[trimmed.toLowerCase()];
  if (preset !== undefined) return { kind: 'interval', intervalMs: preset, spec: trimmed };

  if (isBareInteger(trimmed)) {
    // `Number` rather than `parseInt`: `parseInt('30 2 * * *')` returning 30
    // is the whole reason this module exists, and a form that stops reading
    // at the first thing it does not understand has no place here.
    const ms = Number(trimmed);
    if (!Number.isSafeInteger(ms)) throw new ScheduleParseError(spec, 'the interval is not a usable integer');
    if (ms < MIN_INTERVAL_MS) {
      throw new ScheduleParseError(spec, `an interval of ${ms} ms is below the ${MIN_INTERVAL_MS} ms floor`);
    }
    return { kind: 'interval', intervalMs: ms, spec: trimmed };
  }

  // Anything else has to be cron, and has to prove it by producing an
  // occurrence. `cron-parser` accepts 5- and 6-field forms and the `@daily`
  // family; whatever it rejects, we reject — plus one thing it accepts and
  // we do not.
  //
  // It pads a short expression on the left, so `* * *` becomes `* * * * *`:
  // a mistyped daily schedule silently turns into a pg_dump every minute.
  // That is a smaller copy of the failure this module exists to remove, so
  // the field count is checked before the parser is asked.
  if (!trimmed.startsWith('@')) {
    const fields = trimmed.split(/\s+/).length;
    if (fields < 5) {
      throw new ScheduleParseError(
        spec,
        `a cron expression needs 5 fields (or 6 with seconds), this has ${fields}`
      );
    }
  }

  try {
    const parsed = CronExpressionParser.parse(trimmed);
    parsed.next();
    return { kind: 'cron', expression: trimmed, spec: trimmed };
  } catch (err) {
    throw new ScheduleParseError(spec, (err as Error).message || 'it is not a cron expression');
  }
}

/**
 * Milliseconds from `from` until the next occurrence of `expression`.
 *
 * Never returns zero or negative: a cron whose next occurrence is now would
 * otherwise arm a zero-delay timer, and the loop that produces is the one
 * this module was written to remove.
 */
export function nextCronDelay(expression: string, from: Date = new Date()): number {
  // Local time, per the note on `describeSchedule`.
  const parsed = CronExpressionParser.parse(expression, { currentDate: from });
  const delay = parsed.next().getTime() - from.getTime();
  return delay > 0 ? delay : 1;
}

/**
 * One-line description for logs and `backup schedules` output.
 *
 * Cron expressions are evaluated in the daemon's local timezone — the
 * conventional behaviour, and the one `cron-parser` implements — which means
 * `0 3 * * *` is 03:00 wherever the daemon runs, not 03:00 UTC. On a server
 * whose clock is not the operator's that is a several-hour difference that
 * nothing else would ever mention, so the zone is named here.
 */
export function describeSchedule(
  plan: SchedulePlan,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
  if (plan.kind === 'cron') return `cron ${plan.expression} (${timeZone})`;
  const ms = plan.intervalMs;
  if (ms % 86_400_000 === 0) return `every ${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `every ${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `every ${ms / 60_000}m`;
  return `every ${ms}ms`;
}
