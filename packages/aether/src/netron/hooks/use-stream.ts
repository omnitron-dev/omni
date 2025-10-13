/**
 * @fileoverview useStream reactive hook for real-time data
 * @module @omnitron-dev/aether/netron
 */

import { inject } from '../../di/index.js';
import { signal, effect, onCleanup } from '../../core/index.js';
import { NetronClient } from '../client.js';
import { getBackendName, getServiceName } from '../decorators/index.js';
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
  options?: StreamOptions<TData>
): StreamResult<TData> {
  // Get NetronClient from DI
  const netron = inject(NetronClient);

  // Extract backend and service names
  const backendName = typeof serviceClass === 'string' ? 'main' : getBackendName(serviceClass);
  const serviceName = typeof serviceClass === 'string' ? serviceClass : getServiceName(serviceClass);

  // Create state signals
  const data = signal<TData[]>([]);
  const error = signal<Error | undefined>(undefined);
  const status = signal<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const isReconnecting = signal(false);

  // Track subscription
  let subscription: any = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;

  /**
   * Connect to stream
   */
  const connect = async () => {
    try {
      status.set('connecting');
      error.set(undefined);

      // Get peer and service
      const peer = netron.backend(backendName);
      const serviceInterface = await peer.queryFluentInterface<any>(serviceName);

      // Build stream options
      let stream = serviceInterface;

      if (options?.bufferSize) {
        stream = stream.buffer(options.bufferSize);
      }

      if (options?.throttle) {
        stream = stream.throttle(options.throttle);
      }

      if (options?.filter) {
        stream = stream.filter(options.filter);
      }

      // Subscribe to stream
      subscription = await stream[method](...args).subscribe({
        next: (value: TData) => {
          // Add to data buffer
          if (options?.bufferSize) {
            const buffer = [...data()];
            buffer.push(value);
            if (buffer.length > options.bufferSize) {
              buffer.shift();
            }
            data.set(buffer);
          } else {
            data.set([...data(), value]);
          }

          // Call onData callback
          if (options?.onData) {
            options.onData(value);
          }

          // Update status
          if (status() !== 'connected') {
            status.set('connected');
            reconnectAttempts = 0;
          }
        },
        error: (err: Error) => {
          error.set(err);
          status.set('error');

          // Call onError callback
          if (options?.onError) {
            options.onError(err);
          }

          // Attempt reconnection
          if (options?.reconnect) {
            scheduleReconnect();
          }
        },
        complete: () => {
          status.set('disconnected');

          // Call onComplete callback
          if (options?.onComplete) {
            options.onComplete();
          }

          // Attempt reconnection if not intentional
          if (options?.reconnect && status() !== 'disconnected') {
            scheduleReconnect();
          }
        },
      });

      // Connected successfully
      status.set('connected');
      isReconnecting.set(false);
      reconnectAttempts = 0;

      // Call onConnect callback
      if (options?.onConnect) {
        options.onConnect();
      }
    } catch (err) {
      const e = err as Error;
      error.set(e);
      status.set('error');

      // Attempt reconnection
      if (options?.reconnect) {
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

    isReconnecting.set(true);
    reconnectAttempts++;

    // Calculate delay with exponential backoff
    const baseDelay = options?.reconnectDelay || 1000;
    const maxDelay = options?.reconnectMaxDelay || 30000;
    const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), maxDelay);

    reconnectTimeout = setTimeout(() => {
      if (status() !== 'connected') {
        connect();
      }
    }, delay);
  };

  /**
   * Disconnect from stream
   */
  const disconnect = () => {
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

    status.set('disconnected');
    isReconnecting.set(false);
    reconnectAttempts = 0;

    // Call onDisconnect callback
    if (options?.onDisconnect) {
      options.onDisconnect();
    }
  };

  /**
   * Clear buffered data
   */
  const clear = () => {
    data.set([]);
  };

  // Auto-connect if enabled (default)
  if (options?.autoConnect !== false) {
    effect(() => {
      connect();
    });
  }

  // Cleanup on unmount
  onCleanup(() => {
    disconnect();
  });

  return {
    data,
    error,
    status,
    isReconnecting,
    connect,
    disconnect,
    clear,
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
      await serviceInterface[method](data);
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