import { Redis } from 'ioredis';
import { Test } from '@nestjs/testing';
import { NetronOptions } from '@omnitron-dev/netron';

import { Service, NetronModule, NetronService } from './';

describe('Netron Discovery - Redis Error Handling', () => {
  let netronService: NetronService;
  let redisMock: jest.Mocked<Redis>;

  const options: NetronOptions = {
    id: 'node-error-test',
    listenHost: 'localhost',
    listenPort: 8000,
    discoveryEnabled: true,
    discoveryRedisUrl: 'redis://localhost:6379/2',
  };

  beforeEach(async () => {
    redisMock = {
      smembers: jest.fn(),
      pipeline: jest.fn(),
      eval: jest.fn(),
      multi: jest.fn(),
      exists: jest.fn(),
      quit: jest.fn(),
    } as unknown as jest.Mocked<Redis>;

    const moduleRef = await Test.createTestingModule({
      imports: [NetronModule.forRoot(options)],
    }).compile();

    netronService = moduleRef.get(NetronService);
    await netronService.onApplicationBootstrap();

    // Important: expose test service to ensure discovery is created
    @Service('dummy.service@1.0.0')
    class DummyService {}
    await netronService.instance.peer.exposeService(new DummyService());

    // Now discovery exists, we can replace redis with mock
    (netronService.instance.discovery as any).redis = redisMock;
  });

  afterEach(async () => {
    await netronService.onApplicationShutdown();
    jest.clearAllMocks();
  });

  it('should handle Redis connection errors gracefully in getActiveNodes()', async () => {
    redisMock.smembers.mockRejectedValue(new Error('Redis connection lost'));

    await expect(netronService.instance.discovery?.getActiveNodes()).rejects.toThrow('Redis connection lost');

    expect(redisMock.smembers).toHaveBeenCalledWith('netron:discovery:index:nodes');
  });

  it('should handle Redis pipeline errors gracefully in getActiveNodes()', async () => {
    redisMock.smembers.mockResolvedValue(['node-1']);
    redisMock.pipeline.mockReturnValue({
      hgetall: jest.fn().mockReturnThis(),
      exists: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(new Error('Pipeline error')),
    } as any);

    await expect(netronService.instance.discovery?.getActiveNodes()).rejects.toThrow('Pipeline error');

    expect(redisMock.pipeline).toHaveBeenCalled();
  });
});
