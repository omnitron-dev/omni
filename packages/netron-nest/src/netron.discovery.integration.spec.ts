import { Redis } from 'ioredis';
import { Test } from '@nestjs/testing';
import { delay } from '@devgrid/common';
import { NetronOptions } from '@devgrid/netron';

import { Service, NetronModule, NetronService } from './';

describe('Netron Discovery Integration', () => {
  let redis: Redis;
  let netronService: NetronService;

  const options: NetronOptions = {
    id: 'node-integration-test',
    listenHost: 'localhost',
    listenPort: 5000,
    discoveryEnabled: true,
    discoveryRedisUrl: 'redis://localhost:6379/2',
    discoveryHeartbeatInterval: 100,
    discoveryHeartbeatTTL: 2000,
  };

  beforeEach(async () => {
    redis = new Redis(options.discoveryRedisUrl!);
    await redis.flushdb();

    const moduleRef = await Test.createTestingModule({
      imports: [NetronModule.forRoot(options)],
    }).compile();

    netronService = moduleRef.get(NetronService);
    await netronService.onApplicationBootstrap();
  });

  afterEach(async () => {
    await netronService.onApplicationShutdown();
    await redis.quit();
  });

  it('should register node and maintain heartbeat in Redis', async () => {
    await delay(1000); // waiting for heartbeat

    const nodes = await redis.smembers('netron:discovery:index:nodes');
    expect(nodes).toContain(options.id);

    const nodeInfoExists = await redis.exists(`netron:discovery:nodes:${options.id}`);
    expect(nodeInfoExists).toBe(1);
  });

  it('should remove node from Redis if heartbeat stops', async () => {
    await netronService.onApplicationShutdown();
    await delay(options.discoveryHeartbeatTTL! + 500);

    const nodes = await redis.smembers('netron:discovery:index:nodes');
    expect(nodes).not.toContain(options.id);
  });

  it('should update services on expose and unexpose', async () => {
    @Service('test.service@1.0.0')
    class TestService {}

    await netronService.instance.peer.exposeService(new TestService());

    // Force heartbeat update to ensure Redis state is updated
    await netronService.instance.discovery?.publishHeartbeat();

    let nodeInfo: any;
    const maxAttempts = 10;
    const delayMs = 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const nodeInfoRaw = await redis.hgetall(`netron:discovery:nodes:${options.id}`);
      console.log(nodeInfoRaw);
      if (nodeInfoRaw && nodeInfoRaw['services']) {
        nodeInfo = {
          ...nodeInfoRaw,
          services: JSON.parse(nodeInfoRaw['services']),
        };
        if (nodeInfo.services.some((svc: any) => svc.name === 'test.service')) {
          break;
        }
      }
      await delay(delayMs);
    }

    expect(nodeInfo).toBeDefined();
    expect(nodeInfo.services).toContainEqual({ name: 'test.service', version: '1.0.0' });

    await netronService.instance.peer.unexposeService('test.service@1.0.0');

    // Force heartbeat update again after unexpose
    await netronService.instance.discovery?.publishHeartbeat();

    let nodeInfoAfterUnexpose: any;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const nodeInfoRaw = await redis.hgetall(`netron:discovery:nodes:${options.id}`);
      if (nodeInfoRaw && nodeInfoRaw['services']) {
        nodeInfoAfterUnexpose = {
          ...nodeInfoRaw,
          services: JSON.parse(nodeInfoRaw['services']),
        };
        if (!nodeInfoAfterUnexpose.services.some((svc: any) => svc.name === 'test.service')) {
          break;
        }
      }
      await delay(delayMs);
    }

    expect(nodeInfoAfterUnexpose).toBeDefined();
    expect(nodeInfoAfterUnexpose.services).not.toContainEqual({ name: 'test.service', version: '1.0.0' });
  }, 20000); // increased timeout for reliability
});
