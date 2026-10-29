import { describe, expect, it, vi } from 'vitest';
import { RuntimeDiagnostics } from '../../src/monitoring/runtime-diagnostics.js';
import { createAlertDiagnosticHandler } from '../../src/diagnostics/index.js';
import { Findings, checkRuntimeDiagnostics } from '../../src/commands/doctor.js';

describe('runtime diagnostics shared by health clients', () => {
  it('refreshes persistent failure evidence even when every repeat is less than a minute apart', () => {
    const now = vi.spyOn(Date, 'now');
    const diagnostics = new RuntimeDiagnostics();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    diagnostics.setLogger(logger);
    try {
      for (const timestamp of [1, 20_001, 40_001, 60_001]) {
        now.mockReturnValue(timestamp);
        diagnostics.failure('job.failed', 'Job failed', new Error('offline'));
      }
      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(diagnostics.snapshot().active[0]?.occurrences).toBe(4);
    } finally { now.mockRestore(); }
  });
  it('reports runtime health in doctor, including absent coverage from older daemons', async () => {
    const findings = new Findings();
    const getHealth = vi.fn().mockResolvedValue({ apps: {}, daemon: { indicators: [] } });
    await checkRuntimeDiagnostics(findings, { getHealth });
    expect(findings.skipped()[0]?.id).toBe('daemon.runtime-diagnostics');
    getHealth.mockResolvedValue({ apps: {}, daemon: { indicators: [{ name: 'runtime-diagnostics', status: 'warn' }], diagnostics: [{
      occurrences: 2, event: { id: 'job.failed', title: 'Job failed', evidence: ['refused'], severity: 'critical', remedy: 'Restore the connection' },
    }] } });
    await checkRuntimeDiagnostics(findings, { getHealth });
    expect(findings.all()[0]).toMatchObject({ severity: 'error', remedy: 'Restore the connection' });
  });
  it('retains a failure until its producer confirms recovery, with bounded records', async () => {
    const diagnostics = new RuntimeDiagnostics(2);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    diagnostics.setLogger(logger);
    diagnostics.failure('runtime.job.alerts', 'Alert evaluation failed', new Error('password=sensitive'));
    diagnostics.failure('runtime.job.alerts', 'Alert evaluation failed', new Error('password=sensitive'));
    expect((await diagnostics.check()).status).toBe('degraded');
    expect(diagnostics.snapshot().active[0]?.occurrences).toBe(2);
    expect(JSON.stringify(diagnostics.snapshot())).not.toContain('sensitive');
    expect(logger.error).toHaveBeenCalledTimes(1);
    diagnostics.resolve('runtime.job.alerts');
    expect((await diagnostics.check()).status).toBe('healthy');
    expect(logger.info.mock.calls[0]?.[0].diagnostic.state).toBe('resolved');
    for (const id of ['one', 'two', 'three']) diagnostics.failure(id, id, new Error(id));
    expect(diagnostics.snapshot().active).toHaveLength(2);
    expect(diagnostics.snapshot().dropped).toBe(1);
  });

  it('maps outbox retries to the same id and propagates transport failures', async () => {
    const deliver = vi.fn().mockResolvedValue({ status: 'queued', messageIds: ['1'] });
    const handle = createAlertDiagnosticHandler({ deliver });
    const input = { eventId: 'a1', status: 'firing' as const, ruleName: 'database unavailable', value: '1', summary: 'token=secret', host: 'node0' };
    await handle(input); await handle(input);
    expect(deliver.mock.calls[0]?.[0].eventId).toBe(deliver.mock.calls[1]?.[0].eventId);
    expect(deliver.mock.calls[0]?.[0].evidence).toEqual(['1', 'token=***']);
    await handle({ ...input, status: 'resolved' });
    expect(deliver.mock.calls[2]?.[0]).toMatchObject({ eventId: 'a1:resolved', state: 'resolved' });
    deliver.mockRejectedValueOnce(new Error('broker unavailable'));
    await expect(handle(input)).rejects.toThrow('broker unavailable');
  });
});
