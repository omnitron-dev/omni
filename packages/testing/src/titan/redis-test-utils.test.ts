import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  clients: [] as Array<{ options: Record<string, unknown>; disconnect: ReturnType<typeof vi.fn>; flushdb: ReturnType<typeof vi.fn> }>,
  init: vi.fn(),
  destroy: vi.fn(),
  connectionError: null as Error | null,
}));

vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Redis: class extends EventEmitter {
      status = 'connecting';
      disconnect = vi.fn();
      flushdb = vi.fn().mockResolvedValue('OK');
      constructor(public options: Record<string, unknown>) {
        super();
        doubles.clients.push(this);
        if (!options.lazyConnect) queueMicrotask(() => {
          if (doubles.connectionError) this.emit('error', doubles.connectionError);
          else this.emit('ready');
        });
      }
    },
  };
});
vi.mock('@omnitron-dev/titan-redis', () => ({
  RedisManager: class {
    onModuleInit = doubles.init;
    onModuleDestroy = doubles.destroy;
  },
  RedisService: class {},
}));

import { createRedisTestFixture } from './redis-test-utils.js';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'titan-redis-fixture-'));
  vi.stubEnv('TITAN_TEST_REDIS_INFO', join(directory, 'endpoint.json'));
  vi.stubEnv('TEST_REDIS_HOST', '127.0.0.2');
  vi.stubEnv('TEST_REDIS_PORT', '26379');
  vi.stubEnv('USE_MOCK_REDIS', 'false');
  vi.stubEnv('SKIP_DOCKER_TESTS', 'false');
  doubles.clients.length = 0;
  doubles.connectionError = null;
  doubles.init.mockReset().mockResolvedValue(undefined);
  doubles.destroy.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe('shared Redis test fixture', () => {
  it('uses the isolated endpoint instead of a developer Redis on 6379', async () => {
    const fixture = await createRedisTestFixture();
    expect(fixture.options).toMatchObject({ host: '127.0.0.2', port: 26379, db: 15 });
    await fixture.cleanup();
  });

  it('honors global setup and explicit overrides', async () => {
    writeFileSync(join(directory, 'endpoint.json'), JSON.stringify({ port: 26380 }));
    const selected = await createRedisTestFixture();
    expect(selected.options.port).toBe(26380);
    await selected.cleanup();
    const explicit = await createRedisTestFixture({ host: '127.0.0.3', port: 26381, db: 12 });
    expect(explicit.options).toMatchObject({ host: '127.0.0.3', port: 26381, db: 12 });
    await explicit.cleanup();
  });

  it('does not open a real client when setup selected mock mode', async () => {
    writeFileSync(join(directory, 'endpoint.json'), JSON.stringify({ isMock: true }));
    await expect(createRedisTestFixture()).rejects.toThrow('setup selected mock mode');
    expect(doubles.clients).toHaveLength(0);
  });

  it('closes the client if the initial connection fails', async () => {
    doubles.connectionError = new Error('connection refused');
    await expect(createRedisTestFixture()).rejects.toThrow('connection refused');
    expect(doubles.clients[0]?.disconnect).toHaveBeenCalledOnce();
  });

  it('closes all allocated clients if manager initialization fails', async () => {
    doubles.init.mockRejectedValue(new Error('manager unavailable'));
    await expect(createRedisTestFixture({ withManager: true })).rejects.toThrow('manager unavailable');
    expect(doubles.destroy).toHaveBeenCalledOnce();
    expect(doubles.clients[0]?.disconnect).toHaveBeenCalledOnce();
  });

  it('releases connections and reports a failed cleanup instead of swallowing it', async () => {
    const fixture = await createRedisTestFixture({ withManager: true });
    doubles.clients[0]?.flushdb.mockRejectedValue(new Error('Redis disconnected'));
    await expect(fixture.cleanup()).rejects.toThrow('Redis disconnected');
    expect(doubles.destroy).toHaveBeenCalledOnce();
    expect(doubles.clients[0]?.disconnect).toHaveBeenCalledOnce();
  });
});
