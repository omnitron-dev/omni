/**
 * FileWatcher behaviour.
 *
 * ## Why these tests drive a fake watcher
 *
 * What is worth testing here is this class's logic: which paths it ignores,
 * how it debounces, and what happens to changes that land while a restart is
 * in flight. What is NOT worth testing is `fs.watch`.
 *
 * On macOS `fs.watch(dir, { recursive: true })` is FSEvents, and it behaves
 * nothing like inotify: the stream needs a few hundred milliseconds to arm
 * (writes before that are dropped outright, never delivered late), and
 * steady-state delivery then lags by seconds — 3.6s in one measured run
 * under load.
 *
 * The earlier version of this file wrote real files and slept 300ms. On macOS
 * that meant the four "should trigger restart" cases failed every run, and —
 * worse — the three "should NOT trigger restart" cases passed for the wrong
 * reason: they sampled the mock before delivery, so they would have passed
 * just as happily if the watcher restarted on every `node_modules`, `dist`
 * and `.png` write. Two carried `retry: 2` and a comment blaming FS timing,
 * which is how a vacuous test survives.
 *
 * So the unit tests below inject events through the `watchDirectory` seam and
 * assert exactly. One end-to-end case at the bottom still uses the real
 * `fs.watch`, so the seam itself cannot silently stop matching reality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileWatcher } from '../../src/orchestrator/file-watcher.js';
import type { IEcosystemConfig, IEcosystemAppEntry } from '../../src/config/types.js';
import type { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

/** Generous enough for FSEvents' arm + delivery latency under load. */
const REAL_FS_TIMEOUT = 30_000;

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

/**
 * A FileWatcher whose platform watcher is a hand-driven emitter.
 *
 * `emit()` delivers the change synchronously, the way inotify effectively
 * does, so a test can assert on the debounce window without racing the OS.
 */
class TestFileWatcher extends FileWatcher {
  public watchedDirs: string[] = [];
  private handlers = new Map<string, (eventType: string, filename: string | null) => void>();

  protected override watchDirectory(
    dir: string,
    onEvent: (eventType: string, filename: string | null) => void
  ): fs.FSWatcher {
    this.watchedDirs.push(dir);
    this.handlers.set(dir, onEvent);
    return { close: () => this.handlers.delete(dir), on: () => undefined } as unknown as fs.FSWatcher;
  }

  /** Deliver a change for `relativePath` under the first watched directory. */
  emit(relativePath: string, eventType = 'change'): void {
    const handler = [...this.handlers.values()][0];
    if (!handler) throw new Error('no directory is being watched');
    handler(eventType, relativePath);
  }
}

describe('FileWatcher', () => {
  let tmpDir: string;
  let appDir: string;
  let srcDir: string;
  let watcher: FileWatcher;
  let logger: ReturnType<typeof createMockLogger>;
  let orchestrator: ReturnType<typeof createMockOrchestrator>;

  const restartMock = () => orchestrator.restartApp as ReturnType<typeof vi.fn>;

  /** Let the debounce timer fire and the async restart chain settle. */
  async function settle(debounceMs = 50): Promise<void> {
    await new Promise((r) => setTimeout(r, debounceMs + 150));
  }

  function startWatcher(debounceMs = 50, apps?: IEcosystemAppEntry[]): TestFileWatcher {
    const config = createTestConfig(
      apps ?? [{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]
    );
    const w = new TestFileWatcher(logger as any, orchestrator as any, config, tmpDir, debounceMs);
    watcher = w;
    w.start();
    return w;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-watcher-test-'));
    appDir = path.join(tmpDir, 'test-app');
    srcDir = path.join(appDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'package.json'), '{"name":"test-app"}');
    fs.writeFileSync(path.join(srcDir, 'bootstrap.ts'), 'export default {}');

    logger = createMockLogger();
    orchestrator = createMockOrchestrator();
  });

  afterEach(() => {
    if (watcher) watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- Registration ------------------------------------------------------

  it('watches the app directory resolved from its entry point', () => {
    const w = startWatcher();

    expect(w.getWatchedApps()).toEqual([{ name: 'test-app', directory: appDir }]);
    expect(w.watchedDirs).toEqual([appDir]);
  });

  it('watches only the named apps when a filter is given', () => {
    const app2Dir = path.join(tmpDir, 'other-app');
    const app2Src = path.join(app2Dir, 'src');
    fs.mkdirSync(app2Src, { recursive: true });
    fs.writeFileSync(path.join(app2Dir, 'package.json'), '{"name":"other-app"}');
    fs.writeFileSync(path.join(app2Src, 'main.ts'), 'export {}');

    const config = createTestConfig([
      { name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') },
      { name: 'other-app', script: path.join(app2Src, 'main.ts') },
    ]);
    const w = new TestFileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher = w;
    w.start(['test-app']);

    expect(w.getWatchedApps()).toHaveLength(1);
    expect(w.getWatchedApps()[0]!.name).toBe('test-app');
  });

  it('skips apps with no entry point and says so', () => {
    startWatcher(50, [{ name: 'no-entry' } as IEcosystemAppEntry]);

    expect(watcher.getWatchedApps()).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ app: 'no-entry' }),
      expect.stringContaining('skipping watch')
    );
  });

  it('skips disabled apps', () => {
    startWatcher(50, [
      { name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts'), enabled: false },
    ]);
    expect(watcher.getWatchedApps()).toHaveLength(0);
  });

  it('adds and removes apps at runtime', () => {
    startWatcher(50, []);
    expect(watcher.getWatchedApps()).toHaveLength(0);

    watcher.addApp({ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') });
    expect(watcher.getWatchedApps()).toHaveLength(1);

    watcher.removeApp('test-app');
    expect(watcher.getWatchedApps()).toHaveLength(0);
  });

  it('drops every watcher on stop()', () => {
    startWatcher();
    expect(watcher.getWatchedApps()).toHaveLength(1);

    watcher.stop();
    expect(watcher.getWatchedApps()).toHaveLength(0);
  });

  // --- What triggers a restart -------------------------------------------

  it('restarts on a .ts change', async () => {
    const w = startWatcher();
    w.emit('src/service.ts');
    await settle();

    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
  });

  it('restarts on a .json change', async () => {
    const w = startWatcher();
    w.emit('src/config.json');
    await settle();

    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
  });

  it.each([
    ['node_modules/some-pkg/index.js', 'node_modules'],
    ['dist/index.js', 'dist'],
    ['.git/HEAD', 'a dotted directory'],
    ['coverage/lcov.info', 'coverage'],
    ['src/logo.png', 'an unwatched extension'],
    ['src/notes.md', 'an unwatched extension'],
    ['src/no-extension', 'no extension at all'],
  ])('does not restart for %s (%s)', async (changedPath) => {
    const w = startWatcher();
    w.emit(changedPath);
    await settle();

    expect(orchestrator.restartApp).not.toHaveBeenCalled();
  });

  it('debounces a burst into a single restart', async () => {
    const w = startWatcher(80);
    w.emit('src/a.ts');
    w.emit('src/b.ts');
    w.emit('src/c.ts');
    await settle(80);

    expect(restartMock().mock.calls.length).toBe(1);
    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
  });

  it('logs a failed restart instead of throwing', async () => {
    restartMock().mockRejectedValueOnce(new Error('restart failed'));
    const w = startWatcher();

    w.emit('src/broken.ts');
    await settle();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ app: 'test-app', error: 'restart failed' }),
      'Restart failed'
    );
  });

  // --- The in-flight queue -----------------------------------------------

  it('does not drop changes that arrive while a restart is in flight', async () => {
    // `triggerRestart` used to `clear()` the pending set when it found a
    // restart already running — the exact opposite of the hand-off its own
    // `finally` block implements, which only re-triggers when the set is
    // non-empty. An edit saved during a restart was therefore lost silently
    // and the app kept running the previous code.
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((started) => {
      restartMock().mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            started();
            releaseFirst = done;
          })
      );
    });

    const w = startWatcher();
    w.emit('src/first.ts');
    await firstStarted;

    // Arrives while the first restart is still running.
    w.emit('src/during-restart.ts');
    await settle();
    expect(restartMock().mock.calls.length).toBe(1);

    releaseFirst();
    await settle();

    expect(restartMock().mock.calls.length).toBe(2);
  });

  // --- The seam matches reality ------------------------------------------

  it(
    'restarts on a real filesystem write (end-to-end, no seam)',
    { timeout: REAL_FS_TIMEOUT + 5_000 },
    async () => {
      // Guards the seam: if `watchDirectory` ever stopped wiring `fs.watch`
      // correctly, every test above would still pass. Written as a retry loop
      // because FSEvents drops writes issued before its stream arms, so a
      // single write proves nothing on macOS.
      const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);
      watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
      watcher.start();

      await vi.waitFor(
        async () => {
          fs.writeFileSync(path.join(srcDir, `real-${Date.now()}.ts`), 'export const real = 1;');
          await new Promise((r) => setTimeout(r, 250));
          expect(restartMock().mock.calls.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: REAL_FS_TIMEOUT, interval: 300 }
      );

      expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
    }
  );
});
