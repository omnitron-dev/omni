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
 * So the tests below inject events through the `watchDirectory` seam and
 * assert exactly. The last case pins the seam itself to `fs.watch` with a
 * spy, so it cannot silently stop matching reality — asserting the call
 * rather than waiting for an OS event, which is what kept this suite honest
 * without making it hostage to FSEvents' latency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileWatcher } from '../../src/orchestrator/file-watcher.js';
import type { IEcosystemConfig, IEcosystemAppEntry } from '../../src/config/types.js';
import type { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

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

  it('watches nothing when the entry file is not where the base says', () => {
    // The defect this guards. `bootstrap: './apps/storage/src/bootstrap.ts'`
    // is relative to the PROJECT root; when the entry carries no `cwd` the
    // base falls back to the daemon's cwd. Resolving against the wrong base
    // gives a path that does not exist — and walking UP from it finds the
    // first `package.json` on the way to the filesystem root, which was the
    // daemon's own package.
    //
    // Every DAOS app ended up watching `apps/omnitron`. One edit to
    // `src/commands/doctor.ts` restarted four of them in the same
    // millisecond, and editing their own sources restarted nothing.
    // The entry must be a path that does NOT exist but sits under a
    // directory that DOES have a package.json — that is what makes the walk
    // find something. A nonexistent path with no package.json above it fails
    // for a different reason and would let the defect through; the first
    // version of this test did exactly that and passed with the fix removed.
    const w = startWatcher(50, [
      { name: 'ghost', script: path.join(appDir, 'nested', 'no-such', 'main.ts') },
    ]);

    expect(w.watchedDirs, 'must not fall back to an ancestor package').toEqual([]);
    expect(w.getWatchedApps()).toEqual([]);
  });

  it('does not climb out of the app when the entry is real', () => {
    // The other half: a real entry must still resolve to its own package,
    // not to an ancestor that happens to have a package.json. `appDir` has
    // one; `tmpDir` above it does not, but the walk must stop at the first
    // either way.
    const w = startWatcher();
    expect(w.watchedDirs).toEqual([appDir]);
    expect(w.watchedDirs[0]).not.toBe(tmpDir);
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

  it('wires the seam to a real recursive fs.watch', () => {
    // Guards the seam: every test above talks to a substitute, so if
    // `watchDirectory` stopped calling `fs.watch` — or dropped `recursive` —
    // they would all still pass while the daemon watched nothing.
    //
    // This asserts the call rather than waiting for an event on purpose. The
    // earlier end-to-end version wrote a real file and waited, which made it
    // hostage to FSEvents: it needs hundreds of ms to arm and delivers
    // seconds late, so on a loaded machine it timed out at 30s and failed a
    // suite that had nothing wrong with it. Whether `fs.watch` delivers is
    // Node's contract to keep, not this repo's to re-verify on every run.
    //
    // That rewrite removed the wait and kept the real watcher, which left
    // most of the cost in place: tearing down a recursive FSEvents stream on
    // macOS is load-dependent, measured here between 0 ms idle and 19 s at
    // load 93, and it is paid in `afterEach`. The suite went on failing on a
    // 30 s hook timeout, now with an explanation that no longer described it.
    //
    // So the watcher is a stub. The seam — `fs.watch` called with this
    // directory, `recursive: true`, and a callback — is exactly what is
    // asserted, and it is asserted without asking the operating system for
    // anything.
    const fakeWatcher = { close: vi.fn(), on: vi.fn(), unref: vi.fn() } as unknown as fs.FSWatcher;
    const watchSpy = vi.spyOn(fs, 'watch').mockReturnValue(fakeWatcher);
    try {
      const config = createTestConfig([{ name: 'test-app', script: path.join(appDir, 'src', 'bootstrap.ts') }]);
      watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
      watcher.start();

      expect(watchSpy).toHaveBeenCalledTimes(1);
      const [dir, options] = watchSpy.mock.calls[0]!;
      expect(dir).toBe(appDir);
      expect(options).toMatchObject({ recursive: true });
      expect(typeof watchSpy.mock.calls[0]![2]).toBe('function');
    } finally {
      watchSpy.mockRestore();
    }
  });
});
