import { describe, expect, it, vi } from 'vitest';
import { ownsStackInfrastructure, infrastructureOwnership } from '../../src/project/infrastructure-ownership.js';
import { renderNodeAppConfig } from '../../src/project/node-app-config.js';
import { ProjectService } from '../../src/services/project.service.js';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';
import type { IStackConfig } from '../../src/config/types.js';
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
const delegated = (): IStackConfig => ({
  type: 'local',
  infrastructureOwnership: 'controller',
  managedOrigin: { project: 'sample', stack: 'test' },
});
function harness(stack: IStackConfig) {
  const service = Object.create(ProjectService.prototype) as any;
  const config = {
    name: 'sample',
    apps: [
      {
        name: 'api',
        script: 'app.js',
        env: {
          DATABASE_URL: 'postgres://explicit.test/db',
          REDIS_URL: 'redis://explicit.test',
          MONERO_URL: 'http://owned.test:38081',
        },
      },
    ],
    stacks: { deployed: stack },
  };
  const definitions = new Map([
    [
      'api',
      {
        name: 'api',
        version: '1',
        processes: [],
        requires: { postgres: {}, redis: {} },
        omnitronConfig: {
          database: true,
          redis: true,
          infrastructure: { monero: { docker: { image: 'private/monero:1' } } },
        },
      },
    ],
  ]);
  Object.assign(service, {
    logger,
    registry: { get: () => ({ name: 'sample', path: '/unused' }) },
    configRegistry: new Map([['sample', { config, loadedAt: 1 }]]),
    stackStates: new Map([['sample/deployed', { project: 'sample', stack: 'deployed', config: stack }]]),
    stackEnvFor: vi.fn(async () => ({ api: { CUSTOM_SETTING: 'retained' } })),
    loadAppDefinitions: vi.fn(async () => definitions),
    infraManager: {
      getPortAllocation: vi.fn(),
      getNormalizedServices: vi.fn(),
      provisionStack: vi.fn(),
      planStack: vi.fn(),
    },
    runStackMigrations: vi.fn(),
    orchestrator: { startApp: vi.fn(async () => {}) },
  });
  return { service, config };
}
describe('node allocations do not acquire infrastructure ownership from bootstrap requirements', () => {
  it('writes an explicit controller binding and refuses a guessed source stack', () => {
    const input = {
      project: 'sample',
      sourceStack: 'test',
      artifactRoot: '/artifacts',
      apps: [{ name: 'api' } as never],
      artifacts: [{ app: 'api', version: '1' }],
    };
    const body = renderNodeAppConfig(input),
      config = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
    expect(config.stacks.deployed).toMatchObject({
      type: 'local',
      infrastructureOwnership: 'controller',
      managedOrigin: { project: 'sample', stack: 'test' },
    });
    expect(() => renderNodeAppConfig({ ...input, sourceStack: '' })).toThrow(/explicit source stack/);
  });
  it('keeps ordinary local inference, but rejects missing or contradictory ownership', () => {
    expect(ownsStackInfrastructure({ type: 'local' })).toBe(true);
    expect(ownsStackInfrastructure(delegated())).toBe(false);
    expect(ownsStackInfrastructure({ type: 'local', infrastructureOwnership: 'external' })).toBe(false);
    expect(() => infrastructureOwnership({ type: 'local', infrastructureOwnership: 'controller' })).toThrow(
      /explicit source/
    );
    expect(() =>
      infrastructureOwnership({ type: 'local', managedOrigin: { project: 'sample', stack: 'test' } })
    ).toThrow(/migrate/);
    expect(() => ownsStackInfrastructure({ ...delegated(), infrastructure: { postgres: {} } })).toThrow(/non-owning/);
    expect(() => ownsStackInfrastructure({ ...delegated(), serviceOverrides: { monero: { enabled: false } } })).toThrow(
      /non-owning/
    );
    expect(() => ownsStackInfrastructure({ type: 'remote', infrastructureOwnership: 'external' })).toThrow(
      /local application allocations/
    );
  });
  it.each(['controller', 'external'] as const)(
    'starts applications with explicit bindings and no provisioning or migrations in %s mode',
    async (mode) => {
      const stack = { ...delegated(), infrastructureOwnership: mode },
        { service, config } = harness(stack);
      await service.startLocalStack('sample', 'deployed', stack, config);
      expect(service.infraManager.provisionStack).not.toHaveBeenCalled();
      expect(service.runStackMigrations).not.toHaveBeenCalled();
      const [entry] = service.orchestrator.startApp.mock.calls[0];
      expect(entry).toMatchObject({
        name: 'sample/deployed/api',
        env: {
          DATABASE_URL: 'postgres://explicit.test/db',
          REDIS_URL: 'redis://explicit.test',
          MONERO_URL: 'http://owned.test:38081',
          CUSTOM_SETTING: 'retained',
        },
      });
      expect(entry.env.S3_ENDPOINT).toBeUndefined();
    }
  );
  it('diagnoses delegated dependencies as unverified external connections without a local Docker plan', async () => {
    const { service } = harness(delegated());
    const report = await service.inspectStackReadiness('sample', 'deployed');
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        code: 'infrastructure.delegated',
        state: 'pass',
        message: expect.stringContaining('sample/test'),
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({ code: 'infrastructure.external-readiness', state: 'unknown' })
    );
    expect(service.infraManager.planStack).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain('postgres://explicit.test');
  });
  it('fences concurrent starts and handoffs while relinquishing stale monitoring', async () => {
    const stack = delegated(), { service, config } = harness(stack);
    service.startsInFlight = new Map(); service.stopsInFlight = new Map(); service.reconcilingStacks = false;
    service.loadProjectConfig = vi.fn(async () => config);
    const state = service.stackStates.get('sample/deployed'); state.infraService = { stale: true };
    let complete!: () => void;
    const draining = new Promise<void>(resolve => { complete = resolve; });
    service.infraManager.refreshOwnership = vi.fn(async () => { await draining; return { released: ['legacy-service'], adopted: [] }; });
    const refresh = service.refreshInfrastructureOwnership('sample', 'deployed');
    await expect(service.startStack('sample', 'deployed')).rejects.toThrow(/frozen/);
    await expect(service.prepareHandoff()).rejects.toThrow(/lifecycle/);
    complete();
    expect(await refresh).toEqual({ released: ['legacy-service'], adopted: [] });
    expect(state.infraService).toBeNull(); expect(state.config).toBe(stack);
    expect(service.loadAppDefinitions).not.toHaveBeenCalled(); expect(service.ownershipFrozen).toBe(false);
  });
  it('enforces ownership below the project caller and releases only monitoring on explicit refresh', async () => {
    const manager = new StackInfrastructureManager(logger as never),
      config = delegated();
    await expect(manager.provisionStack('sample', 'deployed', config, {})).rejects.toThrow(/does not own/);
    expect(await manager.planStack('sample', 'deployed', config, {})).toEqual([]);
    let complete!: () => void;
    const drained = new Promise<void>(resolve => { complete = resolve; });
    const release = vi.fn(async () => { await drained; return ['sample-deployed-monero']; });
    (manager as any).instances.set('sample/deployed', { relinquishMonitoring: release });
    (manager as any).portAllocations.set('sample/deployed', {});
    const pending = manager.refreshOwnership('sample', 'deployed', config, {});
    expect(manager.getInstance('sample', 'deployed')).not.toBeNull();
    complete();
    expect(await pending).toEqual({ released: ['sample-deployed-monero'], adopted: [] });
    expect(release).toHaveBeenCalledOnce();
    expect(manager.getInstance('sample', 'deployed')).toBeNull();
    expect(manager.getPortAllocation('sample', 'deployed')).toBeNull();
    expect(await manager.refreshOwnership('sample', 'deployed', config, {})).toEqual({ released: [], adopted: [] });
    expect(await manager.prepareHandoff()).toEqual([]);
  });
});
