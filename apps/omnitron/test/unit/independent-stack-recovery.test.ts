import { afterEach, describe, expect, it, vi } from 'vitest';

const docker = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...await original<typeof import('../../src/infrastructure/container-runtime.js')>(),
  isDockerAvailable: docker,
}));
import { ProjectService } from '../../src/services/project.service.js';
import { OmnitronDaemon } from '../../src/daemon/daemon.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
afterEach(() => { vi.restoreAllMocks(); docker.mockReset().mockResolvedValue(false); });

function reconciler() {
  const service: any = Object.create(ProjectService.prototype);
  const managedError = new Error('Docker is not available: managed database cannot start');
  Object.assign(service, {
    logger: logger(),
    registry: { listRegistrations: () => [{ name: 'sample', enabledStacks: ['managed', 'external', 'remote'] }] },
    stackStates: new Map(), resumeBackoff: new Map(),
    getLoadedConfig: () => ({}),
    startStack: vi.fn(async (_project: string, stack: string) => {
      if (stack === 'managed') throw managedError;
      return { type: stack === 'remote' ? 'remote' : 'local', status: 'running' };
    }),
  });
  return service;
}

describe('enabled stack recovery isolates infrastructure failures', () => {
  it('reconciles remote and external stacks while the managed stack reports its real failure', async () => {
    const service = reconciler();
    await service.reconcileEnabledStacks();
    expect(service.startStack.mock.calls.map((call: unknown[]) => call[1])).toEqual(['managed', 'external', 'remote']);
    expect(docker).not.toHaveBeenCalled();
    expect([...service.resumeBackoff.keys()]).toEqual(['sample/managed']);
    expect(service.logger.error).toHaveBeenCalledWith(expect.objectContaining({
      project: 'sample', stack: 'managed', error: 'Docker is not available: managed database cannot start', retryInMs: 60_000,
    }), expect.any(String));
  });

  it('keeps backoff scoped to the failed stack and clears it after ordinary admission succeeds', async () => {
    const service = reconciler();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await service.reconcileEnabledStacks();
    service.stackStates.set('sample/external', { status: 'running' });
    service.stackStates.set('sample/remote', { status: 'degraded' });
    service.startStack.mockClear();
    await service.reconcileEnabledStacks();
    expect(service.startStack).not.toHaveBeenCalled();
    vi.mocked(Date.now).mockReturnValue(61_000);
    service.startStack.mockResolvedValue({ type: 'local', status: 'running' });
    await service.reconcileEnabledStacks();
    expect(service.startStack).toHaveBeenCalledExactlyOnceWith('sample', 'managed', { source: 'auto-resume' });
    expect(service.resumeBackoff.size).toBe(0);
  });

  it('boot reaches each enabled stack without waiting for unrelated Docker availability', async () => {
    // Any global probe is an error: per-stack admission owns this dependency.
    docker.mockRejectedValue(new Error('Unrelated global Docker probe'));
    const service = reconciler();
    Object.assign(service, {
      listProjectRegistrations: service.registry.listRegistrations,
      loadProjectConfig: vi.fn(async () => ({})),
      listStacks: () => ['managed', 'external', 'remote'].map(name => ({ name })),
      startEnabledStacksReconciler: vi.fn(),
    });
    const daemon: any = Object.assign(new OmnitronDaemon(), {
      app: { container: { resolveAsync: async () => service } },
      dc: {}, reconcileOrphanContainers: vi.fn(async () => {}),
    });
    await daemon.startApps({}, logger());
    expect(service.startStack.mock.calls.map((call: unknown[]) => call[1])).toEqual(['managed', 'external', 'remote']);
    expect(service.startStack).toHaveBeenCalledWith('sample', 'remote', { source: 'boot' });
    expect(service.startEnabledStacksReconciler).toHaveBeenCalledOnce();
    expect(docker).not.toHaveBeenCalled();
  });
});
