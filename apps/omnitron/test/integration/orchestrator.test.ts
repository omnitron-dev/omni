import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager, type ISupervisorConfig } from '@omnitron-dev/titan-pm';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import type { StateStore } from '../../src/daemon/state-store.js';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import type { IEcosystemConfig, IEcosystemAppEntry, IProcessEntry } from '../../src/config/types.js';

// Source-level admission tests use the real PM and supervisor, with only the
// supervisor's start boundary held for configuration/event assertions. Actual
// bootstrap and pool processes are exercised by runtime/backend-handoff.mjs.
// Classic tests below fork real private children through public startApp.
let directory: string;
let pm: ProcessManager;
let service: OrchestratorService;
const save = vi.fn<StateStore['save']>();
const logger = createNullLogger();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const owned = new Set<number>();

beforeEach(async () => {
  directory = await fs.mkdtemp('/tmp/omni-orchestrator-');
  pm = new ProcessManager(logger, { testing: { useMockSpawner: false }, isolation: 'child' });
  save.mockClear();
  service = new OrchestratorService(logger, pm, { save } as unknown as StateStore, directory,
    { reapForeignOrphans: false });
  service.setTopologyDirectory(path.join(directory, 'topology'));
});
afterEach(async () => {
  try { await service?.stopAll(true); }
  finally {
    try { await pm?.shutdown({ force: true, timeout: 5000 }); }
    finally {
      for (const pid of owned) expect(alive(pid), `private child ${pid} leaked`).toBe(false);
      owned.clear();
      await fs.rm(directory, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  }
});
function config(apps: IEcosystemAppEntry[], overrides: Partial<IEcosystemConfig> = {}): IEcosystemConfig {
  return { ...structuredClone(DEFAULT_ECOSYSTEM), apps, ...overrides } as IEcosystemConfig;
}
async function classic(name: string, overrides: Partial<IEcosystemAppEntry> = {}): Promise<IEcosystemAppEntry> {
  const script = path.join(directory, `${name}.cjs`);
  await fs.writeFile(script, `const fs=require('node:fs');
const history=${JSON.stringify(path.join(directory, 'events.jsonl'))};
const record=event=>fs.appendFileSync(history,JSON.stringify({event,name:${JSON.stringify(name)},pid:process.pid})+'\\n');
record('start'); process.stdout.write('startup one\\n    startup two\\n');
process.on('SIGTERM',()=>{record('stop'); process.exit(0)});
process.send({type:'ready'}); setInterval(()=>{},1000);
`);
  return { name, script, cwd: directory, watch: false, restartPolicy: { enabled: false }, ...overrides };
}
async function start(entry: IEcosystemAppEntry) {
  const handle = await service.startApp(entry, config([entry]));
  if (handle.pid) owned.add(handle.pid);
  return handle;
}
async function events(): Promise<Array<{event: string; name: string; pid: number}>> {
  return (await fs.readFile(path.join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
}
async function bootstrap(processes: IProcessEntry[] = [{ name: 'worker', module: './module.mjs' }]) {
  const file = path.join(directory, 'bootstrap.mjs');
  await fs.writeFile(file, `export default ${JSON.stringify({ name: 'fixture', processes })};`);
  return { name: 'fixture', bootstrap: file, cwd: directory, watch: false } satisfies IEcosystemAppEntry;
}
function holdSupervisor() {
  const create = pm.createSupervisor.bind(pm);
  return vi.spyOn(pm, 'createSupervisor').mockImplementation((...args) => {
    const supervisor = create(...args);
    vi.spyOn(supervisor, 'start').mockResolvedValue(undefined);
    return supervisor;
  });
}

describe('public orchestrator lifecycle with real classic children', () => {
  it('starts a distinct process, reports online identity and persists it', async () => {
    const handle = await start(await classic('worker'));
    expect(handle.mode).toBe('classic'); expect(handle.status).toBe('online');
    expect(handle.pid).toBeGreaterThan(0); expect(handle.pid).not.toBe(process.pid);
    expect(alive(handle.pid!)).toBe(true);
    expect(service.getApp('worker')).toMatchObject({ name: 'worker', mode: 'classic', status: 'online', pid: handle.pid });
    expect(save.mock.lastCall?.[0].apps).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'worker', pid: handle.pid, status: 'online' })]));
  });
  it('deduplicates simultaneous and repeated starts without another process', async () => {
    const entry = await classic('worker');
    const [one, two] = await Promise.all([start(entry), start(entry)]);
    const three = await start(entry);
    expect(two).toBe(one); expect(three).toBe(one);
    expect((await events()).filter(row => row.event === 'start')).toHaveLength(1);
  });
  it('waits for exit and permits repeated stop', async () => {
    const handle = await start(await classic('worker')); const pid = handle.pid!;
    await service.stopApp('worker'); await service.stopApp('worker');
    expect(alive(pid)).toBe(false); expect(handle.status).toBe('stopped');
    expect((await events()).filter(row => row.event === 'stop')).toHaveLength(1);
    await expect(service.stopApp('missing')).resolves.toBeUndefined();
  });
  it('restarts the retained entry under a new process and generation', async () => {
    const before = await start(await classic('worker'));
    const pid = before.pid!, generation = before.generation;
    const after = await service.restartApp('worker'); owned.add(after.pid!);
    expect(after.pid).not.toBe(pid); expect(alive(pid)).toBe(false);
    expect(after.generation).not.toBe(generation); expect(after.status).toBe('online');
    expect((await events()).map(row => row.event)).toEqual(['start', 'stop', 'start']);
  });
  it('starts dependencies first and stops consumers before providers', async () => {
    const provider = await classic('provider'), consumer = await classic('consumer', { dependsOn: ['provider'] });
    await service.startAll(config([consumer, provider]));
    for (const item of service.list()) if (item.pid) owned.add(item.pid);
    expect((await events()).map(row => row.name)).toEqual(['provider', 'consumer']);
    expect(await service.stopAll()).toBe(2);
    expect((await events()).filter(row => row.event === 'stop').map(row => row.name)).toEqual(['consumer', 'provider']);
  });
  it('does not shut down PM on reversible stopAll and can start again', async () => {
    const entry = await classic('worker'); const shutdown = vi.spyOn(pm, 'shutdown');
    await service.startAll(config([entry])); owned.add(service.getHandle('worker')!.pid!);
    await service.stopAll(); expect(shutdown).not.toHaveBeenCalled();
    await service.startAll(config([entry])); owned.add(service.getHandle('worker')!.pid!);
    expect(service.getApp('worker')).toMatchObject({ status: 'online' });
  });
  it('skips disabled and transitively blocked apps but starts independent apps', async () => {
    const missing: IEcosystemAppEntry = { name: 'bad', bootstrap: path.join(directory, 'absent.mjs') };
    await service.startAll(config([missing, await classic('disabled', { enabled: false }),
      await classic('dependent', { dependsOn: ['bad'] }), await classic('indirect', { dependsOn: ['dependent'] }), await classic('healthy')]));
    owned.add(service.getHandle('healthy')!.pid!);
    expect(service.getHandle('disabled')).toBeUndefined(); expect(service.getHandle('dependent')).toBeUndefined();
    expect(service.getHandle('indirect')).toBeUndefined(); expect(service.getApp('healthy')).toMatchObject({ status: 'online' });
    expect((await events()).map(row => row.name)).toEqual(['healthy']);
  });
  it('captures actual startup output and keeps diagnostics scoped', async () => {
    await start(await classic('worker'));
    await vi.waitFor(() => expect(service.getLogs('worker')[0]?.lines.join('\n')).toContain('startup two'));
    expect(service.getLogs('worker')[0]?.lines.join('\n')).toContain('startup one');
    expect(Object.keys(await service.getHealth('worker'))).toEqual(['worker']);
    expect(await service.getHealth('missing')).toEqual({}); expect(await service.getMetrics('missing')).toEqual({});
    expect(service.getApp('missing')).toBeNull();
    await service.stopApp('worker'); expect((await service.getHealth('worker'))['worker']?.status).not.toBe('healthy');
  });
  it('refuses unknown restart/scale and classic replication explicitly', async () => {
    await expect(service.restartApp('missing')).rejects.toThrow('Unknown app');
    await expect(service.scaleApp('missing', 2, 'worker')).rejects.toThrow(/App/);
    const handle = await start(await classic('worker')); const pid = handle.pid;
    await expect(service.scaleApp('worker', 3, 'worker')).rejects.toThrow('Classic'); expect(handle.pid).toBe(pid);
    expect((await events()).filter(row => row.event === 'start')).toHaveLength(1);
  });
});

describe('bootstrap admission at the current PM boundary', () => {
  it('stays starting until providers are published, even when every child reports ready', async () => {
    const create = holdSupervisor();
    const entry = { ...await bootstrap([
      { name: 'worker', module: './module.mjs', topology: { expose: true } },
    ]), restartPolicy: { enabled: false } };
    const online = vi.fn(); service.on('app:online', online);
    const implementation = create.getMockImplementation()!;
    create.mockImplementation((...args) => {
      const supervisor = implementation(...args);
      vi.spyOn(supervisor, 'start').mockImplementation(async () => { supervisor.emit('child:started', 'fixture/worker'); });
      vi.spyOn(supervisor, 'getChildProxy').mockReturnValue({
        getExposedServices: async () => {
          expect(service.getHandle(entry.name)?.status).toBe('starting');
          expect(online).not.toHaveBeenCalled();
          return [{ name: 'Worker', methods: ['run'] }];
        }, callExposedService: async () => 'ready',
      } as never);
      return supervisor;
    });
    const handle = await start(entry);
    expect(handle.status).toBe('online');
    expect(online).toHaveBeenCalledExactlyOnceWith(entry.name);
    expect(handle.topology?.router.getServiceNames()).toEqual(['Worker@1.0.0']);
  });

  it('owns and closes the private listener when the first pool fails admission', async () => {
    const entry = { ...await bootstrap([
      { name: 'workers', module: './module.mjs', instances: 2, topology: { expose: true } },
    ]), restartPolicy: { enabled: false } };
    let ownedBeforePool = false;
    vi.spyOn(pm, 'pool').mockImplementationOnce(async () => {
      const handle = service.getHandle(entry.name)!;
      ownedBeforePool = Boolean(handle.topology?.url);
      expect((await fs.stat(handle.topology!.url.slice('unix://'.length))).isSocket()).toBe(true);
      throw new Error('private pool admission failed');
    });
    await expect(start(entry)).rejects.toThrow('private pool admission failed');
    expect(ownedBeforePool).toBe(true);
    expect(service.getHandle(entry.name)?.topology).toBeNull();
    expect(service.getHandle(entry.name)?.lastExit?.message).toContain('private pool admission failed');
    expect(await fs.readdir(path.join(directory, 'topology'))).toEqual([]);
  });

  it('closes only the failed generation when provider discovery rejects after supervisor startup', async () => {
    const create = holdSupervisor();
    const entry = { ...await bootstrap([
      { name: 'worker', module: './module.mjs', topology: { expose: true } },
      { name: 'consumer', module: './module.mjs', topology: { access: ['Worker'] } },
    ]), restartPolicy: { enabled: false } };
    const implementation = create.getMockImplementation()!;
    create.mockImplementation((...args) => {
      const supervisor = implementation(...args);
      vi.spyOn(supervisor, 'getChildProxy').mockReturnValue({ getExposedServices: async () => {
        throw new Error('provider discovery disconnected');
      } } as never);
      vi.spyOn(supervisor, 'stop').mockResolvedValue(undefined);
      return supervisor;
    });
    await expect(start(entry)).rejects.toThrow('provider discovery disconnected');
    const handle = service.getHandle(entry.name)!;
    expect(create.mock.results[0]!.value.stop).toHaveBeenCalledOnce();
    expect(handle.supervisor).toBeNull();
    expect(handle.topology).toBeNull();
    expect(handle.lastExit?.message).toContain('provider discovery disconnected');
    expect(await fs.readdir(path.join(directory, 'topology'))).toEqual([]);
    const definition = create.mock.calls[0]![0] as ISupervisorConfig;
    const dependencies = definition.children![1]!.spawnOptions!.dependencies as Record<string, unknown>;
    expect(dependencies.__topologyConnects).toEqual(['Worker']);
    expect(dependencies.__daemonSocketUrl).toMatch(/\/topology\/t-[^/]+\/rpc\.sock$/);
  });

  it('refuses a missing definition before creating a supervisor', async () => {
    const create = vi.spyOn(pm, 'createSupervisor');
    await expect(start({ name: 'missing', bootstrap: path.join(directory, 'absent.mjs') })).rejects.toThrow('Could not load');
    expect(create).not.toHaveBeenCalled();
  });
  it('refuses an empty topology instead of silently starting legacy single mode', async () => {
    const create = vi.spyOn(pm, 'createSupervisor');
    await expect(start(await bootstrap([]))).rejects.toThrow('must export defineSystem() result');
    expect(create).not.toHaveBeenCalled();
  });
  it('forwards qualified child identity, bootstrap, environment and bounded health settings', async () => {
    const create = holdSupervisor();
    const entry = { ...await bootstrap(), env: { FIXTURE_INPUT: 'value' }, startupTimeout: 4321 };
    const handle = await start(entry);
    const definition = create.mock.calls[0]![0] as ISupervisorConfig;
    expect(definition.children).toHaveLength(1);
    expect(definition.children![0]).toMatchObject({ name: 'fixture/worker', spawnOptions: {
      name: 'fixture/worker', env: entry.env, startupTimeout: 4321,
      dependencies: { bootstrapPath: entry.bootstrap, processName: 'worker' }, observability: { metrics: true },
      health: { enabled: true, interval: DEFAULT_ECOSYSTEM.monitoring!.healthCheck.interval },
    } });
    expect(handle.supervisor).toBe(create.mock.results[0]!.value);
    expect(handle.bootstrapMetadata?.source.path).toBe(entry.bootstrap);
    expect(handle.status).toBe('starting'); // Held admission is not actual readiness.
  });
  it('maps supervision strategy and inherits criticality without overriding child policy', async () => {
    const create = holdSupervisor(); const entry = { ...await bootstrap([
      { name: 'inherited', module: './module.mjs' }, { name: 'optional', module: './module.mjs', critical: false },
    ]), critical: true };
    await service.startApp(entry, config([entry], { supervision: { ...DEFAULT_ECOSYSTEM.supervision!, strategy: 'one_for_all' } }));
    const definition = create.mock.calls[0]![0] as ISupervisorConfig;
    expect(definition.strategy).toBe('one-for-all');
    expect(definition.children!.map(child => [child.name, child.critical])).toEqual([['fixture/inherited', true], ['fixture/optional', false]]);
  });
  it.each(['fixed', 'auto'] as const)('honors %s pool scaling and forwards real health policy', async strategy => {
    // Stop at the actual asynchronous pool-admission boundary, rather than
    // returning a fake healthy pool and claiming that workers were spawned.
    const refusal = new Error('fixture: pool admission held');
    const pool = vi.spyOn(pm, 'pool').mockRejectedValue(refusal);
    const entry = await bootstrap([{ name: 'workers', module: './module.mjs', instances: 3,
      scaling: { strategy, maxInstances: 7 }, health: { enabled: true, interval: 1234, timeout: 4567 } }]);
    await expect(start(entry)).rejects.toThrow('fixture: pool admission held');
    expect(pool).toHaveBeenCalledOnce();
    expect(pool.mock.calls[0]![1]).toMatchObject({ size: 3, metrics: true,
      healthCheck: { enabled: true, interval: 1234 }, autoScale: { enabled: strategy === 'auto', min: 3, max: strategy === 'auto' ? 7 : 3 },
      spawnOptions: { name: 'fixture/workers', dependencies: { bootstrapPath: entry.bootstrap, processName: 'workers' },
        health: { enabled: true, interval: 1234, timeout: 4567 } },
    });
    expect(pool.mock.calls[0]![1]).not.toHaveProperty('replaceUnhealthy');
  });
  it('publishes crash, restart and escalation from the actual supervisor emitter', async () => {
    holdSupervisor(); const handle = await start(await bootstrap()); const supervisor = handle.supervisor!;
    const crash = vi.fn(), restart = vi.fn(), escalated = vi.fn();
    service.on('app:crash', crash); service.on('app:restart', restart); service.on('app:escalated', escalated);
    const failure = new Error('fixture worker failed');
    supervisor.emit('child:crash', 'fixture/worker', failure);
    expect(crash).toHaveBeenCalledWith('fixture', failure); expect(handle.lastExit?.message).toBe(failure.message);
    supervisor.emit('child:restart', 'fixture/worker', 3);
    expect(restart).toHaveBeenCalledWith('fixture', 3); expect(handle.restarts).toBe(3);
    supervisor.emit('escalate', 'fixture/worker', failure);
    expect(escalated).toHaveBeenCalledWith('fixture', 'fixture/worker'); expect(handle.status).toBe('crashed');
  });
  it('refuses invalid counts before invoking supervisor scaling', async () => {
    holdSupervisor(); const handle = await start(await bootstrap());
    const scale = vi.spyOn(handle.supervisor!, 'scaleChild');
    await expect(service.scaleApp('fixture', 0, 'worker')).rejects.toThrow('positive safe integer'); expect(scale).not.toHaveBeenCalled();
    await expect(service.scaleApp('fixture', 1, 'worker')).rejects.toThrow('singleton'); expect(scale).not.toHaveBeenCalled();
  });
});
