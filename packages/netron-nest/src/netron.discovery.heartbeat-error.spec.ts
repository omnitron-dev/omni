import { Redis } from 'ioredis';
import { Test } from '@nestjs/testing';
import { NetronOptions } from '@devgrid/netron';

import { Service, NetronModule, NetronService } from './';

describe('Netron Discovery - publishHeartbeat Redis Error Handling', () => {
  let netronService: NetronService;
  let redisMock: jest.Mocked<Redis>;

  const options: NetronOptions = {
    id: 'heartbeat-error-test',
    listenHost: 'localhost',
    listenPort: 8100,
    discoveryEnabled: true,
    discoveryRedisUrl: 'redis://localhost:6379/2',
    discoveryHeartbeatInterval: 10000, // Disable automatic heartbeat
    discoveryHeartbeatTTL: 2000,
    discoveryPubSubEnabled: true,
  };

  beforeEach(async () => {
    redisMock = {
      eval: jest.fn(),
      publish: jest.fn().mockResolvedValue(1),
      quit: jest.fn(),
    } as unknown as jest.Mocked<Redis>;

    const moduleRef = await Test.createTestingModule({
      imports: [NetronModule.forRoot(options)],
    }).compile();

    netronService = moduleRef.get(NetronService);
    await netronService.onApplicationBootstrap();

    // Expose service to ensure discovery is created
    @Service('dummy.heartbeat.service@1.0.0')
    class DummyHeartbeatService {}
    await netronService.instance.peer.exposeService(new DummyHeartbeatService());

    // Replace redis with mock
    (netronService.instance.discovery as any).redis = redisMock;
  });

  afterEach(async () => {
    await netronService.onApplicationShutdown();
    jest.clearAllMocks();
  });

  it('should handle Redis errors gracefully in publishHeartbeat()', async () => {
    redisMock.eval.mockRejectedValue(new Error('Redis eval failure'));

    await expect(netronService.instance.discovery?.publishHeartbeat()).rejects.toThrow('Redis eval failure');

    expect(redisMock.eval).toHaveBeenCalledTimes(3);
  });

  it('should retry publishHeartbeat after Redis error', async () => {
    redisMock.eval
      .mockRejectedValueOnce(new Error('Temporary Redis failure'))
      .mockRejectedValueOnce(new Error('Temporary Redis failure'))
      .mockResolvedValueOnce('OK');

    await expect(netronService.instance.discovery?.publishHeartbeat()).resolves.not.toThrow();

    expect(redisMock.eval).toHaveBeenCalledTimes(3);
    expect(redisMock.publish).toHaveBeenCalledTimes(1);
  });

  it('should fail publishHeartbeat after maximum retries', async () => {
    redisMock.eval.mockRejectedValue(new Error('Persistent Redis failure'));

    await expect(netronService.instance.discovery?.publishHeartbeat()).rejects.toThrow('Persistent Redis failure');

    expect(redisMock.eval).toHaveBeenCalledTimes(3);
    expect(redisMock.publish).toHaveBeenCalledTimes(0);
  });
});
