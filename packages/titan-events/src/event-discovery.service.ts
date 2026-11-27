/**
 * Event Discovery Service
 *
 * Discovers and registers event handlers from decorated classes
 */

import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { Container, LifecycleEvent } from '@omnitron-dev/titan/nexus';
import { Inject, Injectable, Optional } from '@omnitron-dev/titan/decorators';

import { EventMetadataService } from './event-metadata.service.js';
import { EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN, LOGGER_TOKEN } from './tokens.js';

import type { ILogger } from '@omnitron-dev/titan/module/logger';

import type { IEventHandlerMetadata, IEventDiscoveryResult, IEventListenerOptions } from './types.js';

/**
 * Metadata keys for event decorators
 */
export const EVENT_HANDLER_METADATA = Symbol.for('event:handler');
export const EVENT_BATCH_METADATA = Symbol.for('event:batch');
export const EVENT_ONCE_METADATA = Symbol.for('event:once');
export const EVENT_EMITTER_METADATA = Symbol.for('event:emitter');

/**
 * Service for discovering and registering event handlers
 */
@Injectable()
export class EventDiscoveryService {
  private discoveredHandlers: Map<string, IEventHandlerMetadata[]> = new Map();
  private registeredHandlers = new Map<any, Map<string, { event: string; detach: () => void }>>();
  private initialized = false;
  private readonly onContainerInitialized = () => { this.discoverAndRegister(); };
  private destroyed = false;
  private logger: ILogger | null = null;

  constructor(
    // Container is marked @Optional() so the events module can still
    // initialize when the DI Container token isn't in scope (test harnesses
    // or unusual spawn configurations). Discovery degrades to a no-op when
    // absent — listeners registered manually via EventBus still work.
    @Optional() @Inject(Container) private readonly container: Container | null,
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter,
    @Inject(EVENT_METADATA_SERVICE_TOKEN) private readonly metadataService: EventMetadataService,
    @Optional() @Inject(LOGGER_TOKEN) logger?: ILogger | null
  ) {
    this.logger = logger ?? null;
  }

  /**
   * Initialize the service
   */
  async onInit(): Promise<void> {
    if (this.initialized) return;
    this.discoverAndRegister();
    this.container?.on(LifecycleEvent.ContainerInitialized, this.onContainerInitialized);
    this.initialized = true;
    this.destroyed = false;
    this.logger?.info('EventDiscoveryService initialized');
  }

  /**
   * Discover event handlers in a class
   */
  discoverHandlers(target: any): IEventHandlerMetadata[] {
    const handlers: IEventHandlerMetadata[] = [];
    const prototype = typeof target === 'function' ? target.prototype : target;

    const methodNames = this.getAllPropertyNames(prototype);

    for (const methodName of methodNames) {
      // Check for event handler metadata
      const handlerMetadata =
        Reflect.getMetadata(EVENT_HANDLER_METADATA, prototype, methodName) ||
        Reflect.getMetadata('event:handler', prototype, methodName);

      if (handlerMetadata) {
        handlers.push({
          method: methodName,
          event: handlerMetadata.event || methodName,
          options: handlerMetadata.options || {},
          target,
        });
      }

      const batch = Reflect.getMetadata(EVENT_BATCH_METADATA, prototype, methodName)?.options;
      if (batch) handlers.push({
        method: methodName, event: batch.event, target,
        batch: { maxSize: batch.maxSize, maxWait: batch.maxWait },
      });

      // Check for once handler metadata
      const onceMetadata =
        Reflect.getMetadata(EVENT_ONCE_METADATA, prototype, methodName) ||
        Reflect.getMetadata('event:once', prototype, methodName);

      if (onceMetadata) {
        handlers.push({
          method: methodName,
          event: onceMetadata.event || methodName,
          options: { ...onceMetadata.options, once: true },
          target,
          once: true,
        });
      }
    }

    return handlers;
  }

  /**
   * Discover event emitters in a class
   */
  discoverEmitters(target: any): Array<{ methodName: string; events: string[] }> {
    const emitters: Array<{ methodName: string; events: string[] }> = [];
    const prototype = typeof target === 'function' ? target.prototype : target;

    const methodNames = this.getAllPropertyNames(prototype);

    for (const methodName of methodNames) {
      // Check for event emitter metadata
      const emitterMetadata =
        Reflect.getMetadata(EVENT_EMITTER_METADATA, prototype, methodName) ||
        Reflect.getMetadata('event:emitter', prototype, methodName);

      if (emitterMetadata) {
        emitters.push({
          methodName,
          events: emitterMetadata.events || (emitterMetadata.event ? [emitterMetadata.event] : []),
        });
      }
    }

    return emitters;
  }

  /**
   * Scan a module for event providers
   */
  async scanModule(module: any): Promise<IEventDiscoveryResult> {
    const result: IEventDiscoveryResult = {
      handlers: [],
      emitters: [],
      dependencies: new Map(),
      stats: {
        totalHandlers: 0,
        totalEmitters: 0,
        totalEvents: 0,
        wildcardHandlers: 0,
      },
    };

    // Get module metadata
    const moduleMetadata = Reflect.getMetadata('nexus:module', module) || {};
    const providers = moduleMetadata.providers || [];

    for (const provider of providers) {
      const target = typeof provider === 'function' ? provider : provider.useClass;

      if (target) {
        // Discover handlers
        const handlers = this.discoverHandlers(target);
        result.handlers.push(...handlers);

        // Discover emitters
        const emitters = this.discoverEmitters(target);
        for (const emitter of emitters) {
          for (const event of emitter.events) {
            result.emitters.push({
              class: target.name,
              method: emitter.methodName,
              event,
            });
          }
        }
      }
    }

    // Update stats
    result.stats.totalHandlers = result.handlers.length;
    result.stats.totalEmitters = result.emitters.length;
    result.stats.totalEvents = new Set([
      ...result.handlers.map((h) => h.event),
      ...result.emitters.map((e) => e.event),
    ]).size;
    result.stats.wildcardHandlers = result.handlers.filter((h) => h.event.includes('*')).length;

    return result;
  }

  /**
   * Destroy the service
   */
  async onDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.initialized = false;

    this.container?.off(LifecycleEvent.ContainerInitialized, this.onContainerInitialized);
    // Unregister all handlers
    this.unregisterAllHandlers();
    this.discoveredHandlers.clear();

    this.logger?.info('EventDiscoveryService destroyed');
  }

  /**
   * Get health status
   */
  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: any }> {
    const totalHandlers = Array.from(this.discoveredHandlers.values()).reduce(
      (acc, handlers) => acc + handlers.length,
      0
    );
    const totalRegistered = Array.from(this.registeredHandlers.values()).reduce(
      (acc, handlerMap) => acc + handlerMap.size,
      0
    );

    return {
      status: this.initialized && !this.destroyed ? 'healthy' : 'unhealthy',
      details: {
        initialized: this.initialized,
        destroyed: this.destroyed,
        discoveredEvents: this.discoveredHandlers.size,
        totalHandlers,
        registeredTargets: this.registeredHandlers.size,
        totalRegistered,
      },
    };
  }

  /**
   * Discover all event handlers in the application
   */
  async discoverAllHandlers(): Promise<IEventDiscoveryResult> {
    return this.discoverAndRegister();
  }

  private discoverAndRegister(): IEventDiscoveryResult {
    const handlers: IEventHandlerMetadata[] = [];
    const emitters: Array<{ class: string; method: string; event: string }> = [];
    const dependencies = new Map<string, string[]>();

    // Get all registered providers from container
    const providers = this.getAllProviders();

    this.discoveredHandlers.clear();
    for (const provider of providers) {
      if (!provider || typeof provider !== 'object') continue;
      for (const handler of this.discoverHandlers(provider)) {
        handler.priority = handler.options?.priority;
        handlers.push(handler);
        this.addHandlerToMap(handler.event, handler);
      }
      for (const item of this.discoverEmitters(provider)) {
        for (const event of item.events) emitters.push({ class: provider.constructor.name, method: item.methodName, event });
      }
    }
    for (const { event } of emitters) {
      const targets = this.getHandlersForEvent(event).map(handler => handler.target.constructor.name as string);
      dependencies.set(event, [...new Set(targets)]);
    }

    // Sort handlers by priority
    handlers.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Register all discovered handlers
    for (const handler of handlers) this.attachHandler(handler);

    // Calculate statistics
    const stats = {
      totalHandlers: handlers.length,
      totalEmitters: emitters.length,
      totalEvents: new Set([...handlers.map((h) => h.event), ...emitters.map((e) => e.event)]).size,
      wildcardHandlers: handlers.filter((h) => h.event.includes('*') || h.event.includes('**')).length,
    };

    return {
      handlers,
      emitters,
      dependencies,
      stats,
    };
  }

  /**
   * Register a single event handler
   */
  async registerHandler(metadata: IEventHandlerMetadata): Promise<void> {
    this.attachHandler(metadata);
  }

  private attachHandler(metadata: IEventHandlerMetadata): void {
    const { target, method, event, options, once } = metadata;

    const registrations = this.registeredHandlers.get(target) ?? new Map();
    const key = JSON.stringify([event, method, metadata.batch ? 'batch' : once ? 'once' : 'on']);
    if (registrations.has(key)) return;
    const handler = this.createHandler(target, method, options ?? (metadata.batch ? { errorHandling: 'log' } : undefined));
    let detach: () => void;
    if (metadata.batch) {
      detach = this.emitter.subscribeBatch(event, metadata.batch, items => { void handler(items, { event }); });
    } else if (once) {
      detach = this.emitter.subscribe(event, handler, true);
    } else {
      detach = this.emitter.subscribeEnhanced(event, handler, this.convertToListenerOptions(options));
    }
    registrations.set(key, { event, detach });
    this.registeredHandlers.set(target, registrations);
  }

  /**
   * Register all discovered handlers
   */
  async registerAllHandlers(handlers: IEventHandlerMetadata[]): Promise<void> {
    for (const handler of handlers) {
      await this.registerHandler(handler);
    }
  }

  /**
   * Unregister handlers for a specific target
   */
  unregisterHandlers(target: any): void {
    const handlers = this.registeredHandlers.get(target);
    if (!handlers) return;

    for (const registration of handlers.values()) registration.detach();

    this.registeredHandlers.delete(target);
  }

  /**
   * Unregister all handlers
   */
  unregisterAllHandlers(): void {
    for (const target of this.registeredHandlers.keys()) this.unregisterHandlers(target);
  }

  /**
   * Get handlers for a specific event
   */
  getHandlersForEvent(event: string): IEventHandlerMetadata[] {
    return this.discoveredHandlers.get(event) || [];
  }

  /**
   * Get all discovered handlers
   */
  getAllHandlers(): Map<string, IEventHandlerMetadata[]> {
    return this.discoveredHandlers;
  }

  /**
   * Check if a handler is registered
   */
  isHandlerRegistered(target: any, event: string): boolean {
    const handlers = this.registeredHandlers.get(target);
    return handlers ? [...handlers.values()].some(registration => registration.event === event) : false;
  }

  /**
   * Convert EventListenerOptions to ListenerOptions
   */
  private convertToListenerOptions(options?: IEventListenerOptions): any {
    if (!options) return undefined;

    const listenerOptions: any = {
      priority: options.priority,
      errorBoundary: options.errorBoundary,
      onError: options.onError,
      timeout: options.timeout,
    };

    // Convert retry options if present
    if (options.retry) {
      listenerOptions.retry = {
        maxAttempts: options.retry.attempts,
        delay: options.retry.delay,
        backoff: typeof options.retry.backoff === 'number' ? 'exponential' : undefined,
        factor: typeof options.retry.backoff === 'number' ? options.retry.backoff : undefined,
      };
    }

    return listenerOptions;
  }

  /**
   * Create a wrapped handler function
   */
  private createHandler(target: any, method: string, options?: IEventListenerOptions): (...args: any[]) => any {
    const originalMethod = target[method];

    return async (data: any, metadata: any): Promise<any> => {
      try {
        // Apply filter if specified
        if (options?.filter && !options.filter(data, metadata)) {
          return undefined;
        }

        // Apply transformation if specified
        if (options?.transform) {
          data = options.transform(data);
        }

        // Create context for handler
        const context = {
          event: metadata?.event,
          metadata,
          target,
          method,
        };

        // Call handler with proper context
        const result = await originalMethod.call(target, data, metadata, context);

        return result;
      } catch (error) {
        // Handle error based on options
        if (options?.onError) {
          options.onError(error as Error, data, metadata);
        } else if (options?.errorHandling === 'throw') {
          throw error;
        } else if (options?.errorHandling === 'log') {
          this.logger?.error(`Error in event handler ${target.constructor.name}.${method}:`, error);
        }
        // 'ignore' does nothing
        return undefined;
      }
    };
  }

  getAllProviders(): unknown[] {
    return [...new Set(this.container?.iterateResolvedInstances() ?? [])];
  }

  /**
   * Get all property names from prototype chain
   */
  getAllPropertyNames(obj: any): string[] {
    const props: Set<string> = new Set();

    do {
      Object.getOwnPropertyNames(obj).forEach((prop) => props.add(prop));
      obj = Object.getPrototypeOf(obj);
    } while (obj && obj !== Object.prototype);

    return Array.from(props);
  }

  /**
   * Add handler to discovery map
   */
  private addHandlerToMap(event: string, metadata: IEventHandlerMetadata): void {
    if (!this.discoveredHandlers.has(event)) {
      this.discoveredHandlers.set(event, []);
    }
    this.discoveredHandlers.get(event)!.push(metadata);
  }
}
