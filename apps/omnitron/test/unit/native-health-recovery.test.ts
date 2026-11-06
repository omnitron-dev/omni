import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ get: vi.fn(), remove: vi.fn() }));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...(await original<Record<string, unknown>>()), getContainerState: runtime.get, removeContainer: runtime.remove,
}));
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { containerSpecHash } from '../../src/infrastructure/container-runtime.js';
import { nativeHealthCheck, observeUnhealthy } from '../../src/infrastructure/health-recovery.js';
import type { ContainerState, ResolvedContainer } from '../../src/infrastructure/types.js';

const logger: any = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const services: InfrastructureService[] = [];
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-02T00:00:00Z')); runtime.remove.mockResolvedValue(undefined); });
afterEach(() => { for (const service of services.splice(0)) service.dispose(); vi.useRealTimers(); });
function fixture() {
  const desired: ResolvedContainer = { name: 'fixture', image: 'fixture:1', ports: [], volumes: [], environment: {},
    labels: { 'omnitron.managed': 'true', 'omnitron.project': 'sample', 'omnitron.stack': 'dev', 'omnitron.service': 'fixture' },
    restart: 'unless-stopped', critical: false } as ResolvedContainer;
  const service: any = new InfrastructureService(logger, { services: {} }, {}, undefined, undefined, false);
  service.addAppContainers([desired]); services.push(service);
  service.createAndStart = vi.fn().mockResolvedValue(undefined);
  const actual: ContainerState = { name: desired.name, image: desired.image, status: 'running', health: 'unhealthy',
    containerId: 'a'.repeat(64), startedAt: '2026-01-01T00:00:00Z', labels: desired.labels,
    specHash: containerSpecHash(desired), healthCheck: { completedAt: new Date().toISOString(), exitCode: 1 } };
  runtime.get.mockImplementation(async () => structuredClone(actual));
  const advance = (milliseconds: number, fresh = true) => {
    vi.setSystemTime(Date.now() + milliseconds);
    if (fresh) actual.healthCheck = { completedAt: new Date().toISOString(), exitCode: 1 };
  };
  return { service, actual, advance };
}

describe('native health evidence controls destructive recovery', () => {
  it('does not count repeated polls of one failed Docker probe as confirmations', async () => {
    const { service, advance } = fixture();
    await service.healthSweep();
    for (let n = 0; n < 15; n++) { advance(4000, false); await service.healthSweep(); }
    expect(runtime.remove).not.toHaveBeenCalled();
    expect(service.createAndStart).not.toHaveBeenCalled();
  });
  it('requires elapsed grace even when two real failures arrive four seconds apart', async () => {
    const { service, advance, actual } = fixture();
    await service.healthSweep(); advance(4000); await service.healthSweep();
    expect(runtime.remove).not.toHaveBeenCalled();
    advance(56_000); await service.healthSweep();
    expect(runtime.remove).toHaveBeenCalledExactlyOnceWith(actual.containerId);
    expect(service.createAndStart).toHaveBeenCalledOnce();
    expect(service.restartBackoff.get(actual.name)?.failures).toBe(1);
  });
  it('does not treat old, malformed or successful native probes as a failed health confirmation', () => {
    const { actual } = fixture();
    for (const variant of [
      { healthCheck: undefined }, { startedAt: undefined }, { containerId: 'short' },
      { healthCheck: { completedAt: 'invalid', exitCode: 1 } },
      { healthCheck: { completedAt: new Date(Date.now() - 60_001).toISOString(), exitCode: 1 } },
      { healthCheck: { completedAt: new Date(Date.now() + 1).toISOString(), exitCode: 1 } },
      { healthCheck: { completedAt: new Date().toISOString(), exitCode: 0 } },
    ]) {
      const result = observeUnhealthy(undefined, { ...actual, ...variant }, Date.now());
      expect(result.restart).toBe(false);
      expect(result.evidence).toBeUndefined();
    }
  });
  it('starts new evidence after a changed native ID or process incarnation', () => {
    const { actual, advance } = fixture();
    const first = observeUnhealthy(undefined, actual, Date.now()).evidence;
    advance(60_000);
    for (const variant of [{ containerId: 'b'.repeat(64) }, { startedAt: new Date(Date.now() - 1000).toISOString() }]) {
      expect(observeUnhealthy(first, { ...actual, ...variant }, Date.now())).toMatchObject({ restart: false, evidence: { confirmations: 1, firstObservedAt: Date.now() } });
    }
  });
  it('keeps a container that recovered while the restart was being confirmed', async () => {
    const { service, actual, advance } = fixture();
    await service.healthSweep(); advance(60_000);
    runtime.get.mockResolvedValueOnce(structuredClone(actual)).mockResolvedValueOnce({ ...actual, health: 'healthy' });
    await service.healthSweep();
    expect(runtime.remove).not.toHaveBeenCalled();
    expect(service.createAndStart).not.toHaveBeenCalled();
  });
  it('applies the shared exponential backoff to failed unhealthy restarts', async () => {
    const { service, actual, advance } = fixture();
    runtime.remove.mockRejectedValue(new Error('Native removal refused'));
    for (let attempt = 1; attempt <= 3; attempt++) {
      await service.healthSweep(); advance(60_000); await service.healthSweep();
      expect(runtime.remove).toHaveBeenCalledTimes(attempt);
      advance(1000);
    }
    const backoff = service.restartBackoff.get(actual.name);
    expect(backoff.failures).toBe(3);
    await service.healthSweep(); advance(60_000); await service.healthSweep();
    expect(runtime.remove).toHaveBeenCalledTimes(3);
    expect(service.restartBackoff.get(actual.name)).toEqual(backoff);
    actual.health = 'starting'; await service.healthSweep();
    expect(service.restartBackoff.get(actual.name)).toEqual(backoff);
    actual.health = 'healthy'; await service.healthSweep();
    expect(service.restartBackoff.has(actual.name)).toBe(false);
  });
  it('does not mistake successful container creation for recovered native health', async () => {
    const { service, actual, advance } = fixture();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await service.healthSweep(); advance(60_000); await service.healthSweep();
      expect(service.createAndStart).toHaveBeenCalledTimes(attempt);
      actual.containerId = String(attempt).repeat(64);
      actual.startedAt = new Date().toISOString();
      actual.health = 'starting';
      await service.healthSweep();
      expect(service.restartBackoff.get(actual.name)?.failures).toBe(attempt);
      advance(1000); actual.health = 'unhealthy';
    }
    await service.healthSweep(); advance(60_000); await service.healthSweep();
    expect(runtime.remove).toHaveBeenCalledTimes(3);
  });
  it('serializes health recovery with ordinary reconciliation under the same native lock', async () => {
    const { service, advance } = fixture();
    await service.healthSweep(); advance(60_000);
    let release!: () => void, begun!: () => void;
    const removed = new Promise<void>(resolve => { release = resolve; });
    const removing = new Promise<void>(resolve => { begun = resolve; });
    runtime.remove.mockImplementationOnce(() => { begun(); return removed; });
    const recovery = service.healthSweep(); await removing;
    const reads = runtime.get.mock.calls.length;
    await service.reconcileService(service.getDesiredContainers()[0]);
    expect(runtime.get).toHaveBeenCalledTimes(reads);
    expect(runtime.remove).toHaveBeenCalledOnce();
    release(); await recovery;
    expect(service.createAndStart).toHaveBeenCalledOnce();
    expect(service.reconcileTasks.size).toBe(0);
  });
  it.each(['replacement', 'restarted', 'older probe'])('refuses %s evidence during immediate recheck', async change => {
    const { service, actual, advance } = fixture();
    await service.healthSweep(); advance(60_000);
    const changed = structuredClone(actual);
    if (change === 'replacement') changed.containerId = 'b'.repeat(64);
    if (change === 'restarted') changed.startedAt = new Date().toISOString();
    if (change === 'older probe') changed.healthCheck!.completedAt = new Date(Date.now() - 30_000).toISOString();
    runtime.get.mockResolvedValueOnce(structuredClone(actual)).mockResolvedValueOnce(changed);
    await service.healthSweep();
    expect(runtime.remove).not.toHaveBeenCalled();
  });
  it('does not infer recovery from an unknown native health state', async () => {
    const { service, actual } = fixture();
    const delay = { failures: 3, nextAttemptAt: Date.now() + 120_000 };
    service.restartBackoff.set(actual.name, delay); actual.health = undefined;
    await service.healthSweep();
    expect(service.restartBackoff.get(actual.name)).toEqual(delay);
  });
  it('preserves confirmed observation history across handoff and ignores legacy poll counts', async () => {
    const { service, advance } = fixture();
    await service.healthSweep();
    const saved = await service.prepareHandoff();
    expect(saved.unhealthyTicks).toEqual([]);
    expect(saved.unhealthyEvidence).toHaveLength(1);
    const restored: any = await InfrastructureService.adoptHandoff(logger, saved); services.push(restored);
    restored.createAndStart = vi.fn().mockResolvedValue(undefined); restored.resumeAfterHandoff();
    advance(60_000); await restored.healthSweep();
    expect(runtime.remove).toHaveBeenCalledOnce();
    const legacy = { ...saved, unhealthyTicks: [['fixture', 99]] as Array<[string, number]> };
    delete legacy.unhealthyEvidence;
    const historical: any = await InfrastructureService.adoptHandoff(logger, legacy); services.push(historical);
    historical.resumeAfterHandoff(); runtime.remove.mockClear();
    await historical.healthSweep(); expect(runtime.remove).not.toHaveBeenCalled();
  });
});

it('extracts only the final completed Docker probe without leaking its command output', () => {
  const end = new Date().toISOString();
  expect(nativeHealthCheck({ Log: [{ End: end, ExitCode: -1, Output: 'private response' }] })).toEqual({ completedAt: end, exitCode: -1 });
  for (const value of [undefined, {}, { Log: [] }, { Log: [null] }, { Log: [{ End: end, ExitCode: 0 }, { End: 'invalid', ExitCode: 1 }] }])
    expect(nativeHealthCheck(value)).toBeUndefined();
});
