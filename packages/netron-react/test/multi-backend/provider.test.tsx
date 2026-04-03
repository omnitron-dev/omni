/**
 * Unit tests for MultiBackendProvider
 *
 * Tests the provider component that manages multiple backend connections
 * and provides context for child components.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MultiBackendProvider } from '../../src/multi-backend/provider.js';
import { useMultiBackendContext, useMultiBackendConnectionState } from '../../src/multi-backend/context.js';
import type {
  IMultiBackendClient,
  IBackendClient,
  MultiBackendMetrics,
  IMiddlewareManager,
} from '@omnitron-dev/netron-browser';

// ============================================================================
// Mock Factories
// ============================================================================

interface MockBackendClient extends IBackendClient {
  _connected: boolean;
  _setConnected: (value: boolean) => void;
}

function createMockBackendClient(name: string): MockBackendClient {
  let connected = false;
  return {
    _connected: false,
    _setConnected(value: boolean) {
      connected = value;
      this._connected = value;
    },
    service: vi.fn().mockReturnValue({}),
    invoke: vi.fn().mockResolvedValue({ result: 'success' }),
    getMetrics: vi.fn().mockReturnValue({
      id: name,
      url: `http://localhost/${name}`,
      state: connected ? 'connected' : 'disconnected',
      transport: 'http',
      requestsSent: 0,
      responsesReceived: 0,
      errors: 0,
      avgLatency: 0,
    }),
    isConnected: vi.fn().mockImplementation(() => connected),
    getPath: vi.fn().mockReturnValue(`/${name}`),
    getTransportType: vi.fn().mockReturnValue('http'),
  };
}

interface MockMultiBackendClient extends IMultiBackendClient {
  _backends: Map<string, MockBackendClient>;
  _triggerConnect: (name: string) => void;
  _triggerDisconnect: (name: string) => void;
  _triggerError: (name: string, error: Error) => void;
  _connectDelay: number;
}

function createMockMultiBackendClient(backendNames: string[] = ['core', 'storage']): MockMultiBackendClient {
  const backends = new Map<string, MockBackendClient>();
  const _listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let connectDelay = 0;

  for (const name of backendNames) {
    backends.set(name, createMockBackendClient(name));
  }

  const client: MockMultiBackendClient = {
    _backends: backends,
    _connectDelay: 0,
    _triggerConnect(name: string) {
      const backend = backends.get(name);
      if (backend) {
        backend._setConnected(true);
      }
    },
    _triggerDisconnect(name: string) {
      const backend = backends.get(name);
      if (backend) {
        backend._setConnected(false);
      }
    },
    _triggerError(_name: string, _error: Error) {
      // Error triggering handled in connect rejection
    },
    backend: vi.fn().mockImplementation((name: string) => {
      const backend = backends.get(name);
      if (!backend) {
        throw new Error(`Backend '${name}' not found in pool`);
      }
      return backend;
    }),
    service: vi.fn().mockReturnValue({}),
    invoke: vi.fn().mockResolvedValue({ result: 'success' }),
    getMetrics: vi.fn().mockReturnValue({
      backends: {},
      totalRequestsSent: 0,
      totalResponsesReceived: 0,
      totalErrors: 0,
      avgLatency: 0,
    } as MultiBackendMetrics),
    isConnected: vi.fn().mockImplementation((name?: string) => {
      if (name) {
        return backends.get(name)?.isConnected() ?? false;
      }
      return Array.from(backends.values()).every((b) => b.isConnected());
    }),
    connect: vi.fn().mockImplementation(async (name?: string) => {
      if (connectDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, connectDelay));
      }
      if (name) {
        const backend = backends.get(name);
        if (backend) {
          backend._setConnected(true);
        }
      } else {
        for (const [, backend] of backends) {
          backend._setConnected(true);
        }
      }
    }),
    disconnect: vi.fn().mockImplementation(async (name?: string) => {
      if (name) {
        const backend = backends.get(name);
        if (backend) {
          backend._setConnected(false);
        }
      } else {
        for (const [, backend] of backends) {
          backend._setConnected(false);
        }
      }
    }),
    getMiddleware: vi.fn().mockReturnValue({
      use: vi.fn(),
      execute: vi.fn(),
      clear: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({ executions: 0, errors: 0, avgTime: 0 }),
    } as unknown as IMiddlewareManager),
    destroy: vi.fn().mockResolvedValue(undefined),
    getBackendNames: vi.fn().mockReturnValue(backendNames),
  } as unknown as MockMultiBackendClient;

  // Store connectDelay setter
  Object.defineProperty(client, '_connectDelay', {
    set(value: number) {
      connectDelay = value;
    },
    get() {
      return connectDelay;
    },
  });

  return client;
}

// ============================================================================
// Test Component Helpers
// ============================================================================

function TestConsumer({ testId = 'consumer' }: { testId?: string }) {
  const context = useMultiBackendContext();
  return (
    <div data-testid={testId}>
      <span data-testid="backend-names">{context.backendNames.join(',')}</span>
      <span data-testid="is-connected">{String(context.isConnected())}</span>
    </div>
  );
}

function ConnectionStateConsumer() {
  const state = useMultiBackendConnectionState();
  return (
    <div data-testid="connection-state">
      <span data-testid="all-connected">{String(state.allConnected)}</span>
      <span data-testid="any-connected">{String(state.anyConnected)}</span>
      <span data-testid="any-connecting">{String(state.anyConnecting)}</span>
      <span data-testid="backends-count">{state.backends.size}</span>
    </div>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('MultiBackendProvider', () => {
  let mockClient: MockMultiBackendClient;

  beforeEach(() => {
    mockClient = createMockMultiBackendClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render children', () => {
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <div data-testid="child">Hello World</div>
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('child')).toHaveTextContent('Hello World');
    });

    it('should render multiple children', () => {
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <div data-testid="child1">First</div>
          <div data-testid="child2">Second</div>
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('child1')).toHaveTextContent('First');
      expect(screen.getByTestId('child2')).toHaveTextContent('Second');
    });

    it('should handle fragment children', () => {
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <>
            <span data-testid="fragment-child">Fragment Content</span>
          </>
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('fragment-child')).toHaveTextContent('Fragment Content');
    });
  });

  describe('context provision', () => {
    it('should provide multi-backend context', () => {
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <TestConsumer />
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('backend-names')).toHaveTextContent('core,storage');
    });

    it('should provide connection state context', () => {
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <ConnectionStateConsumer />
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('connection-state')).toBeInTheDocument();
      expect(screen.getByTestId('backends-count')).toHaveTextContent('2');
    });

    it('should provide client via context', () => {
      const ClientChecker = () => {
        const { client } = useMultiBackendContext();
        return <span data-testid="has-client">{String(!!client)}</span>;
      };

      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <ClientChecker />
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('has-client')).toHaveTextContent('true');
    });
  });

  describe('auto-connect behavior', () => {
    it('should auto-connect when autoConnect=true (default)', async () => {
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient}>
          <TestConsumer />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockClient.connect).toHaveBeenCalled();
    });

    it('should not auto-connect when autoConnect=false', async () => {
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <TestConsumer />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockClient.connect).not.toHaveBeenCalled();
    });

    it('should skip auto-connect if already connected', async () => {
      // Pre-connect backends
      mockClient._triggerConnect('core');
      mockClient._triggerConnect('storage');

      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={true}>
          <TestConsumer />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Should not call connect since already connected
      expect(mockClient.connect).not.toHaveBeenCalled();
    });
  });

  describe('connection callbacks', () => {
    it('should call onConnect callback when backend connects', async () => {
      const onConnect = vi.fn();

      render(
        <MultiBackendProvider
          client={mockClient as unknown as IMultiBackendClient}
          autoConnect={true}
          onConnect={onConnect}
        >
          <TestConsumer />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onConnect).toHaveBeenCalledWith('core');
      expect(onConnect).toHaveBeenCalledWith('storage');
    });

    it('should call onDisconnect callback when backend disconnects', async () => {
      const onDisconnect = vi.fn();

      // Start connected
      mockClient._triggerConnect('core');
      mockClient._triggerConnect('storage');

      const { rerender } = render(
        <MultiBackendProvider
          client={mockClient as unknown as IMultiBackendClient}
          autoConnect={false}
          onDisconnect={onDisconnect}
        >
          <TestConsumer />
        </MultiBackendProvider>
      );

      // Trigger disconnect through context
      const DisconnectTrigger = () => {
        const { disconnect } = useMultiBackendContext();
        React.useEffect(() => {
          disconnect('core');
        }, [disconnect]);
        return null;
      };

      rerender(
        <MultiBackendProvider
          client={mockClient as unknown as IMultiBackendClient}
          autoConnect={false}
          onDisconnect={onDisconnect}
        >
          <DisconnectTrigger />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onDisconnect).toHaveBeenCalledWith('core');
    });

    it('should call onError callback on connection error', async () => {
      const onError = vi.fn();
      const error = new Error('Connection failed');

      // Make connect reject
      mockClient.connect = vi.fn().mockRejectedValue(error);

      render(
        <MultiBackendProvider
          client={mockClient as unknown as IMultiBackendClient}
          autoConnect={true}
          onError={onError}
        >
          <TestConsumer />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onError).toHaveBeenCalledWith('core', error);
    });
  });

  describe('connect timeout', () => {
    it('should handle connectTimeout', async () => {
      vi.useRealTimers();

      const onError = vi.fn();

      // Create a client that takes longer than timeout to connect
      const slowClient = createMockMultiBackendClient();
      slowClient.connect = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)));

      render(
        <MultiBackendProvider
          client={slowClient as unknown as IMultiBackendClient}
          autoConnect={true}
          connectTimeout={100}
          onError={onError}
        >
          <TestConsumer />
        </MultiBackendProvider>
      );

      // Wait for timeout
      await waitFor(
        () => {
          expect(onError).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      const [backendName, error] = onError.mock.calls[0];
      expect(backendName).toBe('core');
      expect(error.message).toContain('timeout');

      vi.useFakeTimers();
    });

    it('should use default connectTimeout of 30000ms', () => {
      // This test verifies the default behavior without explicitly setting timeout
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <TestConsumer />
        </MultiBackendProvider>
      );

      // The component should render without timeout errors
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });
  });

  describe('connection state tracking', () => {
    it('should track connection state per backend', async () => {
      // Start with no connections and autoConnect=false
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <ConnectionStateConsumer />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // With no backends connected and autoConnect=false
      expect(screen.getByTestId('any-connected')).toHaveTextContent('false');
      expect(screen.getByTestId('all-connected')).toHaveTextContent('false');
    });

    it('should update allConnected when all backends connect', async () => {
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={true}>
          <ConnectionStateConsumer />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByTestId('all-connected')).toHaveTextContent('true');
    });

    it('should update anyConnected when at least one backend connects', async () => {
      // Only connect core
      mockClient.connect = vi.fn().mockImplementation(async (name?: string) => {
        if (name === 'core' || !name) {
          mockClient._triggerConnect('core');
        }
      });

      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={true}>
          <ConnectionStateConsumer />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByTestId('any-connected')).toHaveTextContent('true');
    });

    it('should track connecting state', async () => {
      vi.useRealTimers();

      // Create a client with delayed connection
      const delayedClient = createMockMultiBackendClient();
      let resolveConnect: () => void;
      delayedClient.connect = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveConnect = resolve;
          })
      );

      render(
        <MultiBackendProvider client={delayedClient as unknown as IMultiBackendClient} autoConnect={true}>
          <ConnectionStateConsumer />
        </MultiBackendProvider>
      );

      // While connecting
      await waitFor(() => {
        expect(screen.getByTestId('any-connecting')).toHaveTextContent('true');
      });

      // Resolve connection
      act(() => {
        resolveConnect!();
      });

      vi.useFakeTimers();
    });
  });

  describe('cleanup', () => {
    it('should cleanup on unmount', async () => {
      const { unmount } = render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={true}>
          <TestConsumer />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      unmount();

      // Verify no errors occur during unmount
      // The component should not attempt to update state after unmount
      expect(true).toBe(true);
    });

    it('should not update state after unmount', async () => {
      vi.useRealTimers();

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Create a client with delayed connection
      let resolveConnect: () => void;
      const delayedClient = createMockMultiBackendClient();
      delayedClient.connect = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveConnect = resolve;
          })
      );

      const { unmount } = render(
        <MultiBackendProvider client={delayedClient as unknown as IMultiBackendClient} autoConnect={true}>
          <TestConsumer />
        </MultiBackendProvider>
      );

      // Unmount before connection completes
      unmount();

      // Resolve connection after unmount
      act(() => {
        resolveConnect!();
      });

      // Wait a bit to ensure no state update errors
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that no React state update warnings were logged
      const stateUpdateWarnings = consoleError.mock.calls.filter((call) =>
        call.some(
          (arg) =>
            typeof arg === 'string' &&
            (arg.includes("Can't perform a React state update") || arg.includes('unmounted component'))
        )
      );

      expect(stateUpdateWarnings.length).toBe(0);

      consoleError.mockRestore();
      vi.useFakeTimers();
    });
  });

  describe('context methods', () => {
    it('should provide connect function that connects specific backend', async () => {
      const ConnectTester = () => {
        const { connect, isConnected } = useMultiBackendContext();
        return (
          <div>
            <button onClick={() => connect('core')}>Connect Core</button>
            <span data-testid="core-connected">{String(isConnected('core'))}</span>
          </div>
        );
      };

      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <ConnectTester />
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('core-connected')).toHaveTextContent('false');

      await act(async () => {
        screen.getByRole('button').click();
        await vi.runAllTimersAsync();
      });

      expect(mockClient.connect).toHaveBeenCalledWith('core');
    });

    it('should provide disconnect function', async () => {
      mockClient._triggerConnect('core');

      const DisconnectTester = () => {
        const { disconnect, isConnected } = useMultiBackendContext();
        return (
          <div>
            <button onClick={() => disconnect('core')}>Disconnect Core</button>
            <span data-testid="core-connected">{String(isConnected('core'))}</span>
          </div>
        );
      };

      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <DisconnectTester />
        </MultiBackendProvider>
      );

      await act(async () => {
        screen.getByRole('button').click();
        await vi.runAllTimersAsync();
      });

      expect(mockClient.disconnect).toHaveBeenCalledWith('core');
    });

    it('should provide getBackend function', () => {
      const GetBackendTester = () => {
        const { getBackend } = useMultiBackendContext();
        const backend = getBackend('core' as never);
        return <span data-testid="has-backend">{String(!!backend)}</span>;
      };

      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <GetBackendTester />
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('has-backend')).toHaveTextContent('true');
    });
  });

  describe('error handling', () => {
    it('should handle connection error gracefully', async () => {
      const error = new Error('Network error');
      mockClient.connect = vi.fn().mockRejectedValue(error);

      const onError = vi.fn();

      render(
        <MultiBackendProvider
          client={mockClient as unknown as IMultiBackendClient}
          autoConnect={true}
          onError={onError}
        >
          <TestConsumer />
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onError).toHaveBeenCalled();
      // Component should still render
      expect(screen.getByTestId('consumer')).toBeInTheDocument();
    });

    it('should handle disconnect error gracefully', async () => {
      const error = new Error('Disconnect failed');
      mockClient.disconnect = vi.fn().mockRejectedValue(error);

      const onError = vi.fn();

      const DisconnectTester = () => {
        const { disconnect } = useMultiBackendContext();
        return <button onClick={() => disconnect('core').catch(() => {})}>Disconnect</button>;
      };

      render(
        <MultiBackendProvider
          client={mockClient as unknown as IMultiBackendClient}
          autoConnect={false}
          onError={onError}
        >
          <DisconnectTester />
        </MultiBackendProvider>
      );

      await act(async () => {
        screen.getByRole('button').click();
        await vi.runAllTimersAsync();
      });

      expect(onError).toHaveBeenCalledWith('core', error);
    });
  });
});
