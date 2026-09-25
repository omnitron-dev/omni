/**
 * An app that left its workers running.
 *
 * An app's processes are its supervisor's children — and, for an entry with
 * `instances > 1`, the workers of a topology pool, which are the daemon's
 * children and nobody's else (`handle.topologyPools`). Two paths let them live
 * on after the app they belonged to:
 *
 *   - `stopApp` stopped only the supervisor. No code in the orchestrator ever
 *     destroyed a pool; only the daemon's own shutdown did. Every restart left
 *     the previous workers running.
 *   - a start over a handle that was not online replaced the handle and
 *     stopped nothing it still ran. A crash restart and a cool-down recovery
 *     come exactly this way — they only flip the status first — and one child
 *     crashing leaves its siblings, the server among them, up.
 *
 * On daos/test, 2026-09-25: priceverse's `ohlcv-aggregator` and storage's
 * `transform` in three generations at once, and paysys's server of one
 * generation holding :3004 against five crash restarts — «held by … a child
 * this daemon still accounts for».
 *
 * Held here: after `stopApp`, nothing of the app is left to stop — its
 * supervisor stopped and every pool destroyed, the pools even when the
 * supervisor's stop throws; and a start over a handle that is not online
 * stops everything that handle ran BEFORE the new one launches, whether the
 * handle sits under the same key or is a stale duplicate under another.
 */
import { describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';

import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import type { IEcosystemAppEntry, IEcosystemConfig } from '../../src/config/types.js';

const config = {
  apps: [],
  supervision: { strategy: 'one_for_one', maxRestarts: 3, window: 60_000, backoff: { type: 'exponential', initial: 300, max: 30_000, factor: 2 } },
  monitoring: { healthCheck: { interval: 30_000, timeout: 5_000 } },
} as unknown as IEcosystemConfig;

/** An orchestrator with only what these paths touch — the log records the order things happened in. */
function orchestrator() {
  const log: string[] = [];
  const self = Object.create(OrchestratorService.prototype) as Record<string, any>;
  Object.assign(self, {
    handles: new Map<string, AppHandle>(),
    coolDownTimers: new Map(),
    config,
    lifecycleQueue: { enqueue: (_key: string, _op: string, fn: () => Promise<unknown>) => fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    persistState: vi.fn(),
    ensureMetricsPolling: vi.fn(),
    metricsBridge: { evictApp: vi.fn() },
    launchBootstrapMode: async (_entry: IEcosystemAppEntry, handle: AppHandle) => {
      log.push('launch');
      handle.status = 'online';
    },
  });
  return { self, log };
}

/** A handle as a generation leaves it: a supervisor with children, and two pools. */
function generation(name: string, log: string[], opts: { supervisorThrows?: boolean } = {}) {
  const handle = new AppHandle({ name, bootstrap: './bootstrap.ts' } as IEcosystemAppEntry, 'bootstrap');
  handle.supervisor = {
    stop: vi.fn(async () => {
      log.push(`${name}: supervisor stopped`);
      if (opts.supervisorThrows) throw new Error('a child would not die');
    }),
  } as never;
  for (const pool of ['ohlcv-aggregator', 'transform']) {
    handle.topologyPools.set(pool, { destroy: vi.fn(async () => void log.push(`${name}: ${pool} destroyed`)) } as never);
  }
  return handle;
}

describe('stopping an app', () => {
  it('stops its supervisor AND destroys every pool — nothing of it is left to stop', async () => {
    const { self, log } = orchestrator();
    const handle = generation('daos/deployed/priceverse', log);
    handle.status = 'online';
    self.handles.set(handle.name, handle);

    await self.stopApp('daos/deployed/priceverse');

    expect(log).toEqual([
      'daos/deployed/priceverse: supervisor stopped',
      'daos/deployed/priceverse: ohlcv-aggregator destroyed',
      'daos/deployed/priceverse: transform destroyed',
    ]);
    expect(handle.topologyPools.size).toBe(0);
    expect(handle.status).toBe('stopped');
  });

  it('destroys the pools even when the supervisor\'s stop throws', async () => {
    const { self, log } = orchestrator();
    const handle = generation('daos/deployed/storage', log, { supervisorThrows: true });
    handle.status = 'online';
    self.handles.set(handle.name, handle);

    await expect(self.stopApp('daos/deployed/storage')).rejects.toThrow(/would not die/);
    expect(log).toContain('daos/deployed/storage: transform destroyed');
    expect(handle.topologyPools.size).toBe(0);
  });
});

describe('starting over a handle that is not online', () => {
  it('a crash restart stops what the old handle still runs before the new one launches', async () => {
    const { self, log } = orchestrator();
    const old = generation('daos/deployed/paysys', log);
    // What the crash-restart and cool-down paths do before they come here.
    old.status = 'stopped';
    self.handles.set(old.name, old);

    const next = await self.startAppInternal({ name: 'daos/deployed/paysys', bootstrap: './bootstrap.ts' }, config);

    expect(log).toEqual([
      'daos/deployed/paysys: supervisor stopped',
      'daos/deployed/paysys: ohlcv-aggregator destroyed',
      'daos/deployed/paysys: transform destroyed',
      'launch',
    ]);
    expect(next).not.toBe(old);
    expect(old.topologyPools.size).toBe(0);
  });

  it('a stale duplicate under another key is stopped too, not only forgotten', async () => {
    const { self, log } = orchestrator();
    const bare = generation('storage', log);
    bare.status = 'errored';
    self.handles.set('storage', bare);

    await self.startAppInternal({ name: 'daos/deployed/storage', bootstrap: './bootstrap.ts' }, config);

    expect(log.slice(0, 3)).toEqual(['storage: supervisor stopped', 'storage: ohlcv-aggregator destroyed', 'storage: transform destroyed']);
    expect(log.at(-1)).toBe('launch');
    expect(self.handles.has('storage')).toBe(false);
  });

  it('an app already online is left alone', async () => {
    const { self, log } = orchestrator();
    const running = generation('daos/deployed/geo', log);
    running.status = 'online';
    self.handles.set(running.name, running);

    expect(await self.startAppInternal({ name: 'daos/deployed/geo', bootstrap: './bootstrap.ts' }, config)).toBe(running);
    expect(log).toEqual([]);
  });
});
