import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '@omnitron-dev/testing/titan';
import { RedisManager } from '../src/redis.manager.js';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('../src/redis.utils.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/redis.utils.js')>(),
  createRedisClient: createClient,
}));

function client(status: string, quit = vi.fn(async () => 'OK')) {
  return {
    status,
    options: { lazyConnect: true },
    on: vi.fn(),
    quit,
    disconnect: vi.fn(),
  };
}

beforeEach(() => { createClient.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('Redis shutdown', () => {
  it.each(['wait', 'connecting', 'connect', 'reconnecting', 'close', 'end'])(
    'disconnects a %s client without starting or retrying a connection', async (status) => {
      const connection = client(status);
      createClient.mockReturnValue(connection);
      const manager = new RedisManager({}, createMockLogger());
      await manager.init();
      await manager.destroy();
      expect(connection.quit).not.toHaveBeenCalled();
      expect(connection.disconnect).toHaveBeenCalledOnce();
      expect(manager.getClients().size).toBe(0);
    },
  );

  it('waits for a ready client to acknowledge QUIT before disconnecting', async () => {
    let finish!: (value: string) => void;
    const connection = client('ready', vi.fn(() => new Promise<string>((resolve) => { finish = resolve; })));
    createClient.mockReturnValue(connection);
    const manager = new RedisManager({}, createMockLogger());
    await manager.init();
    const closing = manager.destroy();
    expect(connection.quit).toHaveBeenCalledOnce();
    expect(connection.disconnect).not.toHaveBeenCalled();
    finish('OK');
    await closing;
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(manager.getClients().size).toBe(0);
  });

  it('bounds a stalled QUIT, reports the reason and releases every client', async () => {
    vi.useFakeTimers();
    const stalled = client('ready', vi.fn(() => new Promise<string>(() => {})));
    const healthy = client('ready');
    createClient.mockReturnValueOnce(stalled).mockReturnValueOnce(healthy);
    const logger = createMockLogger();
    vi.mocked(logger.child).mockReturnValue(logger);
    const manager = new RedisManager({
      shutdownTimeout: 25,
      clients: [{ namespace: 'stalled' }, { namespace: 'healthy' }],
    }, logger);
    await manager.init();
    const closing = manager.destroy();
    await vi.advanceTimersByTimeAsync(25);
    await closing;
    expect(stalled.disconnect).toHaveBeenCalledOnce();
    expect(healthy.disconnect).toHaveBeenCalledOnce();
    expect(manager.getClients().size).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      { error: expect.objectContaining({ message: expect.stringMatching(/shutdown.*stalled.*25/i) }) },
      expect.stringContaining('stalled'),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes an explicitly destroyed client even when QUIT rejects', async () => {
    const failure = new Error('server disconnected');
    const connection = client('ready', vi.fn(async () => { throw failure; }));
    createClient.mockReturnValue(connection);
    const manager = new RedisManager({}, createMockLogger());
    await manager.init();
    await expect(manager.destroyClient('default')).rejects.toBe(failure);
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(manager.hasClient('default')).toBe(false);
  });

  it('preserves explicitly external ownership until the caller removes a client', async () => {
    const connection = client('ready');
    createClient.mockReturnValue(connection);
    const manager = new RedisManager({ closeClient: false }, createMockLogger());
    await manager.init();
    await manager.destroy();
    expect(connection.quit).not.toHaveBeenCalled();
    expect(connection.disconnect).not.toHaveBeenCalled();
    expect(manager.hasClient('default')).toBe(true);
    await manager.destroyClient('default');
    expect(connection.disconnect).toHaveBeenCalledOnce();
  });

  it('supports explicit immediate disconnect of a ready client', async () => {
    const connection = client('ready');
    createClient.mockReturnValue(connection);
    const manager = new RedisManager({ shutdownTimeout: 0 }, createMockLogger());
    await manager.init();
    await manager.destroy();
    expect(connection.quit).not.toHaveBeenCalled();
    expect(connection.disconnect).toHaveBeenCalledOnce();
  });

  it.each([-1, NaN, Infinity, 2 ** 31, 1.5])('rejects an invalid shutdown timeout: %s', (timeout) => {
    expect(() => new RedisManager({ shutdownTimeout: timeout }, createMockLogger())).toThrow(/shutdownTimeout/);
  });
});
