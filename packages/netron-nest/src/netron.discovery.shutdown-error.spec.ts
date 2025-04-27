import Redis from 'ioredis';
import { Test } from '@nestjs/testing';
import { delay } from '@devgrid/common';
import { NetronOptions } from '@devgrid/netron';

import { NetronModule, NetronService } from './';

describe('Netron Discovery - Redis Shutdown Error Handling', () => {
  let netronService: NetronService;
  let redisMock: jest.Mocked<Redis>;

  const options: NetronOptions = {
    id: 'node-shutdown-test',
    listenHost: 'localhost',
    listenPort: 8001,
    discoveryEnabled: true,
    discoveryRedisUrl: 'redis://localhost:6379/2',
    discoveryPubSubEnabled: true,
  };

  beforeEach(async () => {
    redisMock = {
      multi: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      srem: jest.fn().mockReturnThis(),
      exec: jest.fn(),
      unsubscribe: jest.fn(),
      disconnect: jest.fn(),
      publish: jest.fn(),
      quit: jest.fn(),
      eval: jest.fn(),
    } as unknown as jest.Mocked<Redis>;

    const moduleRef = await Test.createTestingModule({
      imports: [NetronModule.forRoot(options)],
    }).compile();

    netronService = moduleRef.get(NetronService);
    await netronService.onApplicationBootstrap();

    await delay(500);

    // Initialize discovery and replace redis with mock
    (netronService.instance.discovery as any).redis = redisMock;
    (netronService.instance.discovery as any).subscriber = redisMock;
  });

  afterEach(async () => {
    await netronService.onApplicationShutdown();  // explicitly stop Netron
    jest.clearAllMocks();
  });

  it('should handle Redis errors gracefully during deregistration on shutdown', async () => {
    redisMock.exec.mockRejectedValue(new Error('Redis multi exec failure'));

    const loggerSpy = jest.spyOn(console, 'error').mockImplementation();

    await expect(netronService.instance.discovery?.shutdown()).resolves.not.toThrow();

    expect(redisMock.multi).toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Error during deregistration of node '${options.id}'`),
      expect.any(Object),
    );

    loggerSpy.mockRestore();
  });

  it('should handle Redis errors gracefully during Pub/Sub unsubscribe on shutdown', async () => {
    redisMock.unsubscribe.mockRejectedValue(new Error('Redis unsubscribe failure'));

    const loggerSpy = jest.spyOn(console, 'error').mockImplementation();

    await expect(netronService.instance.discovery?.shutdown()).resolves.not.toThrow();

    expect(redisMock.unsubscribe).toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Error during Redis Pub/Sub unsubscribe for node '${options.id}'`),
      expect.any(Object),
    );

    loggerSpy.mockRestore();
  });
});
