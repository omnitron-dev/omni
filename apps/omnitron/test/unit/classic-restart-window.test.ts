import { afterEach, beforeEach, expect, it } from 'vitest';
import { vi } from 'vitest';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import type { IEcosystemConfig, IEcosystemAppEntry } from '../../src/config/types.js';
const logger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger; } };
const entry: IEcosystemAppEntry = { name: 'fixture', script: './fixture.mjs' };
function fixture(maxRestarts: number, window = 3600000) {
  const config = { apps: [], supervision: { strategy: 'one_for_one', maxRestarts, window, backoff: { type: 'exponential', initial: 100, max: 1000, factor: 2 } },
    monitoring: { healthCheck: { interval: 15000, timeout: 5000 }, metrics: { interval: 5000, retention: 3600000 } },
    logging: { level: 'info', maxSize: '50mb', maxFiles: 10, compress: true, databaseRetentionDays: 14 } } as unknown as IEcosystemConfig;
  const pm: any = { getWorkerHandle: () => undefined, getProcess: () => undefined };
  const owner = new OrchestratorService(logger, pm, { save() {}, load: () => null } as never, process.cwd());
  const launch = vi.fn(async () => { throw Error('fixture failed'); });
  (owner as any).launchClassicMode = launch;
  return { owner, config, launch, handle: () => (owner as any).handles.get(entry.name) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it('allows N real retries after the initial failure, first attempt uses backoff1, and cooldown preserves lifetime diagnostics', async () => {
  const { owner, config, launch, handle } = fixture(2);
  await expect(owner.startApp(entry, config)).rejects.toThrow('fixture failed');
  await vi.advanceTimersByTimeAsync(99); expect(launch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(launch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(199); expect(launch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect(launch).toHaveBeenCalledTimes(3);
  expect(handle().restarts).toBe(3);
  await vi.advanceTimersByTimeAsync(599999); expect(launch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1); expect(launch).toHaveBeenCalledTimes(4);
  expect(handle().restarts).toBe(4); expect(handle().restartWindow.recent(config.supervision.window)).toBe(1);
});
it('never arms the ten-minute recovery timer for zero budget or disabled policy', async () => {
  for (const disabled of [false, true]) {
    const { owner, config, launch } = fixture(disabled ? 2 : 0);
    await expect(owner.startApp({ ...entry, ...(disabled ? { restartPolicy: { enabled: false } } : {}) }, config)).rejects.toThrow();
    expect((owner as any).coolDownTimers.size).toBe(0);
    await vi.advanceTimersByTimeAsync(600001); expect(launch).toHaveBeenCalledTimes(1);
  }
});
it('does not exhaust the budget on failures separated by the configured window', async () => {
  const { owner, config, launch, handle } = fixture(1, 1000);
  launch.mockImplementation(async (_entry?: unknown, h?: any) => { h.markOnline(100); });
  await owner.startApp(entry, config);
  for (let i = 0; i < 4; i++) {
    handle().markCrashed(); await (owner as any).scheduleRecovery(entry, handle(), config);
    await vi.advanceTimersByTimeAsync(100); expect(launch).toHaveBeenCalledTimes(i + 2);
    await vi.advanceTimersByTimeAsync(1001);
  }
  expect(handle().restarts).toBe(4);
});
