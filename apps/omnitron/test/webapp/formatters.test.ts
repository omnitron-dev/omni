/**
 * The console's shared formatters.
 *
 * The webapp is 18,842 lines across 58 files and had no tests at all, so this
 * is the first. It starts here because these four functions decide what an
 * operator reads off every table in the console, and because two of them
 * conflate "no data" with zero — the same confusion that was just removed
 * from the sampler feeding them.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  formatUptime,
  formatMemory,
  formatMemoryMb,
  formatTimestamp,
  timeAgo,
} from '../../webapp/src/utils/formatters.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatUptime', () => {
  it('drops units that are zero, largest first', () => {
    expect(formatUptime(45_000)).toBe('45s');
    expect(formatUptime(3_600_000)).toBe('1h 0m');
    expect(formatUptime(90_000)).toBe('1m 30s');
    expect(formatUptime(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d 3h 0m');
  });

  it('says a just-started app has been up no time, not that it is unknown', () => {
    // An app that started this instant has an uptime of 0, which is a
    // measurement. Rendering it as `--` says the opposite — that nothing is
    // known — and an operator watching a restart cannot tell the two apart.
    expect(formatUptime(0)).toBe('0s');
  });

  it('still refuses a negative uptime, which is not a measurement', () => {
    expect(formatUptime(-1)).toBe('--');
  });
});

describe('formatMemory', () => {
  it('renders megabytes with one decimal', () => {
    expect(formatMemory(150 * 1024 * 1024)).toBe('150.0 MB');
    expect(formatMemory(1_572_864)).toBe('1.5 MB');
  });

  it('renders a genuine zero as zero', () => {
    // Since the orchestrator stopped overwriting a failed sample with zeros,
    // 0 means the process really is holding nothing measurable — and `--`
    // would claim the sample never happened.
    expect(formatMemory(0)).toBe('0.0 MB');
  });

  it('refuses a negative reading', () => {
    expect(formatMemory(-1)).toBe('--');
  });
});

describe('formatMemoryMb', () => {
  it('renders the bare number, for a column with its own unit header', () => {
    expect(formatMemoryMb(150 * 1024 * 1024)).toBe('150.0');
    expect(formatMemoryMb(0)).toBe('0.0');
    expect(formatMemoryMb(-1)).toBe('--');
  });
});

describe('formatTimestamp', () => {
  it('is 24-hour and zero-padded, so timestamps sort and align', () => {
    expect(formatTimestamp(new Date('2026-09-05T09:07:03Z'))).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('accepts the ISO strings the daemon actually sends', () => {
    expect(formatTimestamp('2026-09-05T09:07:03.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('timeAgo', () => {
  it('coarsens as the gap grows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));

    expect(timeAgo(new Date('2026-09-05T11:59:30Z'))).toBe('just now');
    expect(timeAgo(new Date('2026-09-05T11:45:00Z'))).toBe('15m ago');
    expect(timeAgo(new Date('2026-09-05T09:00:00Z'))).toBe('3h ago');
    expect(timeAgo(new Date('2026-09-02T12:00:00Z'))).toBe('3d ago');
  });

  it('does not render a future timestamp as a large age', () => {
    // Clock skew between the daemon and the browser puts events slightly in
    // the future; "just now" is the honest reading, not "-1m ago".
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));

    expect(timeAgo(new Date('2026-09-05T12:00:30Z'))).toBe('just now');
  });
});
