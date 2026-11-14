import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';
import type { IEcosystemConfig } from '../../src/config/types.js';

afterEach(() => {
  vi.useRealTimers();
});
function fixture(initial?: string) {
  let status = initial;
  const owner = {
    getApp: vi.fn(() => status && { name: 'probe', status, pid: null }),
    startKnownApp: vi.fn(async () => ({})),
    startApp: vi.fn(async () => {
      status = 'errored';
    }),
    startAll: vi.fn(async () => {}),
    restartApp: vi.fn(async () => {}),
    list: vi.fn(() => (status ? [{ name: 'probe', status, pid: null }] : [])),
  };
  const config = { apps: [{ name: 'probe', script: 'probe.js' }] } as IEcosystemConfig;
  const rpc = new DaemonRpcService(owner as never, {} as never, {} as never, config, {} as never);
  return {
    owner,
    rpc,
    config,
    setStatus: (value: string) => {
      status = value;
    },
  };
}

describe('public application startup confirmation', () => {
  it('rejects a failed declared launch that the owner reports without throwing', async () => {
    const f = fixture();
    await expect(f.rpc.startApp({ name: 'probe' })).rejects.toThrow(/probe.*errored/);
    expect(f.owner.startApp).toHaveBeenCalledOnce();
  });

  it('rejects a failed registered launch without replacing its declaration', async () => {
    const f = fixture('stopped');
    f.owner.startKnownApp.mockImplementation(async () => {
      f.setStatus('errored');
      return {};
    });
    await expect(f.rpc.startApp({ name: 'probe' })).rejects.toThrow(/probe.*errored/);
    expect(f.owner.startKnownApp).toHaveBeenCalledExactlyOnceWith('probe');
    expect(f.owner.startApp).not.toHaveBeenCalled();
  });

  it('reports a pending start as unconfirmed without launching a second copy', async () => {
    const f = fixture('starting');
    await expect(f.rpc.startApp({ name: 'probe' })).rejects.toThrow(/probe.*starting/);
    expect(f.owner.startKnownApp).not.toHaveBeenCalled();
    expect(f.owner.startApp).not.toHaveBeenCalled();
  });

  it('is idempotent for an online application without requiring one main PID', async () => {
    const f = fixture('online');
    await expect(f.rpc.startApp({ name: 'probe' })).resolves.toMatchObject({ status: 'online', pid: null });
    expect(f.owner.startKnownApp).not.toHaveBeenCalled();
  });

  it.each(['starting', 'errored', 'stopped'])('rejects a %s restart observation', async (status) => {
    const f = fixture(status);
    await expect(f.rpc.restartApp({ name: 'probe' })).rejects.toThrow(new RegExp(`probe.*${status}`));
    expect(f.owner.restartApp).toHaveBeenCalledOnce();
  });

  it('does not confuse unrelated or disabled registrations with the requested fleet', async () => {
    const f = fixture('online');
    f.config.apps.push({ name: 'disabled', script: 'disabled.js', enabled: false });
    f.owner.list.mockReturnValue([
      { name: 'unrelated', status: 'stopped', pid: null },
      { name: 'probe', status: 'online', pid: null },
    ]);
    await expect(f.rpc.startAll()).resolves.toEqual([{ name: 'probe', status: 'online', pid: null }]);
  });

  it('rejects a missing fleet application even when another registry row is online', async () => {
    const f = fixture();
    f.owner.list.mockReturnValue([{ name: 'unrelated', status: 'online', pid: null }]);
    await expect(f.rpc.startAll()).rejects.toThrow(/probe.*unobserved/);
  });

  it('does not turn a rejected restart into success from the previous online row', async () => {
    vi.useFakeTimers();
    const f = fixture('online');
    f.owner.restartApp.mockRejectedValue(new Error('restart refused'));
    await expect(f.rpc.restartAll()).rejects.toThrow(/probe.*restart refused/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a fleet timeout as unconfirmed without retrying the owner', async () => {
    vi.useFakeTimers();
    const f = fixture('online');
    f.owner.restartApp.mockImplementation(() => new Promise(() => {}));
    const result = expect(f.rpc.restartAll()).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
    expect(f.owner.restartApp).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
