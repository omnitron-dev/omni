import { Redis } from 'ioredis';

import { Netron } from '../../src';
import { ServiceDiscovery } from '../../src/service-discovery';

import type { ServiceInfo, DiscoveryOptions } from '../../src/service-discovery/types';

describe('ServiceDiscovery Initialization', () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new Redis("redis://localhost:6379/2");
  });

  afterEach(async () => {
    await redis.flushall();
    redis.disconnect();
  });

  const nodeId = 'node-1';
  const address = '127.0.0.1:8080';
  const services: ServiceInfo[] = [{ name: 'TestService', version: '1.0' }];
  const netron = new Netron({
    id: nodeId,
  });

  it('should initialize correctly with minimal options', () => {
    const discovery = new ServiceDiscovery(redis, netron, address, services);

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
    const discovery = new ServiceDiscovery(redis, netron, address, services, options);

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
