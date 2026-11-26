import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import { Container, type DynamicModule } from '@omnitron-dev/titan/nexus';
import { getRedisClientToken, type IRedisClient } from '@omnitron-dev/titan-redis';
import { TitanRateLimitModule } from '../src/ratelimit.module.js';
import { RedisRateLimitStorage } from '../src/ratelimit.storage.js';
import { RATE_LIMIT_SERVICE_TOKEN } from '../src/ratelimit.tokens.js';

const configured = { storageType: 'redis', strategy: 'fixed-window', keyPrefix: 'workspace', defaultLimit: 1 } as const;
const modules = [
  ['static', () => TitanRateLimitModule.forRoot(configured)],
  ['async', () => TitanRateLimitModule.forRootAsync({ useFactory: async () => configured })],
] as const;

function load(module: DynamicModule, client?: IRedisClient) {
  const container = new Container();
  if (client) container.register(getRedisClientToken(), { useValue: client });
  container.loadModule({ ...module, name: module.module.name });
  return container;
}

describe('rate limiting storage selected by the configured module', () => {
  for (const [name, configure] of modules) {
    it(`uses one namespace on the registered Redis connection (${name})`, async () => {
      const client = Object.assign(new EventEmitter(), { eval: vi.fn().mockResolvedValue([1, 1]) });
      const container = load(configure(), client as unknown as IRedisClient);
      try {
        const service = await container.resolveAsync(RATE_LIMIT_SERVICE_TOKEN);
        const result = await service.consume('account');
        expect(result.allowed).toBe(true);
        expect(client.eval.mock.calls[0]?.[2]).toMatch(/^workspace:account:\d+$/);
      } finally { await container.dispose(); }
      expect(client.listenerCount('ready')).toBe(0);
    });

    it(`refuses distributed quotas without their configured Redis provider (${name})`, async () => {
      const container = load(configure());
      try {
        await expect(container.resolveAsync(RATE_LIMIT_SERVICE_TOKEN)).rejects.toThrow(/Redis/);
      } finally { await container.dispose(); }
    });
  }

  it('resolves async memory settings without a Redis or logger registration', async () => {
    const container = load(TitanRateLimitModule.forRootAsync({ useFactory: () => ({ defaultLimit: 1 }) }));
    try {
      const service = await container.resolveAsync(RATE_LIMIT_SERVICE_TOKEN);
      expect((await service.consume('example')).allowed).toBe(true);
      expect((await service.consume('example')).allowed).toBe(false);
    } finally { await container.dispose(); }
  });

  it('supports a storage namespace for direct users', async () => {
    const client = Object.assign(new EventEmitter(), { eval: vi.fn().mockResolvedValue([1, 1]) });
    const storage = new RedisRateLimitStorage(client as unknown as IRedisClient);
    try {
      await storage.checkAndConsume('account', 1);
      expect(client.eval.mock.calls[0]?.[2]).toBe('ratelimit:account');
    } finally { storage.destroy(); }
  });
});
