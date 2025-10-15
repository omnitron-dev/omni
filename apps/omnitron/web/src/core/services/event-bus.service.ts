/**
 * Core Module - Event Bus Service
 *
 * Application-wide event bus for cross-module communication
 */

import { Injectable, inject } from '@omnitron-dev/aether/di';
import { EventEmitter } from '@omnitron-dev/eventemitter';

/**
 * Event handler function type
 */
export type EventHandler<T = any> = (data: T) => void | Promise<void>;

/**
 * Event Bus Service
 *
 * Provides a centralized event bus for cross-module communication.
 * Built on top of the Omnitron EventEmitter for reliable event handling.
 *
 * @example
 * ```typescript
 * const eventBus = inject(EventBusService);
 *
 * // Subscribe to events
 * eventBus.on('user:login', (data) => {
 *   console.log('User logged in:', data);
 * });
 *
 * // Emit events
 * eventBus.emit('user:login', { userId: '123', username: 'john' });
 *
 * // Subscribe once
 * eventBus.once('app:ready', () => {
 *   console.log('App is ready!');
 * });
 *
 * // Unsubscribe
 * const unsubscribe = eventBus.on('data:updated', handler);
 * unsubscribe(); // Stop listening
 * ```
 */
@Injectable({ scope: 'singleton', providedIn: 'root' })
export class EventBusService {
  private emitter: EventEmitter;
  private eventLog: Array<{ event: string; data: any; timestamp: number }> = [];
  private maxLogSize = 100;

  constructor() {
    this.emitter = new EventEmitter();

    // Enable event logging in development
    if (import.meta.env.DEV) {
      this.enableLogging();
    }
  }

  /**
   * Subscribe to an event
   *
   * @param event - Event name
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  on<T = any>(event: string, handler: EventHandler<T>): () => void {
    this.emitter.on(event, handler);

    // Return unsubscribe function
    return () => {
      this.emitter.off(event, handler);
    };
  }

  /**
   * Subscribe to an event once
   *
   * @param event - Event name
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  once<T = any>(event: string, handler: EventHandler<T>): () => void {
    this.emitter.once(event, handler);

    // Return unsubscribe function (even though it's once, allow manual removal)
    return () => {
      this.emitter.off(event, handler);
    };
  }

  /**
   * Unsubscribe from an event
   *
   * @param event - Event name
   * @param handler - Event handler function
   */
  off<T = any>(event: string, handler: EventHandler<T>): void {
    this.emitter.off(event, handler);
  }

  /**
   * Emit an event
   *
   * @param event - Event name
   * @param data - Event data
   */
  emit<T = any>(event: string, data?: T): void {
    this.emitter.emit(event, data);

    // Log event in development
    if (import.meta.env.DEV) {
      this.logEvent(event, data);
    }
  }

  /**
   * Emit an event asynchronously (wait for all handlers to complete)
   *
   * @param event - Event name
   * @param data - Event data
   * @returns Promise that resolves when all handlers complete
   */
  async emitAsync<T = any>(event: string, data?: T): Promise<void> {
    await this.emitter.emitAsync(event, data);

    // Log event in development
    if (import.meta.env.DEV) {
      this.logEvent(event, data);
    }
  }

  /**
   * Remove all listeners for an event
   *
   * @param event - Event name (optional, removes all listeners if not provided)
   */
  removeAllListeners(event?: string): void {
    this.emitter.removeAllListeners(event);
  }

  /**
   * Get listener count for an event
   *
   * @param event - Event name
   * @returns Number of listeners
   */
  listenerCount(event: string): number {
    return this.emitter.listenerCount(event);
  }

  /**
   * Get all event names with listeners
   *
   * @returns Array of event names
   */
  eventNames(): string[] {
    return this.emitter.eventNames();
  }

  /**
   * Enable event logging (for debugging)
   */
  private enableLogging(): void {
    // This method can be extended to add more sophisticated logging
  }

  /**
   * Log an event (for debugging)
   */
  private logEvent(event: string, data: any): void {
    this.eventLog.push({
      event,
      data,
      timestamp: Date.now(),
    });

    // Keep log size under control
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }
  }

  /**
   * Get event log (for debugging)
   *
   * @returns Event log
   */
  getEventLog(): Array<{ event: string; data: any; timestamp: number }> {
    return [...this.eventLog];
  }

  /**
   * Clear event log
   */
  clearEventLog(): void {
    this.eventLog = [];
  }
}
