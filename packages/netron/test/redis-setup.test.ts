import { getTestRedisUrl, createTestRedisClient } from './helpers/test-utils';

describe('Redis Test Setup', () => {
  it('should have REDIS_URL environment variable set', () => {
    expect(process.env['REDIS_URL']).toBeDefined();
    console.log('REDIS_URL:', process.env['REDIS_URL']);
  });

  it('should be able to get test Redis URL', () => {
    const url = getTestRedisUrl();
    expect(url).toBeDefined();
    expect(url).toContain('redis://');
    console.log('Test Redis URL:', url);
  });

  it('should be able to create Redis client', async () => {
    const client = createTestRedisClient();
    expect(client).toBeDefined();

    // Test basic Redis operation
    await client.set('test-key', 'test-value');
    const value = await client.get('test-key');
    expect(value).toBe('test-value');

    // Cleanup
    await client.del('test-key');
    client.disconnect();
  });

  it('should be able to use different databases', async () => {
    const client1 = createTestRedisClient(1);
    const client2 = createTestRedisClient(2);

    // Set different values in different databases
    await client1.set('key', 'value1');
    await client2.set('key', 'value2');

    // Verify isolation
    expect(await client1.get('key')).toBe('value1');
    expect(await client2.get('key')).toBe('value2');

    // Cleanup
    await client1.flushdb();
    await client2.flushdb();
    client1.disconnect();
    client2.disconnect();
  });
});
