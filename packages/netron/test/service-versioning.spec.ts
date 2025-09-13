import { delay } from '@devgrid/common';

import { Public, Netron, Service, RemotePeer } from '../dist';

describe('RemotePeer Service Versioning', () => {
  let localNetron: Netron;
  let remoteNetron: Netron;
  let remotePeer: RemotePeer;

  interface IVersionedServiceV1 {
    greet(): Promise<string>;
  }

  interface IVersionedServiceV2 {
    greet(): Promise<string>;
  }

  @Service('versionedService@1.0.0')
  class VersionedServiceV1 implements IVersionedServiceV1 {
    @Public()
    async greet() {
      return 'Hello from V1';
    }
  }

  @Service('versionedService@2.0.0')
  class VersionedServiceV2 implements IVersionedServiceV2 {
    @Public()
    async greet() {
      return 'Hello from V2';
    }
  }
  beforeAll(async () => {
    localNetron = await Netron.create({
      id: 'local',
      listenHost: 'localhost',
      listenPort: 9090,
      allowServiceEvents: true,
    });

    remoteNetron = await Netron.create({ id: 'remote' });
    await localNetron.peer.exposeService(new VersionedServiceV1());
    await localNetron.peer.exposeService(new VersionedServiceV2());

    remotePeer = await remoteNetron.connect('ws://localhost:9090');
  });

  afterAll(async () => {
    remotePeer.disconnect();
    await localNetron.stop();
    await remoteNetron.stop();
  });

  it('should expose multiple versions of the same service', async () => {
    const availableServices = remotePeer.getServiceNames();

    expect(availableServices).toContain('versionedService@1.0.0');
    expect(availableServices).toContain('versionedService@2.0.0');
  });

  it('should query specific version of a service (v1.0.0)', async () => {
    const serviceV1 = await remotePeer.queryInterface<IVersionedServiceV1>('versionedService@1.0.0');

    expect(await serviceV1.greet()).toBe('Hello from V1');

    await remotePeer.releaseInterface(serviceV1);
  });

  it('should query specific version of a service (v2.0.0)', async () => {
    const serviceV2 = await remotePeer.queryInterface<IVersionedServiceV2>('versionedService@2.0.0');

    expect(await serviceV2.greet()).toBe('Hello from V2');

    await remotePeer.releaseInterface(serviceV2);
  });

  it('should throw when querying non-existent version', async () => {
    await expect(async () => remotePeer.queryInterface('versionedService@3.0.0')).rejects.toThrow(/Unknown service/);
  });

  it('should handle exposing a service version conflict', async () => {
    @Service('versionedService@1.0.0')
    class DuplicateVersionService {
      @Public()
      async greet() {
        return 'This should not be exposed';
      }
    }

    await expect(async () => localNetron.peer.exposeService(new DuplicateVersionService())).rejects.toThrow(
      /Service already exposed/
    );
  });

  it('should correctly handle unexposing a specific service version', async () => {
    await localNetron.peer.unexposeService('versionedService@1.0.0');

    await delay(100);

    const services = remotePeer.getServiceNames();
    expect(services).not.toContain('versionedService@1.0.0');
    expect(services).toContain('versionedService@2.0.0');

    await expect(async () => remotePeer.queryInterface('versionedService@1.0.0')).rejects.toThrow(/Unknown service/);
  });

  it('should re-expose a previously unexposed service version', async () => {
    await localNetron.peer.exposeService(new VersionedServiceV1());

    await delay(100);

    const services = remotePeer.getServiceNames();
    expect(services).toContain('versionedService@1.0.0');

    const serviceV1 = await remotePeer.queryInterface<IVersionedServiceV1>('versionedService@1.0.0');
    expect(await serviceV1.greet()).toBe('Hello from V1');

    await remotePeer.releaseInterface(serviceV1);
  });

  it('should query the latest service version by default if no version specified', async () => {
    const latestService = await remotePeer.queryInterface<IVersionedServiceV2>('versionedService');

    expect(await latestService.greet()).toBe('Hello from V2');

    await remotePeer.releaseInterface(latestService);
  });

  it('should correctly handle interface releases for different versions', async () => {
    const ifaceV1 = await remotePeer.queryInterface<IVersionedServiceV1>('versionedService@1.0.0');
    const ifaceV2 = await remotePeer.queryInterface<IVersionedServiceV2>('versionedService@2.0.0');

    expect(await ifaceV1.greet()).toBe('Hello from V1');
    expect(await ifaceV2.greet()).toBe('Hello from V2');

    await remotePeer.releaseInterface(ifaceV1);
    await remotePeer.releaseInterface(ifaceV2);

    expect(async () => await ifaceV1.greet()).rejects.toThrow(/Invalid interface/);
    expect(async () => await ifaceV2.greet()).rejects.toThrow(/Invalid interface/);
  });
});
