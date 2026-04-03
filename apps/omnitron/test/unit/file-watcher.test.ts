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

describe('FileWatcher', () => {
  let tmpDir: string;
  let appDir: string;
  let srcDir: string;
  let watcher: FileWatcher;
  let logger: ReturnType<typeof createMockLogger>;
  let orchestrator: ReturnType<typeof createMockOrchestrator>;

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
  });

  afterEach(() => {
    if (watcher) watcher.stop();
    // Clean up tmp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should watch app directory and detect file changes', async () => {
    const config = createTestConfig([{ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 100);
    watcher.start();

    const watched = watcher.getWatchedApps();
    expect(watched).toHaveLength(1);
    expect(watched[0]!.name).toBe('test-app');
    expect(watched[0]!.directory).toBe(appDir);
  });

  it('should trigger restart on .ts file change', async () => {
    const config = createTestConfig([{ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    // Modify a source file
    fs.writeFileSync(path.join(srcDir, 'service.ts'), 'export class Service {}');

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 300));

    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
  });

  it('should NOT trigger restart for node_modules changes', async () => {
    const config = createTestConfig([{ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') }]);

    const nodeModulesDir = path.join(appDir, 'node_modules', 'some-pkg');
    fs.mkdirSync(nodeModulesDir, { recursive: true });

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    // Let watcher settle (FSEvents may queue initial events)
    await new Promise((r) => setTimeout(r, 150));
    (orchestrator.restartApp as ReturnType<typeof vi.fn>).mockClear();

    // Write to node_modules
    fs.writeFileSync(path.join(nodeModulesDir, 'index.js'), 'module.exports = {}');

    await new Promise((r) => setTimeout(r, 300));

    expect(orchestrator.restartApp).not.toHaveBeenCalled();
  });

  it('should NOT trigger restart for dist directory changes', async () => {
    const config = createTestConfig([{ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') }]);

    const distDir = path.join(appDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    // Let watcher settle (FSEvents may queue initial events)
    await new Promise((r) => setTimeout(r, 150));
    (orchestrator.restartApp as ReturnType<typeof vi.fn>).mockClear();

    fs.writeFileSync(path.join(distDir, 'index.js'), 'exports = {}');

    await new Promise((r) => setTimeout(r, 300));

    expect(orchestrator.restartApp).not.toHaveBeenCalled();
  });

  it('should NOT trigger restart for non-watched extensions', async () => {
    const config = createTestConfig([{ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    // Let watcher settle (FSEvents may queue initial events)
    await new Promise((r) => setTimeout(r, 150));
    (orchestrator.restartApp as ReturnType<typeof vi.fn>).mockClear();

    // Write a .png file
    fs.writeFileSync(path.join(srcDir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await new Promise((r) => setTimeout(r, 300));

    expect(orchestrator.restartApp).not.toHaveBeenCalled();
  });

  it('should debounce rapid file changes into single restart', async () => {
    const config = createTestConfig([{ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 100);
    watcher.start();

    // Write multiple files rapidly
    fs.writeFileSync(path.join(srcDir, 'a.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(srcDir, 'b.ts'), 'export const b = 2;');
    fs.writeFileSync(path.join(srcDir, 'c.ts'), 'export const c = 3;');

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 400));

    // Should be called only once (debounced)
    expect(orchestrator.restartApp).toHaveBeenCalledTimes(1);
    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
  });

  it('should watch only specified apps when filtered', async () => {
    const app2Dir = path.join(tmpDir, 'other-app');
    const app2Src = path.join(app2Dir, 'src');
    fs.mkdirSync(app2Src, { recursive: true });
    fs.writeFileSync(path.join(app2Dir, 'package.json'), '{"name":"other-app"}');
    fs.writeFileSync(path.join(app2Src, 'main.ts'), 'export {}');

    const config = createTestConfig([
      { name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') },
      { name: 'other-app', bootstrap: path.join(app2Src, 'main.ts') },
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
      { name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts'), enabled: false },
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
    watcher.addApp({ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') });
    expect(watcher.getWatchedApps()).toHaveLength(1);

    // Dynamically remove
    watcher.removeApp('test-app');
    expect(watcher.getWatchedApps()).toHaveLength(0);
  });

  it('should stop all watchers on stop()', () => {
    const config = createTestConfig([{ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();
    expect(watcher.getWatchedApps()).toHaveLength(1);

    watcher.stop();
    expect(watcher.getWatchedApps()).toHaveLength(0);
  });

  it('should handle restart failure gracefully', async () => {
    const config = createTestConfig([{ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') }]);

    (orchestrator.restartApp as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('restart failed'));

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    fs.writeFileSync(path.join(srcDir, 'broken.ts'), 'export const x = 1;');

    await new Promise((r) => setTimeout(r, 300));

    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ app: 'test-app', error: 'restart failed' }),
      'Restart failed'
    );
  });

  it('should detect .json file changes', async () => {
    const config = createTestConfig([{ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') }]);

    watcher = new FileWatcher(logger as any, orchestrator as any, config, tmpDir, 50);
    watcher.start();

    fs.writeFileSync(path.join(srcDir, 'config.json'), '{"key": "value"}');

    await new Promise((r) => setTimeout(r, 300));

    expect(orchestrator.restartApp).toHaveBeenCalledWith('test-app');
  });

  it('should resolve app root from bootstrap path using package.json', () => {
    const config = createTestConfig([{ name: 'test-app', bootstrap: path.join(appDir, 'src', 'bootstrap.ts') }]);

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
