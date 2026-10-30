import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const boot = vi.hoisted(() => ({ start: vi.fn().mockResolvedValue(undefined), file: '', cwd: process.cwd() }));
vi.mock('../../src/daemon/daemon.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/daemon/daemon.js')>();
  return { ...original, OmnitronDaemon: class { start = boot.start; } };
});
vi.mock('../../src/commands/up.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/commands/up.js')>();
  return { ...original, readSavedDaemonConfig: () => original.readSavedDaemonConfig(boot.file), ensurePersistedJwtSecret: () => 'test-only' };
});
vi.mock('../../src/project/registry.js', () => ({ ProjectRegistry: { open: () => ({ autoDetect: () => null, list: () => [] }) } }));
vi.mock('../../src/config/loader.js', () => ({ loadDaemonBootConfig: async () => ({ apps: [] }) }));
vi.mock('../../src/shared/env-config.js', () => ({ getEnv: () => ({ OMNITRON_CWD: boot.cwd }) }));
vi.mock('../../src/daemon/pid-manager.js', () => ({ PidManager: class { isRunning() { return false; } cleanupStale() {} } }));

afterEach(() => vi.restoreAllMocks());

it('passes persisted readiness through the real detached entry point into daemon startup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-boot-'));
  boot.file = path.join(directory, 'config.json');
  const applicationReadiness = { 'project/live/core': { probes: [{ name: 'core', type: 'http', url: 'http://127.0.0.1:4722/health', expect: { status: 'ok' } }] } };
  fs.writeFileSync(boot.file, JSON.stringify({ role: 'slave', initialized: true, initializedAt: '2026-10-30', applicationReadiness }));
  const events = ['unhandledRejection', 'uncaughtExceptionMonitor'] as const;
  const listeners = events.map(event => process.listeners(event));
  vi.spyOn(process, 'chdir').mockImplementation(() => {});
  try {
    await import('../../src/daemon/daemon-entry.js');
    await vi.waitFor(() => expect(boot.start).toHaveBeenCalledOnce());
    expect(boot.start.mock.calls[0]?.[2]).toMatchObject({ role: 'slave', applicationReadiness });
    expect(boot.start.mock.calls[0]?.[1]).toMatchObject({ noWatch: true, watch: false });
  } finally {
    events.forEach((event, i) => process.listeners(event).forEach(listener => {
      if (!listeners[i]!.includes(listener)) process.removeListener(event, listener);
    }));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
