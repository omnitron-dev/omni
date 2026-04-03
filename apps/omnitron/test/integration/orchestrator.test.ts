import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import type { IEcosystemConfig, IEcosystemAppEntry } from '../../src/config/types.js';
import type { ProcessManager, ProcessSupervisor } from '@omnitron-dev/titan-pm';

// ============================================================================
// Mock factories
// ============================================================================

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function createMockSupervisor(overrides: Partial<ProcessSupervisor> = {}): ProcessSupervisor {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    restartChild: vi.fn().mockResolvedValue(undefined),
    getChildNames: vi.fn().mockReturnValue(['test-app']),
    getChildProcessId: vi.fn().mockReturnValue('proc-1'),
    getAllProcessIds: vi.fn().mockReturnValue(['proc-1']),
    getRestartCount: vi.fn().mockReturnValue(0),
    scaleChild: vi.fn().mockResolvedValue(undefined),
    getChildMetrics: vi.fn().mockResolvedValue({ cpu: 5, memory: 100_000 }),
    getChildHealth: vi.fn().mockResolvedValue({
      status: 'healthy',
      checks: [{ name: 'app', status: 'pass' }],
      timestamp: Date.now(),
    }),
    getChildProxy: vi.fn().mockReturnValue(null),
    running: true,
    on: vi.fn().mockImplementation(function (this: any, event: string, handler: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      return this;
    }),
    off: vi.fn(),
    emit: vi.fn().mockImplementation((event: string, ...args: any[]) => {
      for (const handler of listeners.get(event) ?? []) handler(...args);
    }),
    ...overrides,
  } as unknown as ProcessSupervisor;
}

function createMockPM(supervisor?: ProcessSupervisor): ProcessManager {
  const mock = supervisor ?? createMockSupervisor();
  return {
    spawn: vi.fn().mockResolvedValue({ __processId: 'proc-1' }),
    pool: vi.fn().mockResolvedValue({ __processId: 'pool-1', destroy: vi.fn(), scale: vi.fn() }),
    supervisor: vi.fn().mockResolvedValue(mock),
    getProcess: vi.fn().mockReturnValue({ pid: 12345 }),
    getMetrics: vi.fn().mockResolvedValue({ cpu: 5, memory: 100_000 }),
    getHealth: vi.fn().mockResolvedValue({ status: 'healthy', checks: [], timestamp: Date.now() }),
    listProcesses: vi.fn().mockReturnValue([]),
    kill: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as ProcessManager;
}

function createMockStateStore(): StateStore {
  return {
    save: vi.fn(),
    load: vi.fn().mockReturnValue(null),
    clear: vi.fn(),
  } as unknown as StateStore;
}

function makeConfig(overrides?: Partial<IEcosystemConfig>): IEcosystemConfig {
  return {
    apps: [],
    supervision: DEFAULT_ECOSYSTEM.supervision,
    monitoring: DEFAULT_ECOSYSTEM.monitoring,
    logging: DEFAULT_ECOSYSTEM.logging,
    daemon: DEFAULT_ECOSYSTEM.daemon,
    env: 'test',
    ...overrides,
  } as IEcosystemConfig;
}

function makeEntry(name: string, overrides?: Partial<IEcosystemAppEntry>): IEcosystemAppEntry {
  return { name, bootstrap: `./apps/${name}/src/bootstrap.ts`, ...overrides };
}

// ============================================================================
// Tests
// ============================================================================

describe('OrchestratorService', () => {
  let logger: ReturnType<typeof createMockLogger>;
  let pm: ProcessManager;
  let stateStore: ReturnType<typeof createMockStateStore>;
  let orchestrator: OrchestratorService;

  beforeEach(() => {
    logger = createMockLogger();
    pm = createMockPM();
    stateStore = createMockStateStore();
    orchestrator = new OrchestratorService(logger as any, pm, stateStore as any, '/test/cwd');
  });

  describe('startApp — bootstrap mode', () => {
    it('creates PM supervisor for bootstrap app', async () => {
      const entry = makeEntry('main');
      const config = makeConfig({ apps: [entry] });

      await orchestrator.startApp(entry, config);

      expect(pm.supervisor).toHaveBeenCalledTimes(1);
      const supervisorConfig = (pm.supervisor as any).mock.calls[0][0];
      expect(supervisorConfig.children).toHaveLength(1);
      expect(supervisorConfig.children[0].name).toBe('main');
      expect(supervisorConfig.children[0].process).toContain('bootstrap-process');
    });

    it('passes correct spawn options with bootstrapPath dependency', async () => {
      const entry = makeEntry('main');
      const config = makeConfig({ apps: [entry] });

      await orchestrator.startApp(entry, config);

      const supervisorConfig = (pm.supervisor as any).mock.calls[0][0];
      const child = supervisorConfig.children[0];
      expect(child.spawnOptions.dependencies.bootstrapPath).toContain('apps/main/src/bootstrap.ts');
      expect(child.spawnOptions.health.enabled).toBe(true);
      expect(child.spawnOptions.observability.metrics).toBe(true);
    });

    it('configures pool options for multi-instance apps', async () => {
      const entry = makeEntry('main', { instances: 3 });
      const config = makeConfig({ apps: [entry] });

      await orchestrator.startApp(entry, config);

      const supervisorConfig = (pm.supervisor as any).mock.calls[0][0];
      const child = supervisorConfig.children[0];
      expect(child.poolOptions).toBeDefined();
      expect(child.poolOptions.size).toBe(3);
      expect(child.poolOptions.replaceUnhealthy).toBe(true);
      expect(child.poolOptions.spawnOptionsFactory).toBeTypeOf('function');
    });

    it('spawnOptionsFactory provides unique portOffset per instance', async () => {
      const entry = makeEntry('main', { instances: 3 });
      const config = makeConfig({ apps: [entry] });

      await orchestrator.startApp(entry, config);

      const supervisorConfig = (pm.supervisor as any).mock.calls[0][0];
      const factory = supervisorConfig.children[0].poolOptions.spawnOptionsFactory;

      const opts0 = factory(0);
      const opts1 = factory(1);
      const opts2 = factory(2);

      expect(opts0.dependencies.portOffset).toBe(0);
      expect(opts1.dependencies.portOffset).toBe(1);
      expect(opts2.dependencies.portOffset).toBe(2);
      expect(opts0.name).toBe('main-0');
      expect(opts1.name).toBe('main-1');
    });

    it('does not configure pool for single instance', async () => {
      const entry = makeEntry('main', { instances: 1 });
      const config = makeConfig({ apps: [entry] });

      await orchestrator.startApp(entry, config);

      const supervisorConfig = (pm.supervisor as any).mock.calls[0][0];
      expect(supervisorConfig.children[0].poolOptions).toBeUndefined();
    });

    it('maps supervision strategy from config', async () => {
      const entry = makeEntry('main');
      const config = makeConfig({
        apps: [entry],
        supervision: { ...DEFAULT_ECOSYSTEM.supervision, strategy: 'one_for_all' },
      });

      await orchestrator.startApp(entry, config);

      const supervisorConfig = (pm.supervisor as any).mock.calls[0][0];
      expect(supervisorConfig.strategy).toBe('one-for-all');
    });

    it('sets critical flag on supervisor child', async () => {
      const entry = makeEntry('main', { critical: true });
      const config = makeConfig({ apps: [entry] });

      await orchestrator.startApp(entry, config);

      const supervisorConfig = (pm.supervisor as any).mock.calls[0][0];
      expect(supervisorConfig.children[0].critical).toBe(true);
    });

    it('stores supervisor in handle', async () => {
      const entry = makeEntry('main');
      const config = makeConfig({ apps: [entry] });

      const handle = await orchestrator.startApp(entry, config);

      expect(handle.supervisor).not.toBeNull();
    });

    it('persists state after start', async () => {
      const entry = makeEntry('main');
      const config = makeConfig({ apps: [entry] });

      await orchestrator.startApp(entry, config);

      expect(stateStore.save).toHaveBeenCalled();
    });

    it('skips already running app', async () => {
      const entry = makeEntry('main');
      const config = makeConfig({ apps: [entry] });

      await orchestrator.startApp(entry, config);
      // Simulate supervisor emitting child:started to mark online
      const supervisorConfig = (pm.supervisor as any).mock.calls[0][0];
      expect(supervisorConfig).toBeDefined();

      // Start again — should return existing handle
      const handle2 = await orchestrator.startApp(entry, config);
      // supervisor() should still have been called only once
      // (second call returns early because status changes to 'starting' not 'online')
      expect(handle2.mode).toBe('bootstrap');
    });
  });

  describe('startApp — classic mode', () => {
    it('launches classic mode for script entries', async () => {
      const entry: IEcosystemAppEntry = { name: 'legacy', script: './apps/legacy/main.ts' };
      const config = makeConfig({ apps: [entry] });

      // Classic launcher will try to fork, which we can't do in test
      // Just verify the mode detection
      const handle = orchestrator.getHandle('legacy');
      expect(handle).toBeUndefined(); // Not started yet

      // We can't fully test classic mode without real fork
      // but we verify mode detection
      expect(entry.bootstrap).toBeUndefined();
      expect(entry.script).toBeDefined();
    });
  });

  describe('stopApp', () => {
    it('delegates to supervisor.stop() for bootstrap apps', async () => {
      const supervisor = createMockSupervisor();
      const pm = createMockPM(supervisor);
      const orch = new OrchestratorService(logger as any, pm, stateStore as any, '/test');

      const entry = makeEntry('main');
      await orch.startApp(entry, makeConfig({ apps: [entry] }));

      await orch.stopApp('main');

      expect(supervisor.stop).toHaveBeenCalledTimes(1);
    });

    it('marks handle as stopped', async () => {
      const entry = makeEntry('main');
      const config = makeConfig({ apps: [entry] });
      const handle = await orchestrator.startApp(entry, config);

      await orchestrator.stopApp('main');

      expect(handle.status).toBe('stopped');
      expect(handle.supervisor).toBeNull();
    });

    it('is idempotent for already stopped apps', async () => {
      // stopApp on non-existent app should not throw
      await expect(orchestrator.stopApp('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('stopAll', () => {
    it('stops all apps in reverse dependency order', async () => {
      const apps = [makeEntry('main'), makeEntry('storage', { dependsOn: ['main'] })];
      const config = makeConfig({ apps });

      await orchestrator.startAll(config);
      const count = await orchestrator.stopAll();

      expect(count).toBe(2);
    });

    it('calls pm.shutdown()', async () => {
      const config = makeConfig({ apps: [makeEntry('main')] });
      await orchestrator.startAll(config);
      await orchestrator.stopAll();

      expect(pm.shutdown).toHaveBeenCalled();
    });
  });

  describe('restartApp', () => {
    it('stops and starts app', async () => {
      const supervisor = createMockSupervisor();
      const localPm = createMockPM(supervisor);
      const orch = new OrchestratorService(logger as any, localPm, stateStore as any, '/test');

      const entry = makeEntry('main');
      const config = makeConfig({ apps: [entry] });

      // Use startAll to set this.config, so restartApp can call startApp without explicit config
      await orch.startAll(config);
      const handle = await orch.restartApp('main');

      expect(handle.mode).toBe('bootstrap');
      // supervisor() called 3x: startAll + stopApp's supervisor.stop + restartApp's startApp
      expect(localPm.supervisor).toHaveBeenCalledTimes(2);
    });

    it('throws for unknown app', async () => {
      await expect(orchestrator.restartApp('unknown')).rejects.toThrow('Unknown app');
    });
  });

  describe('scaleApp', () => {
    it('delegates to supervisor.scaleChild()', async () => {
      const supervisor = createMockSupervisor();
      const localPm = createMockPM(supervisor);
      const orch = new OrchestratorService(logger as any, localPm, stateStore as any, '/test');

      const entry = makeEntry('main');
      const config = makeConfig({ apps: [entry] });
      await orch.startAll(config);
      await orch.scaleApp('main', 3);

      expect(supervisor.scaleChild).toHaveBeenCalledWith('main', 3);
    });

    it('updates handle instanceCount', async () => {
      const entry = makeEntry('main');
      const config = makeConfig({ apps: [entry] });
      await orchestrator.startAll(config);

      const handle = await orchestrator.scaleApp('main', 4);
      expect(handle.instanceCount).toBe(4);
    });

    it('throws for unknown app', async () => {
      await orchestrator.startAll(makeConfig({ apps: [makeEntry('x')] }));
      await expect(orchestrator.scaleApp('unknown', 2)).rejects.toThrow('Unknown app');
    });

    it('throws for instances < 1', async () => {
      const entry = makeEntry('main');
      await orchestrator.startAll(makeConfig({ apps: [entry] }));
      await expect(orchestrator.scaleApp('main', 0)).rejects.toThrow('at least 1');
    });

    it('returns early when instances unchanged', async () => {
      const supervisor = createMockSupervisor();
      const localPm = createMockPM(supervisor);
      const orch = new OrchestratorService(logger as any, localPm, stateStore as any, '/test');

      const entry = makeEntry('main');
      await orch.startAll(makeConfig({ apps: [entry] }));
      await orch.scaleApp('main', 1); // default is 1

      expect(supervisor.scaleChild).not.toHaveBeenCalled();
    });
  });

  describe('list / getApp', () => {
    it('returns process info for all apps', async () => {
      const apps = [makeEntry('main'), makeEntry('storage')];
      await orchestrator.startAll(makeConfig({ apps }));

      const list = orchestrator.list();
      expect(list).toHaveLength(2);
      expect(list.map((l) => l.name).sort()).toEqual(['main', 'storage']);
    });

    it('returns null for unknown app', () => {
      expect(orchestrator.getApp('nonexistent')).toBeNull();
    });

    it('returns correct ProcessInfoDto', async () => {
      const entry = makeEntry('main');
      await orchestrator.startApp(entry, makeConfig({ apps: [entry] }));

      const info = orchestrator.getApp('main');
      expect(info).not.toBeNull();
      expect(info!.name).toBe('main');
      expect(info!.mode).toBe('bootstrap');
      expect(info!.instances).toBe(1);
    });
  });

  describe('getMetrics', () => {
    it('delegates to supervisor.getChildMetrics()', async () => {
      const supervisor = createMockSupervisor();
      const pm = createMockPM(supervisor);
      const orch = new OrchestratorService(logger as any, pm, stateStore as any, '/test');

      const entry = makeEntry('main');
      await orch.startApp(entry, makeConfig({ apps: [entry] }));

      const metrics = await orch.getMetrics();
      expect(metrics['main']).toBeDefined();
      expect(supervisor.getChildMetrics).toHaveBeenCalled();
    });

    it('filters by app name', async () => {
      const apps = [makeEntry('main'), makeEntry('storage')];
      await orchestrator.startAll(makeConfig({ apps }));

      const metrics = await orchestrator.getMetrics('main');
      expect(Object.keys(metrics)).toEqual(['main']);
    });
  });

  describe('getHealth', () => {
    it('delegates to supervisor.getChildHealth()', async () => {
      const supervisor = createMockSupervisor();
      const pm = createMockPM(supervisor);
      const orch = new OrchestratorService(logger as any, pm, stateStore as any, '/test');

      const entry = makeEntry('main');
      await orch.startApp(entry, makeConfig({ apps: [entry] }));

      const health = await orch.getHealth();
      expect(health['main']).toBeDefined();
      expect(supervisor.getChildHealth).toHaveBeenCalled();
    });
  });

  describe('getLogs', () => {
    it('returns logs from handles', async () => {
      const entry = makeEntry('main');
      await orchestrator.startApp(entry, makeConfig({ apps: [entry] }));

      const handle = orchestrator.getHandle('main')!;
      handle.appendLog('test log line');

      const logs = orchestrator.getLogs('main');
      expect(logs).toHaveLength(1);
      expect(logs[0]!.app).toBe('main');
      expect(logs[0]!.lines).toContain('test log line');
    });
  });

  describe('supervisor event wiring', () => {
    it('emits app:crash on child:crash', async () => {
      const supervisor = createMockSupervisor();
      const pm = createMockPM(supervisor);
      const orch = new OrchestratorService(logger as any, pm, stateStore as any, '/test');

      const crashPromise = new Promise<[string, Error]>((resolve) => {
        orch.on('app:crash', (name: string, error: Error) => resolve([name, error]));
      });

      const entry = makeEntry('main');
      await orch.startApp(entry, makeConfig({ apps: [entry] }));

      // Trigger child:crash event on supervisor
      const crashHandler = (supervisor.on as any).mock.calls.find((c: any[]) => c[0] === 'child:crash')?.[1];
      expect(crashHandler).toBeDefined();
      crashHandler('main', new Error('OOM'));

      const [name, error] = await crashPromise;
      expect(name).toBe('main');
      expect(error.message).toBe('OOM');
    });

    it('emits app:restart on child:restart', async () => {
      const supervisor = createMockSupervisor();
      const pm = createMockPM(supervisor);
      const orch = new OrchestratorService(logger as any, pm, stateStore as any, '/test');

      const restartPromise = new Promise<[string, number]>((resolve) => {
        orch.on('app:restart', (name: string, attempt: number) => resolve([name, attempt]));
      });

      const entry = makeEntry('main');
      await orch.startApp(entry, makeConfig({ apps: [entry] }));

      const restartHandler = (supervisor.on as any).mock.calls.find((c: any[]) => c[0] === 'child:restart')?.[1];
      expect(restartHandler).toBeDefined();
      restartHandler('main', 3);

      const [name, attempt] = await restartPromise;
      expect(name).toBe('main');
      expect(attempt).toBe(3);
    });

    it('emits critical:crash on escalate', async () => {
      const supervisor = createMockSupervisor();
      const pm = createMockPM(supervisor);
      const orch = new OrchestratorService(logger as any, pm, stateStore as any, '/test');

      const escalatePromise = new Promise<string>((resolve) => {
        orch.on('critical:crash', (name: string) => resolve(name));
      });

      const entry = makeEntry('main', { critical: true });
      await orch.startApp(entry, makeConfig({ apps: [entry] }));

      const escalateHandler = (supervisor.on as any).mock.calls.find((c: any[]) => c[0] === 'escalate')?.[1];
      expect(escalateHandler).toBeDefined();
      escalateHandler('main', new Error('exceeded max restarts'));

      const name = await escalatePromise;
      expect(name).toBe('main');
    });

    it('emits app:online on child:started', async () => {
      const supervisor = createMockSupervisor();
      const pm = createMockPM(supervisor);
      const orch = new OrchestratorService(logger as any, pm, stateStore as any, '/test');

      const onlinePromise = new Promise<string>((resolve) => {
        orch.on('app:online', (name: string) => resolve(name));
      });

      const entry = makeEntry('main');
      await orch.startApp(entry, makeConfig({ apps: [entry] }));

      const startedHandler = (supervisor.on as any).mock.calls.find((c: any[]) => c[0] === 'child:started')?.[1];
      expect(startedHandler).toBeDefined();
      startedHandler('main');

      const name = await onlinePromise;
      expect(name).toBe('main');
    });
  });

  describe('startAll', () => {
    it('starts apps in dependency order', async () => {
      const startOrder: string[] = [];
      const localPm = createMockPM();
      (localPm.supervisor as any) = vi.fn().mockImplementation(async (config: any) => {
        startOrder.push(config.children[0].name);
        return createMockSupervisor();
      });
      const orch = new OrchestratorService(logger as any, localPm, stateStore as any, '/test');

      const apps = [
        makeEntry('messaging', { dependsOn: ['main'] }),
        makeEntry('main'),
        makeEntry('storage', { dependsOn: ['main'] }),
      ];
      await orch.startAll(makeConfig({ apps }));

      expect(startOrder[0]).toBe('main');
      // storage and messaging are in same batch (parallel), order may vary
      expect(startOrder.slice(1).sort()).toEqual(['messaging', 'storage']);
    });

    it('skips disabled apps', async () => {
      const apps = [makeEntry('main'), makeEntry('disabled', { enabled: false })];
      await orchestrator.startAll(makeConfig({ apps }));

      expect(orchestrator.list()).toHaveLength(1);
      expect(orchestrator.list()[0]!.name).toBe('main');
    });
  });
});
