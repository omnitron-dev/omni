/**
 * Backup schedule specifications.
 *
 * The old parser took three English words or a bare number of milliseconds,
 * and sent everything else to a hardcoded 24 hours — while the CLI argument,
 * the RPC field and the parser itself were all called `cron`. Two things
 * followed, and both are pinned here because both were invisible:
 *
 *   "0 3 * * *"   → 86 400 000 ms. Not "daily at 03:00" but "every 24 hours
 *                   from whenever the daemon last restarted". Close enough to
 *                   right that nobody would look.
 *   "30 2 * * *"  → parseInt gives 30. A pg_dump every thirty milliseconds.
 *
 * The second is the one that mattered; the first is the one that would have
 * lasted longer.
 */

import { describe, it, expect } from 'vitest';

import { databasesToPrune } from '../../src/services/backup.service.js';
import {
  parseSchedule,
  nextCronDelay,
  describeSchedule,
  ScheduleParseError,
  MIN_INTERVAL_MS,
} from '../../src/services/backup-schedule.js';

describe('parseSchedule — cron', () => {
  it('reads a nightly expression as cron, not as an approximate interval', () => {
    const plan = parseSchedule('0 3 * * *');
    expect(plan).toEqual({ kind: 'cron', expression: '0 3 * * *', spec: '0 3 * * *' });
  });

  it('does not turn "30 2 * * *" into a 30 ms timer', () => {
    // The regression, stated as directly as it can be.
    const plan = parseSchedule('30 2 * * *');
    expect(plan.kind).toBe('cron');
    expect(plan).not.toHaveProperty('intervalMs');
  });

  it('accepts the ordinary cron shapes an operator would type', () => {
    for (const spec of ['*/10 * * * *', '0 0 * * 0', '15 */6 * * *', '0 0 1 * *', '@daily', '@weekly']) {
      expect(parseSchedule(spec).kind, spec).toBe('cron');
    }
  });

  it('rejects a malformed expression instead of defaulting it', () => {
    for (const spec of ['0 99 * * *', 'every tuesday', 'nightly', '0 3 * *']) {
      expect(() => parseSchedule(spec), spec).toThrow(ScheduleParseError);
    }
  });

  it('refuses a short expression rather than letting it pad into "every minute"', () => {
    // `cron-parser` pads on the left, so `* * *` parses as `* * * * *`. A
    // mistyped daily schedule becoming a pg_dump every minute is the same
    // failure as the 30 ms timer, one order of magnitude down.
    expect(() => parseSchedule('* * *')).toThrow(/needs 5 fields/);
    expect(() => parseSchedule('0 3 *')).toThrow(ScheduleParseError);
  });
});

describe('parseSchedule — presets and intervals', () => {
  it('keeps the word forms existing schedules are stored as', () => {
    expect(parseSchedule('hourly')).toMatchObject({ kind: 'interval', intervalMs: 3_600_000 });
    expect(parseSchedule('daily')).toMatchObject({ kind: 'interval', intervalMs: 86_400_000 });
    expect(parseSchedule('WEEKLY')).toMatchObject({ kind: 'interval', intervalMs: 604_800_000 });
  });

  it('accepts a bare interval in milliseconds', () => {
    expect(parseSchedule('3600000')).toMatchObject({ kind: 'interval', intervalMs: 3_600_000 });
  });

  it('refuses an interval below the floor, naming the number', () => {
    // Where a mangled cron expression used to land. Rejecting the range is
    // what turns the old silent runaway into a message.
    expect(() => parseSchedule('30')).toThrow(/30 ms is below/);
    expect(() => parseSchedule(String(MIN_INTERVAL_MS - 1))).toThrow(ScheduleParseError);
    expect(parseSchedule(String(MIN_INTERVAL_MS)).kind).toBe('interval');
  });

  it('does not read a number off the front of something else', () => {
    // `parseInt('3600000 and then some')` is 3600000. `Number` is NaN, and
    // the bare-integer test rejects it before either runs.
    expect(() => parseSchedule('3600000 whenever')).toThrow(ScheduleParseError);
    expect(() => parseSchedule('  ')).toThrow(ScheduleParseError);
    expect(() => parseSchedule('')).toThrow(ScheduleParseError);
  });

  it('trims, because a CLI argument arrives with whatever the shell left', () => {
    expect(parseSchedule('  daily  ')).toMatchObject({ kind: 'interval', intervalMs: 86_400_000 });
    expect(parseSchedule(' 0 3 * * * ')).toMatchObject({ kind: 'cron', expression: '0 3 * * *' });
  });

  it('names what is accepted when it refuses', () => {
    // The message is the entire remedy — an operator who typed something
    // wrong has nothing else to go on.
    try {
      parseSchedule('0 99 * * *');
      expect.unreachable('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('0 3 * * *');
      expect(msg).toContain('hourly');
      expect(msg).toContain(String(MIN_INTERVAL_MS));
    }
  });
});

describe('nextCronDelay', () => {
  // Cron runs on the daemon's local clock, so the expectations are built
  // from local time too. Hardcoding a UTC instant here would make the suite
  // pass in one timezone and fail in another — and the first version of
  // these two tests did exactly that, which is how the timezone question
  // got asked at all.
  const at = (y: number, mo: number, d: number, h: number) => new Date(y, mo - 1, d, h, 0, 0, 0);

  it('lands on the next occurrence of the stated local time', () => {
    const from = at(2026, 9, 5, 1);
    const landed = new Date(from.getTime() + nextCronDelay('0 3 * * *', from));
    expect(landed.getHours()).toBe(3);
    expect(landed.getDate()).toBe(5);
  });

  it('rolls to tomorrow once the time has passed', () => {
    const from = at(2026, 9, 5, 4);
    const landed = new Date(from.getTime() + nextCronDelay('0 3 * * *', from));
    expect(landed.getHours()).toBe(3);
    expect(landed.getDate()).toBe(6);
  });

  it('never returns a non-positive delay', () => {
    // A zero-delay timer that re-arms itself is the runaway loop again, by
    // another route. Exactly-on-the-minute is the case that produces it.
    const onTheMinute = at(2026, 9, 5, 3);
    expect(nextCronDelay('0 3 * * *', onTheMinute)).toBeGreaterThan(0);
    expect(nextCronDelay('* * * * *', onTheMinute)).toBeGreaterThan(0);
  });

  it('spaces a monthly schedule by the actual month', () => {
    // What an interval cannot express, and the reason cron is not
    // approximated by one: February is not 30 days.
    const feb = nextCronDelay('0 0 1 * *', at(2026, 2, 2, 0));
    const mar = nextCronDelay('0 0 1 * *', at(2026, 3, 2, 0));
    expect(feb).not.toBe(mar);
  });
});

describe('describeSchedule', () => {
  it('says what will actually happen, in terms an operator recognises', () => {
    expect(describeSchedule(parseSchedule('0 3 * * *'), 'Europe/Moscow')).toBe('cron 0 3 * * * (Europe/Moscow)');
    expect(describeSchedule(parseSchedule('daily'))).toBe('every 1d');
    expect(describeSchedule(parseSchedule('hourly'))).toBe('every 1h');
    expect(describeSchedule(parseSchedule('90000'))).toBe('every 90000ms');
    expect(describeSchedule(parseSchedule('300000'))).toBe('every 5m');
  });
});

describe('databasesToPrune', () => {
  /**
   * Retention that runs only where the producer still runs.
   *
   * The sweep used to derive its set from the SCHEDULE, so a database
   * removed from the configuration kept every backup it had ever produced.
   * Measured on the development host: `tor-keys` held 37 files and 343 MiB,
   * none newer than two months, because that name appears only in the `full`
   * pass and the `full` pass no longer runs. `storage-objects` held fifteen
   * more.
   */
  it('bounds what is on disk as well as what is scheduled', () => {
    const dbs = databasesToPrune(['main', 'geo'], ['main', 'retired-service']);

    expect(dbs).toContain('retired-service');
    expect(dbs).toContain('main');
    expect(dbs).toContain('geo');
  });

  it('always includes the artefacts only a full pass produces', () => {
    // These are named nowhere else — not in the stack map, and not on disk
    // once their own backups have been pruned away. Dropping them from the
    // list is how they stopped being pruned in the first place.
    const dbs = databasesToPrune([], []);

    expect(dbs).toEqual(expect.arrayContaining(['storage-objects', 'tor-keys', 'daemon-state']));
  });

  it('names each database once', () => {
    const dbs = databasesToPrune(['main', 'main'], ['main', 'tor-keys']);

    expect(dbs.filter((d) => d === 'main')).toHaveLength(1);
    expect(dbs.filter((d) => d === 'tor-keys')).toHaveLength(1);
  });
});
