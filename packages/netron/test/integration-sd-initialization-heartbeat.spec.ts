import { Redis } from 'ioredis';
import { delay } from '@devgrid/common';

import { Service } from '../dist';
import { Netron } from '../dist/netron';
import { cleanupRedis, getTestRedisUrl, createTestRedisClient } from './helpers/test-utils';

@Service('test.service@1.0.0')
class TestService {
  hello() {
    return 'Hello Netron!';
  }
}

describe('ServiceDiscovery Integration - Initialization & Heartbeat', () => {
  let netron: Netron;
  let redis: Redis;

  beforeAll(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 4000,
      discoveryEnabled: true,
      discoveryRedisUrl: getTestRedisUrl(2),
      discoveryHeartbeatInterval: 500, // speed up heartbeat for testing
      discoveryHeartbeatTTL: 3000,
    });
  });

  afterAll(async () => {
    await netron.stop();
    await redis.quit();
  });

  it('should initialize service discovery and maintain heartbeat', async () => {
    // Give time for several heartbeat cycles
    await delay(1500);

    const activeNodes = await netron.discovery!.getActiveNodes();

    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.nodeId).toBe(netron.id);
    expect(activeNodes[0]?.address).toBe('localhost:4000');
    expect(activeNodes[0]?.services).toEqual([]);

    // Wait and check again that heartbeat keeps the node active
    await delay(1000);

    const activeNodesAfterWait = await netron.discovery!.getActiveNodes();

    expect(activeNodesAfterWait).toHaveLength(1);
    expect(activeNodesAfterWait[0]?.nodeId).toBe(netron.id);
  });

  it('should not register node in client mode', async () => {
    const clientNetron = await Netron.create({
      discoveryEnabled: true,
      discoveryRedisUrl: getTestRedisUrl(2),

    });

    try {
      // Give time for initialization
      await delay(500);

      const activeNodes = await clientNetron.discovery!.getActiveNodes();

      console.log('activeNodes', activeNodes);

      // Node in client mode should not be registered
      expect(activeNodes).toHaveLength(1);

      // Check that discovery service is still available
      expect(clientNetron.discovery).toBeDefined();
    } finally {
      await clientNetron.stop();
    }
  });

  it('should allow client to discover server services', async () => {
    // Create server netron with test service
    const serverNetron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 4001,
      discoveryEnabled: true,
      discoveryRedisUrl: getTestRedisUrl(2),
      discoveryHeartbeatInterval: 500,
      discoveryHeartbeatTTL: 3000,
    });

    // Create client netron
    const clientNetron = await Netron.create({
      discoveryEnabled: true,
      discoveryRedisUrl: getTestRedisUrl(2),
    });

    try {
      // Expose test service on server netron
      await serverNetron.peer.exposeService(new TestService());

      // Give time for service information to update
      await delay(1000);

      // Get list of active nodes through client netron
      const activeNodes = await clientNetron.discovery!.getActiveNodes();

      // Check that client sees server node
      expect(activeNodes).toHaveLength(2);
      expect(activeNodes[1]?.nodeId).toBe(serverNetron.id);
      expect(activeNodes[1]?.address).toBe('localhost:4001');
      expect(activeNodes[1]?.services).toEqual([
        { name: 'test.service', version: '1.0.0' }
      ]);
    } finally {
      await serverNetron.stop();
      await clientNetron.stop();
    }
  });
});
