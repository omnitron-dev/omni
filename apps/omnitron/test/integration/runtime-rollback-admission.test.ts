import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Netron } from '@omnitron-dev/titan/netron';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
import { expect, it, vi } from 'vitest';
import { runtimeArtifactDigest } from '../../src/shared/runtime-artifact.js';
import { runtimeUpdatePlanDigest } from '../../src/daemon/runtime-update.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import type { RuntimeUpdatePlan } from '../../src/shared/dto/runtime-update.js';
import type { BackendHandoffAdmission } from '../../src/daemon/backend-handoff-types.js';
import { FlowRuntime } from '../../src/flows/flow-runtime.js';
import { FlowLedger } from '../../src/flows/flow-ledger.js';
import { diskSpaceFlow, type FlowDefinition } from '../../src/shared/dto/flows.js';

async function installController(home: string, formats?: Record<string, number>) {
  const { RuntimeInstallation } = await import('../../src/daemon/runtime-installation.js');
  const registry = (await RuntimeInstallation.open(home))!;
  try {
    const source = path.join(home, 'controller');
    const shared = path.join(source, 'packages/0/dist/shared');
    await fs.mkdir(shared, { recursive: true });
    if (formats) await fs.writeFile(path.join(shared, 'controller-journal-formats.json'), JSON.stringify(formats));
    const sha256 = await runtimeArtifactDigest(source);
    await fs.writeFile(
      path.join(source, 'RUNTIME.json'),
      JSON.stringify({ protocol: 1, sha256, platform: process.platform, arch: process.arch })
    );
    await fs.rename(source, registry.releasePath(sha256));
    return sha256;
  } finally {
    await registry.close();
  }
}

it('settles an admitted receiver before the writer drain and leaves the next delivery queued until release', async () => {
  const db = openSqliteDatabase(':memory:');
  const ledger = new FlowLedger(db);
  const binding = { identity: 'fixture', target: null };
  const workspace = { project: null };
  const definition: FlowDefinition = {
    version: 1,
    name: 'Review',
    nodes: [
      { id: 'start', type: 'input.manual@1', config: {} },
      {
        id: 'review',
        type: 'output.studio@1',
        config: { threadId: randomUUID(), memberId: randomUUID(), task: 'Review sample' },
      },
    ],
    edges: [{ from: 'start', port: 'event', to: 'review' }],
  };
  const ref = { id: randomUUID(), workspace, expectedRevision: null, definition };
  const draft = ledger.save(ref, binding);
  const active = ledger.change(
    { ...ref, revision: draft.revision, activation: null },
    { actor: 'reviewer', session: 'fixture' },
    binding
  ).active!;
  const submit = (id: string) =>
    ledger.submit(ref, active.id, { id, source: 'start', type: 'manual', data: {} }).deliveries[0]!.id;
  const first = submit('first');
  const started = Promise.withResolvers<void>(),
    ack = Promise.withResolvers<void>();
  const dispatched: string[] = [];
  const runtime = new FlowRuntime(ledger, {
    scope: async () => binding,
    admit: async () => {},
    report: vi.fn(),
    deliver: async (entry, check) => {
      check(true);
      dispatched.push(entry.row.id);
      started.resolve();
      await ack.promise;
      return entry.row.id;
    },
  });
  try {
    const tick = runtime.tick();
    await started.promise;
    const next = submit('next');
    let held = false;
    const drain = runtime.pauseAndDrain().then(() => {
      held = true;
    });
    await runtime.tick();
    expect(held).toBe(false);
    ack.resolve();
    await Promise.all([drain, tick]);
    expect(ledger.delivery(first).public).toMatchObject({ status: 'delivered', result: first });
    expect(ledger.delivery(next).row.status).toBe('pending');
    expect(dispatched).toEqual([first]);
    runtime.resume();
    await runtime.tick();
    expect(dispatched).toEqual([first, next]);
  } finally {
    ack.resolve();
    await runtime.dispose();
    db.close();
  }
});

it('drains a real in-flight request, refuses its late journal or worker change, and releases only the owning rollback', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cold-source-'));
  vi.stubEnv('OMNITRON_HOME', home);
  vi.stubEnv('OMNITRON_SOCKET', path.join(home, 'daemon.sock'));
  vi.resetModules();
  try {
    const { OmnitronDaemon } = await import('../../src/daemon/daemon.js');
    const legacy = await installController(home);
    await fs.mkdir(path.join(home, 'data'), { recursive: true });
    const db = openSqliteDatabase(path.join(home, 'data/daemon-state.db'));
    const netron = new Netron(createNullLogger(), { id: 'rollback-fixture' });
    const apps: Array<{ info: { name: string; status: string } }> = [];
    const daemon = Object.assign(Object.create(OmnitronDaemon.prototype), {
      app: { netron },
      execution: {
        controlledOwnerSnapshot: async () => ({
          status: { owner: { id: 'owner', pid: 42 }, inFlight: 0 },
          apps,
          workers: [],
          watchedApps: [],
        }),
      },
      backendRuntimeStatus: () => ({ blockers: {} }),
    }) as InstanceType<typeof OmnitronDaemon>;
    const target = 'd'.repeat(64);
    const plan = {
      protocol: 1,
      instance: home,
      target: { artifact: target },
      before: { backend: legacy },
      stacks: [],
      watches: [],
    } as unknown as RuntimeUpdatePlan;
    const digest = runtimeUpdatePlanDigest(plan);
    const attempt = randomUUID();
    await writePrivateRecord(path.join(home, 'runtime/local-updates/current.json'), {
      protocol: 1,
      phase: 'stopping-candidate',
      plan,
      digest,
      updatedAt: new Date().toISOString(),
      rollbackOwner: {
        ownerId: 'owner',
        ownerPid: 42,
        backend: target,
        backendPid: process.pid,
        retiredPids: [process.pid],
      },
    });
    try {
      db.exec('CREATE TABLE flow_definitions(active TEXT); CREATE TABLE flow_deliveries(status TEXT)');
      expect(netron.inbound.enter()).toBe(true);
      const rejected = expect(daemon.holdRuntimeRollback(digest, process.ppid, attempt)).rejects.toThrow(
        'active flows'
      );
      await vi.waitFor(() => expect(netron.inbound.isDraining).toBe(true));
      expect(netron.inbound.enter()).toBe(false);
      db.exec("INSERT INTO flow_definitions VALUES('finishing-request')");
      netron.inbound.leave();
      await rejected;
      expect(netron.inbound.isDraining).toBe(false);
      expect(db.prepare('SELECT count(*) AS n FROM flow_definitions').get()).toEqual({ n: 1 });
      db.exec('UPDATE flow_definitions SET active=NULL');
      apps.push({ info: { name: 'library/dev/new', status: 'online' } });
      await expect(daemon.holdRuntimeRollback(digest, process.ppid, attempt)).rejects.toThrow('ownership changed');
      expect(netron.inbound.isDraining).toBe(false);
      apps.length = 0;
      await daemon.holdRuntimeRollback(digest, process.ppid, attempt);
      daemon.releaseRuntimeRollback('0'.repeat(64), attempt);
      daemon.releaseRuntimeRollback(digest, randomUUID());
      await delay(0);
      expect(netron.inbound.isDraining).toBe(true);
      if (process.platform === 'darwin' || process.platform === 'linux') {
        // Run the ordinary CLI path with an isolated instance and a recording native supervisor.
        const native = await import('../../src/commands/service-registration.js');
        const jobs = ['fixture-owner', 'fixture-controller'].map((name) => ({
          scope: 'user' as const,
          name,
          file: path.join(home, name),
          body: '',
        }));
        vi.spyOn(native, 'serviceInventory').mockReturnValue({
          owned: { scope: 'user', jobs, managed: null },
          foreign: [],
        });
        vi.spyOn(native, 'nativeLoaded').mockReturnValue({ state: 'running', pid: undefined, lastExit: undefined });
        vi.spyOn(native, 'unchangedJob').mockImplementation(() => {});
        const launch = vi.spyOn(native, 'launchctl').mockReturnValue('');
        const system = vi.spyOn(native, 'systemctl').mockReturnValue('');
        const fallback = vi
          .spyOn(await import('../../src/commands/daemon-cmd.js'), 'daemonStop')
          .mockRejectedValue(Error('Public ingress is closed'));
        const { downCommand } = await import('../../src/commands/up.js');
        await downCommand();
        expect(netron.inbound.enter()).toBe(false);
        expect(fallback).not.toHaveBeenCalled();
        if (process.platform === 'darwin') {
          expect(launch.mock.calls.map(([args]) => args)).toEqual(
            jobs.toReversed().map((job) => ['bootout', native.nativeDomain('user') + '/' + job.name])
          );
        } else {
          expect(system.mock.calls).toEqual(jobs.toReversed().map((job) => ['user', ['disable', '--now', job.name]]));
        }
      }
      daemon.releaseRuntimeRollback(digest, attempt);
      expect(netron.inbound.isDraining).toBe(false);
      const client = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
      await once(client, 'spawn');
      try {
        await daemon.holdRuntimeRollback(digest, client.pid!, attempt);
        const exited = once(client, 'exit');
        client.kill();
        await exited;
        await vi.waitFor(() => expect(netron.inbound.isDraining).toBe(false), { timeout: 3500 });
      } finally {
        if (client.exitCode === null && client.signalCode === null) client.kill();
      }
    } finally {
      daemon.releaseRuntimeRollback(digest, attempt);
      db.close();
    }
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(home, { recursive: true, force: true });
  }
}, 15_000);

it.each(['abort', 'timeout'] as const)(
  'waits for an admitted Flow disk sample and resumes it on warm handoff %s',
  async (outcome) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'warm-flow-'));
    vi.stubEnv('OMNITRON_HOME', home);
    vi.resetModules();
    const started = Promise.withResolvers<void>();
    const sample = Promise.withResolvers<{ freeBytes: number; totalBytes: number }>();
    try {
      const { OmnitronDaemon } = await import('../../src/daemon/daemon.js');
      const target = await installController(home, { hostFlows: 1 });
      await fs.mkdir(path.join(home, 'data'), { recursive: true });
      const db = openSqliteDatabase(path.join(home, 'data/daemon-state.db'));
      const ledger = new FlowLedger(db);
      const definition = diskSpaceFlow('/fixture-volume', 10, 20, 60_000);
      const workspace = { project: null };
      const binding = { identity: 'fixture-controller', target: null };
      const ref = { id: randomUUID(), workspace, expectedRevision: null, definition };
      const draft = ledger.save(ref, binding);
      ledger.change(
        { ...ref, revision: draft.revision, activation: null },
        { actor: 'reviewer', session: 'fixture-session' },
        binding
      );
      const readDisk = vi.fn(async () => {
        started.resolve();
        return sample.promise;
      });
      const flowRuntime = new FlowRuntime(ledger, {
        admit: async () => {},
        scope: async () => binding,
        readDisk,
        report: vi.fn(),
        deliver: vi.fn(),
      });
      const netron = new Netron(createNullLogger(), { id: 'warm-rollback-fixture' });
      const projects = {
        prepareHandoff: async () => ({}),
        resumeAfterHandoff() {},
        recoveryRegistryDigest: () => 'fixture-registry',
      };
      const execution = {
        prepare: vi.fn(async () => ({ ticket: {}, snapshot: { inventoryDigest: 'fixture-epoch' } })),
        abortCandidate: vi.fn(),
        abort: vi.fn(),
      };
      const admission = {
        targetRuntimeHash: target,
        configuration: { registryDigest: 'fixture-registry' },
      } as BackendHandoffAdmission;
      const daemon = Object.assign(Object.create(OmnitronDaemon.prototype), {
        app: { netron, container: { resolveAsync: async () => projects } },
        execution,
        flowRuntime,
        watchConfig: {},
        reviewBackendHandoff: async () => ({ admission }),
        backendRuntimeStatus: () => ({ blockers: {} }),
        initializeRecoveryMonitor: async () => null,
      }) as InstanceType<typeof OmnitronDaemon>;
      const tick = flowRuntime.tick();
      try {
        await started.promise;
        if (outcome === 'timeout') vi.useFakeTimers();
        const transfer = daemon.prepareBackendHandoff('fixture-candidate', undefined, admission);
        const refused = outcome === 'timeout' ? expect(transfer).rejects.toThrow('have not drained') : null;
        await vi.waitFor(() => expect(netron.inbound.isDraining).toBe(true));
        expect(netron.inbound.enter()).toBe(false);
        expect(execution.prepare).not.toHaveBeenCalled();
        expect(ledger.history(ref)).toEqual([]);
        if (outcome === 'timeout') {
          await vi.advanceTimersByTimeAsync(35_001);
          await refused;
          vi.useRealTimers();
          expect(netron.inbound.isDraining).toBe(false);
          expect(execution.prepare).not.toHaveBeenCalled();
        }
        sample.resolve({ freeBytes: 5, totalBytes: 100 });
        await tick;
        if (outcome === 'abort') {
          const state = await transfer;
          expect(execution.prepare).toHaveBeenCalledOnce();
          expect(netron.inbound.isDraining).toBe(true);
          await flowRuntime.tick();
          await daemon.abortBackendHandoff(state);
          expect(netron.inbound.isDraining).toBe(false);
        }
        await flowRuntime.tick();
        expect(readDisk).toHaveBeenCalledOnce();
        expect(ledger.history(ref)).toMatchObject([
          { deliveries: [{ status: 'delivered', title: 'Disk space is low' }] },
        ]);
      } finally {
        vi.useRealTimers();
        sample.resolve({ freeBytes: 5, totalBytes: 100 });
        await tick;
        await flowRuntime.dispose();
        db.close();
      }
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(home, { recursive: true, force: true });
    }
  },
  15_000
);
