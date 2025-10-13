/**
 * @fileoverview useStream reactive hook for real-time data
 * @module @omnitron-dev/aether/netron
 */

import { inject } from '../../di/index.js';
import { signal, effect, onCleanup } from '../../core/index.js';
import { NetronClient } from '../client.js';
import { getBackendName, getServiceName } from '../decorators/index.js';
import type { Signal } from '../../core/reactivity/types.js';
import type {
  Type,
  StreamOptions,
  StreamResult,
} from '../types.js';

/**
 * useStream - Subscribe to real-time data streams
 *
 * @param serviceClass - Service class or service name
 * @param method - Method name
 * @param args - Method arguments
 * @param options - Stream options
 * @returns Stream result with reactive signals
 *
 * @example
 * ```typescript
 * const { data, error, status } = useStream(
 *   PricingService,
 *   'subscribePrices',
 *   ['BTC/USD'],
 *   {
 *     onData: (price) => console.log('Price:', price),
 *     reconnect: true,
 *     reconnectDelay: 1000,
 *   }
 * );
 * ```
 */
export function useStream<TService, TMethod extends keyof TService, TData = any>(
  serviceClass: Type<TService> | string,
  method: TMethod,
  args: TService[TMethod] extends (...args: infer P) => any ? P : never,
  options?: StreamOptions
): StreamResult<TData> {
  // Get NetronClient from DI
  const netron = inject(NetronClient);

  // Extract backend and service names
  const backendName = typeof serviceClass === 'string' ? 'main' : getBackendName(serviceClass);
  const serviceName = typeof serviceClass === 'string' ? serviceClass : getServiceName(serviceClass);

  // Create state signals
  const data = signal<TData | undefined>(options?.initialValue);
  const error = signal<Error | undefined>(undefined);
  const connected = signal(false);

  // Track subscription
  let subscription: any = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;

  /**
   * Connect to stream
   */
  const connect = async () => {
    try {
      connected.set(false);
      error.set(undefined);

      // Get peer and service
      const peer = netron.backend(backendName);
      const serviceInterface = await peer.queryFluentInterface<any>(serviceName);

      // Subscribe to stream by calling the method
      const methodCall = (serviceInterface as any)[method as string];
      if (typeof methodCall !== 'function') {
        throw new Error(`Method ${String(method)} not found on service ${serviceName}`);
      }

      // Call the method with args to get the stream
      const stream = await methodCall(...(args as any[]));

      // Subscribe to the stream
      if (stream && typeof stream.subscribe === 'function') {
        subscription = stream.subscribe({
          next: (value: TData) => {
            data.set(value);

            // Update connection status
            if (!connected()) {
              connected.set(true);
              reconnectAttempts = 0;
            }
          },
          error: (err: Error) => {
            error.set(err);
            connected.set(false);

            // Attempt reconnection
            if (options?.autoReconnect && reconnectAttempts < (options?.maxReconnectAttempts || Infinity)) {
              scheduleReconnect();
            }
          },
          complete: () => {
            connected.set(false);

            // Attempt reconnection if enabled
            if (options?.autoReconnect && reconnectAttempts < (options?.maxReconnectAttempts || Infinity)) {
              scheduleReconnect();
            }
          },
        });

        // Connected successfully
        connected.set(true);
        reconnectAttempts = 0;
      } else {
        throw new Error(`Method ${String(method)} did not return a subscribable stream`);
      }
    } catch (err) {
      const e = err as Error;
      error.set(e);
      connected.set(false);

      // Attempt reconnection
      if (options?.autoReconnect && reconnectAttempts < (options?.maxReconnectAttempts || Infinity)) {
        scheduleReconnect();
      }
    }
  };

  /**
   * Schedule reconnection attempt
   */
  const scheduleReconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }

    reconnectAttempts++;

    // Calculate delay with exponential backoff
    const baseDelay = options?.reconnectDelay || 1000;
    const delay = baseDelay * Math.pow(2, reconnectAttempts - 1);

    reconnectTimeout = setTimeout(() => {
      if (!connected()) {
        connect();
      }
    }, delay);
  };

  /**
   * Close the stream
   */
  const close = () => {
    // Clear reconnect timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    // Unsubscribe
    if (subscription) {
      if (typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe();
      } else if (typeof subscription === 'function') {
        subscription(); // Cleanup function
      }
      subscription = null;
    }

    connected.set(false);
    reconnectAttempts = 0;
  };

  /**
   * Reconnect to the stream
   */
  const reconnect = async () => {
    close();
    reconnectAttempts = 0;
    await connect();
  };

  // Auto-connect by default
  effect(() => {
    connect();
  });

  // Cleanup on unmount
  onCleanup(() => {
    close();
  });

  return {
    data,
    error,
    connected,
    close,
    reconnect,
  };
}

/**
 * useMultiStream - Subscribe to multiple streams
 *
 * @param streams - Array of stream configurations
 * @returns Array of stream results
 *
 * @example
 * ```typescript
 * const [btcStream, ethStream] = useMultiStream([
 *   {
 *     service: PricingService,
 *     method: 'subscribePrices',
 *     args: ['BTC/USD'],
 *   },
 *   {
 *     service: PricingService,
 *     method: 'subscribePrices',
 *     args: ['ETH/USD'],
 *   },
 * ]);
 * ```
 */
export function useMultiStream<
  T extends ReadonlyArray<{
    service: Type<any> | string;
    method: string;
    args: any[];
    options?: StreamOptions;
  }>
>(streams: T): { [K in keyof T]: StreamResult } {
  return streams.map(stream =>
    useStream(
      stream.service,
      stream.method,
      stream.args,
      stream.options
    )
  ) as any;
}

/**
 * useBroadcast - Broadcast data to multiple subscribers
 *
 * @param serviceClass - Service class or service name
 * @param method - Method name
 * @returns Broadcast function and status
 *
 * @example
 * ```typescript
 * const { broadcast, broadcasting, error } = useBroadcast(
 *   NotificationService,
 *   'broadcast'
 * );
 *
 * await broadcast({
 *   type: 'info',
 *   message: 'Hello everyone!',
 * });
 * ```
 */
export function useBroadcast<TService, TMethod extends keyof TService, TData = any>(
  serviceClass: Type<TService> | string,
  method: TMethod
): {
  broadcast: (data: TData) => Promise<void>;
  broadcasting: Signal<boolean>;
  error: Signal<Error | undefined>;
} {
  // Get NetronClient from DI
  const netron = inject(NetronClient);

  // Extract backend and service names
  const backendName = typeof serviceClass === 'string' ? 'main' : getBackendName(serviceClass);
  const serviceName = typeof serviceClass === 'string' ? serviceClass : getServiceName(serviceClass);

  // Create state signals
  const broadcasting = signal(false);
  const error = signal<Error | undefined>(undefined);

  /**
   * Broadcast data
   */
  const broadcast = async (data: TData): Promise<void> => {
    broadcasting.set(true);
    error.set(undefined);

    try {
      // Get peer and service
      const peer = netron.backend(backendName);
      const serviceInterface = await peer.queryFluentInterface<any>(serviceName);

      // Call broadcast method
      const methodCall = (serviceInterface as any)[method as string];
      if (typeof methodCall !== 'function') {
        throw new Error(`Method ${String(method)} not found on service ${serviceName}`);
      }

      await methodCall(data);
    } catch (err) {
      const e = err as Error;
      error.set(e);
      throw e;
    } finally {
      broadcasting.set(false);
    }
  };

  return {
    broadcast,
    broadcasting,
    error,
  };
}