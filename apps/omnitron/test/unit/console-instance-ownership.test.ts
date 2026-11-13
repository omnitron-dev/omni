import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { OMNITRON_HOME } from '../../src/config/defaults.js';
import { consoleContainerName, assertConsoleOwnership, CONSOLE_INSTANCE_LABEL } from '../../src/webapp/console-container.js';
import { resolveOmnitronNginx, withInfrastructureScope } from '../../src/infrastructure/service-resolver.js';
import type { ContainerState } from '../../src/infrastructure/types.js';

const runtime = vi.hoisted(() => ({ state: null as ContainerState | null,
  inspect: vi.fn(() => { throw new Error('Unexpected Docker stack inspection in ownership test'); }),
  remove: vi.fn(), stop: vi.fn(), create: vi.fn() }));
vi.mock('../../src/infrastructure/container-runtime.js', () => ({
  readDockerInventory: vi.fn(() => { throw new Error('Unexpected Docker inventory read in ownership test'); }),
  inspectStackContainers: runtime.inspect,
  getContainerState: async () => runtime.state, removeContainer: runtime.remove,
  stopContainer: runtime.stop, createContainer: runtime.create,
  containerSpecHash: () => 'fixture', ensureImage: vi.fn(), waitForHealthy: vi.fn(),
}));
vi.mock('../../src/config/saved.js', async (original) => ({ ...await original<object>(), readSavedDaemonConfig: () => ({ webapp: false }) }));
import { WebappService } from '../../src/webapp/webapp.service.js';
import { OmnitronDaemon } from '../../src/daemon/daemon.js';

const state = (changes: Partial<ContainerState> = {}): ContainerState => ({
  name: consoleContainerName(), containerId: 'a'.repeat(64), image: 'nginx:alpine', status: 'running',
  health: 'healthy', ports: {}, labels: { [CONSOLE_INSTANCE_LABEL]: path.resolve(OMNITRON_HOME) }, ...changes,
});
beforeEach(() => { vi.clearAllMocks(); runtime.state = null; });
afterEach(() => { expect(runtime.inspect).not.toHaveBeenCalled(); });

describe('Console belongs to an instance', () => {
  it('keeps the default name and isolates other homes, regardless of stack scope', () => {
    expect(consoleContainerName(path.join(os.homedir(), '.omnitron'))).toBe('omnitron-nginx');
    expect(consoleContainerName('/tmp/instance-one')).not.toBe(consoleContainerName('/tmp/instance-two'));
    expect(withInfrastructureScope('project', 'staging', () => resolveOmnitronNginx()).name).toBe(consoleContainerName());
  });

  it('accepts legacy containers only with the exact instance configuration mount', () => {
    const legacy = state({ labels: {}, mounts: [{ source: path.join(OMNITRON_HOME, 'webapp/nginx/nginx.conf'), target: '/etc/nginx/nginx.conf' }] });
    expect(() => assertConsoleOwnership(legacy)).not.toThrow();
    expect(() => assertConsoleOwnership(legacy, '/tmp/different-instance')).toThrow('does not belong');
    expect(() => assertConsoleOwnership(state({ labels: {}, mounts: [] }))).toThrow('does not belong');
  });

  it('refuses foreign containers before start or stop can mutate anything', async () => {
    runtime.state = state({ labels: { [CONSOLE_INSTANCE_LABEL]: '/tmp/other' } });
    const service = new WebappService(createNullLogger());
    await expect(service.start()).rejects.toThrow('does not belong');
    await expect(service.stop()).rejects.toThrow('does not belong');
    expect(runtime.remove).not.toHaveBeenCalled();
    expect(runtime.stop).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
  });

  it('targets the inspected container ID, so replacing the name cannot redirect removal', async () => {
    runtime.state = state();
    await new WebappService(createNullLogger()).stop();
    expect(runtime.stop).toHaveBeenCalledWith('a'.repeat(64), 5);
    expect(runtime.remove).toHaveBeenCalledWith('a'.repeat(64));
  });

  it('an instance without a configured Console never removes a shared container at shutdown', async () => {
    runtime.state = state();
    const tasks = new Map<string, () => Promise<void>>();
    const app = { container: { has: vi.fn(() => false) }, on: vi.fn(), registerShutdownTask: (name: string, task: () => Promise<void>) => tasks.set(name, task) };
    const daemon = { execution: null, handingOffBackend: false };
    (OmnitronDaemon.prototype as unknown as { registerShutdownTasks: Function }).registerShutdownTasks.call(daemon, app, createNullLogger());
    await tasks.get('stop-file-watcher-and-webapp')!();
    expect(runtime.stop).not.toHaveBeenCalled();
    expect(runtime.remove).not.toHaveBeenCalled();
  });
});
