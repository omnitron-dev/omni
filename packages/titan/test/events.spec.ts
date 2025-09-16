/**
 * Comprehensive tests for Titan event system
 */

import 'reflect-metadata';
import { EventsService } from '../src/modules/events/events.service';
import { EventBusService } from '../src/modules/events/event-bus.service';
import { EventDiscoveryService } from '../src/modules/events/event-discovery.service';
import { EventHistoryService } from '../src/modules/events/event-history.service';
import { EventMetadataService } from '../src/modules/events/event-metadata.service';
import { EventSchedulerService } from '../src/modules/events/event-scheduler.service';
import { EventValidationService } from '../src/modules/events/event-validation.service';
import {
  EventsModule,
  EVENTS_SERVICE_TOKEN,
  EVENT_BUS_SERVICE_TOKEN
} from '../src/modules/events/events.module';
import { Application } from '../src/application';

describe('Titan Event System', () => {
  let eventsService: EventsService;
  let eventBus: EventBusService;
  let discoveryService: EventDiscoveryService;
  let historyService: EventHistoryService;
  let metadataService: EventMetadataService;
  let schedulerService: EventSchedulerService;
  let validationService: EventValidationService;
  let mockEmitter: any;
  let mockContainer: any;

  afterEach(async () => {
    // Clean up all services
    if (eventsService) {
      await eventsService.onDestroy?.();
    }
    if (eventBus) {
      await eventBus.onDestroy?.();
    }
    if (discoveryService) {
      await discoveryService.onDestroy?.();
    }
    if (historyService) {
      await historyService.onDestroy?.();
    }
    if (schedulerService) {
      await schedulerService.onDestroy?.();
    }
    // Clean up mock emitter
    if (mockEmitter) {
      mockEmitter.dispose?.();
    }
    // Clear all mocks
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  beforeEach(() => {
    // Create a more realistic mock emitter that actually connects handlers and emit
    const handlers = new Map<string, Function[]>();

    mockEmitter = {
      subscribe: jest.fn().mockImplementation((event: string, handler: Function) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(handler);
        return () => {
          const eventHandlers = handlers.get(event);
          if (eventHandlers) {
            const index = eventHandlers.indexOf(handler);
            if (index !== -1) eventHandlers.splice(index, 1);
          }
        };
      }),

      on: jest.fn().mockImplementation((event: string, handler: Function) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(handler);
      }),

      once: jest.fn().mockImplementation((event: string, handler: Function) => {
        const onceWrapper = (...args: any[]) => {
          handler(...args);
          const eventHandlers = handlers.get(event);
          if (eventHandlers) {
            const index = eventHandlers.indexOf(onceWrapper);
            if (index !== -1) eventHandlers.splice(index, 1);
          }
        };
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(onceWrapper);
      }),

      emit: jest.fn().mockImplementation((event: string, ...args: any[]) => {
        const eventHandlers = handlers.get(event) || [];
        eventHandlers.forEach(handler => handler(...args));
        return eventHandlers.length > 0;
      }),

      emitEnhanced: jest.fn().mockImplementation((event: string, data: any, options?: any) => {
        const eventHandlers = handlers.get(event) || [];
        eventHandlers.forEach(handler => handler(data, options?.metadata));
        return eventHandlers.length > 0;
      }),

      emitParallel: jest.fn().mockImplementation(async (event: string, ...args: any[]) => {
        const eventHandlers = handlers.get(event) || [];
        const results = await Promise.all(
          eventHandlers.map(handler => Promise.resolve(handler(...args)))
        );
        return results;
      }),

      emitSerial: jest.fn().mockImplementation(async (event: string, ...args: any[]) => {
        const eventHandlers = handlers.get(event) || [];
        const results = [];
        for (const handler of eventHandlers) {
          results.push(await Promise.resolve(handler(...args)));
        }
        return results;
      }),

      off: jest.fn().mockImplementation((event: string, handler?: Function) => {
        if (handler) {
          const eventHandlers = handlers.get(event);
          if (eventHandlers) {
            const index = eventHandlers.indexOf(handler);
            if (index !== -1) eventHandlers.splice(index, 1);
          }
        } else {
          handlers.delete(event);
        }
      }),

      listeners: jest.fn().mockImplementation((event: string) => {
        return handlers.get(event) || [];
      }),

      listenerCount: jest.fn().mockImplementation((event: string) => {
        return (handlers.get(event) || []).length;
      }),

      eventNames: jest.fn().mockImplementation(() => {
        return Array.from(handlers.keys());
      }),

      removeAllListeners: jest.fn().mockImplementation((event?: string) => {
        if (event) {
          handlers.delete(event);
        } else {
          handlers.clear();
        }
      }),

      emitParallel: jest.fn().mockImplementation(async (event: string, ...args: any[]) => {
        const eventHandlers = handlers.get(event) || [];
        const promises = eventHandlers.map(handler => Promise.resolve(handler(...args)));
        return Promise.all(promises);
      }),
      emitSequential: jest.fn().mockImplementation(async (event: string, ...args: any[]) => {
        const eventHandlers = handlers.get(event) || [];
        const results = [];
        for (const handler of eventHandlers) {
          results.push(await handler(...args));
        }
        return results;
      }),
      emitSerial: jest.fn().mockImplementation(async (event: string, ...args: any[]) => {
        const eventHandlers = handlers.get(event) || [];
        const results = [];
        for (const handler of eventHandlers) {
          results.push(await handler(...args));
        }
        return results;
      }),
      emitReduce: jest.fn().mockResolvedValue(null),
      onEnhanced: jest.fn(),
      dispose: jest.fn(),
      getHistory: jest.fn().mockResolvedValue([]),
      clearHistory: jest.fn().mockResolvedValue(undefined),
      exportHistory: jest.fn().mockResolvedValue([]),
      importHistory: jest.fn().mockResolvedValue(undefined),
      enableHistory: jest.fn(),
      schedule: jest.fn().mockReturnValue('job1'),
      cancelSchedule: jest.fn().mockReturnValue(true),
      batch: jest.fn(),
      throttle: jest.fn(),
      debounce: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({}),
      exportMetrics: jest.fn().mockReturnValue('{}'),

      // Add dispose method to clean up
      dispose: jest.fn().mockImplementation(() => {
        handlers.clear();
      })
    };

    // Create mock container
    mockContainer = {
      getAllInstances: jest.fn().mockReturnValue([])
    };

    // Create services with mock dependencies
    eventBus = new EventBusService(mockEmitter);
    metadataService = new EventMetadataService();
    discoveryService = new EventDiscoveryService(mockContainer, mockEmitter, metadataService);
    historyService = new EventHistoryService(mockEmitter);
    schedulerService = new EventSchedulerService(mockEmitter);
    validationService = new EventValidationService();

    eventsService = new EventsService(mockEmitter, metadataService);
  });

  describe('EventsService', () => {
    it('should initialize properly', () => {
      expect(eventsService).toBeDefined();
      expect(eventsService.emit).toBeDefined();
      expect(eventsService.on).toBeDefined();
      expect(eventsService.off).toBeDefined();
    });

    it('should emit and handle events', async () => {
      const handler = jest.fn();
      eventsService.on('test.event', handler);
      await eventsService.emit('test.event', { data: 'test' });

      expect(handler).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should handle once events', async () => {
      const handler = jest.fn();
      eventsService.once('test.once', handler);

      await eventsService.emit('test.once', { data: 'first' });
      await eventsService.emit('test.once', { data: 'second' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ data: 'first' });
    });

    it('should remove event listeners', async () => {
      const handler = jest.fn();
      eventsService.on('test.remove', handler);
      eventsService.off('test.remove', handler);

      await eventsService.emit('test.remove', { data: 'test' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle wildcard events', async () => {
      const handler = jest.fn();
      eventsService.on('test.*', handler);

      await eventsService.emit('test.one', { data: 'one' });
      await eventsService.emit('test.two', { data: 'two' });
      await eventsService.emit('other.event', { data: 'other' });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should handle simple async events', async () => {
      const handler = jest.fn(async (data: any) => {
        console.log('Simple handler called with:', data);
        return data.value * 2;
      });

      eventsService.on('simple.test', handler);

      const results = await eventsService.emitAsync('simple.test', { value: 5 });

      expect(handler).toHaveBeenCalledWith({ value: 5 });
      expect(results).toContain(10);
    });

    it('should handle async events in parallel', async () => {
      const handler1 = jest.fn(async (data: any) => {
        return data.order;
      });

      const handler2 = jest.fn(async (data: any) => {
        return data.order * 10;
      });

      eventsService.on('async.test', handler1);
      eventsService.on('async.test', handler2);

      const emitResults = await eventsService.emitAsync('async.test', { order: 1 });

      // Check handlers were called
      expect(handler1).toHaveBeenCalledWith({ order: 1 });
      expect(handler2).toHaveBeenCalledWith({ order: 1 });

      // Check return values
      expect(emitResults).toContain(1);
      expect(emitResults).toContain(10);
    });

    it.skip('should handle event errors gracefully', async () => {
      const errorHandler = jest.fn();
      const goodHandler = jest.fn();

      eventsService.on('error.test', () => {
        throw new Error('Handler error');
      });
      eventsService.on('error.test', goodHandler);

      eventsService.onError(errorHandler);

      await eventsService.emit('error.test', { data: 'test' });

      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should get all listeners for an event', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventsService.on('get.listeners', handler1);
      eventsService.on('get.listeners', handler2);

      const listeners = eventsService.listeners('get.listeners');
      expect(listeners).toHaveLength(2);
    });

    it('should get all event names', () => {
      eventsService.on('event1', jest.fn());
      eventsService.on('event2', jest.fn());
      eventsService.on('event3', jest.fn());

      const eventNames = eventsService.eventNames();
      expect(eventNames).toContain('event1');
      expect(eventNames).toContain('event2');
      expect(eventNames).toContain('event3');
    });

    it('should clear all listeners', () => {
      eventsService.on('clear1', jest.fn());
      eventsService.on('clear2', jest.fn());

      eventsService.removeAllListeners();

      expect(eventsService.listeners('clear1')).toHaveLength(0);
      expect(eventsService.listeners('clear2')).toHaveLength(0);
    });
  });

  describe('EventBusService', () => {
    it('should initialize event bus', () => {
      expect(eventBus).toBeDefined();
      expect(eventBus.emit).toBeDefined();
      expect(eventBus.subscribe).toBeDefined();
    });

    it('should handle subscriptions', async () => {
      const handler = jest.fn();
      const subscription = eventBus.on('bus.event', handler);

      await eventBus.emit('bus.event', { data: 'test' });
      expect(handler).toHaveBeenCalledWith({ data: 'test' }, expect.any(Object));

      subscription.unsubscribe();
      await eventBus.emit('bus.event', { data: 'test2' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should support event patterns', async () => {
      const handler = jest.fn();
      eventBus.on('user.*', handler);

      await eventBus.emit('user.created', { id: 1 });
      await eventBus.emit('user.updated', { id: 2 });
      await eventBus.emit('order.created', { id: 3 });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it.skip('should handle priority subscribers', async () => {
      const results: number[] = [];

      eventBus.subscribe('priority.test', () => results.push(3), { priority: 1 });
      eventBus.subscribe('priority.test', () => results.push(1), { priority: 10 });
      eventBus.subscribe('priority.test', () => results.push(2), { priority: 5 });

      await eventBus.emit('priority.test', {});

      expect(results).toEqual([1, 2, 3]);
    });

    it('should support middleware chain', async () => {
      const middleware1 = jest.fn((data, next) => {
        data.middleware1 = true;
        return next(data);
      });

      const middleware2 = jest.fn((data, next) => {
        data.middleware2 = true;
        return next(data);
      });

      eventBus.use(middleware1);
      eventBus.use(middleware2);

      const handler = jest.fn();
      eventBus.on('middleware.test', handler);

      await eventBus.emit('middleware.test', { initial: true });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          initial: true,
          middleware1: true,
          middleware2: true
        }),
        expect.any(Object) // metadata parameter
      );
    });

    it.skip('should handle replay of events', async () => {
      eventBus.enableReplay(3);

      await eventBus.emit('replay.test', { id: 1 });
      await eventBus.emit('replay.test', { id: 2 });
      await eventBus.emit('replay.test', { id: 3 });

      const handler = jest.fn();
      eventBus.subscribe('replay.test', handler, { replay: true });

      expect(handler).toHaveBeenCalledTimes(3);
      expect(handler).toHaveBeenCalledWith({ id: 1 });
      expect(handler).toHaveBeenCalledWith({ id: 2 });
      expect(handler).toHaveBeenCalledWith({ id: 3 });
    });
  });

  describe('EventDiscoveryService', () => {
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
        providers: [
          class Handler1 {},
          class Handler2 {},
        ]
      };

      const result = await discoveryService.scanModule(module);
      // The result is an object with handlers, emitters, etc.
      // Since we're passing plain classes without decorators, they won't be discovered
      expect(result.handlers).toHaveLength(0);
      expect(result.emitters).toHaveLength(0);
    });
  });

  describe('EventHistoryService', () => {
    it('should record event history', () => {
      // Enable recording first
      historyService.startRecording();

      historyService.record({
        event: 'test.event',
        data: { test: true },
        timestamp: Date.now()
      });

      const history = historyService.getHistorySync('test.event');
      expect(history).toHaveLength(1);
      expect(history[0].event).toBe('test.event');
    });

    it('should limit history size', () => {
      // Enable recording first
      historyService.startRecording();
      historyService.setMaxHistory(3);

      for (let i = 0; i < 5; i++) {
        historyService.record({
          event: 'limited.event',
          data: { id: i },
          timestamp: Date.now()
        });
      }

      const history = historyService.getHistorySync('limited.event');
      expect(history).toHaveLength(3);
      expect(history[0].data.id).toBe(2);
    });

    it('should clear history', () => {
      // Enable recording first
      historyService.startRecording();

      historyService.record({
        event: 'clear.event',
        data: {},
        timestamp: Date.now()
      });

      // Use the correct method name for clearing history
      historyService.clear('clear.event');
      const history = historyService.getHistorySync('clear.event');
      expect(history).toHaveLength(0);
    });

    it('should get statistics', () => {
      // Enable recording first
      historyService.startRecording();

      historyService.record({ event: 'stats.event', data: {}, timestamp: Date.now() });
      historyService.record({ event: 'stats.event', data: {}, timestamp: Date.now() });
      historyService.record({ event: 'other.event', data: {}, timestamp: Date.now() });

      const stats = historyService.getStatisticsSync();
      expect(stats['stats.event']).toBe(2);
      expect(stats['other.event']).toBe(1);
    });
  });

  describe('EventMetadataService', () => {
    it('should store and retrieve metadata', () => {
      metadataService.setMetadata('test.event', {
        description: 'Test event',
        schema: { type: 'object' }
      });

      const metadata = metadataService.getMetadata('test.event');
      expect(metadata.description).toBe('Test event');
      expect(metadata.schema).toEqual({ type: 'object' });
    });

    it('should validate event data against schema', () => {
      metadataService.setMetadata('validated.event', {
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' }
          },
          required: ['name']
        }
      });

      const valid = metadataService.validate('validated.event', { name: 'John', age: 30 });
      expect(valid).toBe(true);

      const invalid = metadataService.validate('validated.event', { age: 30 });
      expect(invalid).toBe(false);
    });

    it('should list all registered events', () => {
      metadataService.setMetadata('event1', {});
      metadataService.setMetadata('event2', {});
      metadataService.setMetadata('event3', {});

      const events = metadataService.getAllEvents();
      expect(events).toContain('event1');
      expect(events).toContain('event2');
      expect(events).toContain('event3');
    });
  });

  describe('EventSchedulerService', () => {
    jest.useFakeTimers();

    it.skip('should schedule delayed events', () => {
      const handler = jest.fn();
      schedulerService.onScheduledEvent('delayed.event', handler);

      schedulerService.scheduleEvent('delayed.event', { data: 'test' }, 1000);

      expect(handler).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);
      expect(handler).toHaveBeenCalledWith({ data: 'test' });
    });

    it.skip('should schedule recurring events', () => {
      const handler = jest.fn();
      schedulerService.onScheduledEvent('recurring.event', handler);

      const jobId = schedulerService.scheduleRecurring('recurring.event', { data: 'test' }, 1000);

      jest.advanceTimersByTime(3500);
      expect(handler).toHaveBeenCalledTimes(3);

      schedulerService.cancelJob(jobId);
      jest.advanceTimersByTime(2000);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should schedule cron-based events', () => {
      const handler = jest.fn();
      schedulerService.onScheduledEvent('cron.event', handler);

      // Every minute
      schedulerService.scheduleCron('cron.event', { data: 'test' }, '* * * * *');

      // Simulate 3 minutes passing
      jest.advanceTimersByTime(3 * 60 * 1000);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it.skip('should cancel scheduled jobs', () => {
      const handler = jest.fn();
      schedulerService.onScheduledEvent('cancel.event', handler);

      const jobId = schedulerService.scheduleEvent('cancel.event', { data: 'test' }, 1000);
      schedulerService.cancelJob(jobId);

      jest.advanceTimersByTime(2000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should list active jobs', () => {
      const job1 = schedulerService.scheduleEvent('job1', {}, 1000);
      const job2 = schedulerService.scheduleEvent('job2', {}, 2000);

      const jobs = schedulerService.getActiveJobs();
      expect(jobs).toContain(job1);
      expect(jobs).toContain(job2);

      schedulerService.cancelJob(job1);
      const updatedJobs = schedulerService.getActiveJobs();
      expect(updatedJobs).not.toContain(job1);
      expect(updatedJobs).toContain(job2);
    });

  });

  describe('EventValidationService', () => {
    it('should validate event names', () => {
      expect(validationService.isValidEventName('valid.event')).toBe(true);
      expect(validationService.isValidEventName('also.valid.event')).toBe(true);
      expect(validationService.isValidEventName('123invalid')).toBe(false);
      expect(validationService.isValidEventName('')).toBe(false);
      expect(validationService.isValidEventName('invalid..event')).toBe(false);
    });

    it('should validate event data', () => {
      const schema = {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' }
        },
        required: ['id']
      };

      validationService.registerSchema('user.event', schema);

      expect(validationService.validateData('user.event', { id: 1, name: 'John' })).toBe(true);
      expect(validationService.validateData('user.event', { name: 'John' })).toBe(false);
      expect(validationService.validateData('user.event', { id: '1', name: 'John' })).toBe(false);
    });

    it('should validate handler signature', () => {
      const validHandler = (data: any) => {};
      const asyncHandler = async (data: any) => {};
      const invalidHandler = 'not a function';

      expect(validationService.isValidHandler(validHandler)).toBe(true);
      expect(validationService.isValidHandler(asyncHandler)).toBe(true);
      expect(validationService.isValidHandler(invalidHandler as any)).toBe(false);
    });

    it('should sanitize event data', () => {
      const data = {
        name: 'John',
        password: 'secret123',
        ssn: '123-45-6789',
        safe: 'value'
      };

      const sanitized = validationService.sanitizeData(data);
      expect(sanitized.name).toBe('John');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.ssn).toBe('[REDACTED]');
      expect(sanitized.safe).toBe('value');
    });
  });

  describe('EventsModule', () => {
    it('should configure event module', () => {
      const config = EventsModule.forRoot({
        enableHistory: true,
        maxHistorySize: 100,
        enableValidation: true,
        enableScheduler: true
      });

      expect(config.module).toBe(EventsModule);
      expect(config.providers).toBeDefined();
      expect(config.exports).toBeDefined();
    });

    it('should configure async module', async () => {
      const configFactory = jest.fn().mockResolvedValue({
        enableHistory: true,
        maxHistorySize: 200
      });

      const config = EventsModule.forRootAsync({
        useFactory: configFactory
      });

      expect(config.module).toBe(EventsModule);
      expect(config.providers).toBeDefined();
    });

    it('should provide default configuration', () => {
      const config = EventsModule.forRoot({});
      expect(config.module).toBe(EventsModule);
      expect(config.providers).toHaveLength(9); // Options + Emitter + 7 services
    });

    it('should export event services', () => {
      const config = EventsModule.forRoot({});
      expect(config.exports).toContain(EVENTS_SERVICE_TOKEN);
      expect(config.exports).toContain(EVENT_BUS_SERVICE_TOKEN);
    });
  });

  describe('Event System Integration', () => {
    it('should handle complex event flow', async () => {
      const results: string[] = [];

      // Start history recording
      historyService.startRecording();

      // Set up handlers with different priorities
      eventsService.on('integration.test', () => results.push('handler1'), { priority: 1 });
      eventsService.on('integration.test', () => results.push('handler2'), { priority: 10 });
      eventsService.on('integration.test', () => results.push('handler3'), { priority: 5 });

      // Set up history recording
      eventsService.on('integration.test', (data) => {
        historyService.record({
          event: 'integration.test',
          data,
          timestamp: Date.now()
        });
      });

      // Emit event
      eventsService.emit('integration.test', { test: true });

      // Check execution order
      expect(results).toEqual(['handler2', 'handler3', 'handler1']);

      // Check history
      const history = historyService.getHistory('integration.test');
      expect(history).toHaveLength(1);
      expect(history[0].data).toEqual({ test: true });
    });

    it('should handle event bubbling', async () => {
      const results: string[] = [];

      eventsService.on('parent', () => results.push('parent'));
      eventsService.on('parent.child', () => results.push('child'));
      eventsService.on('parent.child.grandchild', () => results.push('grandchild'));

      // Enable bubbling
      eventsService.enableBubbling(true);

      await eventsService.emit('parent.child.grandchild', {});

      expect(results).toEqual(['grandchild', 'child', 'parent']);
    });

    it('should handle event transactions', async () => {
      const results: any[] = [];

      eventsService.on('transaction.event', (data) => {
        results.push(data);
        if (data.fail) {
          throw new Error('Transaction failed');
        }
      });

      // Start transaction
      const tx = eventsService.beginTransaction();

      try {
        await tx.emit('transaction.event', { id: 1 });
        await tx.emit('transaction.event', { id: 2, fail: true });
        await tx.commit();
      } catch (error) {
        await tx.rollback();
      }

      // Results should be rolled back
      expect(results).toHaveLength(0);
    });
  });
});