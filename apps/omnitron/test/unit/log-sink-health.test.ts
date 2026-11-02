import { expect, it } from 'vitest';
import { LogSinkHealthIndicator } from '../../src/monitoring/log-sink-health.indicator.js';
it('keeps recovered-but-unconfirmed sink gaps visible without leaking transport errors', async () => {
  const indicator = new LogSinkHealthIndicator({ getSinkHealth: () => [{ name: 'stdout', pendingBytes: 0, failedWrites: 1, unconfirmedBytes: 100, droppedBytes: 0, error: null, nextAttemptAt: null }] });
  const result = await indicator.check();
  expect(result.status).toBe('degraded');
  expect(result.message).toContain('unconfirmed delivery');
});
it('does not expose custom sink error text through health', async () => {
  const indicator = new LogSinkHealthIndicator({ getSinkHealth: () => [{ name: 'stdout', pendingBytes: 0, failedWrites: 1, unconfirmedBytes: 0, droppedBytes: 0, error: 'password=private', nextAttemptAt: 1 }] });
  expect(JSON.stringify(await indicator.check())).not.toContain('private');
});
