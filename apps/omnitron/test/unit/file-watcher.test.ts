/**
 * FileWatcher behaviour.
 *
 * ## Why these tests are event-driven rather than sleep-driven
 *
 * `fs.watch(dir, { recursive: true })` is inotify on Linux (events arrive in
 * single-digit milliseconds) and FSEvents on macOS, where the picture is very
 * different: the stream needs a few hundred ms to arm after `fs.watch()`
 * returns — writes before that are lost entirely — and delivery then lags by
 * roughly a second. Measured on this machine: a write issued immediately
 * after `fs.watch()` produced NO event at all within 1.2s; with a 300ms head
 * start the event landed ~740ms after the write; with a 1s head start,
 * ~1.4s after.
 *
 * The previous version of this file wrote a file and then slept 300ms. On
 * macOS that meant:
 *
 *   - the four "should trigger restart" tests failed every run, because the
 *     event had not been delivered yet when the assertion ran;
 *   - and — worse — the three "should NOT trigger restart" tests passed for
 *     the wrong reason. They too were sampling before delivery, so they would
 *     have passed even if the watcher restarted on every `node_modules`,
 *     `dist` and `.png` write. They proved nothing.
 *
 * So the sleeps are gone. Positive cases wait for the call to arrive
 * (`waitFor`); negative cases first prove the watcher is live and delivering,
 * then use a sentinel write to establish that the ignored write has had its
 * chance to arrive and did not restart anything.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileWatcher } from '../../src/orchestrator/file-watcher.js';
import type { IEcosystemConfig, IEcosystemAppEntry } from '../../src/config/types.js';
import type { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

/** Generous enough for FSEvents' ~1s delivery lag under load; unused on Linux. */
const EVENT_TIMEOUT = 15_000;

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'debug' as const,
  };
}

function createMockOrchestrator() {
  return {
    restartApp: vi.fn().mockResolvedValue(undefined),
  } as unknown as OrchestratorService;
}

function createTestConfig(apps: IEcosystemAppEntry[]): IEcosystemConfig {
  return {
    apps,
    supervision: {
      strategy: 'one_for_one',
      maxRestarts: 5,
      window: 60_000,
      backoff: { type: 'exponential', initial: 1000, max: 30_000, factor: 2 },
    },
    monitoring: {
      healthCheck: { interval: 15_000, timeout: 5_000 },
      metrics: { interval: 5_000, retention: 3600 },
    },
    logging: {
      directory: '/tmp/omnitron-test-logs',
      maxSize: '50mb',
      maxFiles: 10,
      compress: true,
      format: 'json',
    },
    daemon: {
      socketPath: '/tmp/test-daemon.sock',
      port: 9700,
      host: '127.0.0.1',
      pidFile: '/tmp/test-daemon.pid',
      stateFile: '/tmp/test-daemon-state.json',
    },
    env: 'test',
  };
}

describe('FileWatcher', () => {
  let tmpDir: string;
  let appDir: string;
  let srcDir: string;
  let watcher: FileWatcher;
  let logger: ReturnType<typeof createMockLogger>;
  let orchestrator: ReturnType<typeof createMockOrchestrator>;
  let sentinelSeq = 0;

  const restartMock = () => orchestrator.restartApp as ReturnType<typeof vi.fn>;

  /** Resolve once `restartApp` has been called at least `times` times. */
  async function waitForRestarts(times = 1): Promise<void> {
    await vi.waitFor(() => expect(restartMock().mock.calls.length).toBeGreaterThanOrEqual(times), {
      timeout: EVENT_TIMEOUT,
      interval: 25,
    });
  }

  /**
   * Prove the watcher is armed and delivering, then reset the mock.
   *
   * A single write is not enough: FSEvents drops writes issued before its
   * stream finishes arming, and a dropped write is gone — it is never
   * delivered late. So keep writing until one is actually observed, which is
   * also the point at which the watcher is known to be live.
   *
   * Every test that asserts on delivery depends on this. Without it, "no
   * restart happened" is indistinguishable from "the write was lost", and
   * "restart happened" is a coin flip.
   */
  async function armWatcher(): Promise<void> {
    await vi.waitFor(
      async () => {
        fs.writeFileSync(path.join(srcDir, `arm-${++sentinelSeq}.ts`), `export const arm${sentinelSeq} = 1;`);
        await new Promise((r) => setTimeout(r, 150));
        expect(restartMock().mock.calls.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: EVENT_TIMEOUT, interval: 250 }
    );
    restartMock().mockClear();
  }

  /**
   * Write a watched file and wait for its restart. Any event queued BEFORE
   * this write has necessarily been delivered by the time it arrives, so a
   * preceding ignored write that (incorrectly) triggered a restart would
   * already show up in the mock.
   */
  async function sentinelRoundTrip(): Promise<void> {
    fs.writeFileSync(path.join(srcDir, `sentinel-${++sentinelSeq}.ts`), 'export const sentinel = 1;');
    await waitForRestarts(1);
  }

  beforeEach(() => {
    // Create a temp app directory structure
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-watcher-test-'));
    appDir = path.join(tmpDir, 'test-app');
    srcDir = path.join(appDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Create a package.json to mark app root
    fs.writeFileSync(path.join(appDir, 'package.json'), '{"name":"test-app"}');

    // Create a bootstrap file
    fs.writeFileSync(path.join(srcDir, 'bootstrap.ts'), 'export default {}');

    logger = createMockLogger();
    orchestrator = createMockOrchestrator();
    sentinelSeq = 0;
  });

  afterEach(() => {
    if (watcher) watcher.stop();
    // Clean up tmp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should watch app directory and detect file changes', async () => {
    const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 100);
    watcher.start();

    const watched = watcher.getWatchedApps();
    expect(watched).toHaveLength(1);
    expect(watched[0]!.name).toBe('test-app');
    expect(watched[0]!.directory).toBe(appDir);
  });

  it('should trigger restart on .ts file change', async () => {
    const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();
    await armWatcher();

    fs.writeFileSync(path.join(srcDir, 'service.ts'), 'export class Service {}');

    await waitForRestarts(1);
    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
  });

  it('should NOT trigger restart for node_modules changes', async () => {
    const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);

    const nodeModulesDir = path.join(appDir, 'node_modules', 'some-pkg');
    fs.mkdirSync(nodeModulesDir, { recursive: true });

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();
    await armWatcher();

    fs.writeFileSync(path.join(nodeModulesDir, 'index.js'), 'module.exports = {}');
    await sentinelRoundTrip();

    // Exactly one restart — the sentinel's. The node_modules write produced none.
    expect(restartMock().mock.calls.length).toBe(1);
  });

  it('should NOT trigger restart for dist directory changes', async () => {
    const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);

    const distDir = path.join(appDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();
    await armWatcher();

    fs.writeFileSync(path.join(distDir, 'index.js'), 'exports = {}');
    await sentinelRoundTrip();

    expect(restartMock().mock.calls.length).toBe(1);
  });

  it('should NOT trigger restart for non-watched extensions', async () => {
    const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();
    await armWatcher();

    fs.writeFileSync(path.join(srcDir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await sentinelRoundTrip();

    expect(restartMock().mock.calls.length).toBe(1);
  });

  it('should debounce rapid file changes into single restart', async () => {
    const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);

    // Debounce comfortably longer than the delivery jitter, so three writes
    // issued together cannot straddle two windows.
    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 400);
    watcher.start();
    await armWatcher();

    fs.writeFileSync(path.join(srcDir, 'a.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(srcDir, 'b.ts'), 'export const b = 2;');
    fs.writeFileSync(path.join(srcDir, 'c.ts'), 'export const c = 3;');

    await waitForRestarts(1);

    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
    // Three changes, one restart.
    expect(restartMock().mock.calls.length).toBe(1);
  });

  it('should watch only specified apps when filtered', async () => {
    const app2Dir = path.join(tmpDir, 'other-app');
    const app2Src = path.join(app2Dir, 'src');
    fs.mkdirSync(app2Src, { recursive: true });
    fs.writeFileSync(path.join(app2Dir, 'package.json'), '{"name":"other-app"}');
    fs.writeFileSync(path.join(app2Src, 'main.ts'), 'export {}');

    const config = createTestConfig([
      { name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') },
      { name: 'other-app', script: path.join(app2Src, 'main.ts') },
    ]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start(['test-app']);

    const watched = watcher.getWatchedApps();
    expect(watched).toHaveLength(1);
    expect(watched[0]!.name).toBe('test-app');
  });

  it('should skip apps without bootstrap or script', () => {
    const config = createTestConfig([{ name: 'no-entry' } as IEcosystemAppEntry]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    const watched = watcher.getWatchedApps();
    expect(watched).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ app: 'no-entry' }),
      expect.stringContaining('skipping watch')
    );
  });

  it('should skip disabled apps', () => {
    const config = createTestConfig([
      { name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts'), enabled: false },
    ]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    const watched = watcher.getWatchedApps();
    expect(watched).toHaveLength(0);
  });

  it('should support addApp and removeApp dynamically', () => {
    const config = createTestConfig([]);
    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    expect(watcher.getWatchedApps()).toHaveLength(0);

    // Dynamically add
    watcher.addApp({ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') });
    expect(watcher.getWatchedApps()).toHaveLength(1);

    // Dynamically remove
    watcher.removeApp('test-app');
    expect(watcher.getWatchedApps()).toHaveLength(0);
  });

  it('should stop all watchers on stop()', () => {
    const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();
    expect(watcher.getWatchedApps()).toHaveLength(1);

    watcher.stop();
    expect(watcher.getWatchedApps()).toHaveLength(0);
  });

  it('should handle restart failure gracefully', async () => {
    const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();
    // Arm on the resolving mock, then switch to rejecting — otherwise the
    // arming writes would themselves log the failure we are asserting on.
    await armWatcher();
    logger.error.mockClear();
    (orchestrator.restartApp as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('restart failed'));

    fs.writeFileSync(path.join(srcDir, 'broken.ts'), 'export const x = 1;');

    await waitForRestarts(1);
    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
    await vi.waitFor(
      () =>
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ app: 'test-app', error: 'restart failed' }),
          'Restart failed'
        ),
      { timeout: EVENT_TIMEOUT, interval: 25 }
    );
  });

  it('should detect .json file changes', async () => {
    const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();
    await armWatcher();

    fs.writeFileSync(path.join(srcDir, 'config.json'), '{"key": "value"}');

    await waitForRestarts(1);
    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
  });

  it('should resolve app root from bootstrap path using package.json', () => {
    const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    const watched = watcher.getWatchedApps();
    expect(watched[0]!.directory).toBe(appDir);
  });

  it('should work with classic mode script paths', async () => {
    const scriptPath = path.join(srcDir, 'main.ts');
    fs.writeFileSync(scriptPath, 'console.log("hello")');

    const config = createTestConfig([{ name: 'test-app', script: scriptPath }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    const watched = watcher.getWatchedApps();
    expect(watched).toHaveLength(1);
    expect(watched[0]!.name).toBe('test-app');
  });
});
