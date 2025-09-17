import { describe, it, expect } from '@jest/globals';
import {
  REDIS_MODULE_OPTIONS,
  REDIS_MANAGER,
  REDIS_CLIENT,
  REDIS_DEFAULT_NAMESPACE,
  getRedisClientToken,
  getRedisOptionsToken,
} from '../../../src/modules/redis/redis.constants';

describe('Redis Constants', () => {
  describe('Module Tokens', () => {
    it('should have correct constant values', () => {
      expect(typeof REDIS_MODULE_OPTIONS).toBe('symbol');
      expect(REDIS_MODULE_OPTIONS.toString()).toBe('Symbol(REDIS_MODULE_OPTIONS)');
      expect(typeof REDIS_MANAGER).toBe('symbol');
      expect(REDIS_MANAGER.toString()).toBe('Symbol(REDIS_MANAGER)');
      expect(typeof REDIS_CLIENT).toBe('symbol');
      expect(REDIS_CLIENT.toString()).toBe('Symbol(REDIS_CLIENT)');
      expect(REDIS_DEFAULT_NAMESPACE).toBe('default');
    });

    it('should be unique values', () => {
      const tokens = new Set([
        REDIS_MODULE_OPTIONS,
        REDIS_MANAGER,
        REDIS_CLIENT,
        REDIS_DEFAULT_NAMESPACE,
      ]);
      expect(tokens.size).toBe(4);
    });
  });

  describe('getRedisClientToken', () => {
    it('should generate default token when no namespace provided', () => {
      expect(getRedisClientToken()).toBe('REDIS_CLIENT:default');
    });

    it('should generate namespace-specific tokens', () => {
      expect(getRedisClientToken('cache')).toBe('REDIS_CLIENT:cache');
      expect(getRedisClientToken('pubsub')).toBe('REDIS_CLIENT:pubsub');
      expect(getRedisClientToken('session')).toBe('REDIS_CLIENT:session');
    });

    it('should handle empty string as default', () => {
      expect(getRedisClientToken('')).toBe('REDIS_CLIENT:default');
    });

    it('should handle special characters in namespace', () => {
      expect(getRedisClientToken('cache-v1')).toBe('REDIS_CLIENT:cache-v1');
      expect(getRedisClientToken('cache_v2')).toBe('REDIS_CLIENT:cache_v2');
      expect(getRedisClientToken('cache.main')).toBe('REDIS_CLIENT:cache.main');
      expect(getRedisClientToken('cache:prod')).toBe('REDIS_CLIENT:cache:prod');
      expect(getRedisClientToken('cache@main')).toBe('REDIS_CLIENT:cache@main');
    });

    it('should handle very long namespace names', () => {
      const longNamespace = 'a'.repeat(1000);
      const token = getRedisClientToken(longNamespace);
      expect(token).toBe(`REDIS_CLIENT:${longNamespace}`);
      expect(token.length).toBe(1013); // "REDIS_CLIENT:".length + 1000
    });

    it('should handle unicode characters in namespace', () => {
      expect(getRedisClientToken('кэш')).toBe('REDIS_CLIENT:кэш');
      expect(getRedisClientToken('缓存')).toBe('REDIS_CLIENT:缓存');
      expect(getRedisClientToken('キャッシュ')).toBe('REDIS_CLIENT:キャッシュ');
      expect(getRedisClientToken('🚀')).toBe('REDIS_CLIENT:🚀');
      expect(getRedisClientToken('café')).toBe('REDIS_CLIENT:café');
    });

    it('should be consistent for same input', () => {
      const namespace = 'test-namespace';
      const token1 = getRedisClientToken(namespace);
      const token2 = getRedisClientToken(namespace);
      const token3 = getRedisClientToken(namespace);

      expect(token1).toBe(token2);
      expect(token2).toBe(token3);
    });

    it('should generate unique tokens for different namespaces', () => {
      const tokens = new Set([
        getRedisClientToken('ns1'),
        getRedisClientToken('ns2'),
        getRedisClientToken('ns3'),
        getRedisClientToken('ns4'),
        getRedisClientToken('ns5'),
      ]);
      expect(tokens.size).toBe(5);
    });

    it('should handle null and undefined as default', () => {
      // @ts-expect-error - Testing edge case
      expect(getRedisClientToken(null)).toBe('REDIS_CLIENT:default');
      expect(getRedisClientToken(undefined)).toBe('REDIS_CLIENT:default');
      expect(getRedisClientToken()).toBe('REDIS_CLIENT:default');
    });

  });

  describe('getRedisOptionsToken', () => {
    it('should generate default token when no namespace provided', () => {
      expect(getRedisOptionsToken()).toBe('REDIS_OPTIONS:default');
    });

    it('should generate namespace-specific tokens', () => {
      expect(getRedisOptionsToken('cache')).toBe('REDIS_OPTIONS:cache');
      expect(getRedisOptionsToken('pubsub')).toBe('REDIS_OPTIONS:pubsub');
      expect(getRedisOptionsToken('session')).toBe('REDIS_OPTIONS:session');
    });

    it('should handle empty string as default', () => {
      expect(getRedisOptionsToken('')).toBe('REDIS_OPTIONS:default');
    });

    it('should handle special characters in namespace', () => {
      expect(getRedisOptionsToken('cache-v1')).toBe('REDIS_OPTIONS:cache-v1');
      expect(getRedisOptionsToken('cache_v2')).toBe('REDIS_OPTIONS:cache_v2');
      expect(getRedisOptionsToken('cache.main')).toBe('REDIS_OPTIONS:cache.main');
      expect(getRedisOptionsToken('cache:prod')).toBe('REDIS_OPTIONS:cache:prod');
      expect(getRedisOptionsToken('cache@main')).toBe('REDIS_OPTIONS:cache@main');
    });

    it('should handle very long namespace names', () => {
      const longNamespace = 'b'.repeat(1000);
      const token = getRedisOptionsToken(longNamespace);
      expect(token).toBe(`REDIS_OPTIONS:${longNamespace}`);
      expect(token.length).toBe(1014); // "REDIS_OPTIONS:".length + 1000
    });

    it('should handle unicode characters in namespace', () => {
      expect(getRedisOptionsToken('конфиг')).toBe('REDIS_OPTIONS:конфиг');
      expect(getRedisOptionsToken('配置')).toBe('REDIS_OPTIONS:配置');
      expect(getRedisOptionsToken('設定')).toBe('REDIS_OPTIONS:設定');
      expect(getRedisOptionsToken('⚙️')).toBe('REDIS_OPTIONS:⚙️');
      expect(getRedisOptionsToken('naïve')).toBe('REDIS_OPTIONS:naïve');
    });

    it('should be consistent for same input', () => {
      const namespace = 'test-namespace';
      const token1 = getRedisOptionsToken(namespace);
      const token2 = getRedisOptionsToken(namespace);
      const token3 = getRedisOptionsToken(namespace);

      expect(token1).toBe(token2);
      expect(token2).toBe(token3);
    });

    it('should generate unique tokens for different namespaces', () => {
      const tokens = new Set([
        getRedisOptionsToken('opt1'),
        getRedisOptionsToken('opt2'),
        getRedisOptionsToken('opt3'),
        getRedisOptionsToken('opt4'),
        getRedisOptionsToken('opt5'),
      ]);
      expect(tokens.size).toBe(5);
    });

    it('should handle null and undefined as default', () => {
      expect(getRedisOptionsToken(undefined)).toBe('REDIS_OPTIONS:default');
      expect(getRedisOptionsToken()).toBe('REDIS_OPTIONS:default');
    });
  });

  describe('Token Independence', () => {
    it('should generate different tokens for client and options with same namespace', () => {
      const namespaces = ['test', 'cache', 'pubsub', 'session', 'metrics'];

      for (const namespace of namespaces) {
        const clientToken = getRedisClientToken(namespace);
        const optionsToken = getRedisOptionsToken(namespace);

        expect(clientToken).not.toBe(optionsToken);
        expect(clientToken).toContain('REDIS_CLIENT');
        expect(optionsToken).toContain('REDIS_OPTIONS');
        expect(clientToken).toContain(namespace);
        expect(optionsToken).toContain(namespace);
      }
    });

    it('should maintain independence across multiple namespaces', () => {
      const namespaces = ['cache', 'pubsub', 'session', 'metrics', 'default'];
      const clientTokens = namespaces.map(ns => getRedisClientToken(ns));
      const optionsTokens = namespaces.map(ns => getRedisOptionsToken(ns));

      // All tokens should be unique
      const allTokens = [...clientTokens, ...optionsTokens];
      const uniqueTokens = new Set(allTokens);
      expect(uniqueTokens.size).toBe(allTokens.length);
    });
  });

  describe('Edge Cases', () => {
    it('should handle whitespace-only namespaces', () => {
      expect(getRedisClientToken('   ')).toBe('REDIS_CLIENT:   ');
      expect(getRedisClientToken('\t\n')).toBe('REDIS_CLIENT:\t\n');
      expect(getRedisOptionsToken('   ')).toBe('REDIS_OPTIONS:   ');
      expect(getRedisOptionsToken('\t\n')).toBe('REDIS_OPTIONS:\t\n');
    });

    it('should handle namespaces with Redis special characters', () => {
      // These characters have special meaning in Redis
      expect(getRedisClientToken('*')).toBe('REDIS_CLIENT:*');
      expect(getRedisClientToken('?')).toBe('REDIS_CLIENT:?');
      expect(getRedisClientToken('[')).toBe('REDIS_CLIENT:[');
      expect(getRedisClientToken(']')).toBe('REDIS_CLIENT:]');
      expect(getRedisClientToken('$')).toBe('REDIS_CLIENT:$');
    });

    it('should handle namespaces with control characters', () => {
      expect(getRedisClientToken('\0')).toBe('REDIS_CLIENT:\0');
      expect(getRedisClientToken('\n')).toBe('REDIS_CLIENT:\n');
      expect(getRedisClientToken('\r')).toBe('REDIS_CLIENT:\r');
      expect(getRedisClientToken('\t')).toBe('REDIS_CLIENT:\t');
    });
  });

  describe('Performance', () => {
    it('should handle token generation efficiently', () => {
      const iterations = 100000;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        getRedisClientToken(`namespace-${i}`);
        getRedisOptionsToken(`namespace-${i}`);
      }

      const duration = Date.now() - start;
      // Should generate 200000 tokens in less than 500ms
      expect(duration).toBeLessThan(500);
    });

    it('should not have memory leaks with repeated calls', () => {
      const namespace = 'test';
      const tokens = new Set();

      // Same namespace should always return same token
      for (let i = 0; i < 1000; i++) {
        tokens.add(getRedisClientToken(namespace));
        tokens.add(getRedisOptionsToken(namespace));
      }

      // Should only have 2 unique tokens despite 2000 calls
      expect(tokens.size).toBe(2);
    });

    it('should handle concurrent token generation', () => {
      const promises = [];

      for (let i = 0; i < 1000; i++) {
        promises.push(
          Promise.resolve(getRedisClientToken(`async-${i}`)),
          Promise.resolve(getRedisOptionsToken(`async-${i}`))
        );
      }

      return Promise.all(promises).then(results => {
        const uniqueResults = new Set(results);
        expect(uniqueResults.size).toBe(2000); // All should be unique
      });
    });
  });

  describe('Token Format', () => {
    it('should follow consistent format', () => {
      const clientToken = getRedisClientToken('test');
      const optionsToken = getRedisOptionsToken('test');

      expect(clientToken).toMatch(/^REDIS_CLIENT:.+$/);
      expect(optionsToken).toMatch(/^REDIS_OPTIONS:.+$/);
    });

    it('should preserve case sensitivity', () => {
      expect(getRedisClientToken('Test')).toBe('REDIS_CLIENT:Test');
      expect(getRedisClientToken('test')).toBe('REDIS_CLIENT:test');
      expect(getRedisClientToken('TEST')).toBe('REDIS_CLIENT:TEST');

      expect(getRedisClientToken('Test')).not.toBe(getRedisClientToken('test'));
    });

    it('should not transform or encode namespace', () => {
      const specialNamespace = 'name/with/slashes';
      expect(getRedisClientToken(specialNamespace)).toBe(`REDIS_CLIENT:${specialNamespace}`);
      expect(getRedisOptionsToken(specialNamespace)).toBe(`REDIS_OPTIONS:${specialNamespace}`);
    });
  });
});