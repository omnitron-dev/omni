import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DomainError } from '@omnitron-dev/titan/errors';
import { DEFAULT_DAEMON_CONFIG, DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import type { BackendArtifact } from '../../src/daemon/backend-candidate.js';
import type { BackendBootRecord } from '../../src/daemon/backend-handoff-types.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import { BackendRecoveryJournal } from '../../src/daemon/backend-recovery-journal.js';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const mocks = vi.hoisted(() => ({
  daemon: vi.fn(), control: vi.fn(), candidate: vi.fn(), installation: vi.fn(),
  observe: vi.fn(), replacement: vi.fn(), disconnect: vi.fn(), adoption: vi.fn(),
  killFailure: new Map<string, Error>(),
  children: [] as Array<{ entry: string; child: ChildProcess; kill: ChildProcess['kill'] }>,
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: mocks.daemon }));
vi.mock('../../src/daemon/private-control-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/daemon/private-control-client.js')>(), privateControlClient: mocks.control,
}));
vi.mock('../../src/daemon/backend-candidate.js', () => ({
  checkBackendCandidate: mocks.candidate, assertBackendMigrationsCompatible: vi.fn(), verifyBackendEntry: vi.fn(), checkBackendAdoption: mocks.adoption,
}));
vi.mock('../../src/daemon/runtime-installation.js', async original => ({
  ...await original<typeof import('../../src/daemon/runtime-installation.js')>(),
  RuntimeInstallation: { open: mocks.installation },
}));
vi.mock('../../src/daemon/backend-child.js', () => ({ supervisesBackendChildren: () => false, observeBackendChild: vi.fn() }));
vi.mock('../../src/daemon/execution-client.js', () => ({ ExecutionClient: class {
  connect = mocks.observe;
  prepareReplacement = mocks.replacement;
  close = mocks.disconnect;
} }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, fork: (...args: Parameters<typeof actual.fork>) => {
    const child = actual.fork(...args);
    const entry = String(args[0]);
    mocks.children.push({ entry, child, kill: child.kill.bind(child) });
    const failure = mocks.killFailure.get(entry);
    if (failure) vi.spyOn(child, 'kill').mockImplementation(() => { throw failure; });
    return child;
  } };
});

const { replaceBackend, spawnReplacement, recoverBackend, abortBackendReplacement } = await import('../../src/daemon/backend-upgrade.js');
const roots: string[] = [];
const digest = 'c'.repeat(64);
const owner = { id: 'fixture-owner', pid: 123, startedAt: '2026-01-01T00:00:00.000Z' };

beforeEach(() => { vi.clearAllMocks(); mocks.adoption.mockReset().mockResolvedValue(undefined); mocks.killFailure.clear(); resetEnvCache(); });
afterEach(async () => {
  // Only harmless children allocated by this fixture. Retain the original kill
  // function so the injected refusal cannot obstruct fixture teardown.
  for (const { child, kill } of mocks.children.splice(0)) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, 'exit');
    kill('SIGKILL');
    await exited;
  }
  vi.restoreAllMocks(); resetEnvCache();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture(restoreReady = true) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'backend-failure-')));
  roots.push(root);
  const home = path.join(root, 'home'), execution = path.join(home, 'execution');
  await fs.mkdir(execution, { recursive: true, mode: 0o700 });
  const artifacts: BackendArtifact[] = [];
  for (const [index, name] of ['candidate', 'previous'].entries()) {
    const runtimeRoot = path.join(root, name), directory = path.join(runtimeRoot, 'packages/0/dist');
    const entry = path.join(directory, 'daemon/daemon-entry.js');
    await fs.mkdir(path.dirname(entry), { recursive: true });
    await fs.mkdir(path.join(directory, '../node_modules'));
    const require = createRequire(import.meta.url);
    await fs.symlink(path.dirname(require.resolve('tsx/package.json')), path.join(directory, '../node_modules/tsx'), 'dir');
    await fs.writeFile(path.join(directory, '../package.json'), '{"type":"module"}');
    const build = { commit: String(index + 1).repeat(40), dirty: false, builtAt: owner.startedAt, timeBasis: 'source' as const };
    // A real fork uses the ordinary IPC readiness boundary. No application,
    // owner, socket, Docker container or database is started by the child.
    await fs.writeFile(entry, `import fs from 'node:fs';
      const record = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
      setInterval(() => {}, 1000);
      process.send({type: 'backend-ready', pid: process.pid,
        build: ${JSON.stringify(index === 1 && restoreReady ? build : { ...build, commit: 'wrong-readiness-identity' })},
        execution: {owner: ${JSON.stringify(owner)}, epoch: record.state.ticket.to.epoch, phase: 'active'}});
    `);
    artifacts.push({ directory, entry, runtimeRoot, runtimeHash: String(index + 1).repeat(64), entryHash: 'a'.repeat(64),
      build, execPath: process.execPath });
  }
  const [candidate, previous] = artifacts as [BackendArtifact, BackendArtifact];
  const ticket = { id: 'initial-ticket', ownerId: owner.id,
    from: { ownerId: owner.id, controllerId: 'previous', epoch: 1 },
    to: { ownerId: owner.id, controllerId: 'candidate', epoch: 2 } };
  const record: BackendBootRecord = { protocol: 1, state: { protocol: 1, ticket,
    projects: { projects: [], stacks: [], infrastructure: [], resumeBackoff: [], reconciling: false },
    infrastructure: null, executionInventory: digest, watchConfig: { ...DEFAULT_ECOSYSTEM, apps: [] } },
    daemonConfig: { ...DEFAULT_DAEMON_CONFIG, pidFile: path.join(home, 'daemon.pid'), socketPath: path.join(home, 'public.sock'),
      executionHost: { enabled: true, directory: execution } },
    previousEntry: previous.entry, previousPid: 999999, createdAt: owner.startedAt, cwd: home,
    environment: { OMNITRON_HOME: home, PATH: process.env['PATH'] ?? '', TMPDIR: os.tmpdir() },
  };
  const checkpoint = path.join(execution, 'handoff-initial.json');
  await writePrivateRecord(checkpoint, record);
  const journal = new BackendRecoveryJournal(execution);
  journal.publish({ ...record, controller: ticket.from, runtimeHash: previous.runtimeHash, registryDigest: 'a'.repeat(64) });
  await journal.close();
  const complete = vi.fn(), select = vi.fn(), abort = vi.fn(), retire = vi.fn(), prepare = vi.fn(async () => ({ file: checkpoint, ticketId: ticket.id }));
  const beginActivation = vi.fn();
  mocks.candidate.mockImplementation(async directory => artifacts.find(item => item.directory === directory));
  mocks.control.mockResolvedValue({ service: {
    status: async () => ({ instanceHome: home, entry: previous.entry, pid: record.previousPid, runtime: { owner, epoch: 1 } }),
    prepare, retire, abort, complete,
  }, close: vi.fn() });
  mocks.daemon.mockReturnValue({ service: async () => ({ status: async () => ({ handoffSupported: true }),
    controlAddress: async () => ({ socket: path.join(execution, 'control.sock') }) }),
  status: async () => ({ pid: mocks.children.at(-1)!.child.pid, execution: { owner, epoch: 3 } }), disconnect: vi.fn() });
  mocks.installation.mockResolvedValue({ exclusive: async (work: () => Promise<unknown>) => work(), activation: () => null,
    install: async (runtimeRoot: string) => artifacts.find(item => item.runtimeRoot === runtimeRoot),
    selection: () => ({ current: previous.runtimeHash, revision: 1 }), select,
    writeLauncher: vi.fn(), beginActivation, close: vi.fn() });
  mocks.observe.mockResolvedValue({ inventoryDigest: digest });
  mocks.replacement.mockResolvedValue({ ...ticket, id: 'recovery-ticket', from: ticket.to,
    to: { ownerId: owner.id, controllerId: 'restored', epoch: 3 } });
  return { root, candidate, previous, checkpoint, record, complete, select, abort, prepare, retire, beginActivation };
}

it('honors a reviewed hold inside the lease before ordinary recovery or abort can dispatch', async () => {
  const target = await fixture();
  await writePrivateRecord(target.checkpoint, { ...target.record, previousPid: process.pid });
  await fs.writeFile(target.record.daemonConfig.pidFile, String(process.pid));
  const hold = { phase: 'unconfirmed', planId: 'private-fixture', planFile: '/fixture/plan' };
  mocks.installation.mockResolvedValue({ exclusive: (work: () => Promise<unknown>) => work(), close: vi.fn(),
    activation: () => ({ checkpoint: target.checkpoint, reviewedRecovery: hold }) });
  await expect(recoverBackend(target.checkpoint)).rejects.toThrow(/held for reviewed plan/);
  await expect(abortBackendReplacement(target.checkpoint)).rejects.toThrow(/held for reviewed plan/);
  expect(target.abort).not.toHaveBeenCalled();
  expect(mocks.observe).not.toHaveBeenCalled();
  expect(mocks.replacement).not.toHaveBeenCalled();
  expect(mocks.children).toHaveLength(0);
});

it('refuses a candidate adoption failure before draining the current backend', async () => {
  const target = await fixture();
  mocks.adoption.mockRejectedValueOnce(new Error('Native container specification differs'));
  await expect(replaceBackend(target.candidate.directory)).rejects.toThrow('Native container specification differs');
  expect(target.prepare).not.toHaveBeenCalled(); expect(target.retire).not.toHaveBeenCalled();
  expect(mocks.installation).not.toHaveBeenCalled(); expect(mocks.children).toHaveLength(0);
});

it('awaits the final receiving fence before creating any candidate child', async () => {
  const target = await fixture(), spawned = vi.fn(), refused = new Error('Reviewed owner changed during artifact validation');
  const beforeSpawn = vi.fn(async () => { throw refused; });
  await expect(spawnReplacement(target.candidate, target.checkpoint, target.record, spawned, beforeSpawn)).rejects.toBe(refused);
  expect(beforeSpawn).toHaveBeenCalledOnce(); expect(spawned).not.toHaveBeenCalled(); expect(mocks.children).toHaveLength(0);
});

it('reports a refused OS spawn without admitting a nonexistent backend or starting recovery twice', async () => {
  const target = await fixture(), spawned = vi.fn();
  const missingNode = path.join(target.root, 'unavailable-node');
  await expect(spawnReplacement({ ...target.candidate, execPath: missingNode }, target.checkpoint, target.record, spawned))
    .rejects.toMatchObject({ code: 'ENOENT' });
  expect(spawned).not.toHaveBeenCalled();
  expect(mocks.children).toHaveLength(1);
  expect(mocks.children[0]!.child.pid).toBeUndefined();
});

it('checks the frozen checkpoint again and aborts before retirement when adoption changes during drain', async () => {
  const target = await fixture();
  mocks.adoption.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Native resource changed during drain'));
  await expect(replaceBackend(target.candidate.directory)).rejects.toThrow('Native resource changed during drain');
  expect(mocks.adoption).toHaveBeenCalledTimes(2);
  expect(mocks.adoption.mock.calls[0]![1]).toMatchObject({ controller: target.record.state.ticket.from });
  expect(mocks.adoption.mock.calls[1]![1]).toMatchObject({ state: { ticket: target.record.state.ticket } });
  expect(target.abort).toHaveBeenCalledWith({ ticketId: target.record.state.ticket.id });
  expect(target.retire).not.toHaveBeenCalled(); expect(target.beginActivation).not.toHaveBeenCalled();
  expect(mocks.children).toHaveLength(0);
});

async function refused(target: Awaited<ReturnType<typeof fixture>>): Promise<DomainError> {
  const outcome = await replaceBackend(target.candidate.directory).then(() => null, error => error);
  expect(outcome).toBeInstanceOf(Error);
  // This is the original, real child readiness refusal. A rollback failure
  // must not replace it with only its own message in ordinary CLI output.
  expect((outcome as Error).message).toContain('readiness identity');
  return outcome as DomainError;
}

async function throughSharedOutput(error: DomainError): Promise<void> {
  const { serializer } = await import('@omnitron-dev/titan/netron');
  const decoded = serializer.decode(serializer.encode(error));
  expect(decoded).toMatchObject({ code: 500, domainCode: 'BACKEND_REPLACEMENT_FAILED', details: error.details });
  const { emitError } = await import('../../src/commands/output.js');
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
  const output: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { output.push(String(chunk)); return true; });
  expect(emitError(decoded)).toBe(true);
  expect(JSON.parse(output.join(''))).toEqual({ ok: false, code: 500, details: error.details, error: error.message });
}

it('retains the candidate failure when the real recovery inventory gate refuses its checkpoint', async () => {
  const target = await fixture();
  mocks.observe.mockResolvedValue({ inventoryDigest: 'd'.repeat(64) });
  const error = await refused(target);
  expect(error).toBeInstanceOf(DomainError);
  expect(error.domainCode).toBe('BACKEND_REPLACEMENT_FAILED');
  expect(error.details).toMatchObject({ checkpoint: target.checkpoint, recoveryCheckpoint: null, outcome: 'unconfirmed',
    failures: [{ phase: 'candidate', message: expect.stringContaining('readiness identity') },
      { phase: 'prepare-recovery', message: expect.stringContaining('inventory changed since this checkpoint') }] });
  expect(error.cause).toBeInstanceOf(AggregateError);
  expect((error.cause as AggregateError).errors).toHaveLength(2);
  expect(JSON.parse(await fs.readFile(target.checkpoint, 'utf8'))).toEqual(target.record);
  expect(mocks.replacement).not.toHaveBeenCalled(); expect(target.select).not.toHaveBeenCalled();
  expect(error.message).toContain('readiness identity');
  expect(error.message).toContain('inventory changed since this checkpoint');
  await throughSharedOutput(error);
});

it('retains a failed candidate stop and never starts recovery while that child is unconfirmed', async () => {
  const target = await fixture();
  const stopError = Object.assign(new Error('candidate termination refused'), { code: 'EPERM' });
  mocks.killFailure.set(target.candidate.entry, stopError);
  const error = await refused(target);
  expect(error.details.failures).toEqual([{ phase: 'candidate', message: expect.stringContaining('readiness identity') },
    { phase: 'stop-candidate', message: expect.stringContaining('candidate termination refused') }]);
  expect((error.cause as AggregateError).errors[1]).toBe(stopError);
  expect(mocks.observe).not.toHaveBeenCalled(); expect(mocks.children).toHaveLength(1);
});

it.each([false, true])('preserves restoration and optional cleanup failures together (stop refuses=%s)', async stopRefuses => {
  const target = await fixture(false);
  const stopError = new Error('restored child termination refused');
  if (stopRefuses) mocks.killFailure.set(target.previous.entry, stopError);
  const error = await refused(target);
  expect(error.details.failures.map((item: { phase: string }) => item.phase)).toEqual(
    stopRefuses ? ['candidate', 'restore', 'stop-restored'] : ['candidate', 'restore']);
  expect(error.details).toMatchObject({ checkpoint: target.checkpoint,
    recoveryCheckpoint: path.join(path.dirname(target.checkpoint), 'handoff-recovery-ticket.json'), outcome: 'unconfirmed' });
  expect((error.cause as AggregateError).errors).toHaveLength(stopRefuses ? 3 : 2);
  if (stopRefuses) expect((error.cause as AggregateError).errors[2]).toBe(stopError);
  expect(target.complete).not.toHaveBeenCalled(); expect(target.select).not.toHaveBeenCalled();
});

it.each(['complete-recovery', 'select-recovery'] as const)('keeps the candidate failure when %s fails after restoration readiness', async phase => {
  const target = await fixture();
  const finalizationError = new Error('durable recovery acknowledgement unavailable');
  (phase === 'complete-recovery' ? target.complete : target.select).mockRejectedValue(finalizationError);
  const error = await refused(target);
  expect(error.details.outcome).toBe('unconfirmed');
  expect(error.details.failures.map((item: { phase: string }) => item.phase)).toEqual(['candidate', phase]);
  expect((error.cause as AggregateError).errors[1]).toBe(finalizationError);
  expect(mocks.children.at(-1)!.child.exitCode).toBeNull();
  if (phase === 'complete-recovery') expect(target.select).not.toHaveBeenCalled();
});

it('reports confirmed rollback without hiding the original candidate refusal through Netron and JSON CLI output', async () => {
  const target = await fixture();
  const error = await refused(target);
  expect(error.details.outcome).toBe('restored');
  expect(error.details.failures).toEqual([{ phase: 'candidate', message: expect.stringContaining('readiness identity') }]);
  expect(target.complete).toHaveBeenCalledOnce(); expect(target.select).toHaveBeenCalledOnce();
  await throughSharedOutput(error);
});
