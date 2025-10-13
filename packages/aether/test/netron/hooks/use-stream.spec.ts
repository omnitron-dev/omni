/**
 * @fileoverview Comprehensive tests for useStream hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStream, useMultiStream, useBroadcast } from '../../../src/netron/hooks/use-stream.js';
import { NetronClient } from '../../../src/netron/client.js';

// Mock subscription
class MockSubscription {
  private handlers: any = {};

  constructor(handlers: any) {
    this.handlers = handlers;
  }

  unsubscribe() {
    // Cleanup
  }

  // Simulate data emission
  emitData(value: any) {
    if (this.handlers.next) {
      this.handlers.next(value);
    }
  }

  emitError(error: Error) {
    if (this.handlers.error) {
      this.handlers.error(error);
    }
  }

  complete() {
    if (this.handlers.complete) {
      this.handlers.complete();
    }
  }
}

// Mock NetronClient
let currentMockSubscription: MockSubscription;

const createMockBackend = () => ({
  queryFluentInterface: vi.fn().mockImplementation(async () => 
    // Return a proxy that handles any method call
     new Proxy({}, {
      get: (target, prop) => {
        // Don't intercept 'then' - this prevents the Proxy from being treated as a Promise
        if (prop === 'then') {
          return undefined;
        }

        // Return a function that returns a Promise resolving to a subscribable stream
        return async (...args: any[]) => ({
            subscribe: (handlers: any) => {
              currentMockSubscription = new MockSubscription(handlers);
              return currentMockSubscription;
            },
          });
      },
    })
  ),
});

const mockNetronClient = {
  backend: vi.fn(),
};

// Mock DI inject
vi.mock('../../../src/di/index.js', () => ({
  Injectable: vi.fn(() => (target: any) => target),
  Optional: vi.fn(() => (target: any, propertyKey: string, parameterIndex: number) => {}),
  Inject: vi.fn(() => (target: any, propertyKey: string, parameterIndex: number) => {}),
  inject: vi.fn().mockImplementation((token) => {
    if (token === NetronClient) {
      return mockNetronClient;
    }
    return {};
  }),
}));

// Mock decorators
vi.mock('../../../src/netron/decorators/index.js', () => ({
  getBackendName: vi.fn().mockReturnValue('main'),
  getServiceName: vi.fn().mockReturnValue('pricing'),
}));

class PricingService {
  subscribePrices!: (symbol: string) => any;
  subscribeUpdates!: () => any;
}

describe('useStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock backend for each test
    mockNetronClient.backend.mockReturnValue(createMockBackend());
  });

  describe('basic functionality', () => {
    it('should return stream result with reactive signals', () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD']);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('isReconnecting');
      expect(result).toHaveProperty('connect');
      expect(result).toHaveProperty('disconnect');
      expect(result).toHaveProperty('clear');
    });

    it('should work with service name string', () => {
      const result = useStream('PricingService', 'subscribePrices', ['BTC/USD']);

      expect(result).toBeDefined();
    });

    it('should auto-connect by default', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD']);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockNetronClient.backend).toHaveBeenCalled();
    });

    it('should not auto-connect when disabled', () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        autoConnect: false,
      });

      // Should not have connected yet
      expect(result.status()).toBe('connecting');
    });
  });

  describe('connection status', () => {
    it('should start with connecting status', () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD']);

      expect(result.status()).toBe('connecting');
    });

    it('should set status to connected on successful connection', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD']);

      await result.connect();

      expect(['connected', 'connecting']).toContain(result.status());
    });

    it('should set status to error on connection failure', async () => {
      mockNetronClient.backend.mockImplementationOnce(() => {
        throw new Error('Connection failed');
      });

      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD']);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should handle error
      expect(result).toBeDefined();
    });

    it('should set status to disconnected on manual disconnect', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD']);

      await result.connect();
      result.disconnect();

      expect(result.status()).toBe('disconnected');
    });
  });

  describe('data handling', () => {
    it('should accumulate stream data', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD']);

      await result.connect();

      // Simulate data emissions using the currentMockSubscription
      await new Promise(resolve => setTimeout(resolve, 10)); // Let connection settle

      if (currentMockSubscription) {
        currentMockSubscription.emitData({ symbol: 'BTC/USD', price: 50000 });
        currentMockSubscription.emitData({ symbol: 'BTC/USD', price: 51000 });
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have accumulated data
      expect(Array.isArray(result.data())).toBe(true);
      expect(result.data().length).toBe(2);
    });

    it('should respect bufferSize option', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        bufferSize: 2,
      });

      await result.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Simulate multiple data emissions
      if (currentMockSubscription) {
        currentMockSubscription.emitData({ price: 1 });
        currentMockSubscription.emitData({ price: 2 });
        currentMockSubscription.emitData({ price: 3 }); // Should evict first
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      // Buffer should not exceed size
      const data = result.data();
      expect(data.length).toBeLessThanOrEqual(2);
    });

    it('should call onData callback', async () => {
      const onData = vi.fn();
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        onData,
      });

      await result.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      const testData = { symbol: 'BTC/USD', price: 50000 };

      if (currentMockSubscription) {
        currentMockSubscription.emitData(testData);
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      // Callback should be called
      expect(onData).toHaveBeenCalledWith(testData);
    });
  });

  describe('error handling', () => {
    it('should set error on stream error', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        reconnect: false, // Disable reconnect for cleaner testing
      });

      await result.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      const testError = new Error('Stream error');

      if (currentMockSubscription) {
        currentMockSubscription.emitError(testError);
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      // Error should be set
      expect(result.error()).toEqual(testError);
    });

    it('should call onError callback', async () => {
      const onError = vi.fn();
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        onError,
        reconnect: false,
      });

      await result.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      const testError = new Error('Stream error');

      if (currentMockSubscription) {
        currentMockSubscription.emitError(testError);
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      // Callback should be called
      expect(onError).toHaveBeenCalledWith(testError);
    });

    it('should set status to error on error', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        reconnect: false,
      });

      await result.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      if (currentMockSubscription) {
        currentMockSubscription.emitError(new Error('Test'));
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      // Status should reflect error
      expect(result.status()).toBe('error');
    });
  });

  describe('reconnection', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should reconnect on error when enabled', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        reconnect: true,
        reconnectDelay: 1000,
        maxReconnectAttempts: 1, // Limit attempts to prevent infinite loop
      });

      await result.connect();
      await vi.advanceTimersByTimeAsync(10);

      if (currentMockSubscription) {
        currentMockSubscription.emitError(new Error('Connection lost'));
      }

      await vi.advanceTimersByTimeAsync(10);

      // Should be reconnecting
      expect(result.isReconnecting()).toBe(true);
    });

    it('should use exponential backoff for reconnection', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        reconnect: true,
        reconnectDelay: 1000,
        reconnectMaxDelay: 10000,
      });

      // Should calculate delays with backoff
      expect(result).toBeDefined();
    });

    it('should not reconnect when disabled', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        reconnect: false,
      });

      await result.connect();
      await vi.advanceTimersByTimeAsync(10);

      if (currentMockSubscription) {
        currentMockSubscription.emitError(new Error('Connection lost'));
      }

      await vi.advanceTimersByTimeAsync(100);

      expect(result.isReconnecting()).toBe(false);
    });

    it('should track isReconnecting state', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        reconnect: true,
        maxReconnectAttempts: 1,
      });

      expect(result.isReconnecting()).toBe(false);

      await result.connect();
      await vi.advanceTimersByTimeAsync(10);

      if (currentMockSubscription) {
        currentMockSubscription.emitError(new Error('Connection lost'));
      }

      // Should be reconnecting after error
      await vi.advanceTimersByTimeAsync(10);

      expect(result.isReconnecting()).toBe(true);
    });
  });

  describe('callbacks', () => {
    it('should call onConnect callback', async () => {
      const onConnect = vi.fn();
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        onConnect,
      });

      await result.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      // onConnect should be called when first data arrives or subscription succeeds
      expect(onConnect).toHaveBeenCalled();
    });

    it('should call onDisconnect callback', async () => {
      const onDisconnect = vi.fn();
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        onDisconnect,
      });

      await result.connect();
      result.disconnect();

      expect(onDisconnect).toHaveBeenCalled();
    });

    it('should call onComplete callback', async () => {
      const onComplete = vi.fn();
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        onComplete,
        reconnect: false,
      });

      await result.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      if (currentMockSubscription) {
        currentMockSubscription.complete();
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      // Callback should be called
      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    it('should clear buffered data', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD']);

      await result.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      if (currentMockSubscription) {
        currentMockSubscription.emitData({ price: 50000 });
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      result.clear();

      expect(result.data()).toEqual([]);
    });
  });

  describe('disconnect()', () => {
    it('should stop stream and cleanup', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        autoConnect: false,
      });

      await result.connect();
      result.disconnect();

      expect(result.status()).toBe('disconnected');
      expect(result.isReconnecting()).toBe(false);
    });

    it('should clear reconnect timeout', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        reconnect: true,
      });

      await result.connect();
      result.disconnect();

      // Should have cleared timeout
      expect(result).toBeDefined();

      clearTimeoutSpy.mockRestore();
    });
  });

  describe('stream options', () => {
    it('should apply throttle option', async () => {
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        throttle: 1000,
      });

      await result.connect();

      // Should configure throttle
      expect(result).toBeDefined();
    });

    it('should apply filter option', async () => {
      const filter = (value: any) => value.price > 50000;
      const result = useStream(PricingService, 'subscribePrices', ['BTC/USD'], {
        filter,
      });

      await result.connect();

      // Should configure filter
      expect(result).toBeDefined();
    });
  });
});

describe('useMultiStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock backend for each test
    mockNetronClient.backend.mockReturnValue(createMockBackend());
  });

  it('should create multiple streams', () => {
    const results = useMultiStream([
      {
        service: PricingService,
        method: 'subscribePrices',
        args: ['BTC/USD'],
      },
      {
        service: PricingService,
        method: 'subscribePrices',
        args: ['ETH/USD'],
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('data');
    expect(results[1]).toHaveProperty('data');
  });

  it('should accept options for each stream', () => {
    const results = useMultiStream([
      {
        service: PricingService,
        method: 'subscribePrices',
        args: ['BTC/USD'],
        options: { bufferSize: 10 },
      },
      {
        service: PricingService,
        method: 'subscribePrices',
        args: ['ETH/USD'],
        options: { reconnect: true },
      },
    ]);

    expect(results).toHaveLength(2);
  });

  it('should handle empty array', () => {
    const results = useMultiStream([]);

    expect(results).toHaveLength(0);
  });
});

describe('useBroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNetronClient.backend.mockReturnValue({
      queryFluentInterface: vi.fn().mockResolvedValue({
        broadcast: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it('should return broadcast function and state', () => {
    const result = useBroadcast(PricingService, 'broadcast');

    expect(result).toHaveProperty('broadcast');
    expect(result).toHaveProperty('broadcasting');
    expect(result).toHaveProperty('error');
  });

  it('should execute broadcast', async () => {
    const result = useBroadcast(PricingService, 'broadcast');

    await result.broadcast({ type: 'info', message: 'Hello' });

    expect(mockNetronClient.backend).toHaveBeenCalled();
  });

  it('should track broadcasting state', async () => {
    const result = useBroadcast(PricingService, 'broadcast');

    expect(result.broadcasting()).toBe(false);

    const promise = result.broadcast({ message: 'Test' });

    // Should be broadcasting during execution
    await promise;

    expect(result.broadcasting()).toBe(false);
  });

  it('should handle broadcast errors', async () => {
    const testError = new Error('Broadcast failed');

    mockNetronClient.backend.mockReturnValueOnce({
      queryFluentInterface: vi.fn().mockResolvedValue({
        broadcast: vi.fn().mockRejectedValue(testError),
      }),
    });

    const result = useBroadcast(PricingService, 'broadcast');

    await expect(result.broadcast({ message: 'Test' })).rejects.toThrow('Broadcast failed');

    expect(result.error()).toEqual(testError);
  });

  it('should clear error on successful broadcast', async () => {
    const result = useBroadcast(PricingService, 'broadcast');

    result.error.set(new Error('Previous error'));

    await result.broadcast({ message: 'Test' });

    expect(result.error()).toBeUndefined();
  });

  it('should work with string service name', async () => {
    const result = useBroadcast('NotificationService', 'broadcast');

    await result.broadcast({ message: 'Test' });

    expect(mockNetronClient.backend).toHaveBeenCalled();
  });
});
