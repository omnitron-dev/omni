import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: '', directory: '', artifact: '', pid: 123 as number | null,
  hash: 'a'.repeat(64), certificateHash: '', certified: true, oldArtifact: '', oldHash: 'b'.repeat(64),
  checkpointObserved: undefined as (() => void) | undefined, leaseHeld: false, ownerError: '', artifactCalls: [] as string[], requirements: { stackControl: 1 } as Record<string, number> }));
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFileSync: vi.fn(),
}));
vi.mock('../../src/daemon/runtime-installation.js', () => ({ RuntimeInstallation: {
  open: async () => ({ directory: path.join(state.home, 'runtime'), activation: () => null,
    selection: () => ({ current: state.hash }), exclusive: async (work: () => unknown) => {
      if (state.leaseHeld) throw new Error('Another runtime operation');
      state.leaseHeld = true;
      try { return await work(); } finally { state.leaseHeld = false; }
    }, close: async () => {},
    artifact: async (hash: string) => {
      state.artifactCalls.push(hash);
      if (hash !== state.hash) {
        if (state.ownerError) throw new Error(state.ownerError);
        if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid runtime artifact hash');
        if (hash !== state.oldHash) throw new Error('Runtime artifact is not installed');
      }
      return { directory: hash === state.hash ? state.artifact : state.oldArtifact,
        execPath: hash === state.hash ? '/fixture/node-current' : '/fixture/node-owner',
        executionRequirements: state.requirements };
    },
  }),
} }));
vi.mock('../../src/commands/service-units.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/commands/service-units.js')>(),
  unitPathFor: (_platform: string, scope: string, _home: string, owner = false) =>
    path.join(state.home, 'native', scope, owner ? 'owner.unit' : 'backend.unit'),
}));
vi.mock('../../src/daemon/pid-manager.js', () => ({ PidManager: class {
  getPid() { return state.pid; } isRunning() { return state.pid !== null; }
} }));
vi.mock('../../src/daemon/backend-recovery-journal.js', () => ({ BackendRecoveryJournal: class {
  read() { state.checkpointObserved?.(); return state.certified ? { status: 'ready', record: { previousPid: 123, runtimeHash: state.certificateHash || state.hash,
    environment: { OMNITRON_HOME: state.home, OMNITRON_DATABASE_URL: 'fixture-daemon-database', PATH: '/fixture/bin' },
  } } : { status: 'invalid', reason: 'Application ownership is changing' }; }
  async close() {}
} }));

let root = '';
beforeEach(async () => {
  vi.resetModules();
  vi.mocked(execFileSync).mockReset().mockImplementation((_file, args) => {
    const label = String(args?.at(-1)).split('/').at(-1);
    if (_file === '/bin/launchctl') throw Object.assign(new Error('absent'), { status: 113, stderr: `Bad request.\nCould not find service "${label}" in domain for user gui: 501\n` });
    return 'LoadState=loaded\nActiveState=inactive\nSubState=dead\nJob=\nMainPID=0\n';
  });
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-service-plan-'));
  state.home = path.join(root, 'instance'); state.directory = path.join(root, 'execution');
  state.artifact = path.join(root, 'artifact/dist'); state.hash = 'a'.repeat(64); state.pid = 123; state.certified = true;
  state.oldArtifact = path.join(root, 'old-artifact/dist'); state.ownerError = ''; state.leaseHeld = false;
  state.artifactCalls = []; state.requirements = { stackControl: 1 }; state.certificateHash = '';
  await fs.mkdir(state.home, { mode: 0o700 });
  for (const artifact of [state.artifact, state.oldArtifact]) {
    await fs.mkdir(path.join(artifact, 'daemon'), { recursive: true });
    await fs.writeFile(path.join(artifact, 'daemon/managed-entry.js'), '');
    await fs.writeFile(path.join(artifact, 'package.json'), '{"type":"module"}');
    await fs.writeFile(path.join(artifact, 'daemon/execution-capabilities.js'), 'export const OWNER_CAPABILITIES = {stackControl:1};');
  }
  await fs.writeFile(path.join(state.home, 'config.json'), JSON.stringify({ role: 'master', executionHost: { enabled: true, directory: state.directory } }), { mode: 0o600 });
  vi.stubEnv('OMNITRON_HOME', state.home);
  vi.stubEnv('OMNITRON_DATABASE_URL', 'fixture-shell-database');
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
const inputs = () => ({ recoveryWaitMs: 0, scope: 'user' as const, execPath: '/fixture/node', entryPath: '/fixture/entry',
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

it('refuses an uncertified live environment and installation against a stale prepared release', async () => {
  const { prepareResidentService, installResidentService } = await import('../../src/commands/service-resident.js');
  state.certified = false;
  await expect(prepareResidentService(inputs())).rejects.toThrow('current backend recovery certificate');
  state.certified = true;
  await prepareResidentService(inputs());
  state.pid = null; state.hash = 'b'.repeat(64);
  await expect(installResidentService(inputs())).rejects.toThrow('no longer matches');
});


it('prepares distinct installed owner and guardian identities with their own native executables', async () => {
  const { prepareResidentService, installResidentService } = await import('../../src/commands/service-resident.js');
  const selected = { ...inputs(), ownerRuntime: state.oldHash };
  const active = await prepareResidentService(selected);
  expect(state.artifactCalls).toEqual([state.hash, state.oldHash]);
  expect(active.config.owner.artifact).toBe(state.oldHash);
  expect(active.config.backend.artifact).toBe(state.hash);
  expect(active.ownerUnit).toContain('/fixture/node-owner');
  expect(active.ownerUnit).toContain(path.join(state.oldArtifact, 'daemon/managed-entry.js'));
  expect(active.ownerUnit).not.toContain(state.artifact);
  expect(active.backendUnit).toContain('/fixture/node-current');
  expect(active.backendUnit).toContain(path.join(state.artifact, 'daemon/managed-entry.js'));
  expect(active.backendUnit).not.toContain(state.oldArtifact);
  state.pid = null;
  vi.stubEnv('OMNITRON_DATABASE_URL', 'unrelated-install-shell');
  const paused = await prepareResidentService(selected);
  expect(paused.config.environment).toEqual(active.config.environment);
  await expect(installResidentService(inputs())).rejects.toThrow('no longer matches');
  const saved = JSON.parse(await fs.readFile(path.join(active.planDirectory, 'supervision.json'), 'utf8'));
  expect(saved.owner.artifact).toBe(state.oldHash);
});

it('explicitly prepares a new owner after the pause without losing the reviewed private environment', async () => {
  const { prepareResidentService, installResidentService } = await import('../../src/commands/service-resident.js');
  const previous = await prepareResidentService({ ...inputs(), ownerRuntime: state.oldHash });
  // The reviewed private record can contain a secret absent from the shell and
  // outside the initial process-environment capture whitelist.
  previous.config.environment['APPLICATION_CREDENTIAL'] = 'fixture-reviewed-private-value';
  await fs.writeFile(path.join(previous.planDirectory, 'supervision.json'), JSON.stringify(previous.config), { mode: 0o600 });
  state.pid = null;
  vi.mocked(execFileSync).mockClear();
  const shell = process.env;
  process.env = {};
  let next: Awaited<ReturnType<typeof prepareResidentService>>;
  try {
    next = await prepareResidentService(inputs());
    await installResidentService(inputs());
  } finally { process.env = shell; }
  expect(next.config.owner.artifact).toBe(state.hash);
  expect(next.config.backend.artifact).toBe(state.hash);
  expect(next.config.environment).toEqual(previous.config.environment);
  expect(next.ownerUnit).toContain('/fixture/node-current');
  expect(next.ownerUnit).not.toContain('/fixture/node-owner');
  const active = JSON.parse(await fs.readFile(path.join(state.home, 'runtime/supervision.json'), 'utf8'));
  expect(active).toEqual(next.config);
});

it('explicitly prepares a newly selected backend while retaining the paused plan environment', async () => {
  const { prepareResidentService } = await import('../../src/commands/service-resident.js');
  const previous = await prepareResidentService(inputs());
  state.pid = null;
  state.hash = 'c'.repeat(64);
  vi.stubEnv('OMNITRON_DATABASE_URL', 'unrelated-paused-shell');
  const next = await prepareResidentService({ ...inputs(), ownerRuntime: state.oldHash });
  expect(next.config.backend.artifact).toBe(state.hash);
  expect(next.config.owner.artifact).toBe(state.oldHash);
  expect(next.config.environment).toEqual(previous.config.environment);
});

it('does not rewrite a reviewed plan or active files when installation requests another owner', async () => {
  const { prepareResidentService, installResidentService } = await import('../../src/commands/service-resident.js');
  const previous = await prepareResidentService({ ...inputs(), ownerRuntime: state.oldHash });
  state.pid = null;
  const file = path.join(previous.planDirectory, 'supervision.json');
  const before = await fs.readFile(file, 'utf8');
  vi.mocked(execFileSync).mockClear();
  await expect(installResidentService(inputs())).rejects.toThrow('no longer matches');
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  await expect(fs.access(path.join(state.home, 'runtime/supervision.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.access(path.join(state.home, 'native'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([
  ['protocol', (plan: Record<string, any>) => { plan['protocol'] = 2; }],
  ['instance', (plan: Record<string, any>) => { plan['instanceHome'] = '/another-instance'; }],
  ['directory', (plan: Record<string, any>) => { plan['directory'] = '/another-execution'; }],
  ['scope', (plan: Record<string, any>) => { plan['scope'] = 'system'; }],
  ['cwd', (plan: Record<string, any>) => { plan['cwd'] = 'relative'; }],
  ['owner hash', (plan: Record<string, any>) => { plan['owner'].artifact = '../runtime'; }],
  ['owner label', (plan: Record<string, any>) => { plan['owner'].label = 'dev.omnitron.other'; }],
  ['backend unit', (plan: Record<string, any>) => { plan['backend'].unit = 'omnitron-other.service'; }],
  ['environment array', (plan: Record<string, any>) => { plan['environment'] = []; }],
  ['environment null', (plan: Record<string, any>) => { plan['environment'] = null; }],
  ['environment value', (plan: Record<string, any>) => { plan['environment'].PATH = 1; }],
  ['environment home', (plan: Record<string, any>) => { plan['environment'].OMNITRON_HOME = '/another-instance'; }],
  ['environment NUL', (plan: Record<string, any>) => { plan['environment'].OMNITRON_TOKEN = 'bad\0value'; }],
])('refuses reuse of an invalid paused plan %s before overwriting it', async (_label, change) => {
  const { prepareResidentService, installResidentService } = await import('../../src/commands/service-resident.js');
  const previous = await prepareResidentService({ ...inputs(), ownerRuntime: state.oldHash });
  state.pid = null;
  const file = path.join(previous.planDirectory, 'supervision.json');
  const plan = JSON.parse(await fs.readFile(file, 'utf8')); change(plan);
  const invalid = JSON.stringify(plan); await fs.writeFile(file, invalid, { mode: 0o600 });
  for (const action of [prepareResidentService, installResidentService]) {
    await expect(action(inputs())).rejects.toThrow('Invalid saved service plan');
    expect(await fs.readFile(file, 'utf8')).toBe(invalid);
  }
  await expect(fs.access(path.join(state.home, 'runtime/supervision.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.access(path.join(state.home, 'native'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([null, [], 'invalid'])('refuses an existing malformed plan %j instead of replacing its environment', async value => {
  const { prepareResidentService, installResidentService } = await import('../../src/commands/service-resident.js');
  const previous = await prepareResidentService(inputs());
  state.pid = null;
  const file = path.join(previous.planDirectory, 'supervision.json');
  const invalid = JSON.stringify(value); await fs.writeFile(file, invalid, { mode: 0o600 });
  for (const action of [prepareResidentService, installResidentService]) {
    await expect(action(inputs())).rejects.toThrow('Invalid saved service plan');
    expect(await fs.readFile(file, 'utf8')).toBe(invalid);
  }
  await expect(fs.access(path.join(state.home, 'runtime/supervision.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('distinguishes missing active supervision from an existing JSON null record', async () => {
  const { readManagedRuntime } = await import('../../src/daemon/managed-runtime.js');
  await expect(readManagedRuntime(state.home)).resolves.toBeNull();
  const file = path.join(state.home, 'runtime/supervision.json');
  await fs.mkdir(path.dirname(file), { mode: 0o700 });
  await fs.writeFile(file, 'null', { mode: 0o600 });
  await expect(readManagedRuntime(state.home)).rejects.toThrow('Invalid independent supervision configuration');
  expect(await fs.readFile(file, 'utf8')).toBe('null');
});

it.each(['../owner', 'c'.repeat(64)])('refuses unknown or uninstalled owner %s before publishing a plan', async ownerRuntime => {
  const { prepareResidentService } = await import('../../src/commands/service-resident.js');
  await expect(prepareResidentService({ ...inputs(), ownerRuntime })).rejects.toThrow(/hash|not installed/);
  expect(state.artifactCalls).toEqual([state.hash, ownerRuntime]);
  await expect(fs.access(path.join(state.home, 'runtime/supervision-plan'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['Runtime artifact checksum differs', 'Runtime artifact targets a different platform'])('propagates ordinary owner artifact verification refusal: %s', async reason => {
  const { prepareResidentService } = await import('../../src/commands/service-resident.js');
  state.ownerError = reason;
  await expect(prepareResidentService({ ...inputs(), ownerRuntime: state.oldHash })).rejects.toThrow(reason);
  await expect(fs.access(path.join(state.home, 'runtime/supervision-plan'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([
  ['export const OWNER_CAPABILITIES = {stackControl:2};', 'lacks required capabilities'],
  ['export const OWNER_CAPABILITIES = {stackControl:"1"};', 'Invalid execution capability'],
  ['export const unrelated = true;', 'no execution capability declaration'],
])('refuses an owner capability declaration without publishing: %s', async (source, reason) => {
  const { prepareResidentService } = await import('../../src/commands/service-resident.js');
  await fs.writeFile(path.join(state.oldArtifact, 'daemon/execution-capabilities.js'), source);
  await expect(prepareResidentService({ ...inputs(), ownerRuntime: state.oldHash })).rejects.toThrow(reason);
  await expect(fs.access(path.join(state.home, 'runtime/supervision-plan'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('checks backend requirements against the selected owner rather than this command package', async () => {
  const { prepareResidentService } = await import('../../src/commands/service-resident.js');
  state.requirements = { stackControl: 1, installedStackStart: 1 };
  await expect(prepareResidentService({ ...inputs(), ownerRuntime: state.oldHash })).rejects.toThrow('installedStackStart@1');
});

it('rejects an owner selection outside resident mode before stopping any daemon', async () => {
  await fs.writeFile(path.join(state.home, 'config.json'), JSON.stringify({ role: 'master', executionHost: { enabled: false } }), { mode: 0o600 });
  const { serviceInstall } = await import('../../src/commands/service.js');
  await expect(serviceInstall({ scope: 'user', ownerRuntime: state.oldHash })).rejects.toThrow('requires independent resident execution');
  expect(state.artifactCalls).toEqual([]);
});


it('keeps the installation lease through both active unit writes and refuses concurrent selection', async () => {
  const { installResidentService } = await import('../../src/commands/service-resident.js');
  const { RuntimeInstallation } = await import('../../src/daemon/runtime-installation.js');
  state.pid = null;
  const write = fs.writeFile.bind(fs);
  const activeWrites: string[] = [];
  vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
    if (String(args[0]).startsWith(path.join(state.home, 'native'))) {
      activeWrites.push(String(args[0]));
      expect(state.leaseHeld).toBe(true);
      const other = await RuntimeInstallation.open();
      await expect(other!.exclusive(async () => { state.hash = 'c'.repeat(64); })).rejects.toThrow('Another runtime operation');
    }
    return write(...args);
  });
  await installResidentService({ ...inputs(), ownerRuntime: state.oldHash });
  expect(activeWrites).toHaveLength(2);
  expect(state.hash).toBe('a'.repeat(64));
  expect(state.leaseHeld).toBe(false);
});


it.each(['loaded', 'query-error'])('refuses native job %s despite absent PIDs, without writing active files', async mode => {
  const { installResidentService } = await import('../../src/commands/service-resident.js');
  state.pid = null;
  vi.mocked(execFileSync).mockImplementation(() => {
    if (mode === 'query-error') throw Object.assign(new Error('Permission denied'), { status: 1 });
    return 'state = waiting';
  });
  await expect(installResidentService(inputs())).rejects.toThrow(/native service/);
  await expect(fs.access(path.join(state.home, 'native/user/owner.unit'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.access(path.join(state.home, 'runtime/supervision.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([
  'LoadState=loaded\nActiveState=activating\nSubState=auto-restart\nJob=\nMainPID=0',
  'LoadState=loaded\nActiveState=inactive\nSubState=dead\nJob=42\nMainPID=0',
  'LoadState=loaded\nActiveState=inactive\nSubState=dead\nJob=\nMainPID=123',
  'LoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0',
  'LoadState=error\nActiveState=inactive\nSubState=dead\nJob=\nMainPID=0',
])('rejects unconfirmed systemd shutdown: %s', async output => {
  const { assertResidentServicesStopped } = await import('../../src/commands/service-resident.js');
  vi.mocked(execFileSync).mockReturnValue(output);
  expect(() => assertResidentServicesStopped('user', 'linux')).toThrow('Stop native service');
});

it.each(['loaded', 'not-found'])('accepts explicit inactive systemd %s units with no pending job', async load => {
  const { assertResidentServicesStopped } = await import('../../src/commands/service-resident.js');
  vi.mocked(execFileSync).mockReturnValue(`LoadState=${load}\nActiveState=inactive\nSubState=dead\nJob=\nMainPID=0\n`);
  expect(() => assertResidentServicesStopped('system', 'linux')).not.toThrow();
  expect(vi.mocked(execFileSync).mock.calls.every(call => !call[1]?.includes('--user'))).toBe(true);
});

it('refuses ambiguous launchd and systemd query errors even if their payload resembles absence', async () => {
  const { assertResidentServicesStopped } = await import('../../src/commands/service-resident.js');
  vi.mocked(execFileSync).mockImplementation(() => { throw Object.assign(new Error('unknown'), { status: 113, stderr: 'Could not find domain' }); });
  expect(() => assertResidentServicesStopped('user', 'darwin')).toThrow('Cannot establish');
  vi.mocked(execFileSync).mockImplementation(() => { throw Object.assign(new Error('unknown'), { status: 1, stdout: 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nJob=\nMainPID=0' }); });
  expect(() => assertResidentServicesStopped('user', 'linux')).toThrow('Cannot establish');
});


it('passes explicit owner selection through the public prepare command without active writes', async () => {
  const { serviceInstall } = await import('../../src/commands/service.js');
  await serviceInstall({ scope: 'user', prepare: true, ownerRuntime: state.oldHash });
  expect(state.artifactCalls).toEqual([state.hash, state.oldHash]);
  const saved = JSON.parse(await fs.readFile(path.join(state.home, 'runtime/supervision-plan/supervision.json'), 'utf8'));
  expect(saved.owner.artifact).toBe(state.oldHash);
  expect(saved.backend.artifact).toBe(state.hash);
  await expect(fs.access(path.join(state.home, 'runtime/supervision.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(vi.mocked(execFileSync).mock.calls.filter(call =>
    String(call[0]).endsWith('launchctl') || String(call[0]).endsWith('systemctl'))).toEqual([]);
});

it('waits for checkpoint publication outside the installation lease and revalidates before writing', async () => {
  const { prepareResidentService } = await import('../../src/commands/service-resident.js');
  state.certified = false;
  let heldWhileWaiting: boolean | undefined;
  state.checkpointObserved = () => {
    state.checkpointObserved = undefined;
    setImmediate(() => { heldWhileWaiting = state.leaseHeld; state.certified = true; });
  };
  try {
    const plan = await prepareResidentService({ ...inputs(), recoveryWaitMs: 1000 });
    expect(heldWhileWaiting).toBe(false);
    expect(plan.config.environment['OMNITRON_DATABASE_URL']).toBe('fixture-daemon-database');
  } finally { state.checkpointObserved = undefined; }
});

it('explains checkpoint refusal and writes no partial service plan', async () => {
  const { prepareResidentService } = await import('../../src/commands/service-resident.js');
  state.certified = false;
  await expect(prepareResidentService(inputs())).rejects.toThrow('Application ownership is changing');
  await expect(fs.access(path.join(state.home, 'runtime/supervision-plan/supervision.json'))).rejects.toThrow();
});

it('rejects a checkpoint from a different runtime even when its process ID matches', async () => {
  const { prepareResidentService } = await import('../../src/commands/service-resident.js');
  state.certificateHash = state.oldHash;
  await expect(prepareResidentService(inputs())).rejects.toThrow('does not match the selected runtime');
  await expect(fs.access(path.join(state.home, 'runtime/supervision-plan/supervision.json'))).rejects.toThrow();
});
