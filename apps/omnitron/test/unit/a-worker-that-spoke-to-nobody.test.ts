/**
 * A worker that spoke to nobody.
 *
 * The daemon runs titan-pm with `forwardChildLogs: false`: the orchestrator
 * subscribes to an APP's output itself, and a second forwarder had stored
 * every line twice. A system worker — the health monitor — has no such
 * subscriber, so its lines were captured and handed to nobody. From 12:15
 * UTC on 2026-09-22 it said «Failed to persist health check results» once a
 * minute and no node had any history; the sentence reached no log, and the
 * error behind it was visible only in Postgres's own.
 *
 * `SystemWorkerManager` now subscribes to each worker's output and says it
 * in the daemon's log, at the worker's own level, under the worker's name.
 */

import { describe, it, expect, vi } from 'vitest';

import { SystemWorkerManager } from '../../src/workers/system-worker-manager.js';

type LogHandler = (line: string, stream: 'stdout' | 'stderr') => void;

function pmWithHandle(handle: Record<string, unknown>) {
  return {
    spawn: vi.fn(async () => ({ __processId: 'proc-1' })),
    getWorkerHandle: vi.fn(() => handle),
    kill: vi.fn().mockResolvedValue(true),
  };
}

function recordingLogger() {
  const lines: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
  const at = (level: string) => (fields: Record<string, unknown>, msg: string) => lines.push({ level, fields, msg });
  const logger: any = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error'), child: () => logger };
  return { logger, lines };
}

describe('a worker that spoke to nobody', () => {
  it('says what the worker said, at its level, under its name', async () => {
    let speak: LogHandler | null = null;
    const pm = pmWithHandle({ onExit: () => () => {}, onLog: (h: LogHandler) => (speak = h) });
    const { logger, lines } = recordingLogger();

    await new SystemWorkerManager(pm as never, logger).spawn('health-monitor', '/w.js', {});
    expect(speak, 'a subscriber for the worker output').not.toBeNull();

    speak!(
      JSON.stringify({
        level: 40,
        time: 1790100955950,
        pid: 47976,
        hostname: 'MacBook-Pro-Taaliman.local',
        name: 'titan-app',
        error: 'value too long for type character varying(32)',
        msg: 'Failed to persist health check results',
      }),
      'stdout',
    );

    const said = lines.find((l) => l.msg === 'Failed to persist health check results');
    expect(said, 'the warning, in the daemon log').toBeDefined();
    expect(said!.level).toBe('warn');
    expect(said!.fields).toMatchObject({ worker: 'health-monitor', error: 'value too long for type character varying(32)' });
    // The worker's own envelope does not pass for the daemon's.
    expect(said!.fields).not.toHaveProperty('pid');
    expect(said!.fields).not.toHaveProperty('hostname');
  });

  it('keeps a line that is not JSON — a stack trace on stderr is still a warning', async () => {
    let speak: LogHandler | null = null;
    const pm = pmWithHandle({ onExit: () => () => {}, onLog: (h: LogHandler) => (speak = h) });
    const { logger, lines } = recordingLogger();

    await new SystemWorkerManager(pm as never, logger).spawn('health-monitor', '/w.js', {});
    speak!('    at HealthMonitorService.persistResults (health-monitor.service.ts:422:7)', 'stderr');

    expect(lines.find((l) => l.msg.includes('persistResults'))).toMatchObject({
      level: 'warn',
      fields: { worker: 'health-monitor', stream: 'stderr' },
    });
  });

  it('says so when a worker cannot be listened to', async () => {
    const pm = pmWithHandle({ onExit: () => () => {} });
    const { logger, lines } = recordingLogger();

    await new SystemWorkerManager(pm as never, logger).spawn('health-monitor', '/w.js', {});

    expect(lines.some((l) => l.level === 'warn' && /no onLog/.test(l.msg))).toBe(true);
  });
});
