import timers from 'node:timers';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SSHClient } from '@xec-sh/ssh';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { ExecutionService } from '../../src/execution/execution.service.js';

// Exercise Omnitron through the real Xec engine, adapter and connection pool.
// Only the authenticated transport boundary is synthetic; no network is used.
describe('ExecutionService SSH tunnel ownership', () => {
  const target = { host: 'node.invalid', username: 'operator', password: 'synthetic-password' };
  let service: ExecutionService;
  let connected: WeakSet<SSHClient>;
  let tunnels: Array<Awaited<ReturnType<SSHClient['createTunnel']>>>;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    // The installed dependency imports node:timers natively. Give it the same
    // virtual clock as the application instead of leaving a real 60 s timer.
    vi.spyOn(timers, 'setInterval').mockImplementation(globalThis.setInterval);
    vi.spyOn(timers, 'clearInterval').mockImplementation(globalThis.clearInterval);
    syncBuiltinESMExports();
    connected = new WeakSet();
    tunnels = [];
    vi.spyOn(SSHClient.prototype, 'connect').mockImplementation(async function connect(this: SSHClient) {
      connected.add(this);
      return this;
    });
    vi.spyOn(SSHClient.prototype, 'isConnected').mockImplementation(function isConnected(this: SSHClient) {
      return connected.has(this);
    });
    vi.spyOn(SSHClient.prototype, 'revalidateTrust').mockResolvedValue();
    vi.spyOn(SSHClient.prototype, 'dispose').mockImplementation(function dispose(this: SSHClient) {
      connected.delete(this);
    });
    vi.spyOn(SSHClient.prototype, 'createTunnel').mockImplementation(async options => {
      const closed = Promise.withResolvers<void>();
      const tunnel = {
        ...options,
        localHost: options.localHost ?? '127.0.0.1',
        localPort: 40000 + tunnels.length,
        closed: closed.promise,
        close: vi.fn(async () => closed.resolve()),
      };
      tunnels.push(tunnel);
      return tunnel;
    });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as ILogger;
    service = new ExecutionService(logger);
  });

  afterEach(async () => {
    await service.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
    syncBuiltinESMExports();
  });

  it('keeps every active tunnel across idle and lifetime limits, then retires the released connection', async () => {
    const first = await service.tunnel(target, 9700);
    const second = await service.tunnel(target, 9800);
    expect(SSHClient.prototype.connect).toHaveBeenCalledTimes(1);
    expect(SSHClient.prototype.revalidateTrust).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(61 * 60_000);
    expect(SSHClient.prototype.dispose).not.toHaveBeenCalled();
    expect(tunnels[0]!.close).not.toHaveBeenCalled();
    expect(tunnels[1]!.close).not.toHaveBeenCalled();

    await first.close();
    expect(SSHClient.prototype.dispose).not.toHaveBeenCalled();
    await second.close();
    expect(SSHClient.prototype.dispose).toHaveBeenCalledTimes(1);
    await second.close();
    expect(tunnels[1]!.close).toHaveBeenCalledTimes(1);
  });

  it('reuses an available connection and reclaims it once its last tunnel has been idle', async () => {
    const first = await service.tunnel(target, 9700);
    await first.close();
    await vi.advanceTimersByTimeAsync(60_000);
    const second = await service.tunnel(target, 9700);
    expect(SSHClient.prototype.connect).toHaveBeenCalledTimes(1);
    await second.close();

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(SSHClient.prototype.dispose).toHaveBeenCalledTimes(1);
    const third = await service.tunnel(target, 9700);
    expect(SSHClient.prototype.connect).toHaveBeenCalledTimes(2);
    await third.close();
  });

  it('preserves a close failure and permits the owner to retry its still-owned tunnel', async () => {
    const handle = await service.tunnel(target, 9700);
    const failure = new Error('Synthetic listener cleanup failure');
    vi.mocked(tunnels[0]!.close).mockRejectedValueOnce(failure);

    await expect(handle.close()).rejects.toBe(failure);
    expect(SSHClient.prototype.dispose).not.toHaveBeenCalled();
    await handle.close();
    expect(tunnels[0]!.close).toHaveBeenCalledTimes(2);
  });
});
