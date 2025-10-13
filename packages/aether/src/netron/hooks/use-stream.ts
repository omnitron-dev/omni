/**
 * @fileoverview useStream reactive hook for real-time data
 * @module @omnitron-dev/aether/netron
 */

import { inject } from '../../di/index.js';
import { signal, onCleanup } from '../../core/index.js';
import { NetronClient } from '../client.js';
import { getBackendName, getServiceName } from '../decorators/index.js';
import type { Signal } from '../../core/reactivity/types.js';
import type { Type, StreamOptions, StreamResult, StreamStatus } from '../types.js';

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

  // Create state signals - data is an array of accumulated values
  const data = signal<TData[]>([]);
  const error = signal<Error | undefined>(undefined);
  const statusSignal = signal<StreamStatus>('connecting');
  const isReconnectingSignal = signal(false);

  // Track subscription
  let subscription: any = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  let lastDataTime = 0;
  let isManualDisconnect = false;
  let isConnecting = false;

  // Buffer size configuration
  const bufferSize = options?.bufferSize ?? Infinity;

  /**
   * Add data to buffer with size limit
   */
  const addData = (value: TData) => {
    // Apply filter if provided
    if (options?.filter && !options.filter(value)) {
      return;
    }

    // Apply throttle if provided
    const now = Date.now();
    if (options?.throttle && now - lastDataTime < options.throttle) {
      return;
    }
    lastDataTime = now;

    // Add to buffer
    const currentData = data();
    const newData = [...currentData, value];

    // Enforce buffer size limit
    if (newData.length > bufferSize) {
      newData.splice(0, newData.length - bufferSize);
    }

    data.set(newData);

    // Call onData callback
    if (options?.onData) {
      options.onData(value);
    }
  };

  /**
   * Connect to stream
   */
  const connect = async () => {
    // Prevent concurrent connection attempts
    if (isConnecting) {
      return;
    }

    // If already connected, disconnect first
    if (subscription) {
      disconnect();
    }

    try {
      isConnecting = true;
      statusSignal.set('connecting');
      error.set(undefined);
      isManualDisconnect = false;

      // Check if netron client is available
      if (!netron || typeof netron.backend !== 'function') {
        throw new Error('NetronClient not available');
      }

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
            // Update connection status
            if (statusSignal() !== 'connected') {
              statusSignal.set('connected');
              reconnectAttempts = 0;
              isReconnectingSignal.set(false);

              // Call onConnect callback
              if (options?.onConnect) {
                options.onConnect();
              }
            }

            // Add data to buffer
            addData(value);
          },
          error: (err: Error) => {
            error.set(err);
            statusSignal.set('error');

            // Call onError callback
            if (options?.onError) {
              options.onError(err);
            }

            // Attempt reconnection if enabled and not manually disconnected
            const shouldReconnect = (options?.reconnect || options?.autoReconnect) && !isManualDisconnect;
            const withinAttempts = reconnectAttempts < (options?.maxReconnectAttempts ?? Infinity);

            if (shouldReconnect && withinAttempts) {
              scheduleReconnect();
            }
          },
          complete: () => {
            // Call onComplete callback
            if (options?.onComplete) {
              options.onComplete();
            }

            // Only set disconnected if not already in error state
            if (statusSignal() !== 'error') {
              statusSignal.set('disconnected');
            }

            // Attempt reconnection if enabled and not manually disconnected
            const shouldReconnect = (options?.reconnect || options?.autoReconnect) && !isManualDisconnect;
            const withinAttempts = reconnectAttempts < (options?.maxReconnectAttempts ?? Infinity);

            if (shouldReconnect && withinAttempts) {
              scheduleReconnect();
            }
          },
        });

        // Mark as connected
        statusSignal.set('connected');
        reconnectAttempts = 0;
        isReconnectingSignal.set(false);

        // Call onConnect callback
        if (options?.onConnect) {
          options.onConnect();
        }
      } else {
        throw new Error(`Method ${String(method)} did not return a subscribable stream`);
      }
    } catch (err) {
      const e = err as Error;
      error.set(e);
      statusSignal.set('error');

      // Call onError callback
      if (options?.onError) {
        options.onError(e);
      }

      // Attempt reconnection if enabled and not manually disconnected
      const shouldReconnect = (options?.reconnect || options?.autoReconnect) && !isManualDisconnect;
      const withinAttempts = reconnectAttempts < (options?.maxReconnectAttempts ?? Infinity);

      if (shouldReconnect && withinAttempts) {
        scheduleReconnect();
      }
    } finally {
      isConnecting = false;
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
    isReconnectingSignal.set(true);

    // Calculate delay with exponential backoff
    const baseDelay = options?.reconnectDelay || 1000;
    const maxDelay = options?.reconnectMaxDelay || 30000;
    const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), maxDelay);

    reconnectTimeout = setTimeout(() => {
      if (!isManualDisconnect) {
        connect();
      }
    }, delay);
  };

  /**
   * Disconnect from the stream
   */
  const disconnect = () => {
    isManualDisconnect = true;

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

    statusSignal.set('disconnected');
    isReconnectingSignal.set(false);
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

  /**
   * Get connection status
   */
  const status = (): StreamStatus => statusSignal();

  /**
   * Check if reconnecting
   */
  const isReconnecting = (): boolean => isReconnectingSignal();

  // Auto-connect by default (unless disabled)
  const shouldAutoConnect = options?.autoConnect !== false;
  if (shouldAutoConnect) {
    // Use setTimeout to defer connection to avoid blocking
    setTimeout(() => {
      connect();
    }, 0);
  }

  // Cleanup on unmount
  try {
    onCleanup(() => {
      disconnect();
    });
  } catch (_err) {
    // onCleanup might not be available in test environment
    // Fail silently in that case
  }

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
  }>,
>(streams: T): { [K in keyof T]: StreamResult } {
  return streams.map((stream) => useStream(stream.service, stream.method, stream.args, stream.options)) as any;
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
