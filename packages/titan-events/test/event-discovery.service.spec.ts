/**
 * Tests for EventDiscoveryService
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import 'reflect-metadata';
import { Application } from '@omnitron-dev/titan/application';
import { EventsModule, EVENTS_SERVICE_TOKEN, EVENT_DISCOVERY_SERVICE_TOKEN } from '../src/events.module.js';
import { Container } from '@omnitron-dev/titan/nexus';
import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { BatchEvents, OnEvent } from '../src/events.decorators.js';
import { EventMetadataService } from '../src/event-metadata.service.js';
import { EventsService } from '../src/events.service.js';
import { EventDiscoveryService } from '../src/event-discovery.service';

describe('EventDiscoveryService', () => {
  let discoveryService: EventDiscoveryService;
  let mockEmitter: any;
  let mockContainer: any;

  beforeEach(() => {
    mockEmitter = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
      listeners: vi.fn().mockReturnValue([]),
      eventNames: vi.fn().mockReturnValue([]),
    };

    mockContainer = {
      resolve: vi.fn(),
      register: vi.fn(),
      registerType: vi.fn(),
      has: vi.fn().mockReturnValue(false),
      get: vi.fn(),
    };

    discoveryService = new EventDiscoveryService(mockContainer, mockEmitter);
  });

  it('should discover event handlers', () => {
    class TestHandler {
      @Reflect.metadata('event:handler', { event: 'test.event' })
      handleTest() {}
    }

    const handlers = discoveryService.discoverHandlers(TestHandler);
    expect(handlers).toHaveLength(1);
    expect(handlers[0].event).toBe('test.event');
  });

  it('should discover multiple handlers in a class', () => {
    class MultiHandler {
      @Reflect.metadata('event:handler', { event: 'event1' })
      handle1() {}

      @Reflect.metadata('event:handler', { event: 'event2' })
      handle2() {}

      @Reflect.metadata('event:handler', { event: 'event3' })
      handle3() {}
    }

    const handlers = discoveryService.discoverHandlers(MultiHandler);
    expect(handlers).toHaveLength(3);
  });

  it('discovers independent batch handlers and cancels queued deliveries on removal', async () => {
    vi.useFakeTimers();
    const container = new Container();
    const emitter = new EnhancedEventEmitter();
    const metadata = new EventMetadataService();
    const discovery = new EventDiscoveryService(container, emitter, metadata);
    const events = new EventsService(emitter, metadata);
    const individual: number[] = [];
    const pairs: number[][] = [];
    const triples: number[][] = [];
    class Consumer {
      @OnEvent({ event: 'sample', errorBoundary: true })
      consume(value: number) { individual.push(value); }

      @BatchEvents({ event: 'sample', maxSize: 2, maxWait: 100 })
      pair(values: number[]) { pairs.push(values); }

      @BatchEvents({ event: 'sample', maxSize: 3, maxWait: 200 })
      triple(values: number[]) { triples.push(values); }
    }
    try {
      container.register(Consumer, { useClass: Consumer, scope: 'singleton' });
      const consumer = container.resolve(Consumer);
      await discovery.onInit();
      await discovery.discoverAllHandlers();
      expect((await discovery.health()).details.totalRegistered).toBe(3);
      events.emit('sample', 1);
      events.emit('sample', 2);
      events.emit('sample', 3);
      expect(individual).toEqual([1, 2, 3]);
      expect(pairs).toEqual([[1, 2]]);
      expect(triples).toEqual([[1, 2, 3]]);
      vi.advanceTimersByTime(100);
      expect(pairs).toEqual([[1, 2], [3]]);
      events.emit('sample', 4);
      discovery.unregisterHandlers(consumer);
      events.emit('sample', 5);
      vi.advanceTimersByTime(200);
      expect(individual).toEqual([1, 2, 3, 4]);
      expect(pairs).toEqual([[1, 2], [3]]);
      expect(triples).toEqual([[1, 2, 3]]);
      expect(emitter.listenerCount('sample')).toBe(0);
    } finally {
      await discovery.onDestroy();
      emitter.dispose();
      await container.dispose();
      vi.useRealTimers();
    }
  });

  it('activates decorated consumers through the application startup path', async () => {
    const delivered: number[][] = [];
    class Consumer {
      @BatchEvents({ event: 'telemetry', maxSize: 2, maxWait: 1000 })
      handle(values: number[]) { delivered.push(values); }
    }
    const app = await Application.create({
      imports: [EventsModule.forRoot({})],
      providers: [[Consumer, { useClass: Consumer, scope: 'singleton' }]],
      skipCoreModules: true,
      disableGracefulShutdown: true,
    });
    try {
      app.container.resolve(Consumer);
      await app.start();
      const activeDiscovery = app.resolve(EVENT_DISCOVERY_SERVICE_TOKEN);
      expect(activeDiscovery.getHandlersForEvent('telemetry')).toHaveLength(1);
      const events = app.resolve(EVENTS_SERVICE_TOKEN);
      events.emit('telemetry', 1);
      events.emit('telemetry', 2);
      expect(delivered).toEqual([[1, 2]]);
    } finally {
      await app.stop({ force: true });
    }
  });

  it('should discover event emitters', () => {
    class TestEmitter {
      @Reflect.metadata('event:emitter', { events: ['test.emit'] })
      emitTest() {}
    }

    const emitters = discoveryService.discoverEmitters(TestEmitter);
    expect(emitters).toHaveLength(1);
    expect(emitters[0].events).toContain('test.emit');
  });

  it('should scan module for event providers', async () => {
    const module = {
      providers: [class Handler1 {}, class Handler2 {}],
    };

    const result = await discoveryService.scanModule(module);
    // The result is an object with handlers, emitters, etc.
    // Since we're passing plain classes without decorators, they won't be discovered
    expect(result.handlers).toHaveLength(0);
    expect(result.emitters).toHaveLength(0);
  });
});
