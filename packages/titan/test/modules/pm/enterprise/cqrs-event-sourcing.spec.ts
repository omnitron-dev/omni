/**
 * Comprehensive Tests for CQRS and Event Sourcing
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  CommandBus,
  QueryBus,
  AggregateRoot,
  ProjectionManager,
  InMemoryEventStore,
  InMemorySnapshotStore,
  InMemoryReadModelStore,
  type ICommand,
  type IQuery,
  type ICommandHandler,
  type IQueryHandler,
  type IDomainEvent,
} from '../../../../src/modules/pm/enterprise/cqrs.js';

import {
  AggregateRoot as ESAggregateRoot,
  EventSourcedRepository,
  InMemoryEventStore as ESEventStore,
  CommandBus as ESCommandBus,
  QueryBus as ESQueryBus,
  type IDomainEvent as ESDomainEvent,
} from '../../../../src/modules/pm/enterprise/event-sourcing.js';

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

describe('CQRS - Command Bus', () => {
  let commandBus: CommandBus;

  beforeEach(() => {
    jest.clearAllMocks();
    commandBus = new CommandBus(mockLogger as any);
  });

  describe('Command Registration', () => {
    it('should register command handlers', () => {
      const handler: ICommandHandler = {
        commandType: 'CreateUser',
        handle: async (command) => {
          return { userId: 'user-123' };
        },
      };

      commandBus.register(handler);
      
      // Verify registration
      expect((commandBus as any).handlers.has('CreateUser')).toBe(true);
    });

    it('should register multiple handlers', () => {
      const handlers: ICommandHandler[] = [
        { commandType: 'CreateUser', handle: async () => ({}) },
        { commandType: 'UpdateUser', handle: async () => ({}) },
        { commandType: 'DeleteUser', handle: async () => ({}) },
      ];

      handlers.forEach(h => commandBus.register(h));

      expect((commandBus as any).handlers.size).toBe(3);
    });
  });

  describe('Command Execution', () => {
    it('should execute registered command', async () => {
      let executed = false;

      const handler: ICommandHandler = {
        commandType: 'TestCommand',
        handle: async (command) => {
          executed = true;
          return { success: true };
        },
      };

      commandBus.register(handler);

      const command: ICommand = {
        id: 'cmd-1',
        aggregateId: 'agg-1',
        type: 'TestCommand',
        payload: { test: true },
        timestamp: Date.now(),
      };

      const result = await commandBus.send(command);

      expect(executed).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should throw error for unregistered command', async () => {
      const command: ICommand = {
        id: 'cmd-1',
        aggregateId: 'agg-1',
        type: 'UnknownCommand',
        payload: {},
        timestamp: Date.now(),
      };

      await expect(commandBus.send(command)).rejects.toThrow('No handler registered');
    });

    it('should emit command events', async () => {
      let executing = false;
      let executed = false;

      commandBus.on('command:executing', () => {
        executing = true;
      });

      commandBus.on('command:executed', () => {
        executed = true;
      });

      const handler: ICommandHandler = {
        commandType: 'EventCommand',
        handle: async () => ({ done: true }),
      };

      commandBus.register(handler);

      await commandBus.send({
        id: 'cmd-1',
        aggregateId: 'agg-1',
        type: 'EventCommand',
        payload: {},
        timestamp: Date.now(),
      });

      expect(executing).toBe(true);
      expect(executed).toBe(true);
    });

    it('should handle command failures', async () => {
      let failed = false;

      commandBus.on('command:failed', () => {
        failed = true;
      });

      const handler: ICommandHandler = {
        commandType: 'FailingCommand',
        handle: async () => {
          throw new Error('Command failed');
        },
      };

      commandBus.register(handler);

      await expect(
        commandBus.send({
          id: 'cmd-1',
          aggregateId: 'agg-1',
          type: 'FailingCommand',
          payload: {},
          timestamp: Date.now(),
        })
      ).rejects.toThrow('Command failed');

      expect(failed).toBe(true);
    });

    it('should timeout slow commands', async () => {
      const handler: ICommandHandler = {
        commandType: 'SlowCommand',
        handle: async () => {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return { done: true };
        },
      };

      commandBus.register(handler);

      const slowBus = new CommandBus(mockLogger as any, { commandTimeout: 100 });
      slowBus.register(handler);

      await expect(
        slowBus.send({
          id: 'cmd-1',
          aggregateId: 'agg-1',
          type: 'SlowCommand',
          payload: {},
          timestamp: Date.now(),
        })
      ).rejects.toThrow();
    });
  });

  describe('Command Middleware', () => {
    it('should execute middleware before command', async () => {
      const executionOrder: string[] = [];

      commandBus.use(async (command) => {
        executionOrder.push('middleware');
      });

      const handler: ICommandHandler = {
        commandType: 'MiddlewareCommand',
        handle: async () => {
          executionOrder.push('handler');
          return {};
        },
      };

      commandBus.register(handler);

      await commandBus.send({
        id: 'cmd-1',
        aggregateId: 'agg-1',
        type: 'MiddlewareCommand',
        payload: {},
        timestamp: Date.now(),
      });

      expect(executionOrder).toEqual(['middleware', 'handler']);
    });

    it('should execute multiple middleware in order', async () => {
      const order: number[] = [];

      commandBus.use(async () => { order.push(1); });
      commandBus.use(async () => { order.push(2); });
      commandBus.use(async () => { order.push(3); });

      const handler: ICommandHandler = {
        commandType: 'Test',
        handle: async () => ({ done: true }),
      };

      commandBus.register(handler);

      await commandBus.send({
        id: 'cmd-1',
        aggregateId: 'agg-1',
        type: 'Test',
        payload: {},
        timestamp: Date.now(),
      });

      expect(order).toEqual([1, 2, 3]);
    });
  });
});

describe('CQRS - Query Bus', () => {
  let queryBus: QueryBus;

  beforeEach(() => {
    jest.clearAllMocks();
    queryBus = new QueryBus(mockLogger as any);
  });

  describe('Query Registration', () => {
    it('should register query handlers', () => {
      const handler: IQueryHandler = {
        queryType: 'GetUser',
        handle: async (query) => {
          return { user: { id: 'user-123' } };
        },
      };

      queryBus.register(handler);
      
      expect((queryBus as any).handlers.has('GetUser')).toBe(true);
    });
  });

  describe('Query Execution', () => {
    it('should execute query', async () => {
      const handler: IQueryHandler = {
        queryType: 'GetUsers',
        handle: async (query) => {
          return { users: [{ id: '1' }, { id: '2' }] };
        },
      };

      queryBus.register(handler);

      const query: IQuery = {
        id: 'q-1',
        type: 'GetUsers',
        parameters: {},
      };

      const result = await queryBus.execute(query);

      expect(result.users).toHaveLength(2);
    });

    it('should throw for unregistered query', async () => {
      await expect(
        queryBus.execute({
          id: 'q-1',
          type: 'UnknownQuery',
          parameters: {},
        })
      ).rejects.toThrow('No handler registered');
    });

    it('should timeout slow queries', async () => {
      const handler: IQueryHandler = {
        queryType: 'SlowQuery',
        handle: async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return {};
        },
      };

      queryBus.register(handler);

      const slowBus = new QueryBus(mockLogger as any, { queryTimeout: 50 });
      slowBus.register(handler);

      await expect(
        slowBus.execute({
          id: 'q-1',
          type: 'SlowQuery',
          parameters: {},
        })
      ).rejects.toThrow();
    });
  });

  describe('Query Caching', () => {
    it('should cache query results', async () => {
      let executions = 0;

      const handler: IQueryHandler = {
        queryType: 'CachedQuery',
        handle: async () => {
          executions++;
          return { value: Math.random() };
        },
      };

      queryBus.register(handler);

      const query: IQuery = {
        id: 'q-1',
        type: 'CachedQuery',
        parameters: {},
        metadata: {
          cacheKey: 'test-cache-key',
          ttl: 5000,
        },
      };

      const result1 = await queryBus.execute(query);
      const result2 = await queryBus.execute(query);

      expect(executions).toBe(1);
      expect(result1.value).toBe(result2.value);
    });

    it('should expire cached results after TTL', async () => {
      jest.useFakeTimers();

      let executions = 0;

      const handler: IQueryHandler = {
        queryType: 'ExpiringQuery',
        handle: async () => {
          executions++;
          return { value: executions };
        },
      };

      queryBus.register(handler);

      const query: IQuery = {
        id: 'q-1',
        type: 'ExpiringQuery',
        parameters: {},
        metadata: {
          cacheKey: 'expiring-key',
          ttl: 1000,
        },
      };

      await queryBus.execute(query);
      
      jest.advanceTimersByTime(1500);
      
      await queryBus.execute(query);

      expect(executions).toBe(2);

      jest.useRealTimers();
    });

    it('should clear cache by pattern', async () => {
      const handler: IQueryHandler = {
        queryType: 'Test',
        handle: async () => ({ value: 1 }),
      };

      queryBus.register(handler);

      await queryBus.execute({
        id: 'q-1',
        type: 'Test',
        parameters: {},
        metadata: { cacheKey: 'user:123', ttl: 5000 },
      });

      await queryBus.execute({
        id: 'q-2',
        type: 'Test',
        parameters: {},
        metadata: { cacheKey: 'user:456', ttl: 5000 },
      });

      queryBus.clearCache('user:');

      // Cache should be empty
      expect((queryBus as any).cache.size).toBe(0);
    });
  });
});

describe('CQRS - Aggregate Root', () => {
  class TestAggregate extends AggregateRoot {
    private state: any = {};

    constructor(id?: string) {
      super(id);
    }

    doSomething(data: any) {
      this.applyEvent('SomethingDone', data);
    }

    protected apply(event: IDomainEvent): void {
      if (event.type === 'SomethingDone') {
        this.state = { ...this.state, ...event.payload };
      }
    }

    getState() {
      return this.state;
    }
  }

  it('should create aggregate with ID', () => {
    const aggregate = new TestAggregate();
    
    expect(aggregate.id).toBeDefined();
    expect(aggregate.version).toBe(0);
  });

  it('should apply events and increment version', () => {
    const aggregate = new TestAggregate();
    
    aggregate.doSomething({ value: 42 });
    
    expect(aggregate.version).toBe(1);
    expect(aggregate.getState()).toEqual({ value: 42 });
  });

  it('should track uncommitted events', () => {
    const aggregate = new TestAggregate();
    
    aggregate.doSomething({ test: true });
    
    const uncommitted = aggregate.getUncommittedEvents();
    expect(uncommitted).toHaveLength(1);
    expect(uncommitted[0]?.type).toBe('SomethingDone');
  });

  it('should clear uncommitted events when marked committed', () => {
    const aggregate = new TestAggregate();
    
    aggregate.doSomething({ test: true });
    aggregate.markEventsAsCommitted();
    
    expect(aggregate.getUncommittedEvents()).toHaveLength(0);
  });

  it('should load from event history', () => {
    const aggregate = new TestAggregate('test-id');
    
    const events: IDomainEvent[] = [
      {
        id: 'e1',
        aggregateId: 'test-id',
        type: 'SomethingDone',
        payload: { step: 1 },
        version: 1,
        timestamp: Date.now(),
      },
      {
        id: 'e2',
        aggregateId: 'test-id',
        type: 'SomethingDone',
        payload: { step: 2 },
        version: 2,
        timestamp: Date.now(),
      },
    ];

    aggregate.loadFromHistory(events);
    
    expect(aggregate.version).toBe(2);
    expect(aggregate.getState()).toEqual({ step: 1, step: 2 });
  });
});

describe('Event Store', () => {
  let eventStore: InMemoryEventStore;

  beforeEach(() => {
    eventStore = new InMemoryEventStore();
  });

  it('should save events', async () => {
    const events: IDomainEvent[] = [
      {
        id: 'e1',
        aggregateId: 'agg-1',
        type: 'TestEvent',
        payload: { test: true },
        version: 1,
        timestamp: Date.now(),
      },
    ];

    await eventStore.saveEvents(events);
    
    const retrieved = await eventStore.getEvents('agg-1');
    expect(retrieved).toHaveLength(1);
  });

  it('should retrieve events for specific aggregate', async () => {
    await eventStore.saveEvents([
      {
        id: 'e1',
        aggregateId: 'agg-1',
        type: 'Event1',
        payload: {},
        version: 1,
        timestamp: Date.now(),
      },
      {
        id: 'e2',
        aggregateId: 'agg-2',
        type: 'Event2',
        payload: {},
        version: 1,
        timestamp: Date.now(),
      },
    ]);

    const events = await eventStore.getEvents('agg-1');
    expect(events).toHaveLength(1);
    expect(events[0]?.aggregateId).toBe('agg-1');
  });

  it('should filter events by version', async () => {
    await eventStore.saveEvents([
      {
        id: 'e1',
        aggregateId: 'agg-1',
        type: 'Event',
        payload: {},
        version: 1,
        timestamp: Date.now(),
      },
      {
        id: 'e2',
        aggregateId: 'agg-1',
        type: 'Event',
        payload: {},
        version: 2,
        timestamp: Date.now(),
      },
      {
        id: 'e3',
        aggregateId: 'agg-1',
        type: 'Event',
        payload: {},
        version: 3,
        timestamp: Date.now(),
      },
    ]);

    const events = await eventStore.getEvents('agg-1', 1);
    expect(events).toHaveLength(2);
    expect(events[0]?.version).toBe(2);
  });

  it('should iterate all events', async () => {
    await eventStore.saveEvents([
      {
        id: 'e1',
        aggregateId: 'agg-1',
        type: 'Event',
        payload: {},
        version: 1,
        timestamp: Date.now(),
      },
      {
        id: 'e2',
        aggregateId: 'agg-2',
        type: 'Event',
        payload: {},
        version: 1,
        timestamp: Date.now(),
      },
    ]);

    const allEvents: IDomainEvent[] = [];
    for await (const event of eventStore.getAllEvents()) {
      allEvents.push(event);
    }

    expect(allEvents).toHaveLength(2);
  });
});

describe('Projection Manager', () => {
  let projectionManager: ProjectionManager;
  let eventStore: InMemoryEventStore;

  beforeEach(() => {
    eventStore = new InMemoryEventStore();
    projectionManager = new ProjectionManager(mockLogger as any, eventStore);
  });

  it('should register projections', () => {
    const projection = {
      name: 'test-projection',
      handle: async (event: IDomainEvent) => {},
      getPosition: async () => null,
      setPosition: async (eventId: string) => {},
    };

    projectionManager.register(projection);
    
    expect((projectionManager as any).projections.has('test-projection')).toBe(true);
  });

  it('should process events through projections', async () => {
    const processedEvents: IDomainEvent[] = [];

    const projection = {
      name: 'event-projection',
      handle: async (event: IDomainEvent) => {
        processedEvents.push(event);
      },
      getPosition: async () => null,
      setPosition: async (eventId: string) => {},
    };

    projectionManager.register(projection);

    await eventStore.saveEvents([
      {
        id: 'e1',
        aggregateId: 'agg-1',
        type: 'TestEvent',
        payload: { test: true },
        version: 1,
        timestamp: Date.now(),
      },
    ]);

    await projectionManager.start();
    await new Promise(resolve => setTimeout(resolve, 100));
    projectionManager.stop();

    expect(processedEvents.length).toBeGreaterThan(0);
  });
});
