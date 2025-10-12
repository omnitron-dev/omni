/**
 * Event Sourcing and CQRS Tests
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  AggregateRoot,
  EventSourcedRepository,
  InMemoryEventStore,
  ReadModelProjection,
  CommandBus,
  QueryBus,
  type IDomainEvent,
  type ICommand,
  type IQuery,
} from '../../../../src/modules/pm/enterprise/event-sourcing.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
} as any;

// Test aggregate
class UserAggregate extends AggregateRoot {
  private name?: string;
  private email?: string;
  private isActive = false;

  constructor(aggregateId: string) {
    super(aggregateId, 'User');
  }

  protected registerEventHandlers(): void {
    this.eventHandlers.set('UserCreated', this.onUserCreated.bind(this));
    this.eventHandlers.set('UserUpdated', this.onUserUpdated.bind(this));
    this.eventHandlers.set('UserActivated', this.onUserActivated.bind(this));
    this.eventHandlers.set('UserDeactivated', this.onUserDeactivated.bind(this));
  }

  // Commands
  createUser(name: string, email: string): void {
    this.applyEvent('UserCreated', { name, email });
  }

  updateUser(updates: { name?: string; email?: string }): void {
    this.applyEvent('UserUpdated', updates);
  }

  activate(): void {
    if (!this.isActive) {
      this.applyEvent('UserActivated', {});
    }
  }

  deactivate(): void {
    if (this.isActive) {
      this.applyEvent('UserDeactivated', {});
    }
  }

  // Event handlers
  private onUserCreated(event: IDomainEvent): void {
    this.name = event.eventData.name;
    this.email = event.eventData.email;
    // Note: Don't set isActive here, let activate() do it
  }

  private onUserUpdated(event: IDomainEvent): void {
    if (event.eventData.name) this.name = event.eventData.name;
    if (event.eventData.email) this.email = event.eventData.email;
  }

  private onUserActivated(event: IDomainEvent): void {
    this.isActive = true;
  }

  private onUserDeactivated(event: IDomainEvent): void {
    this.isActive = false;
  }

  // For snapshot
  protected getState(): any {
    return {
      name: this.name,
      email: this.email,
      isActive: this.isActive,
    };
  }

  // Getters for testing
  getName(): string | undefined {
    return this.name;
  }
  getEmail(): string | undefined {
    return this.email;
  }
  getIsActive(): boolean {
    return this.isActive;
  }
}

// Test read model projection
class UserReadModel extends ReadModelProjection {
  private users = new Map<string, any>();
  private activeUsers = new Set<string>();

  protected registerEventHandlers(): void {
    this.on('UserCreated', this.onUserCreated.bind(this));
    this.on('UserUpdated', this.onUserUpdated.bind(this));
    this.on('UserActivated', this.onUserActivated.bind(this));
    this.on('UserDeactivated', this.onUserDeactivated.bind(this));
  }

  private async onUserCreated(event: IDomainEvent): Promise<void> {
    this.users.set(event.aggregateId, {
      id: event.aggregateId,
      ...event.eventData,
      version: event.eventVersion,
    });
    this.activeUsers.add(event.aggregateId);
  }

  private async onUserUpdated(event: IDomainEvent): Promise<void> {
    const user = this.users.get(event.aggregateId);
    if (user) {
      Object.assign(user, event.eventData);
      user.version = event.eventVersion;
    }
  }

  private async onUserActivated(event: IDomainEvent): Promise<void> {
    this.activeUsers.add(event.aggregateId);
  }

  private async onUserDeactivated(event: IDomainEvent): Promise<void> {
    this.activeUsers.delete(event.aggregateId);
  }

  // Query methods
  getUser(id: string): any {
    return this.users.get(id);
  }

  getAllUsers(): any[] {
    return Array.from(this.users.values());
  }

  getActiveUsers(): string[] {
    return Array.from(this.activeUsers);
  }
}

describe('Event Sourcing', () => {
  describe('AggregateRoot', () => {
    it('should apply events and update state', () => {
      const user = new UserAggregate('user-1');

      user.createUser('John Doe', 'john@example.com');

      expect(user.getName()).toBe('John Doe');
      expect(user.getEmail()).toBe('john@example.com');
      expect(user.getIsActive()).toBe(false); // Not active until activated
      expect(user.getVersion()).toBe(1);
    });

    it('should track uncommitted events', () => {
      const user = new UserAggregate('user-2');

      user.createUser('Jane Doe', 'jane@example.com');
      user.updateUser({ name: 'Jane Smith' });

      const uncommitted = user.getUncommittedEvents();
      expect(uncommitted).toHaveLength(2);
      expect(uncommitted[0].eventType).toBe('UserCreated');
      expect(uncommitted[1].eventType).toBe('UserUpdated');
    });

    it('should load from event history', () => {
      const events: IDomainEvent[] = [
        {
          aggregateId: 'user-3',
          aggregateType: 'User',
          eventType: 'UserCreated',
          eventVersion: 1,
          eventData: { name: 'Bob', email: 'bob@example.com' },
          timestamp: Date.now(),
        },
        {
          aggregateId: 'user-3',
          aggregateType: 'User',
          eventType: 'UserUpdated',
          eventVersion: 2,
          eventData: { email: 'robert@example.com' },
          timestamp: Date.now(),
        },
        {
          aggregateId: 'user-3',
          aggregateType: 'User',
          eventType: 'UserDeactivated',
          eventVersion: 3,
          eventData: {},
          timestamp: Date.now(),
        },
      ];

      const user = new UserAggregate('user-3');
      user.loadFromHistory(events);

      expect(user.getName()).toBe('Bob');
      expect(user.getEmail()).toBe('robert@example.com');
      expect(user.getIsActive()).toBe(false);
      expect(user.getVersion()).toBe(3);
    });

    it('should create and load from snapshot', () => {
      const user = new UserAggregate('user-4');
      user.createUser('Alice', 'alice@example.com');
      user.activate();

      const snapshot = user.createSnapshot();

      expect(snapshot.aggregateId).toBe('user-4');
      expect(snapshot.version).toBe(2);
      expect(snapshot.state.name).toBe('Alice');

      // Load from snapshot
      const newUser = new UserAggregate('user-4');
      newUser.loadFromSnapshot(snapshot);

      expect(newUser.getName()).toBe('Alice');
      expect(newUser.getEmail()).toBe('alice@example.com');
      expect(newUser.getIsActive()).toBe(true);
      expect(newUser.getVersion()).toBe(2);
    });
  });

  describe('EventSourcedRepository', () => {
    let eventStore: InMemoryEventStore;
    let repository: EventSourcedRepository<UserAggregate>;

    beforeEach(() => {
      eventStore = new InMemoryEventStore();
      repository = new EventSourcedRepository(
        eventStore,
        UserAggregate,
        5, // Snapshot every 5 events
        mockLogger as any
      );
    });

    it('should save and load aggregate', async () => {
      const user = new UserAggregate('user-5');
      user.createUser('Test User', 'test@example.com');
      user.updateUser({ name: 'Updated User' });

      await repository.save(user);

      // Load the aggregate
      const loaded = await repository.load('user-5');

      expect(loaded.getName()).toBe('Updated User');
      expect(loaded.getEmail()).toBe('test@example.com');
      expect(loaded.getVersion()).toBe(2);
    });

    it('should create snapshots at intervals', async () => {
      const user = new UserAggregate('user-6');

      // Create 5 events (snapshot interval)
      user.createUser('Snapshot Test', 'snap@example.com');
      user.updateUser({ name: 'Update 1' });
      user.updateUser({ name: 'Update 2' });
      user.updateUser({ name: 'Update 3' });
      user.updateUser({ name: 'Update 4' });

      await repository.save(user);

      // Check that snapshot was created
      const snapshot = await eventStore.getSnapshot('user-6');
      expect(snapshot).not.toBeNull();
      expect(snapshot?.version).toBe(5);
    });

    it('should check if aggregate exists', async () => {
      const user = new UserAggregate('user-7');
      user.createUser('Exists Test', 'exists@example.com');

      await repository.save(user);

      const exists = await repository.exists('user-7');
      const notExists = await repository.exists('user-999');

      expect(exists).toBe(true);
      expect(notExists).toBe(false);
    });
  });

  describe('InMemoryEventStore', () => {
    let eventStore: InMemoryEventStore;

    beforeEach(() => {
      eventStore = new InMemoryEventStore();
    });

    it('should append and retrieve events', async () => {
      const events: IDomainEvent[] = [
        {
          aggregateId: 'agg-1',
          aggregateType: 'Test',
          eventType: 'TestEvent',
          eventVersion: 1,
          eventData: { test: true },
          timestamp: Date.now(),
        },
      ];

      await eventStore.append(events);
      const retrieved = await eventStore.getEvents('agg-1');

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].sequenceNumber).toBeDefined();
    });

    it('should get events by type', async () => {
      const events: IDomainEvent[] = [
        {
          aggregateId: 'agg-1',
          aggregateType: 'Test',
          eventType: 'TypeA',
          eventVersion: 1,
          eventData: {},
          timestamp: Date.now(),
        },
        {
          aggregateId: 'agg-2',
          aggregateType: 'Test',
          eventType: 'TypeB',
          eventVersion: 1,
          eventData: {},
          timestamp: Date.now(),
        },
        {
          aggregateId: 'agg-3',
          aggregateType: 'Test',
          eventType: 'TypeA',
          eventVersion: 1,
          eventData: {},
          timestamp: Date.now(),
        },
      ];

      await eventStore.append(events);
      const typeAEvents = await eventStore.getEventsByType('TypeA');

      expect(typeAEvents).toHaveLength(2);
      expect(typeAEvents.every((e) => e.eventType === 'TypeA')).toBe(true);
    });
  });

  describe('Read Model Projection', () => {
    it('should handle events and update read model', async () => {
      const readModel = new UserReadModel(mockLogger as any);

      const event: IDomainEvent = {
        aggregateId: 'user-8',
        aggregateType: 'User',
        eventType: 'UserCreated',
        eventVersion: 1,
        eventData: { name: 'Read Model User', email: 'rm@example.com' },
        timestamp: Date.now(),
      };

      await readModel.handleEvent(event);

      const user = readModel.getUser('user-8');
      expect(user).toBeDefined();
      expect(user.name).toBe('Read Model User');
      expect(readModel.getActiveUsers()).toContain('user-8');
    });

    it('should handle multiple events in sequence', async () => {
      const readModel = new UserReadModel(mockLogger as any);

      const events: IDomainEvent[] = [
        {
          aggregateId: 'user-9',
          aggregateType: 'User',
          eventType: 'UserCreated',
          eventVersion: 1,
          eventData: { name: 'Multi Event', email: 'multi@example.com' },
          timestamp: Date.now(),
        },
        {
          aggregateId: 'user-9',
          aggregateType: 'User',
          eventType: 'UserUpdated',
          eventVersion: 2,
          eventData: { name: 'Updated Multi' },
          timestamp: Date.now(),
        },
        {
          aggregateId: 'user-9',
          aggregateType: 'User',
          eventType: 'UserDeactivated',
          eventVersion: 3,
          eventData: {},
          timestamp: Date.now(),
        },
      ];

      for (const event of events) {
        await readModel.handleEvent(event);
      }

      const user = readModel.getUser('user-9');
      expect(user.name).toBe('Updated Multi');
      expect(readModel.getActiveUsers()).not.toContain('user-9');
    });
  });

  describe('CQRS', () => {
    describe('CommandBus', () => {
      it('should register and execute commands', async () => {
        const commandBus = new CommandBus();

        const handler = {
          async handle(command: ICommand): Promise<string> {
            return `Handled: ${command.data.value}`;
          },
        };

        commandBus.register('TestCommand', handler);

        const result = await commandBus.execute<string>({
          type: 'TestCommand',
          data: { value: 'test' },
        });

        expect(result).toBe('Handled: test');
      });

      it('should throw for unregistered commands', async () => {
        const commandBus = new CommandBus();

        await expect(
          commandBus.execute({
            type: 'UnknownCommand',
            data: {},
          })
        ).rejects.toThrow('No handler registered for command UnknownCommand');
      });
    });

    describe('QueryBus', () => {
      it('should register and execute queries', async () => {
        const queryBus = new QueryBus();

        const handler = {
          async handle(query: IQuery): Promise<any[]> {
            return [{ id: 1, name: 'Result' }];
          },
        };

        queryBus.register('TestQuery', handler);

        const results = await queryBus.execute<any[]>({
          type: 'TestQuery',
          criteria: { filter: 'test' },
        });

        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Result');
      });
    });
  });
});
