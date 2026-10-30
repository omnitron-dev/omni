import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: '', directory: '', artifact: '', pid: 123 as number | null,
  hash: 'a'.repeat(64), certified: true }));
vi.mock('../../src/daemon/runtime-installation.js', () => ({ RuntimeInstallation: {
  open: async () => ({ directory: path.join(state.home, 'runtime'), activation: () => null,
    selection: () => ({ current: state.hash }), exclusive: (work: () => unknown) => work(), close: async () => {},
    artifact: async () => ({ directory: state.artifact, execPath: '/fixture/node' }),
  }),
} }));
vi.mock('../../src/daemon/pid-manager.js', () => ({ PidManager: class {
  getPid() { return state.pid; } isRunning() { return state.pid !== null; }
} }));
vi.mock('../../src/daemon/backend-recovery-journal.js', () => ({ BackendRecoveryJournal: class {
  read() { return state.certified ? { status: 'ready', record: { previousPid: 123,
    environment: { OMNITRON_HOME: state.home, OMNITRON_DATABASE_URL: 'fixture-daemon-database', PATH: '/fixture/bin' },
  } } : { status: 'invalid' }; }
  async close() {}
} }));

let root = '';
beforeEach(async () => {
  vi.resetModules();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-service-plan-'));
  state.home = path.join(root, 'instance'); state.directory = path.join(root, 'execution');
  state.artifact = path.join(root, 'artifact/dist'); state.hash = 'a'.repeat(64); state.pid = 123; state.certified = true;
  await fs.mkdir(state.home, { mode: 0o700 });
  await fs.mkdir(path.join(state.artifact, 'daemon'), { recursive: true });
  await fs.writeFile(path.join(state.artifact, 'daemon/managed-entry.js'), '');
  await fs.writeFile(path.join(state.home, 'config.json'), JSON.stringify({ role: 'master', executionHost: { enabled: true, directory: state.directory } }), { mode: 0o600 });
  vi.stubEnv('OMNITRON_HOME', state.home);
  vi.stubEnv('OMNITRON_DATABASE_URL', 'fixture-shell-database');
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
const inputs = () => ({ scope: 'user' as const, execPath: '/fixture/node', entryPath: '/fixture/entry',
  workdir: root, path: '/usr/bin:/bin', stderrLog: path.join(root, 'stderr.log') });

it('preserves the certified daemon environment across the controlled initial pause', async () => {
  const { prepareResidentService, installResidentService } = await import('../../src/commands/service-resident.js');
  const active = await prepareResidentService(inputs());
  expect(active.config.environment['OMNITRON_DATABASE_URL']).toBe('fixture-daemon-database');
  await expect(installResidentService(inputs())).rejects.toThrow('controlled initial shutdown');
  state.pid = null;
  vi.stubEnv('OMNITRON_DATABASE_URL', 'different-installing-shell');
  const paused = await prepareResidentService(inputs());
  expect(paused.config.environment).toEqual(active.config.environment);
  expect(paused.ownerUnit).not.toContain('--import');
});

it('refuses an uncertified live environment and a stale prepared release', async () => {
  const { prepareResidentService } = await import('../../src/commands/service-resident.js');
  state.certified = false;
  await expect(prepareResidentService(inputs())).rejects.toThrow('current backend recovery certificate');
  state.certified = true;
  await prepareResidentService(inputs());
  state.pid = null; state.hash = 'b'.repeat(64);
  await expect(prepareResidentService(inputs())).rejects.toThrow('no longer matches');
});
