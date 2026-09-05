/**
 * `redisClientName` must select the client the lock service uses.
 *
 * The option is documented as "Redis client name if using named Redis
 * instances" and could never work: `DistributedLockService` took its client
 * from `@InjectRedis()`, a parameter decorator bound when the class is defined,
 * which cannot consult a value that arrives at runtime. A deployment with named
 * Redis instances that pointed the lock module at one of them silently got the
 * default client — its locks lived in a different Redis than configured, and
 * two services that believed they were coordinating through the named instance
 * were not.
 *
 * The module now resolves the client through a provider, which is the only
 * place a runtime option can be read.
 */

import { describe, it, expect } from 'vitest';

import { TitanLockModule } from '../src/lock.module.js';
import { LOCK_REDIS_TOKEN, LOCK_OPTIONS_TOKEN } from '../src/lock.tokens.js';

type ProviderEntry = [unknown, { useFactory?: (...args: any[]) => unknown; inject?: unknown[] }];

function providerFor(providers: unknown[], token: unknown): ProviderEntry[1] | undefined {
  for (const entry of providers) {
    if (Array.isArray(entry) && entry[0] === token) return entry[1] as ProviderEntry[1];
  }
  return undefined;
}

/** Stands in for RedisManager: records which namespace was asked for. */
function recordingManager() {
  const asked: Array<string | undefined> = [];
  return {
    asked,
    getClient(namespace?: string) {
      asked.push(namespace);
      return { namespace } as unknown;
    },
  };
}

describe('TitanLockModule — redisClientName', () => {
  it('asks the manager for the named client', () => {
    const module = TitanLockModule.forRoot({ redisClientName: 'locks' });
    const provider = providerFor(module.providers as unknown[], LOCK_REDIS_TOKEN);
    expect(provider?.useFactory).toBeTypeOf('function');

    const manager = recordingManager();
    const client = provider!.useFactory!(manager, { redisClientName: 'locks' });

    expect(manager.asked).toEqual(['locks']);
    expect(client).toEqual({ namespace: 'locks' });
  });

  it('falls back to the default client when no name is given', () => {
    const module = TitanLockModule.forRoot({});
    const provider = providerFor(module.providers as unknown[], LOCK_REDIS_TOKEN);

    const manager = recordingManager();
    provider!.useFactory!(manager, {});

    expect(manager.asked).toEqual([undefined]);
  });

  it('resolves the name from the options token, so forRootAsync works too', () => {
    // The async path resolves options through a factory, so the client
    // provider has to read them from the token rather than from a value
    // captured when the module was built.
    const module = TitanLockModule.forRootAsync({ useFactory: () => ({ redisClientName: 'from-async' }) });
    const provider = providerFor(module.providers as unknown[], LOCK_REDIS_TOKEN);

    expect(provider?.inject).toContain(LOCK_OPTIONS_TOKEN);

    const manager = recordingManager();
    provider!.useFactory!(manager, { redisClientName: 'from-async' });

    expect(manager.asked).toEqual(['from-async']);
  });
});
