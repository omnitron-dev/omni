/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { pLimit, type Limit } from '@omnitron-dev/common';

// Type for event listener
type EventListener = {
  fn: Function;
  context: any;
  once: boolean;
};

// EventEmitter implementation that works in Node, Bun, and browser
// Combines both synchronous and asynchronous event emission capabilities
export class EventEmitter {
  private _events: Map<string | symbol, EventListener | EventListener[]> = new Map();
  private _eventsCount: number = 0;
  private onceListeners = new WeakMap<Function, Function>(); // Map to store listeners that should only be called once
  private limiter?: Limit; // Optional limiter for controlling concurrency

  constructor(concurrency?: number) {
    // Set concurrency if a valid number is provided
    if (concurrency && concurrency >= 1) {
      this.setConcurrency(concurrency);
    }
  }

  /**
   * Return an array listing the events for which the emitter has registered listeners
   */
  eventNames(): Array<string | symbol> {
    return Array.from(this._events.keys());
  }

  /**
   * Return the listeners registered for a given event
   */
  listeners(event: string | symbol): Function[] {
    const handlers = this._events.get(event);

    if (!handlers) return [];

    if (!Array.isArray(handlers)) {
      return [handlers.fn];
    }

    return handlers.map((h) => h.fn);
  }

  /**
   * Return the number of listeners listening to a given event
   */
  listenerCount(event: string | symbol): number {
    const handlers = this._events.get(event);

    if (!handlers) return 0;
    if (!Array.isArray(handlers)) return 1;
    return handlers.length;
  }

  /**
   * Calls each of the listeners registered for a given event (synchronous)
   */
  emit(event: string | symbol, ...args: any[]): boolean {
    const handlers = this._events.get(event);

    if (!handlers) return false;

    if (!Array.isArray(handlers)) {
      // Single handler
      if (handlers.once) {
        this.removeListener(event, handlers.fn);
      }
      handlers.fn.apply(handlers.context, args);
    } else {
      // Multiple handlers - iterate over a copy to handle removal during emit
      const handlersCopy = handlers.slice();
      for (let i = 0; i < handlersCopy.length; i++) {
        const handler = handlersCopy[i];
        if (handler && handler.once) {
          this.removeListener(event, handler.fn);
        }
        if (handler) {
          handler.fn.apply(handler.context, args);
        }
      }
    }

    return true;
  }

  /**
   * Add a listener for a given event
   */
  on(event: string | symbol, fn: Function, context?: any): this {
    return this.addListener(event, fn, context, false);
  }

  /**
   * Add a listener for a given event (alias for on)
   */
  addListener(event: string | symbol, fn: Function, context?: any, once: boolean = false): this {
    if (typeof fn !== 'function') {
      throw new TypeError('The listener must be a function');
    }

    const listener: EventListener = {
      fn,
      context: context || this,
      once: once || false,
    };

    const existing = this._events.get(event);

    if (!existing) {
      this._events.set(event, listener);
      this._eventsCount++;
    } else if (!Array.isArray(existing)) {
      this._events.set(event, [existing, listener]);
    } else {
      existing.push(listener);
    }

    return this;
  }

  /**
   * Add a one-time listener for a given event
   */
  once(event: string | symbol, fn: Function, context?: any): this {
    if (typeof fn !== 'function') {
      throw new TypeError('The listener must be a function');
    }

    let fired = false;
    const onceListener = (...args: any[]) => {
      this.removeListener(event, onceListener);
      if (!fired) {
        fired = true;
        return fn.apply(context || this, args);
      }
      return undefined;
    };

    this.on(event, onceListener);
    this.onceListeners.set(fn, onceListener);
    return this;
  }

  /**
   * Remove a listener from a given event
   */
  removeListener(event: string | symbol, fn: Function): this {
    // Check if this is a once listener
    const onceListener = this.onceListeners.get(fn);
    if (onceListener) {
      this.onceListeners.delete(fn);
      fn = onceListener;
    }

    const handlers = this._events.get(event);

    if (!handlers) return this;

    if (!Array.isArray(handlers)) {
      // Single handler
      if (handlers.fn === fn) {
        this._events.delete(event);
        this._eventsCount--;
      }
    } else {
      // Multiple handlers
      const filtered = handlers.filter((h) => h.fn !== fn);

      if (filtered.length === 0) {
        this._events.delete(event);
        this._eventsCount--;
      } else if (filtered.length === 1 && filtered[0]) {
        this._events.set(event, filtered[0]);
      } else {
        this._events.set(event, filtered);
      }
    }

    return this;
  }

  /**
   * Remove listener (alias for removeListener)
   */
  off(event: string | symbol, fn: Function): this {
    return this.removeListener(event, fn);
  }

  /**
   * Remove all listeners, or those of the specified event
   */
  removeAllListeners(event?: string | symbol): this {
    if (event) {
      if (this._events.has(event)) {
        this._events.delete(event);
        this._eventsCount--;
      }
    } else {
      this._events.clear();
      this._eventsCount = 0;
    }

    return this;
  }

  // ============= Async Event Emitter Methods =============

  /**
   * Method to set concurrency limit using p-limit
   */
  setConcurrency(concurrency: number) {
    if (concurrency >= 1) {
      this.limiter = pLimit(concurrency);
    }
    return this;
  }

  /**
   * Emit events in parallel, returning a promise that resolves when all listeners have been executed
   */
  emitParallel(event: any, ...args: any[]) {
    const promises = this.listeners(event).map((listener) => this._executeListener(listener, args));
    return Promise.all(promises);
  }

  /**
   * Emit events serially, ensuring each listener is executed one after the other
   */
  emitSerial(event: any, ...args: any[]) {
    return this.listeners(event).reduce(
      (promise, listener) =>
        promise.then((values: any) =>
          this._executeListener(listener, args).then((value: any) => {
            values.push(value);
            return values;
          })
        ),
      Promise.resolve([])
    );
  }

  /**
   * Emit events using a reduce function, processing listeners from left to right
   */
  emitReduce(event: any, ...args: any[]) {
    return this._emitReduceRun(event, args);
  }

  /**
   * Emit events using a reduce function, processing listeners from right to left
   */
  emitReduceRight(event: any, ...args: any[]) {
    return this._emitReduceRun(event, args, true);
  }

  /**
   * Subscribe to an event with an option to only listen once
   */
  subscribe(event: any, listener: (...args: any[]) => void, once = false) {
    const unsubscribe = () => {
      this.removeListener(event, listener);
    };

    if (once) {
      this.once(event, listener);
    } else {
      this.on(event, listener);
    }

    return unsubscribe;
  }

  /**
   * Private method to handle reduce logic for event emission
   */
  private _emitReduceRun(event: any, args: any[], inverse = false) {
    const listeners = inverse ? this.listeners(event).reverse() : this.listeners(event);
    return listeners.reduce(
      (promise, listener) =>
        promise.then((prevArgs) => {
          const currentArgs = Array.isArray(prevArgs) ? prevArgs : [prevArgs];
          return this._executeListener(listener, currentArgs);
        }),
      Promise.resolve(args)
    );
  }

  /**
   * Private method to execute a listener with optional concurrency control
   */
  private _executeListener(listener: Function, args: any[]): Promise<any> {
    try {
      if (this.limiter) {
        return this.limiter(() => listener(...args));
      }
      return Promise.resolve(listener(...args));
    } catch (err) {
      return Promise.reject(err);
    }
  }
}
