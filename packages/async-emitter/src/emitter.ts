/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { EventEmitter } from "eventemitter3";
import { pLimit, type Limit } from "@devgrid/common";

export class AsyncEventEmitter extends EventEmitter {
  private onceListeners = new WeakMap<Function, Function>(); // Map to store listeners that should only be called once
  private limiter?: Limit; // Optional limiter for controlling concurrency

  constructor(concurrency?: number) {
    super();
    // Set concurrency if a valid number is provided
    if (concurrency && concurrency >= 1) {
      this.setConcurrency(concurrency);
    }
  }

  // Method to set concurrency limit using p-limit
  setConcurrency(concurrency: number) {
    if (concurrency >= 1) {
      this.limiter = pLimit(concurrency);
    }
    return this;
  }

  // Emit events in parallel, returning a promise that resolves when all listeners have been executed
  emitParallel(event: any, ...args: any[]) {
    const promises = this.listeners(event).map(listener => this._executeListener(listener, args));
    return Promise.all(promises);
  }

  // Emit events serially, ensuring each listener is executed one after the other
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

  // Emit events using a reduce function, processing listeners from left to right
  emitReduce(event: any, ...args: any[]) {
    return this._emitReduceRun(event, args);
  }

  // Emit events using a reduce function, processing listeners from right to left
  emitReduceRight(event: any, ...args: any[]) {
    return this._emitReduceRun(event, args, true);
  }

  // Override the 'once' method to ensure a listener is only called once
  override once(event: any, listener: any | ((...args: any[]) => void)) {
    if (typeof listener !== "function") {
      throw new TypeError("listener must be a function");
    }
    let fired = false;
    const onceListener = (...args: any[]) => {
      this.removeListener(event, onceListener);
      if (!fired) {
        fired = true;
        return (listener as (...args: any[]) => void).apply(this, args);
      }
      return undefined;
    };
    this.on(event, onceListener);
    this.onceListeners.set(listener, onceListener);
    return this;
  }

  // Override the 'removeListener' method to handle once listeners
  override removeListener(event: any, listener: (...args: any[]) => void) {
    const onceListener = this.onceListeners.get(listener);
    if (onceListener) {
      this.onceListeners.delete(listener);
      listener = onceListener as (...args: any[]) => void;
    }
    return super.removeListener(event, listener!);
  }

  // Subscribe to an event with an option to only listen once
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

  // Private method to handle reduce logic for event emission
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

  // Private method to execute a listener with optional concurrency control
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