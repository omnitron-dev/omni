import { describe, expect, it, vi } from 'vitest';
import { NotificationManager } from '../../../src/rotif/rotif.js';
import { RotifTransport } from '../../../src/transport/rotif.transport.js';
import { DiagnosticNotificationSink } from '../../../src/diagnostics.js';
import { describeError, type DiagnosticEvent } from '@omnitron-dev/titan/diagnostics';

// Exercise real publication, transport and diagnostics; inject only the Redis boundary.
function fixture(patterns = ['diagnostics.operational']) {
  const runLuaScript = vi.fn();
  const runOnError = vi.fn();
  const manager = Object.assign(Object.create(NotificationManager.prototype) as NotificationManager, {
    active: true, initializationDefer: { promise: Promise.resolve() },
    config: {}, activePatterns: new Set(patterns), patternMatcherCache: new Map(),
    logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    middleware: { runBeforePublish: vi.fn(), runOnError, runAfterPublish: vi.fn() }, runLuaScript,
  });
  return { manager, runLuaScript, runOnError };
}
const event: DiagnosticEvent = { eventId: 'publication-test', id: 'runtime.failed', source: 'test',
  severity: 'critical', title: 'Runtime failed', state: 'raised', timestamp: 1, evidence: [] };

describe('publication failure boundaries', () => {
  it('never acknowledges a failed Redis publication as a duplicate and retains both failure causes', async () => {
    const { manager, runLuaScript, runOnError } = fixture();
    runLuaScript.mockRejectedValue(new Error('Redis offline password=secret'));
    runOnError.mockRejectedValue(new Error('error observer failed'));
    const sink = new DiagnosticNotificationSink(new RotifTransport(manager));
    const failure = await sink.deliver(event).catch(error => error);
    expect(failure).toMatchObject({ status: 'failed', code: 'DIAGNOSTIC_DELIVERY_UNAVAILABLE' });
    const evidence = describeError(failure);
    expect(evidence).toContain('Redis offline');
    expect(evidence).toContain('error observer failed');
    expect(evidence).not.toContain('secret');
  });
  it('refuses partial fan-out, then accepts a retry with deduplicated prior successes', async () => {
    const { manager, runLuaScript } = fixture(['diagnostics.*', 'diagnostics.operational']);
    runLuaScript.mockResolvedValueOnce('1-0').mockRejectedValueOnce(new Error('second stream unavailable'))
      .mockResolvedValueOnce('DUPLICATE').mockResolvedValueOnce('2-0');
    const sink = new DiagnosticNotificationSink(new RotifTransport(manager));
    await expect(sink.deliver(event)).rejects.toMatchObject({ status: 'failed' });
    expect(await sink.deliver(event)).toMatchObject({ status: 'queued', messageIds: ['2-0'] });
    expect(runLuaScript).toHaveBeenCalledTimes(4);
    expect(runLuaScript.mock.calls[0]?.[2][8]).toBe(runLuaScript.mock.calls[2]?.[2][8]);
    expect(runLuaScript.mock.calls[0]?.[2][8]).not.toBe(runLuaScript.mock.calls[1]?.[2][8]);
  });
  it('preserves distinct event identities containing punctuation when deduplicating', async () => {
    const { manager, runLuaScript } = fixture();
    const accepted = new Set<string>();
    runLuaScript.mockImplementation(async (_script, _keys, args: string[]) => {
      const key = args[8]!;
      if (accepted.has(key)) return 'DUPLICATE';
      accepted.add(key);
      return `${accepted.size}-0`;
    });
    const sink = new DiagnosticNotificationSink(new RotifTransport(manager));
    for (const eventId of ['incident:1', 'incident_1', 'incident/1']) {
      expect(await sink.deliver({ ...event, eventId })).toMatchObject({ status: 'queued' });
      expect(await sink.deliver({ ...event, eventId })).toMatchObject({ status: 'duplicate' });
    }
    expect(accepted.size).toBe(3);
  });
  it('requires Redis acknowledgement even when a script returns an invalid result', async () => {
    const { manager, runLuaScript } = fixture();
    runLuaScript.mockResolvedValueOnce(null).mockResolvedValueOnce('DUPLICATE');
    await expect(manager.publish('diagnostics.operational', event)).rejects.toThrow('publication failed');
    expect(await manager.publish('diagnostics.operational', event)).toBe('DUPLICATE');
  });
});
