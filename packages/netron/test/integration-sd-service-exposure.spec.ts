import Redis from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron, Service } from '../dist';

@Service('test.service@1.0.0')
class TestService {
  hello() {
    return 'Hello Netron!';
  }
}

describe('ServiceDiscovery Integration - Service Exposure & Unexposure', () => {
  let redis: Redis;
  let netron: Netron;

  beforeAll(async () => {
    redis = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', { db: 2 });
    await redis.flushdb();

    netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 4004,
      discoveryEnabled: true,
      discoveryRedisUrl: process.env['REDIS_URL'] || 'redis://localhost:6379/2',
      discoveryHeartbeatInterval: 500,
      discoveryHeartbeatTTL: 3000,
    });

    await delay(1000);
  });

  afterAll(async () => {
    await netron.stop();
    await redis.quit();
  });

  it('should correctly update service info in Redis on exposure and unexposure', async () => {
    await netron.peer.exposeService(new TestService());

    await delay(1000); // wait for heartbeat update

    const activeNodes = await netron.discovery!.getActiveNodes();

    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.services).toEqual([
      { name: 'test.service', version: '1.0.0' },
    ]);

    // Now unexpose the service
    await netron.peer.unexposeService('test.service@1.0.0');

    await delay(1000); // wait for heartbeat update

    const activeNodesAfterUnexpose = await netron.discovery!.getActiveNodes();
    expect(activeNodesAfterUnexpose).toHaveLength(1);
    expect(activeNodesAfterUnexpose[0]?.services).toEqual([]);
  });
});
