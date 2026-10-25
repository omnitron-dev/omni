import { describe, it, expect, vi } from 'vitest';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger };
function orchestrator() {
  const service = new OrchestratorService(logger, {} as any, {} as any);
  const native = service as any;
  native.ensureMetricsPolling = vi.fn(); native.persistState = vi.fn();
  native.launchClassicMode = vi.fn(async (_entry: unknown, handle: any) => { handle.status = 'online'; });
  native.tearDownProcesses = vi.fn(); native.releaseExposedServices = vi.fn();
  return { service, native };
}
describe('qualified app registration identities', () => {
  it.each(['two/prod/benchmarks', 'one/staging/benchmarks'])('keeps one/prod/benchmarks alongside %s', async second => {
    const { service, native } = orchestrator(); const config: any = { apps: [] };
    const first = await native.startAppInternal({ name: 'one/prod/benchmarks' }, config);
    const other = await native.startAppInternal({ name: second }, config);
    expect(other).not.toBe(first); expect(service.list().map(a => a.name).sort()).toEqual(['one/prod/benchmarks', second].sort());
    expect(native.launchClassicMode).toHaveBeenCalledTimes(2); expect(native.tearDownProcesses).not.toHaveBeenCalled();
    expect(await native.startAppInternal({ name: second }, config)).toBe(other);
    expect(native.launchClassicMode).toHaveBeenCalledTimes(2);
  });
  it('refuses an ambiguous bare basename after two distinct projects are registered', async () => {
    const { native } = orchestrator(); const config: any = { apps: [] };
    await native.startAppInternal({ name: 'one/prod/benchmarks' }, config);
    await native.startAppInternal({ name: 'two/prod/benchmarks' }, config);
    await expect(native.startAppInternal({ name: 'benchmarks' }, config)).rejects.toThrow(/Ambiguous/);
    expect(native.launchClassicMode).toHaveBeenCalledTimes(2);
  });
  it('does not remove a stopped distinct qualified app when another basename starts', async () => {
    const { native } = orchestrator(); const config: any = { apps: [] };
    const first = await native.startAppInternal({ name: 'one/prod/benchmarks' }, config); first.status = 'stopped';
    await native.startAppInternal({ name: 'two/prod/benchmarks' }, config);
    expect(native.handles.get('one/prod/benchmarks')).toBe(first); expect(native.tearDownProcesses).not.toHaveBeenCalled();
  });
});
