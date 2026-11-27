/**
 * Three commands looked for a service by walking a list Netron does not keep.
 *
 * `pipeline`, `k8s` and `cluster` each reached into the client's privates and
 * asked `netron.getPeers ? netron.getPeers() : []`. Netron has no `getPeers`
 * — its peers are the `peers` Map — so the guard chose `[]` every time, the
 * walk never ran, and the lookup fell through to its own `throw`:
 *
 *     ■  Failed: OmnitronPipelines service not available
 *     ■  Failed: OmnitronKubernetes service not available
 *     ▲  Cluster mode is not enabled. Enable it in omnitron.config.ts
 *
 * all with exit 0. Measured 2026-09-23 on the development daemon, whose
 * registry lists both services: asked through `client.service()`,
 * `listPipelines()` answered `[]` and `listPods()` 9 pods. `secret.ts` had
 * the same walk and was fixed the same way; see
 * `a-service-lookup-that-walked-the-peers-itself.test.ts`.
 *
 * This court is not a reading of the source. It stands up a real Netron on a
 * unix socket, exposes the daemon's own rpc service classes over it — with
 * fakes only BEHIND them — and runs the commands with the real client. A
 * walk over peers that do not exist cannot find anything here, and neither
 * could it on the daemon.
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExecutionEngine } from '@xec-sh/core';
import { pipelineShellReceipt } from '../../data/operations/pipeline-shell-receipt.js';

import { Netron } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Service, Public } from '@omnitron-dev/titan/decorators';

import { PipelineRpcService } from '../../src/services/pipeline.rpc-service.js';
import type { PreparePipelineRun, StartPipelineRun } from '../../src/shared/dto/pipelines.js';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { KubernetesRpcService } from '../../src/services/kubernetes.rpc-service.js';
import { FleetRpcService } from '../../src/services/fleet.rpc-service.js';
import { ClusterRpcService } from '../../src/cluster/cluster.rpc-service.js';

const logged: Array<{ level: string; text: string }> = [];
const tables: unknown[][] = [];
const same = (s: unknown) => String(s);

vi.mock('@xec-sh/kit', () => ({
  log: {
    error: (t: string) => logged.push({ level: 'error', text: t }),
    info: (t: string) => logged.push({ level: 'info', text: t }),
    success: (t: string) => logged.push({ level: 'success', text: t }),
    warn: (t: string) => logged.push({ level: 'warn', text: t }),
  },
  table: (opts: { data: unknown[] }) => tables.push(opts.data),
  prism: { bold: same, dim: same, green: same, yellow: same, blue: same, red: same },
}));

/** Where the commands' `createDaemonClient()` connects: the stand below. */
const stand = vi.hoisted(() => ({ socketPath: '' }));
vi.mock('../../src/daemon/daemon-client.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/daemon/daemon-client.js')>();
  return { ...real, createDaemonClient: () => real.createDaemonClient(stand.socketPath) };
});

const { pipelineListCommand, pipelineRunCommand } = await import('../../src/commands/pipeline.js');
const { k8sPodsCommand, k8sDeployScaleCommand } = await import('../../src/commands/k8s.js');
const { clusterStatusCommand, clusterStepDownCommand } = await import('../../src/commands/cluster.js');

/** The one service every client connection asks for first (`ensureConnected`). */
@Service({ name: 'OmnitronDaemon' })
class Daemon {
  @Public()
  async ping(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

const pod = (name: string) => ({
  name,
  namespace: 'kube-system',
  status: 'Running',
  ready: true,
  restarts: 0,
  age: '1d',
  node: 'kind-control-plane',
  labels: {},
});

const revision = 'a'.repeat(64);
const reviewDigest = 'b'.repeat(64);
function pipelineRpc(backend: any) {
  const list = backend.listPipelines;
  if (list) backend.listPipelines = async () => (await list()).map((row: object) => ({ ...row, revision }));
  return new PipelineRpcService(backend, { validateSession: async () => null }, { record: async () => {} });
}

function pipelineRuns(rows: Array<{ id: string; name: string }>) {
  const prepare = vi.fn(async ({ runId, expectedRevision }: PreparePipelineRun, _actor: string) => ({
    id: runId, status: 'awaiting-review',
    review: { protocol: 1, digest: reviewDigest, definitionRevision: expectedRevision, projects: [], parameterNames: [] },
  }));
  const start = vi.fn(async ({ runId }: StartPipelineRun, _actor: string) => ({ id: runId, status: 'running' }));
  const rpc = pipelineRpc({ listPipelines: async () => rows, prepareRun: prepare, startRun: start });
  return { rpc, prepare, start };
}

const services = {
  pipelines: (list: unknown[]) =>
    pipelineRpc({ listPipelines: async () => list } as never),
  kubernetes: () =>
    new KubernetesRpcService({
      listPods: async () => [pod('coredns-a'), pod('coredns-b')],
      scaleDeployment: async () => undefined,
    } as never),
  fleet: () =>
    new FleetRpcService({
      getSummary: async () => ({
        totalNodes: 1,
        onlineNodes: 1,
        offlineNodes: 0,
        leader: null,
        nodes: [
          {
            id: '0f1e2d3c-aaaa-bbbb-cccc-000000000001',
            hostname: 'node-a',
            address: '10.0.0.1',
            port: 9700,
            role: 'leader',
            status: 'online',
            lastHeartbeat: null,
            metadata: null,
            createdAt: '2026-09-23T00:00:00.000Z',
          },
        ],
      }),
    } as never),
  cluster: (isLeader = true) =>
    new ClusterRpcService({
      getClusterState: () => ({
        nodeId: 'node-a',
        state: isLeader ? 'leader' : 'follower',
        term: 3,
        leaderId: isLeader ? 'node-a' : 'node-b',
        votedFor: 'node-b',
        peers: 1,
        uptime: 65_000,
      }),
      isLeader,
      stepDown: async () => undefined,
    } as never),
};

let server: Netron | null = null;
const dirs: string[] = [];

/** A directory for one test's socket, removed after it. */
function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-walk-'));
  dirs.push(dir);
  return dir;
}

/** A daemon on a fresh socket, exposing exactly `exposed`. */
async function daemonWith(...exposed: object[]): Promise<void> {
  stand.socketPath = path.join(scratchDir(), 'daemon.sock');
  server = new Netron(createNullLogger(), { id: 'court-daemon' });
  server.registerTransport('unix', () => new UnixSocketTransport());
  server.registerTransportServer('unix', { name: 'unix', options: {
    path: stand.socketPath, force: true, invocationWrapper: createAuthContextWrapper(),
  } });
  // Authenticate at the transport boundary, just like the daemon's private
  // Unix socket. The invocation wrapper only carries the admitted identity.
  server.setTransportAuthContext('unix', {
    userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' },
  });
  await server.start();
  for (const svc of [new Daemon(), ...exposed]) await server.peer.exposeService(svc);
}

const said = () => logged.map((l) => l.text).join('\n');

let exitCodeBefore: typeof process.exitCode;
beforeEach(() => {
  logged.length = 0;
  tables.length = 0;
  exitCodeBefore = process.exitCode;
  process.exitCode = undefined;
});
afterEach(async () => {
  process.exitCode = exitCodeBefore;
  await server?.stop();
  server = null;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it('reads and verifies a completed shell receipt through the CLI and registered Netron service', async () => {
  const run = { id: '70d8b4ec-91e2-4729-954f-d033014f98ff', review: { digest: 'e'.repeat(64) }, status: 'success',
    steps: [{ name: 'check', kind: 'shell', nodeId: 'site', sourceHash: '2'.repeat(64),
      status: 'success', exitCode: 0, outputTruncated: false, output: 'synthetic retained output' }] };
  const expected = pipelineShellReceipt(run);
  await daemonWith(pipelineRpc({ getRunStatus: (id: string) => id === run.id ? run : null }));
  const engine = new ExecutionEngine({ quiet: true, enableEvents: false, retry: { retries: 0 }, preferLocal: false });
  const home = scratchDir();
  const args = ['--import=tsx/esm', fileURLToPath(new URL('../../src/cli/omnitron.ts', import.meta.url)),
    '--json', 'pipeline', 'status', run.id, '--shell-receipt'];
  const command = { adapter: 'local' as const, shell: false, command: process.execPath, timeout: 20_000, nothrow: true,
    envMode: 'replace' as const, env: { HOME: home, OMNITRON_HOME: home, OMNITRON_SOCKET: stand.socketPath } };
  try {
    const actual = await engine.execute({ ...command, args });
    expect(actual.exitCode, actual.stderr).toBe(0);
    expect(JSON.parse(actual.stdout)).toEqual({ ok: true, data: expected });
    const verified = await engine.execute({ ...command, args: [...args, expected.digest] });
    expect(verified.exitCode, verified.stderr).toBe(0);
    expect(JSON.parse(verified.stdout)).toEqual({ ok: true, data: expected });
    run.steps[0]!.output += '\n';
    const changed = await engine.execute({ ...command, args: [...args, expected.digest] });
    expect(changed.exitCode).toBe(1);
    expect(changed.stdout).toBe('');
    expect(JSON.parse(changed.stderr)).toMatchObject({ ok: false, error: expect.stringContaining('differs') });
  } finally { await engine.dispose(); }
});

describe('omnitron pipeline list', () => {
  it('finds the service the daemon exposes, and gives its answer', async () => {
    await daemonWith(services.pipelines([]));

    await pipelineListCommand();

    expect(said()).not.toContain('not available');
    expect(said()).toContain('No pipelines defined');
    expect(process.exitCode).toBeUndefined();
  });

  it('lists what is there', async () => {
    await daemonWith(
      services.pipelines([
        { id: 'p1', name: 'release', description: null, steps: [{ name: 'build', run: 'pnpm build' }], triggers: [], createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z' },
      ]),
    );

    await pipelineListCommand();

    expect(said()).toContain('Found 1 pipeline(s)');
    expect(said()).toContain('release');
  });

  it('exits 1 when the lookup does fail', async () => {
    await daemonWith(); // no OmnitronPipelines

    await pipelineListCommand();

    expect(logged.some((l) => l.level === 'error')).toBe(true);
    expect(process.exitCode).toBe(1);
  });
});

describe('omnitron pipeline run', () => {
  it('updates the definition through the administrator RPC without replacing its identity', async () => {
    const definition = { name: 'release', steps: [{name:'deploy', run:'node deploy.mjs', env:{PATH:'/opt/runtime/bin:/usr/bin'}}] };
    const update = vi.fn(async (id, def) => ({ id, ...def }));
    await daemonWith(pipelineRpc({ updatePipeline: update } as never));
    const { createDaemonClient } = await import('../../src/daemon/daemon-client.js');
    const client = createDaemonClient();
    try {
      const rpc = await client.service<import('../../src/shared/dto/services.js').IOmnitronPipelinesService>('OmnitronPipelines');
      const revision = 'a'.repeat(64);
      const result = await rpc.updatePipeline({id:'stable-id', definition, expectedRevision: revision});
      expect(result.id).toBe('stable-id');
      expect(result.steps).toEqual(definition.steps);
      expect(update).toHaveBeenCalledExactlyOnceWith('stable-id', definition, revision);
    } finally { await client.disconnect(); }
  });
  it.each(['release', 'pipeline-id'])('resolves %s to the registered pipeline over Netron', async (name) => {
    const { rpc, prepare, start } = pipelineRuns([{ id: 'pipeline-id', name: 'release' }]);
    await daemonWith(rpc);
    await pipelineRunCommand(name);
    const runId = prepare.mock.calls[0]?.[0].runId;
    expect(runId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ runId, id: 'pipeline-id', expectedRevision: revision }, 'omnitron-local');
    expect(start).toHaveBeenCalledExactlyOnceWith({ runId, expectedDigest: reviewDigest }, 'omnitron-local');
    expect(process.exitCode).toBeUndefined();
    expect(said()).toContain(`Pipeline run ${runId}: running`);
  });
  it.each([
    { name: 'absent', rows: [], error: 'No pipeline' },
    { name: 'release', rows: [{ id: 'p1', name: 'release' }, { id: 'p2', name: 'release' }], error: 'ambiguous' },
  ])('refuses $name when the target is not unique', async ({ name, rows, error }) => {
    const { rpc, prepare, start } = pipelineRuns(rows);
    await daemonWith(rpc);
    await pipelineRunCommand(name);
    expect(prepare).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(said()).toContain(error);
  });
  it('gives an exact id priority over another pipeline with that name', async () => {
    const { rpc, prepare, start } = pipelineRuns([{ id: 'p1', name: 'release' }, { id: 'p2', name: 'p1' }]);
    await daemonWith(rpc);
    const runId = '17a904d3-4d4f-4425-ab38-57c1dd10d8ec';
    await pipelineRunCommand('p1', { runId, prepare: true });
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ runId, id: 'p1', expectedRevision: revision }, 'omnitron-local');
    expect(start).not.toHaveBeenCalled();
    expect(said()).toContain(`Pipeline run ${runId}: awaiting-review`);
    expect(process.exitCode).toBeUndefined();
  });
});

describe('omnitron k8s', () => {
  it('pods: finds the service the daemon exposes, and lists what it returns', async () => {
    await daemonWith(services.kubernetes());

    await k8sPodsCommand();

    expect(said()).not.toContain('not available');
    expect(said()).toContain('Found 2 pod(s)');
    expect(process.exitCode).toBeUndefined();
  });

  it('pods: exits 1 when the lookup does fail', async () => {
    await daemonWith(); // no OmnitronKubernetes

    await k8sPodsCommand();

    expect(process.exitCode).toBe(1);
  });

  it('deploy scale: a refused replicas count is a failed command', async () => {
    await k8sDeployScaleCommand('web', 'three');

    expect(said()).toContain("Invalid replicas count: 'three'");
    expect(process.exitCode).toBe(1);
  });
});

describe('omnitron cluster', () => {
  it('status: reads the election from a daemon that runs one, and the fleet beside it', async () => {
    await daemonWith(services.cluster(), services.fleet());

    await clusterStatusCommand();

    expect(said()).not.toContain('Cluster mode is');
    expect(said()).toContain('Cluster State');
    expect(said()).toContain('node-a');
    expect(said()).toContain('Fleet Nodes (1/1 online)');
    expect(tables).toHaveLength(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('status: a fleet it could not ask is said, not left out', async () => {
    await daemonWith(services.cluster()); // no OmnitronFleet

    await clusterStatusCommand();

    // The cluster state stands; the missing table must not read as a fleet
    // of nobody.
    expect(said()).toContain('Cluster State');
    expect(said()).toContain('Fleet nodes not shown');
    expect(tables).toHaveLength(0);
  });

  it('status: distinguishes a current standalone daemon from a legacy daemon without the status service', async () => {
    await daemonWith(new ClusterRpcService(null));
    await clusterStatusCommand();
    expect(said()).toContain('runs standalone');
    expect(said()).toContain('OMNITRON_CLUSTER_DATABASE_URL');
    expect(process.exitCode).toBeUndefined();
  });

  it('status: a worker reports its enrollment and supported controls without claiming leadership', async () => {
    const worker = new ClusterRpcService(null, { nodeId: 'edge-a', clusterId: 'west' });
    await daemonWith(worker);
    await clusterStatusCommand();
    expect(said()).toContain('Cluster west · worker edge-a');
    expect(said()).toContain('stack.stop, stack.resume-installed');
    expect(said()).not.toContain('Lease:');
    expect(await worker.isLeader()).toEqual({ leader: false, nodeId: 'edge-a', term: null });
    expect((await worker.stepDown()).success).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it('status: a legacy worker without the status service cannot attest its enrollment', async () => {
    await daemonWith(services.fleet());
    await clusterStatusCommand();
    expect(said()).toContain('enrollment is unreported');
    expect(process.exitCode).toBe(2);
  });

  it('status: no daemon at all is a failure, not «cluster mode is off»', async () => {
    stand.socketPath = path.join(scratchDir(), 'absent.sock');

    await clusterStatusCommand();

    expect(said()).not.toContain('Cluster mode is');
    expect(said()).toContain('Failed to get cluster status');
    expect(process.exitCode).toBe(1);
  });

  it('step-down: reaches the election and reports it', async () => {
    await daemonWith(services.cluster());

    await clusterStepDownCommand();

    expect(said()).toContain('Leadership lease released');
    expect(process.exitCode).toBeUndefined();
  });

  it('step-down: refused by a node that is not the leader, exits 1', async () => {
    await daemonWith(services.cluster(false));

    await clusterStepDownCommand();

    expect(said()).toContain('This node has no confirmed leadership lease');
    expect(process.exitCode).toBe(1);
  });

  it('step-down: on a daemon without cluster mode deposes nobody, and exits 1', async () => {
    await daemonWith();

    await clusterStepDownCommand();

    expect(said()).toContain('enrollment is unreported');
    expect(process.exitCode).toBe(1);
  });
});
