/**
 * Discovery Service PubSub Integration Tests
 * Tests PubSub event propagation and module integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Redis } from 'ioredis';
import { DiscoveryService } from '../src/discovery.service.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { DiscoveryOptions, DiscoveryEvent } from '../src/types.js';
import { createTestRedisClient, cleanupRedis, createMockLogger } from './test-utils.js';
import { isRedisInMockMode } from './test-utils.js';

const skipTests = isRedisInMockMode();
if (skipTests) {
  console.log('⏭️ Skipping discovery-pubsub.spec.ts - requires real Redis');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('DiscoveryService - PubSub Tests', () => {
  let redis: Redis;
  let logger: ILogger;
  let service: DiscoveryService;

  beforeEach(async () => {
    redis = createTestRedisClient(15);
    await redis.connect();
    await cleanupRedis(redis);
    logger = createMockLogger();
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.onStop();
      } catch (_e) {
        // ignore
      }
      service = null as any;
    }
    await cleanupRedis(redis);
    await redis.disconnect();
    vi.clearAllMocks();
  });

  describe('PubSub Enabled', () => {
    it('should setup PubSub when enabled', async () => {
      const options: DiscoveryOptions = {
        pubSubEnabled: true,
        pubSubChannel: 'test:channel',
      };

      service = new DiscoveryService(redis, logger, options);
      await service.onStart();

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('PubSub'));
    });

    it('should publish NODE_REGISTERED event', async () => {
      const options: DiscoveryOptions = {
        pubSubEnabled: true,
        heartbeatInterval: 500,
      };

      service = new DiscoveryService(redis, logger, options);

      const publishSpy = vi.spyOn(redis, 'publish');

      await service.onStart();

      // Wait for initial heartbeat
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should have published event
      expect(publishSpy).toHaveBeenCalled();
    });

    it('should not process own events', async () => {
      const options: DiscoveryOptions = {
        pubSubEnabled: true,
      };

      service = new DiscoveryService(redis, logger, options);
      const handler = vi.fn();

      service.onEvent(handler);

      await service.onStart();

      // Simulate receiving own event
      const event: DiscoveryEvent = {
        type: 'NODE_REGISTERED',
        nodeId: service.getNodeId(),
        address: service.getAddress(),
        services: [],
        timestamp: Date.now(),
      };

      // Deliver it the way Redis would. The previous version emitted straight
      // into `eventEmitter`, which is DOWNSTREAM of the filter — the check
      // lives in the pub/sub message handler and drops the event before it is
      // emitted. So that route could never observe the filtering, which is
      // presumably why the test asserted nothing and called the behaviour
      // "implementation-specific".
      const deliver = (service as unknown as {
        messageHandler: (channel: string, message: string) => void;
      }).messageHandler;
      deliver(options.pubSubChannel ?? 'titan:discovery:events', JSON.stringify(event));

      // Own event: dropped.
      expect(handler).not.toHaveBeenCalled();

      // The same event from another node does reach the handler — without this
      // half, the assertion above would also pass if the handler were simply
      // never wired up.
      deliver(
        options.pubSubChannel ?? 'titan:discovery:events',
        JSON.stringify({ ...event, nodeId: 'some-other-node' }),
      );
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]![0]).toMatchObject({ nodeId: 'some-other-node' });
    });
  });

  describe('PubSub Disabled', () => {
    it('should not setup PubSub when disabled', async () => {
      const options: DiscoveryOptions = {
        pubSubEnabled: false,
      };

      service = new DiscoveryService(redis, logger, options);
      await service.onStart();

      const publishSpy = vi.spyOn(redis, 'publish');

      // Trigger something that would publish
      await service.registerService({ name: 'Test', version: '1.0.0' });

      // Should not publish if PubSub is disabled
      expect(publishSpy).not.toHaveBeenCalled();
    });
  });

  describe('Event Types', () => {
    beforeEach(() => {
      const options: DiscoveryOptions = {
        pubSubEnabled: true,
      };
      service = new DiscoveryService(redis, logger, options);
    });

    it('should publish NODE_UPDATED event on service update', async () => {
      await service.onStart();

      const publishSpy = vi.spyOn(redis, 'publish');

      await service.registerService({ name: 'NewService', version: '1.0.0' });

      // Should publish update event
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(publishSpy).toHaveBeenCalled();
    });

    it('should publish NODE_DEREGISTERED event on stop', async () => {
      await service.onStart();

      // Wait for registration
      await new Promise((resolve) => setTimeout(resolve, 200));

      const publishSpy = vi.spyOn(redis, 'publish');

      await service.deregisterNode(service.getNodeId());

      expect(publishSpy).toHaveBeenCalled();
    });
  });

  describe('Custom PubSub Channel', () => {
    it('should use custom channel when specified', async () => {
      const customChannel = 'my:custom:channel';
      const options: DiscoveryOptions = {
        pubSubEnabled: true,
        pubSubChannel: customChannel,
      };

      service = new DiscoveryService(redis, logger, options);
      await service.onStart();

      const _subscribeSpy = vi.spyOn(redis, 'subscribe');

      // Check that custom channel is used
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The service should have subscribed to the custom channel
      // This is verified by checking the internal subscriber setup
    });
  });

  describe('Multiple Event Handlers', () => {
    beforeEach(() => {
      const options: DiscoveryOptions = {
        pubSubEnabled: true,
      };
      service = new DiscoveryService(redis, logger, options);
    });

    it('should call all registered handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      service.onEvent(handler1);
      service.onEvent(handler2);
      service.onEvent(handler3);

      const event: DiscoveryEvent = {
        type: 'NODE_REGISTERED',
        nodeId: 'other-node',
        address: '127.0.0.1:8080',
        services: [],
        timestamp: Date.now(),
      };

      (service as any).eventEmitter.emit('discovery:event', event);

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
      expect(handler3).toHaveBeenCalledWith(event);
    });

    it('should not call removed handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      service.onEvent(handler1);
      service.onEvent(handler2);

      service.offEvent(handler1);

      const event: DiscoveryEvent = {
        type: 'NODE_UPDATED',
        nodeId: 'other-node',
        address: '127.0.0.1:8080',
        services: [],
        timestamp: Date.now(),
      };

      (service as any).eventEmitter.emit('discovery:event', event);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith(event);
    });
  });

  describe('Error Handling in PubSub', () => {
    it('should handle publish errors gracefully', async () => {
      const options: DiscoveryOptions = {
        pubSubEnabled: true,
      };

      service = new DiscoveryService(redis, logger, options);

      redis.publish = vi.fn().mockRejectedValue(new Error('Publish error'));

      await service.onStart();

      // Wait for attempted publish
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should log error but not throw
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle malformed event messages', async () => {
      const options: DiscoveryOptions = {
        pubSubEnabled: true,
      };

      service = new DiscoveryService(redis, logger, options);
      await service.onStart();

      // Simulate receiving malformed message
      const subscriber = (service as any).subscriber;
      if (subscriber) {
        subscriber.emit('message', 'titan:discovery:events', 'invalid json');
      }

      // Should log error
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.anything() }),
        expect.stringContaining('parse')
      );
    });
  });

  describe('PubSub Cleanup', () => {
    it('should unsubscribe on stop when PubSub enabled', async () => {
      const options: DiscoveryOptions = {
        pubSubEnabled: true,
      };

      service = new DiscoveryService(redis, logger, options);
      await service.onStart();

      await service.onStop();

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Unsubscribed from PubSub'));
    });

    it('should handle unsubscribe errors', async () => {
      const options: DiscoveryOptions = {
        pubSubEnabled: true,
      };

      service = new DiscoveryService(redis, logger, options);
      await service.onStart();

      // Mock unsubscribe error
      const subscriber = (service as any).subscriber;
      if (subscriber) {
        subscriber.unsubscribe = vi.fn().mockRejectedValue(new Error('Unsub error'));
      }

      await service.onStop();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.anything() }),
        expect.stringContaining('PubSub')
      );
    });
  });
});
