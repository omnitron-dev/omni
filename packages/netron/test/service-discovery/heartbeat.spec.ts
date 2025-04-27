import { Redis } from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron } from '../../src';
import { NodeInfo } from '../../src/service-discovery/types';
import { ServiceDiscovery } from '../../src/service-discovery';

describe('ServiceDiscovery Heartbeat', () => {
  let redis: Redis;
  let discovery: ServiceDiscovery;
  const nodeId = 'test-node';
  const address = '127.0.0.1:3000';
  const services = [{ name: 'test-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = new Redis('redis://localhost:6379/2');
    await redis.flushdb();
    const netron = new Netron({
      id: nodeId,
    });

    discovery = new ServiceDiscovery(redis, netron, address, services, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });
  });

  afterEach(async () => {
    await discovery.shutdown();
    await redis.flushdb();
    redis.disconnect();
  });

  it('should publish heartbeat immediately and register node in Redis', async () => {
    await discovery.startHeartbeat();

    const nodeData = await redis.hgetall(`netron:discovery:nodes:${nodeId}`);

    expect(nodeData['address']).toBe(address);

    const servicesRaw = nodeData['services'];
    expect(servicesRaw).toBeDefined();
    expect(JSON.parse(servicesRaw!)).toEqual(services);

    expect(nodeData['timestamp']).toBeDefined();

    const heartbeatExists = await redis.exists(`netron:discovery:heartbeat:${nodeId}`);
    expect(heartbeatExists).toBe(1);

    const nodeIndex = await redis.sismember('netron:discovery:index:nodes', nodeId);
    expect(nodeIndex).toBe(1);
  });

  it('should update heartbeat periodically', async () => {
    await discovery.startHeartbeat();

    const initialTimestamp = await redis.hget(`netron:discovery:nodes:${nodeId}`, 'timestamp');
    expect(initialTimestamp).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 700));

    const updatedTimestamp = await redis.hget(`netron:discovery:nodes:${nodeId}`, 'timestamp');
    expect(updatedTimestamp).toBeDefined();
    expect(Number(updatedTimestamp)).toBeGreaterThan(Number(initialTimestamp));
  });

  it('should deregister node when heartbeat stops', async () => {
    await discovery.startHeartbeat();
    await discovery.shutdown();

    const nodeExists = await redis.exists(`netron:discovery:nodes:${nodeId}`);
    const heartbeatExists = await redis.exists(`netron:discovery:heartbeat:${nodeId}`);
    const nodeIndex = await redis.sismember('netron:discovery:index:nodes', nodeId);

    expect(nodeExists).toBe(0);
    expect(heartbeatExists).toBe(0);
    expect(nodeIndex).toBe(0);
  });

  it('should deregister node automatically after heartbeat TTL expires', async () => {
    await discovery.startHeartbeat();

    // Stop heartbeat to prevent TTL updates
    await discovery.shutdown();

    // Wait longer than heartbeatTTL (3.5 seconds)
    await delay(3500);

    const activeNodes: NodeInfo[] = await discovery.getActiveNodes();
    expect(activeNodes.length).toBe(0);

    const nodeExists = await redis.exists(`netron:discovery:nodes:${nodeId}`);
    expect(nodeExists).toBe(0);
  });
});
