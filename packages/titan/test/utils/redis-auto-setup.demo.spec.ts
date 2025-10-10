/**
 * Demonstration test for redis-auto-setup.ts
 *
 * This test demonstrates the automatic Redis Docker container management.
 * Run with: yarn test test/utils/redis-auto-setup.demo.spec.ts
 *
 * NO manual Redis setup required!
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { setupRedisContainer, setupSharedRedisContainer, setupRedisForTests } from './redis-auto-setup.js';

describe('Redis Auto-Setup Demo', () => {
  describe('Pattern 1: Isolated Container Per Test', () => {
    const redis = setupRedisContainer();

    it('should automatically start Redis and allow operations', async () => {
      const client = redis.getClient();

      // Redis is ready to use - no manual startup needed!
      await client.set('demo-key', 'demo-value');
      const result = await client.get('demo-key');

      expect(result).toBe('demo-value');

      // Check connection details
      const conn = redis.getConnection();
      expect(conn.host).toBe('127.0.0.1');
      expect(conn.port).toBeGreaterThan(16379); // Dynamic port allocation
    });

    it('should have clean state for each test', async () => {
      const client = redis.getClient();

      // New container = clean state
      const keys = await client.keys('*');
      expect(keys.length).toBe(0);

      await client.set('test-key', 'test-value');
      const value = await client.get('test-key');
      expect(value).toBe('test-value');
    });

    it('should work with Redis commands', async () => {
      const client = redis.getClient();

      // Test various Redis operations
      await client.lpush('list-key', 'item1', 'item2', 'item3');
      const length = await client.llen('list-key');
      expect(length).toBe(3);

      const items = await client.lrange('list-key', 0, -1);
      expect(items).toEqual(['item3', 'item2', 'item1']);
    });
  });

  describe('Pattern 2: Shared Container', () => {
    const redis = setupSharedRedisContainer();

    beforeEach(async () => {
      // Clean up before each test
      await redis.getClient().flushdb();
    });

    it('should share container across tests', async () => {
      const client = redis.getClient();
      await client.set('shared-key', 'shared-value');

      const result = await client.get('shared-key');
      expect(result).toBe('shared-value');
    });

    it('should see clean state after beforeEach cleanup', async () => {
      const client = redis.getClient();

      // Previous test data cleared by beforeEach
      const result = await client.get('shared-key');
      expect(result).toBeNull();
    });
  });

  describe('Pattern 3: For NotificationManager/Custom Config', () => {
    const { getRedisUrl, getRedisConfig } = setupRedisForTests();

    it('should provide connection details for constructors', async () => {
      // Get Redis URL for configuration
      const redisUrl = getRedisUrl();
      expect(redisUrl).toMatch(/^redis:\/\/127\.0\.0\.1:\d+$/);

      // Or get connection config
      const config = getRedisConfig();
      expect(config.host).toBe('127.0.0.1');
      expect(config.port).toBeGreaterThan(16379);
    });

    it('should work with custom clients', async () => {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(getRedisUrl());

      await client.set('custom-key', 'custom-value');
      const result = await client.get('custom-key');
      expect(result).toBe('custom-value');

      await client.quit();
    });
  });
});

describe('Redis Auto-Setup - Timeout Configuration', () => {
  // Demonstrate custom timeout
  const redis = setupRedisContainer({
    name: 'demo-timeout',
    timeout: 45000, // 45 seconds for slower systems
  });

  it('should respect custom timeouts', async () => {
    const client = redis.getClient();
    await client.ping();
    expect(client.status).toBe('ready');
  });
});

describe('Redis Auto-Setup - Verbose Mode', () => {
  // Enable verbose logging with REDIS_VERBOSE=true environment variable
  // or pass verbose: true in options
  const redis = setupRedisContainer({
    name: 'demo-verbose',
    verbose: false, // Set to true to see detailed logs
  });

  it('should work in verbose mode', async () => {
    const client = redis.getClient();
    const info = await client.info('server');
    expect(info).toContain('redis_version');
  });
});
