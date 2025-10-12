/**
 * CQRS (Command Query Responsibility Segregation) Implementation
 *
 * Separates read and write models with automatic synchronization
 * and event-driven updates.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Errors } from '../../../errors/index.js';
import type { ILogger } from '../../logger/logger.types.js';

/**
 * Command interface
 */
export interface ICommand {
  id: string;
  aggregateId: string;
  type: string;
  payload: any;
  metadata?: ICommandMetadata;
  timestamp: number;
}

/**
 * Command metadata
 */
export interface ICommandMetadata {
  userId?: string;
  tenantId?: string;
  correlationId?: string;
  causationId?: string;
  ipAddress?: string;
}

/**
 * Query interface
 */
export interface IQuery {
  id: string;
  type: string;
  parameters: any;
  projection?: string;
  metadata?: IQueryMetadata;
}

/**
 * Query metadata
 */
export interface IQueryMetadata {
  userId?: string;
  tenantId?: string;
  cacheKey?: string;
  ttl?: number;
}

/**
 * Command handler interface
 */
export interface ICommandHandler<T = any> {
  commandType: string;
  handle(command: ICommand): Promise<T>;
}

/**
 * Query handler interface
 */
export interface IQueryHandler<T = any> {
  queryType: string;
  handle(query: IQuery): Promise<T>;
}

/**
 * Event interface
 */
export interface IDomainEvent {
  id: string;
  aggregateId: string;
  type: string;
  payload: any;
  version: number;
  timestamp: number;
  metadata?: IEventMetadata;
}

/**
 * Event metadata
 */
export interface IEventMetadata {
  userId?: string;
  tenantId?: string;
  correlationId?: string;
  causationId?: string;
}

/**
 * Aggregate root interface
 */
export interface IAggregateRoot {
  id: string;
  version: number;
  getUncommittedEvents(): IDomainEvent[];
  markEventsAsCommitted(): void;
  loadFromHistory(events: IDomainEvent[]): void;
}

/**
 * Read model interface
 */
export interface IReadModel {
  id: string;
  lastEventId?: string;
  lastUpdated: number;
}

/**
 * Projection interface
 */
export interface IProjection {
  name: string;
  handle(event: IDomainEvent): Promise<void>;
  getPosition(): Promise<string | null>;
  setPosition(eventId: string): Promise<void>;
}

/**
 * CQRS configuration
 */
export interface ICQRSConfig {
  eventStore?: IEventStore;
  snapshotStore?: ISnapshotStore;
  readModelStore?: IReadModelStore;
  commandTimeout?: number;
  queryTimeout?: number;
  enableSnapshots?: boolean;
  snapshotFrequency?: number;
}

/**
 * Event store interface
 */
export interface IEventStore {
  saveEvents(events: IDomainEvent[]): Promise<void>;
  getEvents(aggregateId: string, fromVersion?: number): Promise<IDomainEvent[]>;
  getAllEvents(fromPosition?: string): AsyncIterable<IDomainEvent>;
}

/**
 * Snapshot store interface
 */
export interface ISnapshotStore {
  save(aggregateId: string, snapshot: any, version: number): Promise<void>;
  get(aggregateId: string): Promise<{ snapshot: any; version: number } | null>;
}

/**
 * Read model store interface
 */
export interface IReadModelStore {
  save(model: IReadModel): Promise<void>;
  get(id: string): Promise<IReadModel | null>;
  query(criteria: any): Promise<IReadModel[]>;
}

/**
 * CQRS Command Bus
 */
export class CommandBus extends EventEmitter {
  private handlers = new Map<string, ICommandHandler>();
  private middleware: Array<(command: ICommand) => Promise<void>> = [];

  constructor(
    private readonly logger: ILogger,
    private readonly config: ICQRSConfig = {}
  ) {
    super();
  }

  /**
   * Register a command handler
   */
  register(handler: ICommandHandler): void {
    this.handlers.set(handler.commandType, handler);
    this.logger.debug({ commandType: handler.commandType }, 'Command handler registered');
  }

  /**
   * Add middleware
   */
  use(middleware: (command: ICommand) => Promise<void>): void {
    this.middleware.push(middleware);
  }

  /**
   * Send a command
   */
  async send<T = any>(command: ICommand): Promise<T> {
    // Run middleware
    for (const mw of this.middleware) {
      await mw(command);
    }

    // Find handler
    const handler = this.handlers.get(command.type);
    if (!handler) {
      throw Errors.notFound(`No handler registered for command type: ${command.type}`);
    }

    // Execute command
    this.emit('command:executing', command);

    try {
      const result = await this.withTimeout(handler.handle(command), this.config.commandTimeout || 30000);

      this.emit('command:executed', command, result);
      return result;
    } catch (error) {
      this.emit('command:failed', command, error);
      throw error;
    }
  }

  /**
   * Execute with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(Errors.timeout('CQRS command', timeout)), timeout)),
    ]);
  }
}

/**
 * CQRS Query Bus
 */
export class QueryBus extends EventEmitter {
  private handlers = new Map<string, IQueryHandler>();
  private cache = new Map<string, { result: any; expiry: number }>();

  constructor(
    private readonly logger: ILogger,
    private readonly config: ICQRSConfig = {}
  ) {
    super();
  }

  /**
   * Register a query handler
   */
  register(handler: IQueryHandler): void {
    this.handlers.set(handler.queryType, handler);
    this.logger.debug({ queryType: handler.queryType }, 'Query handler registered');
  }

  /**
   * Execute a query
   */
  async execute<T = any>(query: IQuery): Promise<T> {
    // Check cache
    if (query.metadata?.cacheKey) {
      const cached = this.cache.get(query.metadata.cacheKey);
      if (cached && cached.expiry > Date.now()) {
        this.emit('query:cache-hit', query);
        return cached.result;
      }
    }

    // Find handler
    const handler = this.handlers.get(query.type);
    if (!handler) {
      throw Errors.notFound(`No handler registered for query type: ${query.type}`);
    }

    // Execute query
    this.emit('query:executing', query);

    try {
      const result = await this.withTimeout(handler.handle(query), this.config.queryTimeout || 5000);

      // Cache result
      if (query.metadata?.cacheKey && query.metadata?.ttl) {
        this.cache.set(query.metadata.cacheKey, {
          result,
          expiry: Date.now() + query.metadata.ttl,
        });
      }

      this.emit('query:executed', query, result);
      return result;
    } catch (error) {
      this.emit('query:failed', query, error);
      throw error;
    }
  }

  /**
   * Clear cache
   */
  clearCache(pattern?: string): void {
    if (pattern) {
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Execute with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(Errors.timeout('CQRS query', timeout)), timeout)),
    ]);
  }
}

/**
 * Abstract Aggregate Root
 */
export abstract class AggregateRoot implements IAggregateRoot {
  protected _id: string;
  protected _version: number = 0;
  private _uncommittedEvents: IDomainEvent[] = [];

  constructor(id?: string) {
    this._id = id || uuidv4();
  }

  get id(): string {
    return this._id;
  }

  get version(): number {
    return this._version;
  }

  /**
   * Apply an event
   */
  protected applyEvent(eventType: string, payload: any, metadata?: IEventMetadata): void {
    const event: IDomainEvent = {
      id: uuidv4(),
      aggregateId: this._id,
      type: eventType,
      payload,
      version: ++this._version,
      timestamp: Date.now(),
      metadata,
    };

    this._uncommittedEvents.push(event);
    this.apply(event);
  }

  /**
   * Apply event to state (to be implemented by subclasses)
   */
  protected abstract apply(event: IDomainEvent): void;

  /**
   * Get uncommitted events
   */
  getUncommittedEvents(): IDomainEvent[] {
    return this._uncommittedEvents;
  }

  /**
   * Mark events as committed
   */
  markEventsAsCommitted(): void {
    this._uncommittedEvents = [];
  }

  /**
   * Load from event history
   */
  loadFromHistory(events: IDomainEvent[]): void {
    for (const event of events) {
      this._version = event.version;
      this.apply(event);
    }
  }
}

/**
 * Projection manager
 */
export class ProjectionManager extends EventEmitter {
  private projections = new Map<string, IProjection>();
  private running = false;

  constructor(
    private readonly logger: ILogger,
    private readonly eventStore: IEventStore
  ) {
    super();
  }

  /**
   * Register a projection
   */
  register(projection: IProjection): void {
    this.projections.set(projection.name, projection);
    this.logger.debug({ projection: projection.name }, 'Projection registered');
  }

  /**
   * Start projections
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.logger.info('Starting projections');

    // Start processing events for each projection
    for (const [name, projection] of this.projections) {
      this.processProjection(projection).catch((error) => {
        this.logger.error({ error, projection: name }, 'Projection failed');
      });
    }
  }

  /**
   * Stop projections
   */
  stop(): void {
    this.running = false;
    this.logger.info('Stopping projections');
  }

  /**
   * Process events for a projection
   */
  private async processProjection(projection: IProjection): Promise<void> {
    const position = await projection.getPosition();

    for await (const event of this.eventStore.getAllEvents(position || undefined)) {
      if (!this.running) break;

      try {
        await projection.handle(event);
        await projection.setPosition(event.id);

        this.emit('projection:processed', projection.name, event);
      } catch (error) {
        this.logger.error({ error, projection: projection.name, event }, 'Failed to process event in projection');

        // Optionally retry or continue
        this.emit('projection:error', projection.name, event, error);
      }
    }
  }
}

/**
 * In-memory event store (for testing)
 */
export class InMemoryEventStore implements IEventStore {
  private events: IDomainEvent[] = [];

  async saveEvents(events: IDomainEvent[]): Promise<void> {
    this.events.push(...events);
  }

  async getEvents(aggregateId: string, fromVersion: number = 0): Promise<IDomainEvent[]> {
    return this.events.filter((e) => e.aggregateId === aggregateId && e.version > fromVersion);
  }

  async *getAllEvents(fromPosition?: string): AsyncIterable<IDomainEvent> {
    let startIndex = 0;

    if (fromPosition) {
      const index = this.events.findIndex((e) => e.id === fromPosition);
      if (index >= 0) {
        startIndex = index + 1;
      }
    }

    for (let i = startIndex; i < this.events.length; i++) {
      const event = this.events[i];
      if (event) {
        yield event;
      }
    }
  }
}

/**
 * In-memory snapshot store (for testing)
 */
export class InMemorySnapshotStore implements ISnapshotStore {
  private snapshots = new Map<string, { snapshot: any; version: number }>();

  async save(aggregateId: string, snapshot: any, version: number): Promise<void> {
    this.snapshots.set(aggregateId, { snapshot, version });
  }

  async get(aggregateId: string): Promise<{ snapshot: any; version: number } | null> {
    return this.snapshots.get(aggregateId) || null;
  }
}

/**
 * In-memory read model store (for testing)
 */
export class InMemoryReadModelStore implements IReadModelStore {
  private models = new Map<string, IReadModel>();

  async save(model: IReadModel): Promise<void> {
    this.models.set(model.id, model);
  }

  async get(id: string): Promise<IReadModel | null> {
    return this.models.get(id) || null;
  }

  async query(criteria: any): Promise<IReadModel[]> {
    // Simple implementation - in production would use proper query engine
    const results: IReadModel[] = [];

    for (const model of this.models.values()) {
      let matches = true;

      for (const [key, value] of Object.entries(criteria)) {
        if ((model as any)[key] !== value) {
          matches = false;
          break;
        }
      }

      if (matches) {
        results.push(model);
      }
    }

    return results;
  }
}

/**
 * Command decorator for marking command handlers
 */
export function Command(type: string): ClassDecorator {
  return (target: any) => {
    target.prototype.commandType = type;
    return target;
  };
}

/**
 * Query decorator for marking query handlers
 */
export function Query(type: string): ClassDecorator {
  return (target: any) => {
    target.prototype.queryType = type;
    return target;
  };
}
