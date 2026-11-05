import type { IStackAppStatus, IStackInfo } from '../../src/shared/dto/project.js';

/** Complete wire fixtures: omissions must not silently imitate an old daemon. */
export function stackAppFixture(name: string, overrides: Partial<IStackAppStatus> = {}): IStackAppStatus {
  return { name, handleKey: name, status: 'stopped', pid: null, instances: 1, uptime: 0,
    restarts: 0, cpu: 0, memory: 0, port: null, ...overrides };
}

export function stackFixture(name: string, overrides: Partial<IStackInfo> = {}): IStackInfo {
  return { name, type: 'local', status: 'stopped', config: { type: 'local' }, nodes: [], apps: [],
    infrastructure: { ready: false, services: {} }, portRange: null, startedAt: null,
    uptime: 0, attachedAt: null, ...overrides };
}
