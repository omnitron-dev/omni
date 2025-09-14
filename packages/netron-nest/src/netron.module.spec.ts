import { Test, TestingModule } from '@nestjs/testing';
import { Netron, NetronOptions } from '@omnitron-dev/netron';

import { NetronModule } from './netron.module';
import { NetronService } from './netron.service';
import { NETRON_OPTIONS, NETRON_INSTANCE } from './constants';

describe('NetronModule', () => {
  const options: NetronOptions = {
    listenHost: 'localhost',
    listenPort: 4000,
    discoveryEnabled: true,
    discoveryRedisUrl: 'redis://localhost:6379/2',
  };

  describe('forRoot', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [NetronModule.forRoot(options)],
      }).compile();
    });

    afterAll(async () => {
      await moduleRef.close();
    });

    it('should provide NetronService', () => {
      const service = moduleRef.get(NetronService);
      expect(service).toBeInstanceOf(NetronService);
    });

    it('should provide NETRON_OPTIONS', () => {
      const providedOptions = moduleRef.get<NetronOptions>(NETRON_OPTIONS);
      expect(providedOptions).toEqual(options);
    });

    it('should provide NETRON_INSTANCE as singleton', () => {
      const netronInstance1 = moduleRef.get<Netron>(NETRON_INSTANCE);
      const netronInstance2 = moduleRef.get<Netron>(NETRON_INSTANCE);
      expect(netronInstance1).toBeDefined();
      expect(netronInstance1).toBe(netronInstance2);
    });
  });

  describe('forRootAsync', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [
          NetronModule.forRootAsync({
            useFactory: async () => options,
          }),
        ],
      }).compile();
    });

    afterAll(async () => {
      await moduleRef.close();
    });

    it('should asynchronously provide NETRON_OPTIONS', () => {
      const providedOptions = moduleRef.get<NetronOptions>(NETRON_OPTIONS);
      expect(providedOptions).toEqual(options);
    });

    it('should asynchronously provide NetronService', () => {
      const service = moduleRef.get(NetronService);
      expect(service).toBeInstanceOf(NetronService);
    });

    it('should asynchronously provide NETRON_INSTANCE as singleton', () => {
      const netronInstance1 = moduleRef.get<Netron>(NETRON_INSTANCE);
      const netronInstance2 = moduleRef.get<Netron>(NETRON_INSTANCE);
      expect(netronInstance1).toBeDefined();
      expect(netronInstance1).toBe(netronInstance2);
    });
  });

  describe('Lifecycle integration', () => {
    let moduleRef: TestingModule;
    let netronService: NetronService;
    let netronInstance: Netron;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [NetronModule.forRoot(options)],
      }).compile();

      netronService = moduleRef.get(NetronService);
      netronInstance = moduleRef.get<Netron>(NETRON_INSTANCE);
    });

    afterAll(async () => {
      await moduleRef.close();
    });

    it('should start Netron on application bootstrap', async () => {
      const startSpy = jest.spyOn(netronInstance, 'start').mockResolvedValue(undefined);

      await netronService.onApplicationBootstrap();

      expect(startSpy).toHaveBeenCalled();
    });

    it('should stop Netron on application shutdown', async () => {
      const stopSpy = jest.spyOn(netronInstance, 'stop').mockResolvedValue(undefined);

      await netronService.onApplicationShutdown('SIGINT');

      expect(stopSpy).toHaveBeenCalledWith();
    });
  });
});
