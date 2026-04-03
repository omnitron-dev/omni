/**
 * Unit tests for Multi-Backend Connection-Aware Components
 *
 * Tests React components for conditionally rendering content based on
 * backend connection states.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { MultiBackendProvider } from '../../src/multi-backend/provider.js';
import {
  BackendConnectionAware,
  RequireBackendConnection,
  MultiBackendConnectionAware,
  RequireAllBackends,
  RequireAnyBackend,
  BackendStatus,
} from '../../src/multi-backend/components.js';
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
  _connecting: boolean;
  _error: Error | null;
  _setConnected: (value: boolean) => void;
  _setConnecting: (value: boolean) => void;
  _setError: (error: Error | null) => void;
}

function createMockBackendClient(name: string): MockBackendClient {
  let connected = false;
  let _connecting = false;
  let _error: Error | null = null;

  return {
    _connected: false,
    _connecting: false,
    _error: null,
    _setConnected(value: boolean) {
      connected = value;
      this._connected = value;
      if (value) {
        _connecting = false;
        this._connecting = false;
        _error = null;
        this._error = null;
      }
    },
    _setConnecting(value: boolean) {
      _connecting = value;
      this._connecting = value;
    },
    _setError(err: Error | null) {
      _error = err;
      this._error = err;
      if (err) {
        connected = false;
        this._connected = false;
        _connecting = false;
        this._connecting = false;
      }
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
  _triggerConnecting: (name: string) => void;
  _triggerError: (name: string, error: Error) => void;
  _updateConnectionState: (
    name: string,
    state: { connected?: boolean; connecting?: boolean; error?: Error | null }
  ) => void;
}

function createMockMultiBackendClient(backendNames: string[] = ['core', 'storage']): MockMultiBackendClient {
  const backends = new Map<string, MockBackendClient>();
  const connectionStates = new Map<string, { connected: boolean; connecting: boolean; error: Error | null }>();

  for (const name of backendNames) {
    backends.set(name, createMockBackendClient(name));
    connectionStates.set(name, { connected: false, connecting: false, error: null });
  }

  const client: MockMultiBackendClient = {
    _backends: backends,
    _triggerConnect(name: string) {
      const backend = backends.get(name);
      const state = connectionStates.get(name);
      if (backend && state) {
        backend._setConnected(true);
        state.connected = true;
        state.connecting = false;
        state.error = null;
      }
    },
    _triggerDisconnect(name: string) {
      const backend = backends.get(name);
      const state = connectionStates.get(name);
      if (backend && state) {
        backend._setConnected(false);
        state.connected = false;
      }
    },
    _triggerConnecting(name: string) {
      const backend = backends.get(name);
      const state = connectionStates.get(name);
      if (backend && state) {
        backend._setConnecting(true);
        state.connecting = true;
      }
    },
    _triggerError(name: string, error: Error) {
      const backend = backends.get(name);
      const state = connectionStates.get(name);
      if (backend && state) {
        backend._setError(error);
        state.error = error;
        state.connected = false;
        state.connecting = false;
      }
    },
    _updateConnectionState(
      name: string,
      newState: { connected?: boolean; connecting?: boolean; error?: Error | null }
    ) {
      const state = connectionStates.get(name);
      if (state) {
        if (newState.connected !== undefined) state.connected = newState.connected;
        if (newState.connecting !== undefined) state.connecting = newState.connecting;
        if (newState.error !== undefined) state.error = newState.error;
      }
    },
    backend: vi.fn().mockImplementation((name: string) => {
      const backend = backends.get(name);
      if (!backend) {
        throw new Error(`Backend '${name}' not found`);
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
        return connectionStates.get(name)?.connected ?? false;
      }
      return Array.from(connectionStates.values()).every((s) => s.connected);
    }),
    connect: vi.fn().mockImplementation(async (name?: string) => {
      if (name) {
        const backend = backends.get(name);
        const state = connectionStates.get(name);
        if (backend && state) {
          backend._setConnected(true);
          state.connected = true;
          state.connecting = false;
        }
      } else {
        for (const [n, backend] of backends) {
          const state = connectionStates.get(n);
          if (state) {
            backend._setConnected(true);
            state.connected = true;
            state.connecting = false;
          }
        }
      }
    }),
    disconnect: vi.fn().mockImplementation(async (name?: string) => {
      if (name) {
        const backend = backends.get(name);
        const state = connectionStates.get(name);
        if (backend && state) {
          backend._setConnected(false);
          state.connected = false;
        }
      } else {
        for (const [n, backend] of backends) {
          const state = connectionStates.get(n);
          if (state) {
            backend._setConnected(false);
            state.connected = false;
          }
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

  return client;
}

// ============================================================================
// Test Wrapper
// ============================================================================

function _createWrapper(client: IMultiBackendClient, autoConnect = false) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MultiBackendProvider client={client} autoConnect={autoConnect}>
        {children}
      </MultiBackendProvider>
    );
  };
}

// ============================================================================
// Tests: BackendConnectionAware
// ============================================================================

describe('BackendConnectionAware', () => {
  let mockClient: MockMultiBackendClient;

  beforeEach(() => {
    mockClient = createMockMultiBackendClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should render children when connected', async () => {
    mockClient._triggerConnect('core');

    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={true}>
        <BackendConnectionAware backend="core">
          <div data-testid="content">Connected Content</div>
        </BackendConnectionAware>
      </MultiBackendProvider>
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId('content')).toHaveTextContent('Connected Content');
  });

  it('should render connecting when connecting', async () => {
    // Create client that stays in connecting state
    const connectingClient = createMockMultiBackendClient();
    connectingClient.connect = vi.fn().mockImplementation(async (name?: string) => {
      if (name) {
        connectingClient._triggerConnecting(name);
      }
      // Never resolves to stay in connecting state
      await new Promise(() => {});
    });

    render(
      <MultiBackendProvider client={connectingClient as unknown as IMultiBackendClient} autoConnect={true}>
        <BackendConnectionAware backend="core" connecting={<div data-testid="connecting">Connecting...</div>}>
          <div data-testid="content">Connected Content</div>
        </BackendConnectionAware>
      </MultiBackendProvider>
    );

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.queryByTestId('connecting')).toBeInTheDocument();
  });

  it('should render disconnected when disconnected', () => {
    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
        <BackendConnectionAware backend="core" disconnected={<div data-testid="disconnected">Not Connected</div>}>
          <div data-testid="content">Connected Content</div>
        </BackendConnectionAware>
      </MultiBackendProvider>
    );

    expect(screen.getByTestId('disconnected')).toHaveTextContent('Not Connected');
  });

  it('should render error when error present', async () => {
    const error = new Error('Connection failed');

    // Create client that fails to connect
    const errorClient = createMockMultiBackendClient();
    errorClient.connect = vi.fn().mockImplementation(async (name?: string) => {
      if (name) {
        errorClient._triggerError(name, error);
      }
      throw error;
    });

    render(
      <MultiBackendProvider client={errorClient as unknown as IMultiBackendClient} autoConnect={true}>
        <BackendConnectionAware
          backend="core"
          error={(err, retry) => (
            <div data-testid="error">
              <span data-testid="error-message">{err.message}</span>
              <button data-testid="retry-button" onClick={retry}>
                Retry
              </button>
            </div>
          )}
        >
          <div data-testid="content">Connected Content</div>
        </BackendConnectionAware>
      </MultiBackendProvider>
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId('error-message')).toHaveTextContent('Connection failed');
  });

  it('should call retry function when retry button clicked', async () => {
    const error = new Error('Connection failed');

    const errorClient = createMockMultiBackendClient();
    let connectCalls = 0;
    errorClient.connect = vi.fn().mockImplementation(async (name?: string) => {
      connectCalls++;
      if (connectCalls === 1 && name) {
        errorClient._triggerError(name, error);
        throw error;
      }
      // Second call succeeds
      if (name) {
        errorClient._triggerConnect(name);
      }
    });

    render(
      <MultiBackendProvider client={errorClient as unknown as IMultiBackendClient} autoConnect={true}>
        <BackendConnectionAware
          backend="core"
          error={(err, retry) => (
            <button data-testid="retry-button" onClick={retry}>
              Retry
            </button>
          )}
        >
          <div data-testid="content">Connected Content</div>
        </BackendConnectionAware>
      </MultiBackendProvider>
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Click retry
    fireEvent.click(screen.getByTestId('retry-button'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(errorClient.connect).toHaveBeenCalledTimes(3); // Initial + retry calls
  });

  it('should render children when no fallback provided for disconnected state', () => {
    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
        <BackendConnectionAware backend="core">
          <div data-testid="content">Content</div>
        </BackendConnectionAware>
      </MultiBackendProvider>
    );

    expect(screen.getByTestId('content')).toHaveTextContent('Content');
  });
});

// ============================================================================
// Tests: RequireBackendConnection
// ============================================================================

describe('RequireBackendConnection', () => {
  let mockClient: MockMultiBackendClient;

  beforeEach(() => {
    mockClient = createMockMultiBackendClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should render children only when connected', async () => {
    mockClient._triggerConnect('core');

    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={true}>
        <RequireBackendConnection backend="core">
          <div data-testid="content">Protected Content</div>
        </RequireBackendConnection>
      </MultiBackendProvider>
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId('content')).toHaveTextContent('Protected Content');
  });

  it('should render fallback when not connected', () => {
    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
        <RequireBackendConnection backend="core" fallback={<div data-testid="fallback">Not Available</div>}>
          <div data-testid="content">Protected Content</div>
        </RequireBackendConnection>
      </MultiBackendProvider>
    );

    expect(screen.getByTestId('fallback')).toHaveTextContent('Not Available');
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  it('should render null when not connected and no fallback', () => {
    const { container } = render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
        <RequireBackendConnection backend="core">
          <div data-testid="content">Protected Content</div>
        </RequireBackendConnection>
      </MultiBackendProvider>
    );

    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    // Container should only have the provider wrapper elements
    expect(container.textContent).toBe('');
  });
});

// ============================================================================
// Tests: MultiBackendConnectionAware
// ============================================================================

describe('MultiBackendConnectionAware', () => {
  let mockClient: MockMultiBackendClient;

  beforeEach(() => {
    mockClient = createMockMultiBackendClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('requireAll=true (default)', () => {
    it('should render children when all backends connected', async () => {
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={true}>
          <MultiBackendConnectionAware>
            <div data-testid="content">All Connected</div>
          </MultiBackendConnectionAware>
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByTestId('content')).toHaveTextContent('All Connected');
    });

    it('should render disconnected when not all backends connected', () => {
      mockClient._triggerConnect('core');
      // storage remains disconnected

      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <MultiBackendConnectionAware disconnected={<div data-testid="disconnected">Not all connected</div>}>
            <div data-testid="content">All Connected</div>
          </MultiBackendConnectionAware>
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('disconnected')).toHaveTextContent('Not all connected');
    });

    it('should render connecting when any backend is connecting', async () => {
      const connectingClient = createMockMultiBackendClient();
      connectingClient.connect = vi.fn().mockImplementation(async () => {
        connectingClient._triggerConnecting('core');
        await new Promise(() => {});
      });

      render(
        <MultiBackendProvider client={connectingClient as unknown as IMultiBackendClient} autoConnect={true}>
          <MultiBackendConnectionAware connecting={<div data-testid="connecting">Connecting...</div>}>
            <div data-testid="content">All Connected</div>
          </MultiBackendConnectionAware>
        </MultiBackendProvider>
      );

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(screen.queryByTestId('connecting')).toBeInTheDocument();
    });
  });

  describe('requireAll=false', () => {
    it('should render children when any backend connected', async () => {
      // Only connect core
      mockClient.connect = vi.fn().mockImplementation(async (name?: string) => {
        if (name === 'core' || !name) {
          mockClient._triggerConnect('core');
        }
      });

      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={true}>
          <MultiBackendConnectionAware requireAll={false}>
            <div data-testid="content">Any Connected</div>
          </MultiBackendConnectionAware>
        </MultiBackendProvider>
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByTestId('content')).toHaveTextContent('Any Connected');
    });

    it('should render disconnected when no backends connected', () => {
      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <MultiBackendConnectionAware
            requireAll={false}
            disconnected={<div data-testid="disconnected">No connection</div>}
          >
            <div data-testid="content">Content</div>
          </MultiBackendConnectionAware>
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('disconnected')).toHaveTextContent('No connection');
    });

    it('should render content even if some backends have errors when connected', async () => {
      mockClient._triggerConnect('core');
      mockClient._triggerError('storage', new Error('Storage error'));

      render(
        <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
          <MultiBackendConnectionAware requireAll={false}>
            <div data-testid="content">Degraded Mode</div>
          </MultiBackendConnectionAware>
        </MultiBackendProvider>
      );

      // When at least one is connected and requireAll=false, should show content
      expect(screen.queryByTestId('content')).toBeInTheDocument();
    });
  });

  describe('specific backends', () => {
    it('should check only specified backends', async () => {
      const threeBackendClient = createMockMultiBackendClient(['core', 'storage', 'analytics']);
      threeBackendClient._triggerConnect('core');
      threeBackendClient._triggerConnect('storage');
      // analytics remains disconnected

      render(
        <MultiBackendProvider client={threeBackendClient as unknown as IMultiBackendClient} autoConnect={false}>
          <MultiBackendConnectionAware backends={['core', 'storage']}>
            <div data-testid="content">Specific backends connected</div>
          </MultiBackendConnectionAware>
        </MultiBackendProvider>
      );

      expect(screen.getByTestId('content')).toHaveTextContent('Specific backends connected');
    });
  });

  it('should render appropriate states', async () => {
    const error = new Error('Backend error');

    const errorClient = createMockMultiBackendClient();
    // This mock triggers error for all backends
    errorClient.connect = vi.fn().mockImplementation(async (name?: string) => {
      if (name) {
        errorClient._triggerError(name, error);
      } else {
        // When connecting all, trigger error on all
        errorClient._triggerError('core', error);
        errorClient._triggerError('storage', error);
      }
      throw error;
    });

    render(
      <MultiBackendProvider client={errorClient as unknown as IMultiBackendClient} autoConnect={true}>
        <MultiBackendConnectionAware
          error={(errors, retry) => (
            <div data-testid="error">
              <span data-testid="error-count">{errors.size} errors</span>
              <button data-testid="retry" onClick={retry}>
                Retry
              </button>
            </div>
          )}
        >
          <div data-testid="content">Content</div>
        </MultiBackendConnectionAware>
      </MultiBackendProvider>
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Both backends have errors, so expect 2 errors
    expect(screen.getByTestId('error-count')).toHaveTextContent('2 errors');
  });
});

// ============================================================================
// Tests: RequireAllBackends
// ============================================================================

describe('RequireAllBackends', () => {
  let mockClient: MockMultiBackendClient;

  beforeEach(() => {
    mockClient = createMockMultiBackendClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should render children when all backends connected', async () => {
    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={true}>
        <RequireAllBackends>
          <div data-testid="content">All Ready</div>
        </RequireAllBackends>
      </MultiBackendProvider>
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId('content')).toHaveTextContent('All Ready');
  });

  it('should render fallback when not all connected', () => {
    mockClient._triggerConnect('core');

    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
        <RequireAllBackends fallback={<div data-testid="fallback">Loading...</div>}>
          <div data-testid="content">All Ready</div>
        </RequireAllBackends>
      </MultiBackendProvider>
    );

    expect(screen.getByTestId('fallback')).toHaveTextContent('Loading...');
  });
});

// ============================================================================
// Tests: RequireAnyBackend
// ============================================================================

describe('RequireAnyBackend', () => {
  let mockClient: MockMultiBackendClient;

  beforeEach(() => {
    mockClient = createMockMultiBackendClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should render children when any backend connected', async () => {
    mockClient._triggerConnect('core');

    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
        <RequireAnyBackend>
          <div data-testid="content">Partially Ready</div>
        </RequireAnyBackend>
      </MultiBackendProvider>
    );

    expect(screen.getByTestId('content')).toHaveTextContent('Partially Ready');
  });

  it('should render fallback when no backends connected', () => {
    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
        <RequireAnyBackend fallback={<div data-testid="fallback">Offline</div>}>
          <div data-testid="content">Ready</div>
        </RequireAnyBackend>
      </MultiBackendProvider>
    );

    expect(screen.getByTestId('fallback')).toHaveTextContent('Offline');
  });
});

// ============================================================================
// Tests: BackendStatus
// ============================================================================

describe('BackendStatus', () => {
  let mockClient: MockMultiBackendClient;

  beforeEach(() => {
    mockClient = createMockMultiBackendClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should display backend name and status', () => {
    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
        <BackendStatus backend="core" />
      </MultiBackendProvider>
    );

    const status = screen.getByText(/core:/);
    expect(status).toHaveTextContent('core: disconnected');
  });

  it('should display connected status', async () => {
    mockClient._triggerConnect('core');

    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={true}>
        <BackendStatus backend="core" />
      </MultiBackendProvider>
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const status = screen.getByText(/core:/);
    expect(status).toHaveTextContent('core: connected');
  });

  it('should display connecting status', async () => {
    const connectingClient = createMockMultiBackendClient();
    connectingClient.connect = vi.fn().mockImplementation(async (name?: string) => {
      if (name) {
        connectingClient._triggerConnecting(name);
      }
      await new Promise(() => {});
    });

    render(
      <MultiBackendProvider client={connectingClient as unknown as IMultiBackendClient} autoConnect={true}>
        <BackendStatus backend="core" />
      </MultiBackendProvider>
    );

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    const status = screen.getByText(/core:/);
    expect(status).toHaveTextContent('core: connecting');
  });

  it('should display error status', async () => {
    const error = new Error('Connection failed');
    const errorClient = createMockMultiBackendClient();
    errorClient.connect = vi.fn().mockImplementation(async (name?: string) => {
      if (name) {
        errorClient._triggerError(name, error);
      }
      throw error;
    });

    render(
      <MultiBackendProvider client={errorClient as unknown as IMultiBackendClient} autoConnect={true}>
        <BackendStatus backend="core" />
      </MultiBackendProvider>
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const status = screen.getByText(/core:/);
    expect(status).toHaveTextContent('core: error');
  });

  it('should display error message when showError=true', async () => {
    const error = new Error('Connection failed');
    const errorClient = createMockMultiBackendClient();
    errorClient.connect = vi.fn().mockImplementation(async (name?: string) => {
      if (name) {
        errorClient._triggerError(name, error);
      }
      throw error;
    });

    render(
      <MultiBackendProvider client={errorClient as unknown as IMultiBackendClient} autoConnect={true}>
        <BackendStatus backend="core" showError={true} />
      </MultiBackendProvider>
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const status = screen.getByText(/core:/);
    expect(status).toHaveTextContent('(Connection failed)');
  });

  it('should apply custom className', () => {
    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
        <BackendStatus backend="core" className="custom-status" />
      </MultiBackendProvider>
    );

    const status = screen.getByText(/core:/);
    expect(status).toHaveClass('custom-status');
  });

  it('should include data attributes', () => {
    render(
      <MultiBackendProvider client={mockClient as unknown as IMultiBackendClient} autoConnect={false}>
        <BackendStatus backend="core" />
      </MultiBackendProvider>
    );

    const status = screen.getByText(/core:/);
    expect(status).toHaveAttribute('data-backend', 'core');
    expect(status).toHaveAttribute('data-status', 'disconnected');
  });
});
