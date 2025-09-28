/**
 * Event Sourcing and CQRS Implementation
 *
 * Provides event sourcing capabilities with automatic snapshot management,
 * event replay, and CQRS pattern support.
 */

import { EventEmitter } from 'events';
import type { ILogger } from '../../logger/logger.types.js';

/**
 * Domain event interface
 */
export interface IDomainEvent {
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  eventVersion: number;
  eventData: any;
  metadata?: IEventMetadata;
  timestamp: number;
  sequenceNumber?: number;
}

/**
 * Event metadata
 */
export interface IEventMetadata {
  userId?: string;
  correlationId?: string;
  causationId?: string;
  tenantId?: string;
  [key: string]: any;
}

/**
 * Event store interface
 */
export interface IEventStore {
  append(events: IDomainEvent[]): Promise<void>;
  getEvents(aggregateId: string, fromVersion?: number): Promise<IDomainEvent[]>;
  getEventsByType(eventType: string, limit?: number): Promise<IDomainEvent[]>;
  getSnapshot(aggregateId: string): Promise<ISnapshot | null>;
  saveSnapshot(snapshot: ISnapshot): Promise<void>;
}

/**
 * Snapshot interface
 */
export interface ISnapshot {
  aggregateId: string;
  aggregateType: string;
  version: number;
  state: any;
  timestamp: number;
}

/**
 * Aggregate root base class
 */
export abstract class AggregateRoot extends EventEmitter {
  protected version = 0;
  protected uncommittedEvents: IDomainEvent[] = [];
  protected eventHandlers = new Map<string, (event: IDomainEvent) => void>();

  constructor(
    protected readonly aggregateId: string,
    protected readonly aggregateType: string
  ) {
    super();
    this.registerEventHandlers();
  }

  /**
   * Register event handlers
   */
  protected abstract registerEventHandlers(): void;

  /**
   * Apply an event
   */
  protected applyEvent(eventType: string, eventData: any, metadata?: IEventMetadata): void {
    const event: IDomainEvent = {
      aggregateId: this.aggregateId,
      aggregateType: this.aggregateType,
      eventType,
      eventVersion: ++this.version,
      eventData,
      metadata,
      timestamp: Date.now()
    };

    // Apply to current state
    this.handleEvent(event);

    // Add to uncommitted events
    this.uncommittedEvents.push(event);

    // Emit for projections
    this.emit('event', event);
  }

  /**
   * Handle an event
   */
  protected handleEvent(event: IDomainEvent): void {
    const handler = this.eventHandlers.get(event.eventType);
    if (handler) {
      handler.call(this, event);
    }
  }

  /**
   * Load from event stream
   */
  loadFromHistory(events: IDomainEvent[]): void {
    for (const event of events) {
      this.handleEvent(event);
      this.version = event.eventVersion;
    }
  }

  /**
   * Load from snapshot
   */
  loadFromSnapshot(snapshot: ISnapshot): void {
    this.version = snapshot.version;
    Object.assign(this, snapshot.state);
  }

  /**
   * Get uncommitted events
   */
  getUncommittedEvents(): IDomainEvent[] {
    return this.uncommittedEvents;
  }

  /**
   * Mark events as committed
   */
  markEventsAsCommitted(): void {
    this.uncommittedEvents = [];
  }

  /**
   * Create snapshot
   */
  createSnapshot(): ISnapshot {
    return {
      aggregateId: this.aggregateId,
      aggregateType: this.aggregateType,
      version: this.version,
      state: this.getState(),
      timestamp: Date.now()
    };
  }

  /**
   * Get current state (for snapshot)
   */
  protected abstract getState(): any;

  /**
   * Get version
   */
  getVersion(): number {
    return this.version;
  }
}

/**
 * Event sourced repository
 */
export class EventSourcedRepository<T extends AggregateRoot> {
  constructor(
    private readonly eventStore: IEventStore,
    private readonly AggregateClass: new (id: string) => T,
    private readonly snapshotInterval = 10,
    private readonly logger: ILogger
  ) {}

  /**
   * Load aggregate
   */
  async load(aggregateId: string): Promise<T> {
    const aggregate = new this.AggregateClass(aggregateId);

    // Try to load from snapshot
    const snapshot = await this.eventStore.getSnapshot(aggregateId);
    let fromVersion = 0;

    if (snapshot) {
      aggregate.loadFromSnapshot(snapshot);
      fromVersion = snapshot.version;
    }

    // Load events after snapshot
    const events = await this.eventStore.getEvents(aggregateId, fromVersion);
    aggregate.loadFromHistory(events);

    return aggregate;
  }

  /**
   * Save aggregate
   */
  async save(aggregate: T): Promise<void> {
    const events = aggregate.getUncommittedEvents();

    if (events.length === 0) {
      return;
    }

    // Save events
    await this.eventStore.append(events);

    // Check if we should create a snapshot
    if (aggregate.getVersion() % this.snapshotInterval === 0) {
      const snapshot = aggregate.createSnapshot();
      await this.eventStore.saveSnapshot(snapshot);
    }

    // Mark events as committed
    aggregate.markEventsAsCommitted();
  }

  /**
   * Exists check
   */
  async exists(aggregateId: string): Promise<boolean> {
    const events = await this.eventStore.getEvents(aggregateId, 0);
    return events.length > 0;
  }
}

/**
 * In-memory event store implementation
 */
export class InMemoryEventStore implements IEventStore {
  private events: IDomainEvent[] = [];
  private snapshots = new Map<string, ISnapshot>();
  private sequenceNumber = 0;

  async append(events: IDomainEvent[]): Promise<void> {
    for (const event of events) {
      event.sequenceNumber = ++this.sequenceNumber;
      this.events.push(event);
    }
  }

  async getEvents(aggregateId: string, fromVersion = 0): Promise<IDomainEvent[]> {
    return this.events
      .filter(e => e.aggregateId === aggregateId && e.eventVersion > fromVersion)
      .sort((a, b) => a.eventVersion - b.eventVersion);
  }

  async getEventsByType(eventType: string, limit = 100): Promise<IDomainEvent[]> {
    return this.events
      .filter(e => e.eventType === eventType)
      .slice(-limit);
  }

  async getSnapshot(aggregateId: string): Promise<ISnapshot | null> {
    return this.snapshots.get(aggregateId) || null;
  }

  async saveSnapshot(snapshot: ISnapshot): Promise<void> {
    this.snapshots.set(snapshot.aggregateId, snapshot);
  }
}

/**
 * Read model projection base class
 */
export abstract class ReadModelProjection {
  protected eventHandlers = new Map<string, (event: IDomainEvent) => Promise<void>>();

  constructor(protected readonly logger: ILogger) {
    this.registerEventHandlers();
  }

  /**
   * Register event handlers
   */
  protected abstract registerEventHandlers(): void;

  /**
   * Handle an event
   */
  async handleEvent(event: IDomainEvent): Promise<void> {
    const handler = this.eventHandlers.get(event.eventType);
    if (handler) {
      try {
        await handler.call(this, event);
      } catch (error) {
        this.logger.error({ error, event }, 'Failed to handle event in projection');
      }
    }
  }

  /**
   * Register a handler
   */
  protected on(eventType: string, handler: (event: IDomainEvent) => Promise<void>): void {
    this.eventHandlers.set(eventType, handler);
  }
}

/**
 * CQRS Command Bus
 */
export class CommandBus {
  private handlers = new Map<string, ICommandHandler<any, any>>();

  /**
   * Register command handler
   */
  register<TCommand, TResult>(
    commandType: string,
    handler: ICommandHandler<TCommand, TResult>
  ): void {
    this.handlers.set(commandType, handler);
  }

  /**
   * Execute command
   */
  async execute<TResult>(command: ICommand): Promise<TResult> {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      throw new Error(`No handler registered for command ${command.type}`);
    }

    return handler.handle(command);
  }
}

/**
 * CQRS Query Bus
 */
export class QueryBus {
  private handlers = new Map<string, IQueryHandler<any, any>>();

  /**
   * Register query handler
   */
  register<TQuery, TResult>(
    queryType: string,
    handler: IQueryHandler<TQuery, TResult>
  ): void {
    this.handlers.set(queryType, handler);
  }

  /**
   * Execute query
   */
  async execute<TResult>(query: IQuery): Promise<TResult> {
    const handler = this.handlers.get(query.type);
    if (!handler) {
      throw new Error(`No handler registered for query ${query.type}`);
    }

    return handler.handle(query);
  }
}

/**
 * Command interface
 */
export interface ICommand {
  type: string;
  data: any;
  metadata?: IEventMetadata;
}

/**
 * Query interface
 */
export interface IQuery {
  type: string;
  criteria: any;
}

/**
 * Command handler interface
 */
export interface ICommandHandler<TCommand, TResult> {
  handle(command: TCommand): Promise<TResult>;
}

/**
 * Query handler interface
 */
export interface IQueryHandler<TQuery, TResult> {
  handle(query: TQuery): Promise<TResult>;
}

/**
 * Event Sourced Process decorator
 */
export function EventSourced(options: {
  snapshots?: { every: number };
  retention?: string;
} = {}): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata('event-sourced', options, target);
    return target;
  };
}

/**
 * Command decorator
 */
export function Command(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = Reflect.getMetadata('commands', target) || [];
    metadata.push({ method: propertyKey, descriptor });
    Reflect.defineMetadata('commands', metadata, target);
  };
}

/**
 * Event Handler decorator
 */
export function EventHandler(eventType: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = Reflect.getMetadata('event-handlers', target) || [];
    metadata.push({ eventType, method: propertyKey, descriptor });
    Reflect.defineMetadata('event-handlers', metadata, target);
  };
}

/**
 * Query decorator
 */
export function Query(options?: { model?: string }): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = Reflect.getMetadata('queries', target) || [];
    metadata.push({ method: propertyKey, descriptor, options });
    Reflect.defineMetadata('queries', metadata, target);
  };
}

/**
 * Read Model decorator
 */
export function ReadModel(options: {
  source: any;
  storage?: string;
}): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata('read-model', options, target);
    return target;
  };
}

/**
 * Projection decorator
 */
export function Projection(eventType: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata = Reflect.getMetadata('projections', target) || [];
    metadata.push({ eventType, method: propertyKey, descriptor });
    Reflect.defineMetadata('projections', metadata, target);
  };
}