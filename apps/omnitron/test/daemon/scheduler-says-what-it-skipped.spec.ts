/**
 * The daemon says which of its jobs did not register.
 *
 * Three of the five are conditional on an optional service — all of them
 * "master only, requires PG". The registration line named what DID register,
 * which tells a reader five without telling them whether five is all of them.
 * A job that never registers is a sweep that never runs, and this platform has
 * already paid for one of those going unnoticed for four months.
 */
import { describe, it, expect, vi } from 'vitest';

import { registerDaemonJobs } from '../../src/daemon/daemon-scheduler.js';

const recordingLogger = () => {
  const lines: Array<{ ctx: Record<string, unknown>; msg: string }> = [];
  const record = (_ctx: unknown, msg?: unknown) =>
    lines.push({ ctx: (_ctx ?? {}) as Record<string, unknown>, msg: String(msg ?? '') });
  const logger: Record<string, unknown> = {
    trace: record, debug: record, info: record, warn: record, error: record, fatal: record,
  };
  logger['child'] = () => logger;
  return { logger: logger as never, lines };
};

const run = (present: { auth?: boolean; alert?: boolean; fleet?: boolean }) => {
  const { logger, lines } = recordingLogger();
  const scheduler = { addInterval: vi.fn() } as never;
  registerDaemonJobs(scheduler, {
    logger,
    orchestrator: { list: () => [] } as never,
    authService: present.auth ? ({ cleanupExpiredSessions: vi.fn() } as never) : null,
    metricsService: { record: vi.fn() } as never,
    alertService: present.alert ? ({ evaluate: vi.fn() } as never) : null,
    fleetService: present.fleet ? ({ heartbeat: vi.fn(), selfNodeId: 'n1' } as never) : null,
    logManager: { checkRotation: vi.fn() } as never,
    infraService: null,
    metricsInterval: 1000,
    healthCheckInterval: 1000,
  });
  return lines;
};

describe('daemon job registration', () => {
  it('names the jobs whose service is absent', () => {
    const lines = run({});

    const registered = lines.find((l) => l.msg.includes('jobs registered'));
    expect(registered?.ctx['jobs']).toEqual(['metrics-collection', 'log-rotation']);

    const missing = lines.find((l) => l.msg.includes('not registered'));
    expect(missing, 'three jobs silently did not register').toBeDefined();
    const skipped = missing?.ctx['skipped'] as Array<{ job: string; because: string }>;
    expect(skipped.map((s) => s.job)).toEqual([
      'session-cleanup',
      'alert-evaluation',
      'fleet-heartbeat',
    ]);
    expect(skipped[0]?.because, 'a reader has to know WHY it is absent').toMatch(/requires PG/);
  });

  it('says nothing extra when every job registered', () => {
    const lines = run({ auth: true, alert: true, fleet: true });

    expect(lines.find((l) => l.msg.includes('jobs registered'))?.ctx['jobs']).toHaveLength(5);
    expect(
      lines.find((l) => l.msg.includes('not registered')),
      'a complete registration should not report a gap'
    ).toBeUndefined();
  });
});
