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
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const mocks = vi.hoisted(() => ({
  daemon: vi.fn(), control: vi.fn(), candidate: vi.fn(), installation: vi.fn(),
  observe: vi.fn(), replacement: vi.fn(), disconnect: vi.fn(),
  killFailure: new Map<string, Error>(),
  children: [] as Array<{ entry: string; child: ChildProcess; kill: ChildProcess['kill'] }>,
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: mocks.daemon }));
vi.mock('../../src/daemon/private-control-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/daemon/private-control-client.js')>(), privateControlClient: mocks.control,
}));
vi.mock('../../src/daemon/backend-candidate.js', () => ({
  checkBackendCandidate: mocks.candidate, assertBackendMigrationsCompatible: vi.fn(), verifyBackendEntry: vi.fn(),
}));
vi.mock('../../src/daemon/runtime-installation.js', () => ({ RuntimeInstallation: { open: mocks.installation } }));
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

const { replaceBackend } = await import('../../src/daemon/backend-upgrade.js');
const roots: string[] = [];
const digest = 'c'.repeat(64);
const owner = { id: 'fixture-owner', pid: 123, startedAt: '2026-01-01T00:00:00.000Z' };

beforeEach(() => { vi.clearAllMocks(); mocks.killFailure.clear(); resetEnvCache(); });
afterEach(async () => {
  // Only harmless children allocated by this fixture. Retain the original kill
  // function so the injected refusal cannot obstruct fixture teardown.
  for (const { child, kill } of mocks.children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
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
  const complete = vi.fn(), select = vi.fn(), abort = vi.fn();
  mocks.candidate.mockImplementation(async directory => artifacts.find(item => item.directory === directory));
  mocks.control.mockResolvedValue({ service: {
    status: async () => ({ instanceHome: home, entry: previous.entry, pid: record.previousPid }),
    prepare: async () => ({ file: checkpoint, ticketId: ticket.id }), retire: vi.fn(), abort, complete,
  }, close: vi.fn() });
  mocks.daemon.mockReturnValue({ service: async () => ({ status: async () => ({ handoffSupported: true }),
    controlAddress: async () => ({ socket: path.join(execution, 'control.sock') }) }),
  status: async () => ({ pid: mocks.children.at(-1)!.child.pid, execution: { owner, epoch: 3 } }), disconnect: vi.fn() });
  mocks.installation.mockResolvedValue({ exclusive: async (work: () => Promise<unknown>) => work(), activation: () => null,
    install: async (runtimeRoot: string) => artifacts.find(item => item.runtimeRoot === runtimeRoot),
    selection: () => ({ current: previous.runtimeHash, revision: 1 }), select,
    writeLauncher: vi.fn(), beginActivation: vi.fn(), close: vi.fn() });
  mocks.observe.mockResolvedValue({ inventoryDigest: digest });
  mocks.replacement.mockResolvedValue({ ...ticket, id: 'recovery-ticket', from: ticket.to,
    to: { ownerId: owner.id, controllerId: 'restored', epoch: 3 } });
  return { root, candidate, previous, checkpoint, record, complete, select, abort };
}

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
