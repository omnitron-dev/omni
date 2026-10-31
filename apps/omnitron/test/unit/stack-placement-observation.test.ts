import { describe, expect, it } from 'vitest';
import { nodePlacement, observeStack } from '../../src/project/stack-observation.js';
import type { IStackInfo } from '../../src/shared/dto/project.js';
import type { ProcessInfoDto } from '../../src/config/types.js';

const base: IStackInfo = {
  name: 'prod',
  type: 'cluster',
  status: 'running',
  config: {
    type: 'cluster',
    apps: ['api'],
    nodes: [
      { host: 'a', role: 'app' },
      { host: 'b', role: 'app' },
    ],
  },
  nodes: [],
  apps: [
    {
      name: 'api',
      handleKey: 'sample/prod/api',
      status: 'stopped',
      pid: null,
      instances: 0,
      uptime: 0,
      restarts: 0,
      cpu: 0,
      memory: 0,
      port: null,
    },
  ],
  infrastructure: { ready: false, services: {} },
  portRange: null,
  startedAt: null,
  attachedAt: null,
  uptime: 0,
};
const process = (name = 'sample/deployed/api', pid = 10): ProcessInfoDto => ({
  name,
  pid,
  status: 'online',
  instances: 1,
  uptime: 1000,
  restarts: 2,
  cpu: 3,
  memory: 100,
  port: 8080,
  mode: 'bootstrap',
  critical: false,
});
const infra = {
  ready: true,
  services: { redis: { status: 'running' as const, containerName: 'sample-prod-redis', port: 6379 } },
};
const at = '2026-10-31T12:00:00.000Z';
const node = (index: number, processes: ProcessInfoDto[] | null) =>
  nodePlacement('sample', base, base.config.nodes![index]!, processes, infra, at);

describe('node-qualified stack observations', () => {
  it('retains two replicas with identical names and independent infrastructure on both nodes', () => {
    const result = observeStack(base, [node(0, [process()]), node(1, [process(undefined, 20)])]);
    expect(result.apps[0]).toMatchObject({ status: 'online', instances: 2, cpu: 6, memory: 200, pid: null });
    expect(result.placements!.map((p) => p.apps[0]!.process!.pid)).toEqual([10, 20]);
    expect(Object.keys(result.infrastructure.services)).toEqual(['a:9700/redis', 'b:9700/redis']);
  });
  it('never assigns another project or another stack by app basename', () => {
    const result = observeStack(base, [
      node(0, [process('foreign/deployed/api'), process('sample/dev/api')]),
      node(1, []),
    ]);
    expect(result.apps[0]).toMatchObject({ status: 'stopped', pid: null });
  });
  it('does not let one healthy replica hide an unreachable node', () => {
    const result = observeStack(base, [node(0, [process()]), node(1, null)]);
    expect(result.status).toBe('degraded');
    expect(result.apps[0]!.status).toBe('degraded');
    expect(result.placements![1]).toMatchObject({ appsObserved: false, apps: [{ process: null, expected: true }] });
  });
  it('distinguishes absent from unobserved, including a completely disconnected stack', () => {
    expect(observeStack(base, [node(0, []), node(1, [])]).status).toBe('stopped');
    const disconnected = observeStack(base, [node(0, null), node(1, null)]);
    expect(disconnected.status).toBe('unknown');
    expect(disconnected.apps[0]!.status).toBe('unknown');
  });
  it('allows an infrastructure-only node without inventing application replicas', () => {
    const onlyServices = nodePlacement('sample', base, { host: 'db', role: 'database', apps: [] }, [], infra, at);
    const result = observeStack(base, [node(0, [process()]), onlyServices]);
    expect(result.apps[0]).toMatchObject({ status: 'online', instances: 1 });
    expect(onlyServices.apps).toEqual([]);
  });
  it('reports unexpected replicas instead of silently counting them as desired', () => {
    const misplaced = nodePlacement('sample', base, { host: 'db', role: 'database', apps: [] }, [process()], infra, at);
    expect(observeStack(base, [node(0, [process()]), misplaced]).status).toBe('degraded');
    expect(misplaced.errors).toContain('Applications are running outside their configured placement');
  });
});
