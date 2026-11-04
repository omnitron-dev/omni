import { expect, it, vi } from 'vitest';
import { observeStackHealth } from '../../src/project/stack-health.js';
import { ProjectService } from '../../src/services/project.service.js';
import { stackHealthReading } from '../../src/shared/stack-reading.js';
import type { IStackInfo } from '../../src/shared/dto/project.js';
const info = { type: 'local', status: 'running', apps: [
  { name: 'api', handleKey: 'sample/dev/api', status: 'online' },
  { name: 'worker', handleKey: 'sample/dev/worker', status: 'online' },
] } as IStackInfo;
const good = { status: 'healthy', checks: [] };
const at = '2026-11-04T00:00:00.000Z';
it('keeps online lifecycle separate from a failing application', () => {
  const result = observeStackHealth(info, new Map([['local', {
    'sample/dev/api': good, 'sample/dev/worker': { status: 'unhealthy', checks: [{ name: 'source', status: 'fail', message: 'Source contract rejected' }] },
  }]]), at);
  expect(result.status).toBe('running');
  expect(result.health?.status).toBe('unhealthy');
  expect(result.apps.map(app => app.health)).toEqual(['healthy', 'unhealthy']);
  expect(stackHealthReading(result.health).findings[0]?.checks[0]?.message).toBe('Source contract rejected');
});
it('does not promote missing, foreign or unreadable health to healthy', () => {
  for (const answers of [null, {}, { 'different/dev/api': good, 'sample/dev/worker': good }]) {
    expect(observeStackHealth(info, new Map([['local', answers]]), at).health?.status).toBe('unknown');
  }
});
it('preserves every physical replica and identifies a missing node observation', () => {
  const remote = { ...info, type: 'cluster', placements: ['a', 'b'].map(nodeKey => ({ nodeKey, appsObserved: true,
    apps: [{ name: 'api', expected: true, process: { name: 'sample/dev/api', status: 'online' } }] })) } as IStackInfo;
  const result = observeStackHealth(remote, new Map([['a', { 'sample/dev/api': good }], ['b', null]]), at);
  expect(result.health?.apps).toHaveLength(2);
  expect(result.health?.apps[1]).toMatchObject({ node: 'b', status: 'unknown' });
  expect(result.health?.status).toBe('unknown');
  expect(result.apps[0]?.health).toBe('unknown');
});

it('coalesces concurrent owner reads and refuses pre-restart health for a replacement process', async () => {
  let finish!: (value: Record<string, typeof good>) => void;
  const getHealth = vi.fn(() => new Promise<Record<string, typeof good>>(resolve => { finish = resolve; }));
  let current = { ...info, apps: info.apps.map(app => ({ ...app, pid: 10, restarts: 0 })) };
  const service: ProjectService = Object.assign(Object.create(ProjectService.prototype), {
    orchestrator: { getHealth }, getStack: () => current,
  });
  const first = service.withRemoteAppStatuses('sample', current);
  const second = service.withRemoteAppStatuses('sample', current);
  await Promise.resolve();
  expect(getHealth).toHaveBeenCalledTimes(1);
  current = { ...current, apps: current.apps.map(app => app.name === 'api' ? { ...app, pid: 11, restarts: 1 } : app) };
  finish({ 'sample/dev/api': good, 'sample/dev/worker': good });
  for (const result of await Promise.all([first, second])) {
    expect(result.apps[0]).toMatchObject({ pid: 11, health: 'unknown' });
    expect(result.apps[1]?.health).toBe('healthy');
  }
  getHealth.mockRejectedValueOnce(new Error('Owner disconnected'));
  expect((await service.withRemoteAppStatuses('sample', current)).health?.status).toBe('unknown');
  expect(getHealth).toHaveBeenCalledTimes(2);
});
it('a deliberately stopped stack is not an unhealthy application', () => {
  const stopped = { ...info, status: 'stopped', apps: info.apps.map(app => ({ ...app, status: 'stopped' })) } as IStackInfo;
  expect(observeStackHealth(stopped, new Map(), at).health?.status).toBe('not-running');
});
