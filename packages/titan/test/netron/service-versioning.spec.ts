import { delay } from '@omnitron-dev/common';

import { Public, Netron, Service, RemotePeer } from '../../src/netron';
import { createMockLogger, createNetronClient } from './test-utils.js';

describe('RemotePeer Service Versioning', () => {
  let localNetron: Netron;
  let remoteNetron: Netron;
  let remotePeer: RemotePeer;

  interface IVersionedServiceV1 {
    greet(): Promise<string>;
  }

  interface IVersionedServiceV2 {
    greet(): Promise<string>;
    farewell(): Promise<string>;
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

    @Public()
    async farewell() {
      return 'Goodbye from V2';
    }
  }
  beforeAll(async () => {
    const { Netron } = await import('../../src/netron/netron.js');
    const { WebSocketTransport } = await import('../../src/netron/transport/websocket-transport.js');

    const localLogger = createMockLogger();
    localNetron = new Netron(localLogger, { allowServiceEvents: true });
    localNetron.registerTransport('ws', () => new WebSocketTransport());
    localNetron.registerTransportServer('ws', {
      name: 'ws',
      options: { host: 'localhost', port: 9090 }
    });

    await localNetron.peer.exposeService(new VersionedServiceV1());
    await localNetron.peer.exposeService(new VersionedServiceV2());
    await localNetron.start();

    await new Promise((resolve) => setTimeout(resolve, 100));

    remoteNetron = await createNetronClient({ logger: createMockLogger() });
    remotePeer = await remoteNetron.connect('ws://localhost:9090');
  });

  afterAll(async () => {
    remotePeer.disconnect();
    await localNetron.stop();
    await remoteNetron.stop();
  });

  it('should expose multiple versions of the same service', async () => {
    // In modern auth-aware architecture, services are discovered on-demand
    // Query both versions to ensure they're available
    const serviceV1 = await remotePeer.queryInterface<IVersionedServiceV1>('versionedService@1.0.0');
    const serviceV2 = await remotePeer.queryInterface<IVersionedServiceV2>('versionedService@2.0.0');

    // Verify both services work
    expect(await serviceV1.greet()).toBe('Hello from V1');
    expect(await serviceV2.greet()).toBe('Hello from V2');
    expect(await serviceV2.farewell()).toBe('Goodbye from V2');

    // After querying, services should be in the local cache
    const availableServices = remotePeer.getServiceNames();
    expect(availableServices).toContain('versionedService@1.0.0');
    expect(availableServices).toContain('versionedService@2.0.0');

    await remotePeer.releaseInterface(serviceV1);
    await remotePeer.releaseInterface(serviceV2);
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
    await expect(async () => remotePeer.queryInterface('versionedService@3.0.0')).rejects.toThrow(/not found/);
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

    await delay(300);

    // Invalidate cache to reflect the unexpose
    remotePeer.invalidateDefinitionCache('versionedService@1.0.0');

    // In modern architecture, unexposed services should not be queryable
    await expect(async () => remotePeer.queryInterface('versionedService@1.0.0')).rejects.toThrow(/not found/);

    // But v2.0.0 should still be available
    const serviceV2 = await remotePeer.queryInterface<IVersionedServiceV2>('versionedService@2.0.0');
    expect(await serviceV2.greet()).toBe('Hello from V2');
    await remotePeer.releaseInterface(serviceV2);
  });

  it('should re-expose a previously unexposed service version', async () => {
    // First query to ensure we have an interface (if it exists)
    let existingInterface;
    try {
      existingInterface = await remotePeer.queryInterface<IVersionedServiceV1>('versionedService@1.0.0');
    } catch {
      // Service might not be exposed
    }

    // Unexpose the service
    try {
      await localNetron.peer.unexposeService('versionedService@1.0.0');
      await delay(100);

      // Release the interface if we had one
      if (existingInterface) {
        await remotePeer.releaseInterface(existingInterface);
      }

      // Invalidate cache after unexposing and releasing
      remotePeer.invalidateDefinitionCache('versionedService@1.0.0');
    } catch {
      // Service might not be exposed, that's ok
    }

    // Now re-expose with a fresh service instance
    await localNetron.peer.exposeService(new VersionedServiceV1());

    await delay(100);

    // After re-exposing, service should be queryable again with new definition
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

    await expect(async () => await ifaceV1.greet()).rejects.toThrow(/Invalid interface/);
    await expect(async () => await ifaceV2.greet()).rejects.toThrow(/Invalid interface/);
  });
});
