/**
 * Tests for EventDiscoveryService
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import 'reflect-metadata';
import { EventDiscoveryService } from '../../../src/modules/events/event-discovery.service';

describe('EventDiscoveryService', () => {
  let discoveryService: EventDiscoveryService;
  let mockEmitter: any;
  let mockContainer: any;

  beforeEach(() => {
    mockEmitter = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn(),
      listeners: jest.fn().mockReturnValue([]),
      eventNames: jest.fn().mockReturnValue([]),
    };

    mockContainer = {
      resolve: jest.fn(),
      register: jest.fn(),
      registerType: jest.fn(),
      has: jest.fn().mockReturnValue(false),
      get: jest.fn(),
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
