import { Redis } from 'ioredis';

import { Netron, ServiceDiscovery } from '../../src';
import { cleanupRedis, createTestRedisClient } from '../helpers/test-utils';

import type { ServiceInfo, DiscoveryOptions } from '../../src';

describe('ServiceDiscovery Initialization', () => {
  let redis: Redis | undefined;

  beforeEach(() => {
    redis = createTestRedisClient(2);
  });

  afterEach(async () => {
    if (redis) {
      await cleanupRedis(redis);
    }
    if (redis) {
      redis.disconnect();
    }
  });

  const nodeId = 'node-1';
  const address = '127.0.0.1:8080';
  const services: ServiceInfo[] = [{ name: 'TestService', version: '1.0' }];
  const netron = new Netron({
    id: nodeId,
  });

  it('should initialize correctly with minimal options', () => {
    const discovery = new ServiceDiscovery(redis!, netron, address, services);

    expect(discovery).toBeDefined();
    expect(discovery['nodeId']).toBe(nodeId);
    expect(discovery['address']).toBe(address);
    expect(discovery['services']).toEqual(services);
    expect(discovery['options'].heartbeatInterval).toBe(5000);
    expect(discovery['options'].heartbeatTTL).toBe(15000);
  });

  it('should initialize correctly with full options', () => {
    const options: DiscoveryOptions = {
      heartbeatInterval: 10000,
      heartbeatTTL: 30000,
    };
    const discovery = new ServiceDiscovery(redis!, netron, address, services, options);

    expect(discovery).toBeDefined();
    expect(discovery['options'].heartbeatInterval).toBe(10000);
    expect(discovery['options'].heartbeatTTL).toBe(30000);
  });

  it('should handle invalid redis instance gracefully', () => {
    expect(() => {
      new ServiceDiscovery(null as any, netron, address, services);
    }).toThrow();
  });
});
