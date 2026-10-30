import { describe, expect, it } from 'vitest';
import { DockerHealthIndicator } from '../../src/monitoring/docker-health.indicator.js';
import type { InfrastructureHealthContext } from '../../src/monitoring/infrastructure-health.js';
const context: InfrastructureHealthContext = {
  stacks: [{ project: 'sample', stack: 'dev', intent: 'inactive' }, { project: 'sample', stack: 'live', intent: 'running' }],
  requiredContainers: ['database'], unresolvedStacks: [],
};
const up = { name: 'database', status: 'running' as const, health: 'healthy' as const, project: 'sample', stack: 'live' };
const down = { name: 'old-worker', status: 'exited' as const, health: 'unhealthy' as const, project: 'sample', stack: 'dev' };
const check = (seen = [up, down], desired = context) => new DockerHealthIndicator(() => null, async () => seen, () => desired).check();

describe('Docker observation combined with local desired state', () => {
  it('explains an intentionally stopped container without treating its stale healthcheck as a current failure', async () => {
    const out = await check();
    expect(out.status).toBe('healthy');
    expect(out.message).toContain('1 intentionally stopped');
    expect(out.details).toMatchObject({ inactive: ['old-worker'], running: 1 });
  });
  it('fails a required container absent from Docker, including one never created', async () => {
    const out = await check([down]);
    expect(out.status).toBe('unhealthy');
    expect(out.message).toContain('database: required container is missing');
  });
  it('does not excuse a stopped container in an enabled stack', async () => {
    const out = await check([up, { ...down, stack: 'live' }]);
    expect(out.status).toBe('unhealthy');
    expect(out.message).toContain('required by an active stack');
  });
  it('does not guess intent from a container name or an unknown project', async () => {
    const out = await check([up, { ...down, project: 'unknown' }]);
    expect(out.status).toBe('degraded');
    expect(out.message).toContain('desired state is not established');
  });
  it('shows all simultaneous failures and warnings', async () => {
    const out = await check([{ ...up, health: 'unhealthy' }, { ...down, stack: 'live' }], { ...context, unresolvedStacks: ['sample/other'] });
    expect(out.status).toBe('unhealthy');
    expect(out.message).toMatch(/old-worker.*sample\/other.*database/);
  });
  it('keeps a running unhealthy container of a disabled stack visible', async () => {
    expect((await check([up, { ...down, status: 'running' }])).status).toBe('degraded');
  });
  it('asks Docker even when reconciler state claims everything is fine', async () => {
    const indicator = new DockerHealthIndicator(() => ({ getDesiredServices: () => [] }) as never,
      async () => { throw Error('offline'); }, () => context);
    expect((await indicator.check()).status).toBe('unhealthy');
  });
});

describe('stack intent is derived without changing infrastructure', () => {
  it('never calls an inactive stack enabled or assumes an unknown registration is disabled', async () => {
    const { ProjectService } = await import('../../src/services/project.service.js');
    const self = {
      registry: { list: () => [{ name: 'sample', enabledStacks: ['live'] }, { name: 'unloaded', enabledStacks: [] }, { name: 'unspecified' }] },
      getLoadedConfig: (name: string) => name === 'unloaded' ? null : { stacks: { dev: { type: 'local' }, live: { type: 'local' }, remote: { type: 'remote' } } },
      resolveStacks: (config: { stacks: unknown }) => config.stacks,
      getRunningStacks: () => [],
      orchestrator: { list: () => [] },
      infraManager: { getInstance: () => ({ getDesiredServices: () => [{ name: 'database' }] }) },
    };
    const out = ProjectService.prototype.getInfrastructureHealthContext.call(self as never);
    expect(out.stacks).toContainEqual({ project: 'sample', stack: 'dev', intent: 'inactive' });
    expect(out.stacks).toContainEqual({ project: 'sample', stack: 'live', intent: 'running', containers: ['database'] });
    expect(out.stacks).toContainEqual({ project: 'unspecified', stack: 'dev', intent: 'unknown' });
    expect(out.stacks.some(s => s.project === 'unloaded' || s.stack === 'remote')).toBe(false);
    expect(out.requiredContainers).toEqual(['database']);
  });
});

describe('retired services in an otherwise active stack', () => {
  const desired: InfrastructureHealthContext = { ...context, stacks: [{ project: 'sample', stack: 'live', intent: 'running', containers: ['database'] }] };
  it('requires a reconciler inventory before calling a stopped service retired', async () => {
    const out = await check([up, { ...down, stack: 'live' }], desired);
    expect(out.status).toBe('healthy');
    expect(out.message).toContain('stopped containers no longer declared');
    expect(out.details).toMatchObject({ retired: ['old-worker'] });
    expect((await check([up, { ...down, stack: 'live' }])).status).toBe('unhealthy');
  });
  it('keeps missing required and still-running retired containers visible', async () => {
    expect((await check([{ ...down, stack: 'live' }], desired)).status).toBe('unhealthy');
    expect((await check([up, { ...down, stack: 'live', status: 'running', health: 'healthy' }], desired)).status).toBe('degraded');
  });
});
