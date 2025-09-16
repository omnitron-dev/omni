/**
 * Event Discovery Service
 * 
 * Discovers and registers event handlers from decorated classes
 */

import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Container, Injectable } from '@omnitron-dev/nexus';

import { EventMetadataService } from './event-metadata.service';
import { EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN } from './events.module';

import type {
  EventHandlerMetadata,
  EventDiscoveryResult,
  EventListenerOptions
} from './types';

/**
 * Metadata keys for event decorators
 */
export const EVENT_HANDLER_METADATA = Symbol('event:handler');
export const EVENT_ONCE_METADATA = Symbol('event:once');
export const EVENT_EMITTER_METADATA = Symbol('event:emitter');

/**
 * Service for discovering and registering event handlers
 */
@Injectable()
export class EventDiscoveryService {
  private discoveredHandlers: Map<string, EventHandlerMetadata[]> = new Map();
  private registeredHandlers: Map<any, Map<string, Function>> = new Map();

  constructor(
    @Inject(Container) private readonly container: Container,
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter,
    @Inject(EVENT_METADATA_SERVICE_TOKEN) private readonly metadataService: EventMetadataService
  ) { }

  /**
   * Discover all event handlers in the application
   */
  async discoverHandlers(): Promise<EventDiscoveryResult> {
    const handlers: EventHandlerMetadata[] = [];
    const emitters: Array<{ class: string; method: string; event: string }> = [];
    const dependencies = new Map<string, string[]>();

    // Get all registered providers from container
    const providers = this.getAllProviders();

    for (const provider of providers) {
      if (!provider || typeof provider !== 'object') continue;

      const prototype = Object.getPrototypeOf(provider);
      if (!prototype) continue;

      // Check for event handler methods
      const propertyNames = this.getAllPropertyNames(prototype);

      for (const propertyName of propertyNames) {
        if (typeof prototype[propertyName] !== 'function') continue;

        // Check for @OnEvent decorator metadata
        const handlerMetadata = Reflect.getMetadata(
          EVENT_HANDLER_METADATA,
          prototype,
          propertyName
        );

        if (handlerMetadata) {
          const metadata: EventHandlerMetadata = {
            event: handlerMetadata.event,
            method: propertyName,
            target: provider,
            options: handlerMetadata.options,
            once: false,
            priority: handlerMetadata.options?.priority
          };

          handlers.push(metadata);
          this.addHandlerToMap(handlerMetadata.event, metadata);
        }

        // Check for @OnceEvent decorator metadata
        const onceMetadata = Reflect.getMetadata(
          EVENT_ONCE_METADATA,
          prototype,
          propertyName
        );

        if (onceMetadata) {
          const metadata: EventHandlerMetadata = {
            event: onceMetadata.event,
            method: propertyName,
            target: provider,
            options: onceMetadata.options,
            once: true,
            priority: onceMetadata.options?.priority
          };

          handlers.push(metadata);
          this.addHandlerToMap(onceMetadata.event, metadata);
        }

        // Check for @EmitEvent decorator metadata
        const emitterMetadata = Reflect.getMetadata(
          EVENT_EMITTER_METADATA,
          prototype,
          propertyName
        );

        if (emitterMetadata) {
          emitters.push({
            class: provider.constructor.name,
            method: propertyName,
            event: emitterMetadata.event
          });

          // Track dependencies
          const deps = dependencies.get(emitterMetadata.event) || [];
          handlers
            .filter(h => h.event === emitterMetadata.event)
            .forEach(h => {
              if (!deps.includes(h.target.constructor.name)) {
                deps.push(h.target.constructor.name);
              }
            });
          dependencies.set(emitterMetadata.event, deps);
        }
      }
    }

    // Sort handlers by priority
    handlers.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Register all discovered handlers
    await this.registerAllHandlers(handlers);

    // Calculate statistics
    const stats = {
      totalHandlers: handlers.length,
      totalEmitters: emitters.length,
      totalEvents: new Set([...handlers.map(h => h.event), ...emitters.map(e => e.event)]).size,
      wildcardHandlers: handlers.filter(h => h.event.includes('*') || h.event.includes('**')).length
    };

    return {
      handlers,
      emitters,
      dependencies,
      stats
    };
  }

  /**
   * Register a single event handler
   */
  async registerHandler(metadata: EventHandlerMetadata): Promise<void> {
    const { target, method, event, options, once } = metadata;

    // Create bound handler
    const handler = this.createHandler(target, method, options);

    // Store reference for cleanup
    if (!this.registeredHandlers.has(target)) {
      this.registeredHandlers.set(target, new Map());
    }
    this.registeredHandlers.get(target)!.set(event, handler);

    // Register with emitter
    if (once) {
      this.emitter.once(event, handler);
    } else {
      // Convert EventListenerOptions to ListenerOptions
      const listenerOptions = this.convertToListenerOptions(options);
      this.emitter.onEnhanced(event, handler, listenerOptions);
    }
  }

  /**
   * Register all discovered handlers
   */
  async registerAllHandlers(handlers: EventHandlerMetadata[]): Promise<void> {
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

    for (const [event, handler] of handlers.entries()) {
      this.emitter.off(event, handler);
    }

    this.registeredHandlers.delete(target);
  }

  /**
   * Unregister all handlers
   */
  unregisterAllHandlers(): void {
    for (const [target, handlers] of this.registeredHandlers.entries()) {
      for (const [event, handler] of handlers.entries()) {
        this.emitter.off(event, handler);
      }
    }

    this.registeredHandlers.clear();
  }

  /**
   * Get handlers for a specific event
   */
  getHandlersForEvent(event: string): EventHandlerMetadata[] {
    return this.discoveredHandlers.get(event) || [];
  }

  /**
   * Get all discovered handlers
   */
  getAllHandlers(): Map<string, EventHandlerMetadata[]> {
    return this.discoveredHandlers;
  }

  /**
   * Check if a handler is registered
   */
  isHandlerRegistered(target: any, event: string): boolean {
    const handlers = this.registeredHandlers.get(target);
    return handlers ? handlers.has(event) : false;
  }

  /**
   * Convert EventListenerOptions to ListenerOptions
   */
  private convertToListenerOptions(options?: EventListenerOptions): any {
    if (!options) return undefined;

    const listenerOptions: any = {
      priority: options.priority,
      errorBoundary: options.errorBoundary,
      onError: options.onError,
      timeout: options.timeout
    };

    // Convert retry options if present
    if (options.retry) {
      listenerOptions.retry = {
        maxAttempts: options.retry.attempts,
        delay: options.retry.delay,
        backoff: typeof options.retry.backoff === 'number' ? 'exponential' : undefined,
        factor: typeof options.retry.backoff === 'number' ? options.retry.backoff : undefined
      };
    }

    return listenerOptions;
  }

  /**
   * Create a wrapped handler function
   */
  private createHandler(
    target: any,
    method: string,
    options?: EventListenerOptions
  ): Function {
    const originalMethod = target[method];

    return async (data: any, metadata: any) => {
      try {
        // Apply filter if specified
        if (options?.filter && !options.filter(data, metadata)) {
          return;
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
          method
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
          console.error(`Error in event handler ${target.constructor.name}.${method}:`, error);
        }
        // 'ignore' does nothing
      }
    };
  }

  /**
   * Get all providers from container
   */
  private getAllProviders(): any[] {
    // This would need to be implemented based on actual Container API
    // For now, return empty array
    return [];
  }

  /**
   * Get all property names from prototype chain
   */
  private getAllPropertyNames(obj: any): string[] {
    const props: Set<string> = new Set();

    do {
      Object.getOwnPropertyNames(obj).forEach(prop => props.add(prop));
      obj = Object.getPrototypeOf(obj);
    } while (obj && obj !== Object.prototype);

    return Array.from(props);
  }

  /**
   * Add handler to discovery map
   */
  private addHandlerToMap(event: string, metadata: EventHandlerMetadata): void {
    if (!this.discoveredHandlers.has(event)) {
      this.discoveredHandlers.set(event, []);
    }
    this.discoveredHandlers.get(event)!.push(metadata);
  }
}