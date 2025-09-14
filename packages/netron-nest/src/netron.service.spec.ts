import { Test } from '@nestjs/testing';
import { Netron, NetronOptions } from '@omnitron-dev/netron';
import { Reflector, DiscoveryService } from '@nestjs/core';

import { NETRON_OPTIONS } from './constants';
import { NetronService } from './netron.service';

jest.mock('@omnitron-dev/netron');

describe('NetronService', () => {
  let netronService: NetronService;
  let netronInstanceMock: jest.Mocked<Netron>;
  let discoveryServiceMock: jest.Mocked<DiscoveryService>;
  let reflectorMock: jest.Mocked<Reflector>;

  beforeEach(async () => {
    netronInstanceMock = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      peer: {
        exposeService: jest.fn(),
      },
    } as any;

    discoveryServiceMock = {
      getProviders: jest.fn().mockReturnValue([]),
    } as any;

    reflectorMock = {
      get: jest.fn().mockReturnValue(undefined),
    } as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        NetronService,
        { provide: Reflector, useValue: reflectorMock },
        { provide: DiscoveryService, useValue: discoveryServiceMock },
        {
          provide: NETRON_OPTIONS,
          useValue: { listenHost: 'localhost', listenPort: 3000 } as NetronOptions,
        },
      ],
    }).compile();

    netronService = moduleRef.get(NetronService);
    (netronService as any).netron = netronInstanceMock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(netronService).toBeDefined();
  });

  it('should start Netron on application bootstrap', async () => {
    discoveryServiceMock.getProviders.mockReturnValue([]);

    await netronService.onApplicationBootstrap();

    expect(netronInstanceMock.start).toHaveBeenCalled();
  });

  it('should stop Netron on application shutdown', async () => {
    await netronService.onApplicationShutdown('SIGINT');
    expect(netronInstanceMock.stop).toHaveBeenCalled();
  });

  it('should log when Netron starts as server', async () => {
    discoveryServiceMock.getProviders.mockReturnValue([]);

    const loggerSpy = jest.spyOn((netronService as any).logger, 'log');
    await netronService.onApplicationBootstrap();

    expect(loggerSpy).toHaveBeenCalledWith('Netron server started at localhost:3000');
  });

  describe('registerDiscoveredServices', () => {
    class TestService {}

    beforeEach(() => {
      discoveryServiceMock.getProviders.mockReturnValue([
        {
          instance: new TestService(),
          metatype: TestService,
          isDependencyTreeStatic: () => true,
          name: 'TestService',
        } as any,
      ]);

      reflectorMock.get.mockReturnValue('test.service@1.0.0');
    });

    it('should expose discovered services', () => {
      (netronService as any).registerDiscoveredServices();

      expect(netronInstanceMock.peer.exposeService).toHaveBeenCalledWith(expect.any(TestService));
    });

    it('should handle errors during service exposure gracefully', () => {
      (netronInstanceMock.peer.exposeService as jest.Mock).mockImplementation(() => {
        throw new Error('Exposure failed');
      });

      const loggerErrorSpy = jest.spyOn((netronService as any).logger, 'error');

      (netronService as any).registerDiscoveredServices();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error exposing service "test.service@1.0.0": Exposure failed')
      );
    });

    it('should warn if provider dependency tree is not static', () => {
      const loggerWarnSpy = jest.spyOn((netronService as any).logger, 'warn');

      discoveryServiceMock.getProviders.mockReturnValue([
        {
          instance: new TestService(),
          metatype: TestService,
          isDependencyTreeStatic: () => false,
          name: 'TestService',
        } as any,
      ]);

      (netronService as any).registerDiscoveredServices();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Service "TestService" cannot be exposed because it is defined in a non-static provider.'
      );
      expect(netronInstanceMock.peer.exposeService).not.toHaveBeenCalled();
    });
  });
});
