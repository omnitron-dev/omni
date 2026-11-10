import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { TopologyStateStore } from '../../src/project/topology-state.js';
import {
  applyTopologySpec,
  topologyChanges,
  topologyIssues,
  topologyRevision,
  topologySpec,
  validateTopologySpec,
} from '../../src/project/topology-plan.js';
import { resolveNodePlacements } from '../../src/project/stack-placement.js';
import { publicStack } from '../../src/project/public-stack.js';
import { resolveStack } from '../../src/project/config-resolver.js';
import { TopologyControl } from '../../src/project/topology-control.js';
import { topologyServices } from '../../src/project/topology-services.js';
import { ProjectService } from '../../src/services/project.service.js';
import type { TopologyPlan, TopologySpec } from '../../src/shared/dto/topology.js';

const spec: TopologySpec = {
  version: 1,
  type: 'cluster',
  apps: ['api', 'worker'],
  nodes: [
    { host: 'a', port: 9700, role: 'app', apps: ['api'] },
    { host: 'b', port: 9700, role: 'worker', apps: ['worker'] },
  ],
};
const scope = { project: 'sample', stack: 'prod' };
const entries = [
  { name: 'api', script: 'api.js' },
  { name: 'worker', script: 'worker.js' },
];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});
function database() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-topology-'));
  const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;
  const db = new DaemonStateStore(logger, path.join(dir, 'state.db'));
  cleanups.push(async () => {
    await db.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, db, topology: new TopologyStateStore(db) };
}
function plan(draftRevision: number, changes: Partial<TopologyPlan> = {}): TopologyPlan {
  return {
    ...scope,
    id: 'plan-1',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    baseRevision: 'base',
    draftRevision,
    spec,
    changes: [],
    issues: [],
    effect: 'configuration',
    status: 'planned',
    ...changes,
  };
}

describe('one placement contract for planner and deployment', () => {
  it('assigns only the requested apps to each node and preserves infrastructure-only nodes', () => {
    const placements = resolveNodePlacements(
      {
        ...applyTopologySpec({ type: 'cluster' }, spec),
        nodes: [...spec.nodes, { host: 'db', role: 'database', apps: [] }],
      },
      entries
    );
    expect(placements.map((node) => node.apps.map((app) => app.name))).toEqual([['api'], ['worker'], []]);
  });
  it('preserves cluster infrastructure-only defaults while honoring explicit placement on any role', () => {
    const stack = {
      type: 'cluster' as const,
      nodes: [
        { host: 'a', role: 'app' as const },
        { host: 'db', role: 'database' as const },
        { host: 'cache', role: 'cache' as const },
        { host: 'mixed', role: 'database' as const, apps: ['api'] },
      ],
    };
    const placed = resolveNodePlacements(stack, entries);
    const names = [['api', 'worker'], [], [], ['api']];
    expect(placed.map((placement) => placement.apps.map((app) => app.name))).toEqual(names);
    expect(topologySpec(stack, entries).nodes.map((node) => node.apps)).toEqual(names);
    const remote = resolveNodePlacements({ type: 'remote', nodes: [{ host: 'a', role: 'database' }] }, entries);
    expect(remote[0]!.apps).toEqual(entries);
  });
  it('refuses duplicates, unknown apps and unassigned apps before deployment', () => {
    for (const nodes of [
      [spec.nodes[0]!, spec.nodes[0]!],
      [{ ...spec.nodes[0]!, apps: ['unknown'] }],
      [spec.nodes[0]!],
    ]) {
      expect(() => resolveNodePlacements({ type: 'cluster', nodes }, entries)).toThrow();
    }
  });
  it('does not silently discard a cross-host startup dependency', () => {
    const dependent = [{ ...entries[0]!, dependsOn: ['worker'] }, entries[1]!];
    expect(topologyIssues(spec, dependent)).toEqual([
      expect.objectContaining({ severity: 'error', code: 'invalid-placement' }),
    ]);
  });
  it('rejects dependency cycles and duplicate definitions before any placement is admitted', () => {
    const cyclic = [
      { ...entries[0]!, dependsOn: ['worker'] },
      { ...entries[1]!, dependsOn: ['api'] },
    ];
    for (const type of ['local', 'cluster'] as const) {
      expect(topologyIssues({ ...spec, type, nodes: type === 'local' ? [] : spec.nodes }, cyclic)).toContainEqual(
        expect.objectContaining({ severity: 'error', message: expect.stringMatching(/Circular dependency/) })
      );
    }
    expect(() => resolveNodePlacements({ type: 'local' }, [entries[0]!, entries[0]!])).toThrow(/Duplicate/);
  });
  it('rejects execution fields, credentials and malformed documents', () => {
    for (const input of [
      { ...spec, command: 'exec' },
      { ...spec, nodes: [{ ...spec.nodes[0], ssh: { password: 'secret' } }] },
      { ...spec, apps: ['../api'] },
      { ...spec, nodes: [{ ...spec.nodes[0], port: 0 }] },
    ])
      expect(() => validateTopologySpec(input)).toThrow();
    expect(validateTopologySpec(spec)).toEqual(spec);
  });
  it('keeps changes stable, represents replica moves as remove/add, and keeps secrets out of portable intent', () => {
    const base = {
      type: 'cluster' as const,
      nodes: [{ ...spec.nodes[0]!, ssh: { privateKey: '/private/key' }, apps: ['api', 'worker'] }],
    };
    const before = topologySpec(base, entries);
    expect(JSON.stringify(before)).not.toContain('/private/key');
    expect(applyTopologySpec(base, spec).nodes![0]!.ssh!.privateKey).toBe('/private/key');
    const pinned = { ...base, nodes: base.nodes.map(node => ({ ...node, nodeId: 'old-worker' })) };
    expect(() => applyTopologySpec(pinned, spec)).toThrow('pinned allocation');
    const replacement = { ...spec, nodes: spec.nodes.map(node => ({ ...node, nodeId: 'replacement' })) };
    expect(() => validateTopologySpec(replacement)).toThrow('only once');
    expect(() => applyTopologySpec(pinned, replacement)).toThrow('pinned allocation');
    expect(topologyChanges(before, spec)).toContainEqual({
      action: 'remove',
      resource: 'application',
      name: 'worker',
      node: 'a:9700',
    });
    expect(topologyChanges(before, spec)).toContainEqual({
      action: 'add',
      resource: 'application',
      name: 'worker',
      node: 'b:9700',
    });
    expect(topologyRevision({ a: 1, b: 2 })).toBe(topologyRevision({ b: 2, a: 1 }));
  });
  it('shows both sides of node role and label changes in the review plan', () => {
    const next = structuredClone(spec);
    next.nodes[0]!.role = 'gateway';
    next.nodes[0]!.label = 'Edge';
    expect(topologyChanges(spec, next)).toEqual([
      {
        action: 'update',
        resource: 'node',
        name: 'Edge',
        node: 'a:9700',
        fields: [
          { field: 'role', before: 'app', after: 'gateway' },
          { field: 'label', before: null, after: 'Edge' },
        ],
      },
    ]);
    expect(topologyChanges(next, spec)[0]!.fields).toContainEqual({ field: 'label', before: 'Edge', after: null });
  });
  it('never uses the daemon RPC port as the database, Redis or gateway service port', () => {
    const result = resolveStack(
      {
        ...DEFAULT_ECOSYSTEM, apps: [],
        infrastructure: { postgres: { port: 15432, databases: {} }, redis: { port: 16379 }, gateway: { port: 18080 } },
      },
      'sample',
      'prod',
      {
        type: 'cluster',
        nodes: [
          { host: 'db', port: 19700, role: 'database' },
          { host: 'cache', port: 29700, role: 'cache' },
          { host: 'gw', port: 39700, role: 'gateway' },
        ],
      },
      new Map()
    );
    expect(result.infrastructureAddresses.postgres.port).toBe(15432);
    expect(result.infrastructureAddresses.redis.port).toBe(16379);
    expect(result.infrastructureAddresses.gateway?.port).toBe(18080);
  });
  it('redacts launch environment, SSH keys and infrastructure passwords from viewer read models', () => {
    const result = publicStack({
      config: {
        type: 'remote',
        settings: { env: { SECRET: 'sensitive' } },
        infrastructure: { postgres: { databases: {}, password: 'sensitive' } },
        nodes: [{ host: 'a', role: 'app', ssh: { privateKey: 'sensitive' } }],
      },
    } as never);
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(result.config.nodes![0]!.host).toBe('a');
  });
});

describe('target intent is separate from executable configuration', () => {
  it('survives reopening without admitting a target for deployment or auto-resume', async () => {
    const { dir, db, topology } = database();
    const stack = applyTopologySpec({ type: 'cluster' }, spec);
    const config = { ...DEFAULT_ECOSYSTEM, apps: entries, stacks: { prod: stack } };
    const source = {
      configuration: async () => ({ config, stack, apps: entries, userStacks: {} }),
      observation: async () => ({ config: stack, placements: [] }) as never,
      dependencies: async () => ({
        version: 1 as const,
        generatedAt: new Date().toISOString(),
        dependencies: [],
        warnings: [],
      }),
      nodes: () => spec.nodes.map((node) => ({ id: node.host, name: node.host, host: node.host, port: node.port })),
    };
    const control = new TopologyControl(topology, source);
    const before = await control.workspace(scope);
    const target = { ...spec, apps: ['api'], nodes: [{ ...spec.nodes[0]!, apps: ['api'] }] };
    const draft = await control.saveDraft({
      ...scope,
      baseRevision: before.revision,
      expectedDraft: null,
      spec: target,
    });
    const planned = await control.plan({ ...scope, draftRevision: draft.revision });
    expect(planned.issues).toContainEqual(expect.objectContaining({ code: 'intent-only' }));
    await control.apply({ ...scope, plan: planned.id }, { actorId: 'admin', actorType: 'user' });
    await db.dispose();
    const reopened = await new TopologyControl(new TopologyStateStore(db), source).workspace(scope);
    expect(reopened.desired).toEqual(target);
    expect(reopened.configured).toEqual(spec);
    expect(config.stacks.prod.apps).toEqual(['api', 'worker']);
    expect(reopened.observed.config.nodes).toHaveLength(2);
    const resolve = (
      ProjectService.prototype as unknown as {
        resolveStacks(config: unknown, project: { name: string; path: string }): Record<string, unknown>;
      }
    ).resolveStacks;
    expect(resolve.call({ topologyState: topology }, config, { name: 'sample', path: dir })['prod']).toEqual(
      stack
    );
  });

  it('uses the provisioner binding rules and never invents stateless recovery guarantees', () => {
    const services = topologyServices(
      {
        services: {
          db: { preset: 'postgres' },
          gateway: { ports: { http: 80 }, env: {}, docker: { image: 'gateway' }, bareMetal: {} as never },
        },
      },
      {
        type: 'cluster',
        serviceOverrides: {
          db: { external: { host: 'private-db', ports: { main: 5432 }, secrets: { password: 'never-return' } } },
          gateway: { provisioning: 'bareMetal' },
        },
      },
      [{ project: 'sample', stack: 'prod', app: 'api', service: 'unresolved', evidence: 'configuration', via: 'URL' }]
    );
    expect(services).toEqual([
      { name: 'db', runtime: 'external', stateful: true },
      { name: 'gateway', runtime: 'host', stateful: 'unknown' },
      { name: 'unresolved', runtime: 'configured', stateful: 'unknown' },
    ]);
    expect(JSON.stringify(services)).not.toContain('never-return');
  });

  it('describes a Docker service before its release-backed mount is installed', () => {
    const services = topologyServices({
      artifactVolumes: { site: { service: 'gateway', app: 'web', directory: 'dist/public', target: '/srv/site' } },
      services: { gateway: { ports: {}, env: {}, docker: { image: 'gateway' } } },
    }, { type: 'local' }, []);
    expect(services).toEqual([{ name: 'gateway', runtime: 'docker', stateful: 'unknown' }]);
  });
});

describe('durable topology intent and immutable plans', () => {
  it('rejects concurrent edits and preserves draft and applied intent across reopen', async () => {
    const { db, topology } = database();
    const draft = topology.saveDraft(scope, 'base', spec, null);
    expect(() => topology.saveDraft(scope, 'base', spec, null)).toThrow(/another session/);
    topology.addPlan(scope, plan(draft.revision));
    topology.apply(scope, 'plan-1', 'base', { actorId: 'admin', actorType: 'user' });
    await db.dispose();
    expect(topology.read(scope).desired).toEqual(spec);
    expect(topology.read(scope).plans[0]!.status).toBe('applied');
    expect(topology.read(scope).appliedBy?.actorId).toBe('admin');
  });
  it('makes an accepted plan idempotent without recording fictional runtime placement', () => {
    const { topology } = database();
    const draft = topology.saveDraft(scope, 'base', spec, null);
    topology.addPlan(scope, plan(draft.revision));
    const actor = { actorId: 'admin', actorType: 'user' };
    const first = topology.apply(scope, 'plan-1', 'base', actor);
    expect(topology.apply(scope, 'plan-1', 'changed', actor)).toEqual(first);
    expect(topology.read(scope).desired).toEqual(spec);
  });
  it('refuses stale, expired, blocked and edited plans without changing desired configuration', () => {
    for (const kind of ['stale', 'expired', 'blocked', 'edited']) {
      const { topology } = database();
      const draft = topology.saveDraft(scope, 'base', spec, null);
      topology.addPlan(
        scope,
        plan(
          draft.revision,
          kind === 'expired'
            ? { expiresAt: '2000-01-01T00:00:00Z' }
            : kind === 'blocked'
              ? { issues: [{ code: 'test', severity: 'error', message: 'blocked' }] }
              : {}
        )
      );
      if (kind === 'edited') topology.saveDraft(scope, 'base', spec, draft.revision);
      expect(() =>
        topology.apply(scope, 'plan-1', kind === 'stale' ? 'changed' : 'base', {
          actorId: 'admin',
          actorType: 'user',
        })
      ).toThrow();
      expect(topology.read(scope).desired).toBeNull();
    }
  });
  it('rolls back failed mutations, commits with FULL durability, and refuses corrupt state', () => {
    const { db } = database();
    db.kvSetSync('test', { value: 1 });
    expect(() =>
      db.kvUpdateSync('test', () => {
        throw new Error('abort');
      })
    ).toThrow('abort');
    expect(db.kvGetSync('test')).toEqual({ value: 1 });
    db.kvUpdateSync('test', () => {
      expect(db.initSync().pragma('synchronous', { simple: true })).toBe(2);
      return { value: 2 };
    });
    expect(db.initSync().pragma('synchronous', { simple: true })).toBe(1);
    db.initSync().prepare('UPDATE state_kv SET value = ? WHERE key = ?').run('{broken', 'test');
    expect(() => db.kvUpdateSync('test', () => ({ value: 3 }))).toThrow(/Corrupt/);
  });
});
