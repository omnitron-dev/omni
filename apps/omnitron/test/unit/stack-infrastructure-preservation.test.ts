import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectService } from '../../src/services/project.service.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { NodeStackStop } from '../../src/project/node-stack-stop.js';
import { InfrastructureRpcService } from '../../src/services/infrastructure.rpc-service.js';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { resolveInfrastructureDefinition } from '../../src/infrastructure/infrastructure-definition.js';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';
import { recoveryState } from '../../src/daemon/recovery-state.js';
import * as runtime from '../../src/infrastructure/container-runtime.js';
import type { ExistingInfrastructureReview } from '../../src/shared/dto/project.js';

const native = vi.hoisted(() => ({ review: vi.fn() }));
vi.mock('../../src/infrastructure/existing-containers.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/infrastructure/existing-containers.js')>(),
  reviewExistingContainers: native.review,
  inspectExistingInfrastructure: async (...args: unknown[]) => {
    const review = await native.review(...args);
    return { review, state: { ready: review.digest !== null, services: {} } };
  },
}));
const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger };
const scope = { project: 'sample', stack: 'dev' };
const digest = 'a'.repeat(64);
const observation = (): ExistingInfrastructureReview => ({ protocol: 1, mode: 'preserve', scope, digest, checks: [], containers: [] });
const directories: string[] = [];
beforeEach(() => { native.review.mockReset().mockResolvedValue(observation()); });
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'preserved-stack-')); directories.push(directory);
  const script = path.join(directory, 'app.js'); fs.writeFileSync(script, 'throw Error("DO NOT EXECUTE DURING REVIEW")');
  const config: any = { apps: [{ name: 'api', script }], stacks: { dev: { type: 'local', infrastructure: { postgres: { databases: { api: { migrate: true } } } } } } };
  const values = new Map<string, unknown>();
  const store = {
    kvGetSync: (key: string) => values.get(key) ?? null,
    kvUpdateSync: (key: string, update: (value: unknown) => unknown) => { const value = update(values.get(key) ?? null); values.set(key, structuredClone(value)); return value; },
  };
  const service: any = Object.assign(Object.create(ProjectService.prototype), {
    logger, daemonStateStore: store,
    registry: { get: () => ({ path: directory, registeredAt: '2026-11-12T00:00:00Z' }) },
    getLoadedConfig: () => config, loadProjectConfig: vi.fn(async () => config),
    resolveStacks: () => config.stacks, resolveStackApps: () => config.apps,
    localSelection: () => ({ read: () => ({ revision: 1, release: null }) }),
    assertStartAuthority: vi.fn(),
    stackEnvFor: vi.fn(async () => ({ api: { PRIVATE_VALUE: 'never-print-this-secret' } })),
    loadAppDefinitions: vi.fn(), runStackMigrations: vi.fn(),
    stackEntryBuilder: () => (entry: unknown) => entry,
    infraManager: {
      reviewPreservation: vi.fn(async () => observation()), provisionStack: vi.fn(),
      preserveStack: vi.fn(async () => ({ getDesiredServices: () => [], getState: () => ({ ready: true, services: {} }) })),
    },
    startsInFlight: new Map(), stopsInFlight: new Map(), stackStates: new Map([['sample/dev', {}]]),
    orchestrator: { startApp: vi.fn(), enableStackExecution: vi.fn() }, emit: vi.fn(), audit: { record: vi.fn() },
  });
  return { service, config, script, values };
}

describe('stack preservation admission', () => {
  it('reads the recorded full stop of an application-only receiver across a daemon restart', async () => {
    const f = fixture();
    const origin = { project: 'sample', stack: 'prod' };
    f.config.stacks.dev = { type: 'local', managedOrigin: origin, infrastructureOwnership: 'controller' };
    const file = path.join(path.dirname(f.script), 'state.db');
    const previous = new DaemonStateStore(logger, file);
    const operationId = 'retire';
    const observedAt = new Date().toISOString();
    f.service.daemonStateStore = previous;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.parse(observedAt) - 1000);
      f.service.setInfrastructurePolicy(scope.project, scope.stack, null);
    } finally { vi.useRealTimers(); }
    const plan = { protocol: 1, ...origin, applications: true, operationId, containers: [{ id: 'before', name: 'store' }],
      execution: { ...scope, revision: 6, phase: 'running', apps: [{ name: 'sample/dev/api', generation: 'previous' }] } };
    const receipt = { protocol: 1, ...origin, operationId, outcome: 'stopped', observedAt, removedContainers: ['before'],
      applications: { ...scope, operationId, revision: 7, stopped: ['sample/dev/api'], observedAt } };
    const journal = 'lifecycle:node-stack-stops:v1';
    previous.kvSetSync(journal, { 'sample/prod': { plan, receipt, phase: 'stopped' } });
    await previous.dispose();
    const current = new DaemonStateStore(logger, file);
    try {
      f.service.daemonStateStore = current;
      f.service.nodeStackStop = new NodeStackStop(current, {} as never);
      f.service.startStackOnce = vi.fn(async () => ({}));
      await f.service.startStack('sample', 'dev', { source: 'operator' });
      expect(f.service.startStackOnce.mock.calls[0][7]).toMatchObject({ mode: 'reconcile', explicitReconcile: false });
      const reviewed = await f.service.reviewStackStart('sample', 'dev');
      expect(reviewed.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(reviewed.targets).toEqual([{ node: 'local', applicationOnly: true }]);
      await f.service.startLocalStack('sample', 'dev', f.config.stacks.dev, f.config, undefined, vi.fn(), undefined, undefined, reviewed);
      expect(f.service.orchestrator.startApp).toHaveBeenCalledOnce();
      expect(f.service.infraManager.reviewPreservation).not.toHaveBeenCalled();
      expect(f.service.infraManager.provisionStack).not.toHaveBeenCalled();
      expect(f.service.runStackMigrations).not.toHaveBeenCalled();
      for (const state of [{ plan, receipt, phase: 'failed' }, { plan, receipt, phase: 'stopped', suspended: true },
        { plan, receipt: { ...receipt, observedAt: '1970-01-01T00:00:00Z' }, phase: 'stopped' },
        { plan, receipt: { ...receipt, removedContainers: [] }, phase: 'stopped' }]) {
        current.kvSetSync(journal, { 'sample/prod': state });
        await expect(f.service.startStack('sample', 'dev', { source: 'operator' })).rejects.toMatchObject({
          details: { reason: 'infrastructure-review-required' },
        });
      }
      expect(f.service.startStackOnce).toHaveBeenCalledOnce();
    } finally { await current.dispose(); }
  });
  it('reviews the complete remote declaration without creating an owner or changing recovery', async () => {
    const manager = new StackInfrastructureManager(logger);
    const host = vi.fn((definition, registry) => new InfrastructureService(logger, definition, { presetRegistry: registry }));
    const rpc = new InfrastructureRpcService(() => null, host, undefined, logger, undefined, undefined, manager);
    // Native filesystem inspection is the boundary; the definition and ownership paths are real.
    vi.spyOn(rpc as any, 'checkStackConfigs').mockResolvedValue(new Map([['gateway', '/fixture/gateway']]));
    const token = recoveryState.token();
    const result = await rpc.reviewStack({ ...scope, infrastructure: 'preserve',
      config: { redis: {}, gateway: { port: 8080 } },
      services: { cache: { docker: { image: 'redis:7' }, ports: {}, env: {} } },
    });
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(native.review.mock.calls[0]![0].map((container: { name: string }) => container.name))
      .toEqual(expect.arrayContaining(['sample-dev-redis', 'sample-dev-gateway', 'sample-dev-cache']));
    expect(host).not.toHaveBeenCalled();
    expect(manager.listInstances()).toEqual([]);
    expect(recoveryState.token()).toBe(token);
    manager.dispose();
  });

  it('identifies a changed resource during migration admission and backend handoff', async () => {
    const manager = new StackInfrastructureManager(logger);
    const approved = observation();
    approved.containers.push({ name: 'sample-dev-gateway', id: '1'.repeat(64), fingerprint: 'a'.repeat(64) });
    native.review.mockResolvedValue(approved);
    await manager.preserveStack(scope.project, scope.stack, { type: 'local' }, {}, approved.digest!);
    const service = manager.getInstance(scope.project, scope.stack)!;
    const snapshot = service.captureRecoveryState();
    const issue = { code: 'infrastructure.preservation-blocked', resource: 'sample-dev-gateway', state: 'unknown',
      message: 'Mounted configuration cannot be confirmed.', native: { env: 'private-native-state' } };
    native.review.mockResolvedValue({ ...approved, digest: null, checks: [issue] });
    await expect(manager.inspectPreservedBindings(scope.project, scope.stack, { type: 'local' }, {}))
      .rejects.toThrow(/no migration was executed\nsample-dev-gateway: Mounted configuration cannot be confirmed\.$/);
    const next = { ...approved, digest: 'b'.repeat(64), containers: [{ ...approved.containers[0]!, id: '2'.repeat(64) }] };
    native.review.mockResolvedValue(next);
    await expect(InfrastructureService.validateHandoff(snapshot))
      .rejects.toThrow(/changed during handoff\nsample-dev-gateway: Container identity differs from the preservation review\.$/);
    manager.dispose();
  });

  it('reviews desired infrastructure before a stop, without executing application declarations or migrations', async () => {
    const f = fixture();
    const review = await f.service.reviewStackStart('sample', 'dev', { infrastructure: 'preserve' });
    expect(review.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(review)).not.toContain('never-print-this-secret');
    expect(f.service.loadProjectConfig).not.toHaveBeenCalled();
    expect(f.service.loadAppDefinitions).not.toHaveBeenCalled();
    expect(f.service.runStackMigrations).not.toHaveBeenCalled();
    expect(f.service.infraManager.provisionStack).not.toHaveBeenCalled();
    expect(f.service.orchestrator.startApp).not.toHaveBeenCalled();
    f.service.infraManager.reviewPreservation.mockResolvedValue({ ...observation(), digest: null, checks: [{ state: 'blocked', code: 'preset-drift', resource: 'postgres', message: 'health-check specification differs' }] });
    expect((await f.service.reviewStackStart('sample', 'dev')).digest).toBeNull();
  });

  it.each(['native', 'script', 'environment', 'release'])('rejects %s drift after review before startup effects', async changed => {
    const f = fixture();
    const options: any = { infrastructure: 'preserve' };
    if (changed === 'release') {
      options.release = 'reviewed-release';
      f.service.admitRelease = vi.fn(async () => ({ id: options.release, manifestSha256: 'b'.repeat(64) }));
      f.service.installedRelease = vi.fn(async () => ({ entries: f.config.apps }));
    }
    const before = await f.service.reviewStackStart('sample', 'dev', options);
    expect(before.digest).toMatch(/^[a-f0-9]{64}$/);
    if (changed === 'native') f.service.infraManager.reviewPreservation.mockResolvedValue({ ...observation(), digest: 'c'.repeat(64) });
    if (changed === 'script') fs.appendFileSync(f.script, '\n// different launch');
    if (changed === 'environment') f.service.stackEnvFor.mockResolvedValue({ api: { PRIVATE_VALUE: 'changed-secret' } });
    if (changed === 'release') f.service.admitRelease.mockResolvedValue({ id: options.release, manifestSha256: 'c'.repeat(64) });
    await expect(f.service.startStack('sample', 'dev', { ...options, review: before.digest, source: 'operator' })).rejects.toThrow('no startup effects');
    expect(f.service.loadProjectConfig).not.toHaveBeenCalled();
    expect(f.service.loadAppDefinitions).not.toHaveBeenCalled();
    expect(f.service.infraManager.provisionStack).not.toHaveBeenCalled();
    expect(f.service.infraManager.preserveStack).not.toHaveBeenCalled();
    expect(f.service.runStackMigrations).not.toHaveBeenCalled();
    expect(f.service.orchestrator.startApp).not.toHaveBeenCalled();
    expect(f.service.orchestrator.enableStackExecution).not.toHaveBeenCalled();
    if (changed === 'release') expect(f.service.installedRelease.mock.calls.every((call: unknown[]) => call[5] === false)).toBe(true);
  });

  it('starts applications on the reviewed infrastructure without provisioning, bootstrap extraction or requested migrations', async () => {
    const f = fixture(), enable = vi.fn();
    const review = await f.service.reviewStackStart('sample', 'dev');
    await f.service.startLocalStack('sample', 'dev', f.config.stacks.dev, f.config, undefined, enable, undefined, undefined, review);
    expect(f.service.infraManager.preserveStack).toHaveBeenCalledOnce();
    expect(f.service.infraManager.provisionStack).not.toHaveBeenCalled();
    expect(f.service.loadAppDefinitions).not.toHaveBeenCalled();
    expect(f.service.runStackMigrations).not.toHaveBeenCalled();
    expect(enable).toHaveBeenCalledOnce();
    expect(f.service.orchestrator.startApp).toHaveBeenCalledOnce();
  });

  it('does not let degraded-infrastructure settings admit drift at the final start gate', async () => {
    const f = fixture(); f.config.stacks.dev.settings = { allowDegradedInfra: true };
    const review = await f.service.reviewStackStart('sample', 'dev');
    f.service.infraManager.reviewPreservation.mockResolvedValue({ ...observation(), digest: null });
    await expect(f.service.startLocalStack('sample', 'dev', f.config.stacks.dev, f.config, undefined, vi.fn(), undefined, undefined, review)).rejects.toThrow('immediately before start');
    expect(f.service.infraManager.preserveStack).not.toHaveBeenCalled();
    expect(f.service.orchestrator.startApp).not.toHaveBeenCalled();
  });

  it('retains preservation across automatic starts and requires explicit reconciliation to expand authority', async () => {
    const f = fixture(); f.service.startStackOnce = vi.fn(async () => ({}));
    f.service.setInfrastructurePolicy('sample', 'dev', null);
    await expect(f.service.startStack('sample', 'dev', { source: 'boot' })).rejects.toThrow('requires a successful');
    await expect(f.service.startStack('sample', 'dev', { source: 'auto-resume' })).rejects.toThrow('requires a successful');
    await expect(f.service.startStack('sample', 'dev', { source: 'auto-resume', infrastructure: 'reconcile' })).rejects.toThrow('cannot expand');
    expect(f.service.startStackOnce).not.toHaveBeenCalled();
    f.service.setInfrastructurePolicy('sample', 'dev', digest);
    await f.service.startStack('sample', 'dev', { source: 'auto-resume' });
    expect(f.service.startStackOnce.mock.calls[0][7]).toEqual({ mode: 'preserve', review: digest, explicitReconcile: false });
    await f.service.startStack('sample', 'dev', { source: 'operator', infrastructure: 'reconcile' });
    expect(f.service.startStackOnce.mock.calls[1][7]).toEqual({ mode: 'reconcile', review: undefined, explicitReconcile: true });
    f.service.registry.get = () => ({ registeredAt: 'new-registration' });
    expect(f.service.infrastructurePolicy('sample', 'dev')).toBeNull();
  });
});

describe('recipient preservation uses the existing infrastructure lifecycle', () => {
  it('reads, adopts and transfers ownership without native mutation or setup, and refuses unreviewed provisioning', async () => {
    const effects = ['createContainer', 'startContainer', 'stopContainer', 'removeContainer', 'ensureImage', 'execInContainer', 'ensureNetwork', 'createVolume'] as const;
    const spies = effects.map(name => vi.spyOn(runtime, name).mockImplementation(async () => { throw Error('FORBIDDEN NATIVE EFFECT'); }));
    const manager = new StackInfrastructureManager(logger);
    const rpc = new InfrastructureRpcService(() => null,
      (definition, registry) => new InfrastructureService(logger, definition, { presetRegistry: registry }), undefined, logger, undefined, undefined, manager);
    const input = { ...scope, config: {}, infrastructure: 'preserve' as const };
    const before = await rpc.reviewStack(input);
    expect(manager.listInstances()).toHaveLength(0);
    const result = await rpc.provisionStack({ ...input, review: before.digest! });
    expect(result.preservation).toEqual(before);
    const service = manager.getInstance(scope.project, scope.stack)!;
    await expect(service.provision()).rejects.toThrow('explicit reconcile');
    await (service as any).healthSweep();
    const state = await service.prepareHandoff();
    const next = await InfrastructureService.adoptHandoff(logger, state); next.resumeAfterHandoff();
    await expect(next.provision()).rejects.toThrow('explicit reconcile');
    native.review.mockResolvedValue({ ...observation(), digest: null });
    await (next as any).healthSweep();
    expect(next.getState()).toMatchObject({ ready: false, preservationIssues: [{ code: 'infrastructure.preservation-unconfirmed', scope }] });
    const warnings = logger.warn.mock.calls.length;
    await (next as any).healthSweep();
    expect(logger.warn.mock.calls).toHaveLength(warnings);
    native.review.mockResolvedValue(observation());
    await (next as any).healthSweep();
    expect(next.getState()).toMatchObject({ ready: true, preservationIssues: [] });
    next.dispose();
    for (const effect of spies) expect(effect).not.toHaveBeenCalled();
  });

  it('refuses replaced native identity on the recipient before ownership adoption or setup', async () => {
    const manager = new StackInfrastructureManager(logger), adopt = vi.spyOn(manager, 'preserveHosted');
    const rpc = new InfrastructureRpcService(() => null,
      (definition, registry) => new InfrastructureService(logger, definition, { presetRegistry: registry }), undefined, logger, undefined, undefined, manager);
    const input = { ...scope, config: {}, infrastructure: 'preserve' as const };
    const review = await rpc.reviewStack(input);
    native.review.mockResolvedValue({ ...observation(), digest: 'b'.repeat(64) });
    await expect(rpc.provisionStack({ ...input, review: review.digest! })).rejects.toThrow('changed since review');
    expect(adopt).not.toHaveBeenCalled();
    expect(manager.listInstances()).toHaveLength(0);
  });

  it('acknowledges same-node provisioning only after the receiver has saved its verified inventory', async () => {
    const placement = { placementDigest: digest, stopOperationId: 'b43625d6-a9e9-47cd-9515-5d8c6f24f48f' };
    const full = { ...observation(), containers: [{ name: 'sample-dev-redis', id: '1'.repeat(64), fingerprint: digest }] };
    native.review.mockResolvedValue(full);
    const entered = Promise.withResolvers<void>(), saved = Promise.withResolvers<void>();
    const remember = vi.fn(async () => { entered.resolve(); await saved.promise; });
    const prepare = vi.fn(async () => remember);
    const name = full.containers[0]!.name;
    const provision = vi.fn(async () => ({ services: { [name]: { name, status: 'running', health: 'healthy' } } }));
    const rpc = new InfrastructureRpcService(() => null, () => ({ provision, resumeStack: vi.fn(), getDesiredServices: () => [{ name }] }) as never,
      undefined, logger, undefined, undefined, undefined, prepare);
    const input = { ...scope, placement, infrastructure: 'reconcile' as const, config: { redis: { image: 'redis:7' } } };
    let answered = false;
    const result = rpc.provisionStack(input).then(value => { answered = true; return value; });
    await Promise.race([entered.promise, result.then(() => { throw Error('RPC returned before recording container identities'); })]);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(answered).toBe(false);
    expect(prepare).toHaveBeenCalledWith(scope, placement);
    expect(remember).toHaveBeenCalledExactlyOnceWith(full);
    saved.resolve();
    await expect(result).resolves.toMatchObject({ ready: true });
    prepare.mockRejectedValueOnce(Error('Stop changed'));
    await expect(rpc.provisionStack(input)).rejects.toThrow('Stop changed');
    expect(provision).toHaveBeenCalledOnce();
  });

  it('revalidates once more at native adoption and keeps a failed recovery fenced', async () => {
    const manager = new StackInfrastructureManager(logger);
    const rpc = new InfrastructureRpcService(() => null,
      (definition, registry) => new InfrastructureService(logger, definition, { presetRegistry: registry }), undefined, logger, undefined, undefined, manager);
    const input = { ...scope, config: {}, infrastructure: 'preserve' as const };
    const review = await rpc.reviewStack(input);
    native.review.mockResolvedValueOnce(observation()).mockResolvedValueOnce({ ...observation(), digest: 'c'.repeat(64) });
    await expect(rpc.provisionStack({ ...input, review: review.digest! })).rejects.toThrow('changed after review');
    expect(manager.listInstances()).toHaveLength(0);
    const existing = new InfrastructureService(logger, resolveInfrastructureDefinition({ config: {}, normalizedServices: {} }));
    await existing.holdForPreservation();
    expect(existing.captureRecoveryState().preservationPending).toBe(true);
    await expect(existing.provision()).rejects.toThrow('explicit reconcile');
  });

  it('forwards read-only review to the recipient and refuses an older node without provisioning fallback', async () => {
    const f = fixture(), invoke = vi.fn(async (..._args: unknown[]) => observation());
    const connector = { addSlave: vi.fn(), waitUntilConnected: vi.fn(async () => true), invokeOnSlave: invoke };
    f.service.getSlaveConnector = () => connector; f.service.shipStackStatics = vi.fn();
    const node = { host: 'node.test', port: 9700, role: 'app' };
    const review = await f.service.reviewNodeInfrastructure(node, {}, {}, scope, path.dirname(f.script));
    expect(review.mode).toBe('preserve');
    expect(invoke.mock.calls[0]?.slice(2, 4)).toEqual(['OmnitronInfra', 'reviewStack']);
    expect(f.service.shipStackStatics).not.toHaveBeenCalled();
    invoke.mockResolvedValue({ ready: true } as never);
    await expect(f.service.reviewNodeInfrastructure(node, {}, {}, scope, path.dirname(f.script))).rejects.toThrow('Recipient does not confirm');
    expect(invoke.mock.calls.every(call => call[3] === 'reviewStack')).toBe(true);
    expect(f.service.shipStackStatics).not.toHaveBeenCalled();
  });
});
