/**
 * A heartbeat for a row called «self».
 *
 * The fleet-heartbeat job ran `fleetService.heartbeat(selfNodeId ?? 'self')`,
 * and a default master never sets `selfNodeId` — the daemon provides it as
 * `undefined`. So every interval sent `UPDATE nodes … WHERE id = 'self'` to a
 * uuid column and failed, and a `catch { /* Non-critical *\/ }` said nothing:
 * 119 failures in 30 minutes in Postgres's own log on 2026-09-22, and the
 * master's row kept the `lastHeartbeat` of the moment it registered.
 *
 * The job now beats only a row it knows, reports a heartbeat that reached no
 * row, and says a problem once at warn and quietly after — clearing it on
 * success, so a problem that comes back is said again.
 */
import { describe, it, expect, vi } from 'vitest';

import { registerDaemonJobs } from '../../src/daemon/daemon-scheduler.js';

function recordingLogger() {
  const lines: Array<{ level: string; msg: string; ctx: Record<string, unknown> }> = [];
  const at = (level: string) => (ctx: unknown, msg?: unknown) =>
    lines.push({ level, ctx: (ctx ?? {}) as Record<string, unknown>, msg: String(msg ?? '') });
  const logger: Record<string, unknown> = {
    trace: at('trace'), debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error'), fatal: at('fatal'),
  };
  logger['child'] = () => logger;
  return { logger: logger as never, lines };
}

/** The fleet-heartbeat job, as the scheduler would run it. */
function heartbeatJob(fleetService: Record<string, unknown>) {
  const { logger, lines } = recordingLogger();
  const jobs = new Map<string, () => Promise<void>>();
  const scheduler = {
    addInterval: vi.fn((name: string, _ms: number, fn: () => Promise<void>) => jobs.set(name, fn)),
  } as never;
  registerDaemonJobs(scheduler, {
    logger,
    orchestrator: { list: () => [] } as never,
    authService: null,
    metricsService: { record: vi.fn() } as never,
    alertService: null,
    fleetService: fleetService as never,
    logManager: { checkRotation: vi.fn() } as never,
    infraService: null,
    syncService: null,
    metricsInterval: 1000,
    healthCheckInterval: 1000,
  });
  const job = jobs.get('fleet-heartbeat');
  if (!job) throw new Error('fleet-heartbeat did not register');
  const said = (level: string) => lines.filter((l) => l.level === level && /heartbeat/i.test(l.msg));
  return { job, said };
}

describe('a heartbeat for a row called self', () => {
  it('beats no row it does not know, and says so once', async () => {
    const heartbeat = vi.fn(async () => 1);
    const { job, said } = heartbeatJob({ heartbeat, selfNodeId: undefined });

    await job();
    await job();
    await job();

    expect(heartbeat, "a literal 'self' is not a node").not.toHaveBeenCalled();
    expect(said('warn')).toHaveLength(1);
    expect(said('warn')[0]!.msg).toMatch(/has not registered itself/);
  });

  it('beats the row this daemon registered', async () => {
    const heartbeat = vi.fn(async () => 1);
    const { job, said } = heartbeatJob({ heartbeat, selfNodeId: '40655c07-4824-46b8-b793-af9fce7a383e' });

    await job();

    expect(heartbeat).toHaveBeenCalledWith('40655c07-4824-46b8-b793-af9fce7a383e');
    expect(said('warn')).toEqual([]);
  });

  it('says a heartbeat that reached no row', async () => {
    const { job, said } = heartbeatJob({ heartbeat: vi.fn(async () => 0), selfNodeId: '40655c07-4824-46b8-b793-af9fce7a383e' });

    await job();

    expect(said('warn').map((l) => l.msg)).toEqual(["Fleet heartbeat reached no row — this daemon's registration is gone"]);
  });

  it('says a failure once, quietly after, and again once it has come back', async () => {
    let fail = true;
    const heartbeat = vi.fn(async () => {
      if (fail) throw new Error('invalid input syntax for type uuid: "self"');
      return 1;
    });
    const { job, said } = heartbeatJob({ heartbeat, selfNodeId: '40655c07-4824-46b8-b793-af9fce7a383e' });

    await job();
    await job();
    expect(said('warn')).toHaveLength(1);
    expect(said('debug')).toHaveLength(1);

    fail = false;
    await job(); // clears it
    fail = true;
    await job();
    expect(said('warn'), 'a failure that returns is news again').toHaveLength(2);
  });
});
