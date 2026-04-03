/**
 * useSubscription - Hook for real-time event subscriptions
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNetronClient, useNetronConnection } from '../core/context.js';
import type { SubscriptionOptions, SubscriptionResult } from '../core/types.js';

/**
 * useSubscription hook
 *
 * Subscribes to real-time events over WebSocket.
 *
 * @example
 * ```tsx
 * const { data: prices, isConnected } = useSubscription<PriceUpdate>({
 *   event: 'prices:update',
 *   filter: (update) => update.symbol === 'BTC-USD',
 * });
 * ```
 */
export function useSubscription<TData = unknown>(options: SubscriptionOptions<TData>): SubscriptionResult<TData> {
  const client = useNetronClient();
  const connection = useNetronConnection();

  const { event, filter, transform, buffer, enabled = true, onData, onError, onConnect, onDisconnect } = options;

  // State
  const [data, setData] = useState<TData | undefined>(undefined);
  const [history, setHistory] = useState<TData[]>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const bufferRef = useRef<TData[]>([]);
  const bufferTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Handle incoming data
  const handleData = useCallback(
    (rawData: unknown) => {
      try {
        // Transform if needed
        let transformedData: TData;
        if (transform) {
          transformedData = transform(rawData);
        } else {
          transformedData = rawData as TData;
        }

        // Filter if needed
        if (filter && !filter(transformedData)) {
          return;
        }

        // Handle buffering
        if (buffer) {
          bufferRef.current.push(transformedData);

          // Flush if buffer is full
          if (bufferRef.current.length >= buffer.size) {
            flushBuffer();
          } else {
            // Schedule flush
            if (bufferTimeoutRef.current) {
              clearTimeout(bufferTimeoutRef.current);
            }
            bufferTimeoutRef.current = setTimeout(flushBuffer, buffer.timeout);
          }
        } else {
          // No buffering - update immediately
          setData(transformedData);
          setHistory((prev) => [...prev.slice(-99), transformedData]); // Keep last 100
          onData?.(transformedData);
        }
      } catch (err) {
        const handleError = err instanceof Error ? err : new Error(String(err));
        setError(handleError);
        onError?.(handleError);
      }
    },
    [filter, transform, buffer, onData, onError]
  );

  // Flush buffer
  const flushBuffer = useCallback(() => {
    if (bufferRef.current.length === 0) return;

    const bufferedData = [...bufferRef.current];
    bufferRef.current = [];

    if (bufferTimeoutRef.current) {
      clearTimeout(bufferTimeoutRef.current);
      bufferTimeoutRef.current = undefined;
    }

    if (!buffer) return;

    let dataToEmit: TData;
    switch (buffer.strategy) {
      case 'latest':
        dataToEmit = bufferedData[bufferedData.length - 1]!;
        break;
      case 'first':
        dataToEmit = bufferedData[0]!;
        break;
      case 'all':
      default:
        // For 'all' strategy, we emit the full array
        dataToEmit = bufferedData as unknown as TData;
    }

    setData(dataToEmit);
    setHistory((prev) => [...prev.slice(-99), dataToEmit]);
    onData?.(dataToEmit);
  }, [buffer, onData]);

  // Subscribe effect
  useEffect(() => {
    if (!enabled || !connection.isConnected) {
      return undefined;
    }

    try {
      unsubscribeRef.current = client.subscribe<TData>(event, handleData);
      setIsSubscribed(true);
      setError(null);
      onConnect?.();
    } catch (err) {
      const subscribeError = err instanceof Error ? err : new Error(String(err));
      setError(subscribeError);
      onError?.(subscribeError);
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
        setIsSubscribed(false);
        onDisconnect?.();
      }

      // Flush any remaining buffer
      flushBuffer();
    };
  }, [event, enabled, connection.isConnected, client, handleData, onConnect, onDisconnect, onError, flushBuffer]);

  // Connection state change handler
  useEffect(() => {
    if (!connection.isConnected && isSubscribed) {
      setIsSubscribed(false);
      onDisconnect?.();
    }
  }, [connection.isConnected, isSubscribed, onDisconnect]);

  // Unsubscribe function
  const unsubscribe = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      setIsSubscribed(false);
    }
  }, []);

  // Resubscribe function
  const resubscribe = useCallback(() => {
    unsubscribe();

    if (enabled && connection.isConnected) {
      try {
        unsubscribeRef.current = client.subscribe<TData>(event, handleData);
        setIsSubscribed(true);
        setError(null);
      } catch (err) {
        const resubscribeError = err instanceof Error ? err : new Error(String(err));
        setError(resubscribeError);
        onError?.(resubscribeError);
      }
    }
  }, [event, enabled, connection.isConnected, client, handleData, unsubscribe, onError]);

  // Clear history function
  const clearHistory = useCallback(() => {
    setHistory([]);
    bufferRef.current = [];
  }, []);

  // Return result
  return useMemo(
    () => ({
      data,
      history,
      isConnected: connection.isConnected,
      isSubscribed,
      error,
      unsubscribe,
      resubscribe,
      clearHistory,
    }),
    [data, history, connection.isConnected, isSubscribed, error, unsubscribe, resubscribe, clearHistory]
  );
}

export default useSubscription;
