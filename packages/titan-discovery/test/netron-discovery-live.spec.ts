/**
 * The integration against a real Netron and a real Redis.
 *
 * `netron-discovery-integration.spec.ts` drives NetronDiscoveryIntegration with
 * a mock Netron — an EventEmitter with a `services` map — which pins the wiring
 * but cannot tell whether a real Netron emits what the integration listens for.
 * Nothing covered that until now: titan used to own service discovery and had
 * six `test/integration/integration-sd-*.spec.ts` files driving
 * `Netron.create({ discoveryEnabled: true })` end to end, but discovery moved
 * into this package, `Netron.discovery` was commented out and the options were
 * removed, so those specs referenced an API that no longer exists. They were
 * excluded from titan's vitest run rather than ported, which left the real path
 * — a live Netron exposing a service, the integration reacting, discovery
 * writing to Redis — with no coverage at all.
 *
 * These tests restore that, expressed against the API the code actually has.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';

import { Netron, Service, Public } from '@omnitron-dev/titan/netron';

import { NetronDiscoveryIntegration } from '../src/netron-integration.js';
import { DiscoveryService } from '../src/discovery.service.js';
import {
  createTestRedisClient,
  cleanupRedis,
  createMockLogger,
  isRedisInMockMode,
  waitFor,
} from './test-utils.js';

const describeOrSkip = isRedisInMockMode() ? describe.skip : describe;

@Service('calculator@1.0.0')
class Calculator {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }
}

describeOrSkip('NetronDiscoveryIntegration against a live Netron', () => {
  let redis: Redis;
  let netron: Netron;
  let discovery: DiscoveryService;
  let integration: NetronDiscoveryIntegration;

  const logger = createMockLogger();

  beforeAll(async () => {
    redis = createTestRedisClient(11);
  });

  afterAll(async () => {
    await redis?.quit().catch(() => {});
  });

  beforeEach(async () => {
    await cleanupRedis(redis);

    netron = await Netron.create(logger as never, { listenHost: '127.0.0.1', listenPort: 0 } as never);

    discovery = new DiscoveryService(
      redis as never,
      logger as never,
      { heartbeatInterval: 500, heartbeatTTL: 5_000 } as never
    );
    await discovery.onInit();
    await discovery.onStart();

    integration = new NetronDiscoveryIntegration(netron, discovery as never, logger as never, null);
    await integration.onModuleInit();
  });

  async function teardown() {
    await integration?.onModuleDestroy?.().catch(() => {});
    await discovery?.onStop().catch(() => {});
    await netron?.stop().catch(() => {});
  }

  it('registers a service that a real Netron exposes', async () => {
    try {
      await netron.peer.exposeService(new Calculator());

      // The event is emitted by LocalPeer.exposeService; if the integration
      // listens for a name Netron does not emit, this never arrives.
      await waitFor(async () => {
        const nodes = await discovery.getActiveNodes();
        return nodes.some((node) => node.services?.some((service) => service.name === 'calculator'));
      }, 5_000);

      const nodes = await discovery.getActiveNodes();
      const services = nodes.flatMap((node) => node.services ?? []);
      expect(services.map((service) => service.name)).toContain('calculator');
    } finally {
      await teardown();
    }
  }, 30_000);

  it('unregisters the service when it is unexposed', async () => {
    try {
      await netron.peer.exposeService(new Calculator());
      await waitFor(async () => {
        const nodes = await discovery.getActiveNodes();
        return nodes.some((node) => node.services?.some((service) => service.name === 'calculator'));
      }, 5_000);

      await netron.peer.unexposeService('calculator@1.0.0');

      await waitFor(async () => {
        const nodes = await discovery.getActiveNodes();
        return !nodes.some((node) => node.services?.some((service) => service.name === 'calculator'));
      }, 5_000);

      const nodes = await discovery.getActiveNodes();
      expect(nodes.flatMap((node) => node.services ?? []).map((s) => s.name)).not.toContain('calculator');
    } finally {
      await teardown();
    }
  }, 30_000);

  it('leaves no node behind after a graceful stop', async () => {
    // What integration-sd-graceful-shutdown.spec.ts checked, against the API
    // that exists now: stopping must remove the node from the index and drop
    // its heartbeat rather than leaving a tombstone until the TTL expires.
    try {
      await netron.peer.exposeService(new Calculator());
      await waitFor(async () => (await discovery.getActiveNodes()).length > 0, 5_000);
    } finally {
      await teardown();
    }

    expect(await discovery.getActiveNodes()).toHaveLength(0);
  }, 30_000);
});
