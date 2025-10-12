/**
 * CQRS Tests
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  CommandBus,
  QueryBus,
  AggregateRoot,
  InMemoryEventStore,
  InMemorySnapshotStore,
  InMemoryReadModelStore,
  ProjectionManager,
  type ICommand,
  type IQuery,
  type ICommandHandler,
  type IQueryHandler,
  type IDomainEvent,
  type IProjection,
} from '../../../../src/modules/pm/enterprise/cqrs.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(() => mockLogger),
} as any;

// Test aggregate
class UserAggregate extends AggregateRoot {
  private name?: string;
  private email?: string;

  protected apply(event: IDomainEvent): void {
    switch (event.type) {
      case 'UserCreated':
        this.name = event.payload.name;
        this.email = event.payload.email;
        break;
      case 'UserUpdated':
        if (event.payload.name) this.name = event.payload.name;
        if (event.payload.email) this.email = event.payload.email;
        break;
    }
  }

  createUser(name: string, email: string): void {
    this.applyEvent('UserCreated', { name, email });
  }

  updateUser(updates: { name?: string; email?: string }): void {
    this.applyEvent('UserUpdated', updates);
  }

  getName(): string | undefined {
    return this.name;
  }

  getEmail(): string | undefined {
    return this.email;
  }
}

// Test command handler
class CreateUserCommandHandler implements ICommandHandler {
  commandType = 'CreateUser';

  constructor(private eventStore: InMemoryEventStore) {}

  async handle(command: ICommand): Promise<string> {
    const aggregate = new UserAggregate();
    aggregate.createUser(command.payload.name, command.payload.email);

    const events = aggregate.getUncommittedEvents();
    await this.eventStore.saveEvents(events);
    aggregate.markEventsAsCommitted();

    return aggregate.id;
  }
}

// Test query handler
class GetUserQueryHandler implements IQueryHandler {
  queryType = 'GetUser';

  constructor(private readModelStore: InMemoryReadModelStore) {}

  async handle(query: IQuery): Promise<any> {
    return this.readModelStore.get(query.parameters.userId);
  }
}

// Test projection
class UserProjection implements IProjection {
  name = 'UserProjection';
  private position: string | null = null;

  constructor(private readModelStore: InMemoryReadModelStore) {}

  async handle(event: IDomainEvent): Promise<void> {
    if (event.type === 'UserCreated') {
      await this.readModelStore.save({
        id: event.aggregateId,
        lastEventId: event.id,
        lastUpdated: Date.now(),
        ...event.payload,
      });
    }
  }

  async getPosition(): Promise<string | null> {
    return this.position;
  }

  async setPosition(eventId: string): Promise<void> {
    this.position = eventId;
  }
}

describe('CQRS', () => {
  describe('CommandBus', () => {
    let commandBus: CommandBus;
    let eventStore: InMemoryEventStore;

    beforeEach(() => {
      commandBus = new CommandBus(mockLogger);
      eventStore = new InMemoryEventStore();
    });

    it('should register and execute commands', async () => {
      // Register handler
      const handler = new CreateUserCommandHandler(eventStore);
      commandBus.register(handler);

      // Send command
      const command: ICommand = {
        id: 'cmd-1',
        aggregateId: 'user-1',
        type: 'CreateUser',
        payload: { name: 'John', email: 'john@example.com' },
        timestamp: Date.now(),
      };

      const userId = await commandBus.send<string>(command);
      expect(userId).toBeDefined();

      // Verify events were stored
      const events = await eventStore.getEvents(userId);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('UserCreated');
    });

    it('should throw error for unregistered command', async () => {
      const command: ICommand = {
        id: 'cmd-1',
        aggregateId: 'user-1',
        type: 'UnknownCommand',
        payload: {},
        timestamp: Date.now(),
      };

      await expect(commandBus.send(command)).rejects.toThrow('No handler registered for command type: UnknownCommand');
    });

    it('should run middleware before handling', async () => {
      const middleware = jest.fn().mockResolvedValue(undefined);
      commandBus.use(middleware);

      const handler = new CreateUserCommandHandler(eventStore);
      commandBus.register(handler);

      const command: ICommand = {
        id: 'cmd-1',
        aggregateId: 'user-1',
        type: 'CreateUser',
        payload: { name: 'John', email: 'john@example.com' },
        timestamp: Date.now(),
      };

      await commandBus.send(command);
      expect(middleware).toHaveBeenCalledWith(command);
    });

    it('should emit events during command execution', async () => {
      const events: string[] = [];
      commandBus.on('command:executing', () => events.push('executing'));
      commandBus.on('command:executed', () => events.push('executed'));

      const handler = new CreateUserCommandHandler(eventStore);
      commandBus.register(handler);

      const command: ICommand = {
        id: 'cmd-1',
        aggregateId: 'user-1',
        type: 'CreateUser',
        payload: { name: 'John', email: 'john@example.com' },
        timestamp: Date.now(),
      };

      await commandBus.send(command);
      expect(events).toEqual(['executing', 'executed']);
    });
  });

  describe('QueryBus', () => {
    let queryBus: QueryBus;
    let readModelStore: InMemoryReadModelStore;

    beforeEach(() => {
      queryBus = new QueryBus(mockLogger);
      readModelStore = new InMemoryReadModelStore();
    });

    it('should register and execute queries', async () => {
      // Add test data
      await readModelStore.save({
        id: 'user-1',
        lastUpdated: Date.now(),
        name: 'John',
        email: 'john@example.com',
      });

      // Register handler
      const handler = new GetUserQueryHandler(readModelStore);
      queryBus.register(handler);

      // Execute query
      const query: IQuery = {
        id: 'query-1',
        type: 'GetUser',
        parameters: { userId: 'user-1' },
      };

      const result = await queryBus.execute(query);
      expect(result).toMatchObject({
        name: 'John',
        email: 'john@example.com',
      });
    });

    it('should cache query results', async () => {
      await readModelStore.save({
        id: 'user-1',
        lastUpdated: Date.now(),
        name: 'John',
      });

      const handler = new GetUserQueryHandler(readModelStore);
      queryBus.register(handler);

      const query: IQuery = {
        id: 'query-1',
        type: 'GetUser',
        parameters: { userId: 'user-1' },
        metadata: {
          cacheKey: 'user-1',
          ttl: 5000,
        },
      };

      // First call
      const result1 = await queryBus.execute(query);

      // Update data
      await readModelStore.save({
        id: 'user-1',
        lastUpdated: Date.now(),
        name: 'Jane',
      });

      // Second call should return cached result
      const result2 = await queryBus.execute(query);
      expect(result2.name).toBe('John'); // Still cached

      // Clear cache
      queryBus.clearCache('user-1');

      // Third call should get fresh data
      const result3 = await queryBus.execute(query);
      expect(result3.name).toBe('Jane');
    });
  });

  describe('AggregateRoot', () => {
    it('should track events', () => {
      const aggregate = new UserAggregate();
      aggregate.createUser('John', 'john@example.com');
      aggregate.updateUser({ email: 'newemail@example.com' });

      const events = aggregate.getUncommittedEvents();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('UserCreated');
      expect(events[1].type).toBe('UserUpdated');
    });

    it('should increment version with each event', () => {
      const aggregate = new UserAggregate();
      expect(aggregate.version).toBe(0);

      aggregate.createUser('John', 'john@example.com');
      expect(aggregate.version).toBe(1);

      aggregate.updateUser({ name: 'Jane' });
      expect(aggregate.version).toBe(2);
    });

    it('should load from event history', () => {
      const events: IDomainEvent[] = [
        {
          id: 'event-1',
          aggregateId: 'user-1',
          type: 'UserCreated',
          payload: { name: 'John', email: 'john@example.com' },
          version: 1,
          timestamp: Date.now(),
        },
        {
          id: 'event-2',
          aggregateId: 'user-1',
          type: 'UserUpdated',
          payload: { name: 'Jane' },
          version: 2,
          timestamp: Date.now(),
        },
      ];

      const aggregate = new UserAggregate('user-1');
      aggregate.loadFromHistory(events);

      expect(aggregate.version).toBe(2);
      expect(aggregate.getName()).toBe('Jane');
      expect(aggregate.getEmail()).toBe('john@example.com');
    });

    it('should clear uncommitted events after commit', () => {
      const aggregate = new UserAggregate();
      aggregate.createUser('John', 'john@example.com');

      expect(aggregate.getUncommittedEvents()).toHaveLength(1);

      aggregate.markEventsAsCommitted();

      expect(aggregate.getUncommittedEvents()).toHaveLength(0);
    });
  });

  describe('ProjectionManager', () => {
    it('should process events through projections', async () => {
      const eventStore = new InMemoryEventStore();
      const readModelStore = new InMemoryReadModelStore();
      const projectionManager = new ProjectionManager(mockLogger, eventStore);

      // Register projection
      const projection = new UserProjection(readModelStore);
      projectionManager.register(projection);

      // Add events
      const events: IDomainEvent[] = [
        {
          id: 'event-1',
          aggregateId: 'user-1',
          type: 'UserCreated',
          payload: { name: 'John', email: 'john@example.com' },
          version: 1,
          timestamp: Date.now(),
        },
      ];
      await eventStore.saveEvents(events);

      // Process projection
      const processedEvents: any[] = [];
      projectionManager.on('projection:processed', (name, event) => {
        processedEvents.push({ name, event });
      });

      // Start processing (will process immediately)
      await projectionManager.start();

      // Allow time for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Stop processing
      projectionManager.stop();

      // Check read model was updated
      const readModel = await readModelStore.get('user-1');
      expect(readModel).toMatchObject({
        name: 'John',
        email: 'john@example.com',
      });
    });
  });

  describe('Event Stores', () => {
    it('should store and retrieve events', async () => {
      const eventStore = new InMemoryEventStore();

      const events: IDomainEvent[] = [
        {
          id: 'event-1',
          aggregateId: 'agg-1',
          type: 'TestEvent',
          payload: { data: 'test' },
          version: 1,
          timestamp: Date.now(),
        },
        {
          id: 'event-2',
          aggregateId: 'agg-1',
          type: 'TestEvent2',
          payload: { data: 'test2' },
          version: 2,
          timestamp: Date.now(),
        },
      ];

      await eventStore.saveEvents(events);

      const retrieved = await eventStore.getEvents('agg-1');
      expect(retrieved).toHaveLength(2);
      expect(retrieved[0].id).toBe('event-1');
      expect(retrieved[1].id).toBe('event-2');
    });

    it('should retrieve events from specific version', async () => {
      const eventStore = new InMemoryEventStore();

      const events: IDomainEvent[] = [
        {
          id: 'event-1',
          aggregateId: 'agg-1',
          type: 'Event1',
          payload: {},
          version: 1,
          timestamp: Date.now(),
        },
        {
          id: 'event-2',
          aggregateId: 'agg-1',
          type: 'Event2',
          payload: {},
          version: 2,
          timestamp: Date.now(),
        },
        {
          id: 'event-3',
          aggregateId: 'agg-1',
          type: 'Event3',
          payload: {},
          version: 3,
          timestamp: Date.now(),
        },
      ];

      await eventStore.saveEvents(events);

      const fromVersion2 = await eventStore.getEvents('agg-1', 2);
      expect(fromVersion2).toHaveLength(1);
      expect(fromVersion2[0].version).toBe(3);
    });

    it('should iterate all events', async () => {
      const eventStore = new InMemoryEventStore();

      const events: IDomainEvent[] = [
        {
          id: 'event-1',
          aggregateId: 'agg-1',
          type: 'Event1',
          payload: {},
          version: 1,
          timestamp: Date.now(),
        },
        {
          id: 'event-2',
          aggregateId: 'agg-2',
          type: 'Event2',
          payload: {},
          version: 1,
          timestamp: Date.now(),
        },
      ];

      await eventStore.saveEvents(events);

      const allEvents: IDomainEvent[] = [];
      for await (const event of eventStore.getAllEvents()) {
        allEvents.push(event);
      }

      expect(allEvents).toHaveLength(2);
    });
  });

  describe('Snapshot Store', () => {
    it('should save and retrieve snapshots', async () => {
      const snapshotStore = new InMemorySnapshotStore();

      const snapshot = {
        state: { name: 'John', email: 'john@example.com' },
      };

      await snapshotStore.save('agg-1', snapshot, 5);

      const retrieved = await snapshotStore.get('agg-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.version).toBe(5);
      expect(retrieved?.snapshot).toEqual(snapshot);
    });

    it('should return null for non-existent snapshots', async () => {
      const snapshotStore = new InMemorySnapshotStore();
      const result = await snapshotStore.get('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('Read Model Store', () => {
    it('should save and retrieve read models', async () => {
      const store = new InMemoryReadModelStore();

      const model = {
        id: 'model-1',
        lastUpdated: Date.now(),
        name: 'Test Model',
        type: 'user',
      };

      await store.save(model);

      const retrieved = await store.get('model-1');
      expect(retrieved).toMatchObject(model);
    });

    it('should query read models', async () => {
      const store = new InMemoryReadModelStore();

      await store.save({
        id: 'user-1',
        lastUpdated: Date.now(),
        type: 'user',
        name: 'John',
      });

      await store.save({
        id: 'user-2',
        lastUpdated: Date.now(),
        type: 'user',
        name: 'Jane',
      });

      await store.save({
        id: 'product-1',
        lastUpdated: Date.now(),
        type: 'product',
        name: 'Widget',
      });

      const users = await store.query({ type: 'user' });
      expect(users).toHaveLength(2);

      const johns = await store.query({ type: 'user', name: 'John' });
      expect(johns).toHaveLength(1);
      expect(johns[0].id).toBe('user-1');
    });
  });
});
