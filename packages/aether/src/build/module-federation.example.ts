/**
 * Module Federation Examples
 * Real-world usage examples for Aether Module Federation
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { defineConfig } from 'vite';
import { moduleFederationPlugin, loadRemoteComponent } from '@omnitron-dev/aether/build/module-federation';
import { defineComponent, signal, lazy, Suspense, ErrorBoundary } from '@omnitron-dev/aether';

// ==============================================
// Example 1: Basic Host Configuration
// ==============================================

/**
 * Host application that consumes remote components
 */
export const hostConfig = defineConfig({
  plugins: [
    moduleFederationPlugin({
      name: 'host-app',
      remotes: {
        'design-system': 'http://localhost:3001',
        'dashboard': 'http://localhost:3002',
      },
      shared: {
        '@omnitron-dev/aether': {
          singleton: true,
          version: '1.0.0',
          requiredVersion: '^1.0.0',
        },
      },
    }),
  ],
});

// ==============================================
// Example 2: Basic Remote Configuration
// ==============================================

/**
 * Remote application that exposes components
 */
export const remoteConfig = defineConfig({
  plugins: [
    moduleFederationPlugin({
      name: 'design-system',
      filename: 'remoteEntry.js',
      exposes: {
        './Button': './src/components/Button.tsx',
        './Input': './src/components/Input.tsx',
        './Card': './src/components/Card.tsx',
        './Modal': './src/components/Modal.tsx',
      },
      shared: {
        '@omnitron-dev/aether': {
          singleton: true,
          version: '1.0.0',
        },
      },
    }),
  ],
});

// ==============================================
// Example 3: Component with Remote Loading
// ==============================================

/**
 * Load remote button component with error handling
 */
const RemoteButton = lazy(
  loadRemoteComponent('design-system', 'Button', LocalButtonFallback),
);

/**
 * App component using remote components
 */
export const App = defineComponent(() => {
  const [count, setCount] = signal(0);

  return () => (
    <div>
      <h1>Host Application</h1>

      <ErrorBoundary
        fallback={(error) => (
          <div class="error">
            Failed to load remote component: {error.message}
          </div>
        )}
      >
        <Suspense fallback={<div>Loading button...</div>}>
          <RemoteButton label="Click me" onClick={() => setCount(count() + 1)} />
        </Suspense>
      </ErrorBoundary>

      <p>Count: {count()}</p>
    </div>
  );
});

// ==============================================
// Example 4: Multiple Remotes
// ==============================================

/**
 * Multi-remote host configuration
 */
export const multiRemoteConfig = defineConfig({
  plugins: [
    moduleFederationPlugin({
      name: 'main-app',
      remotes: {
        'design-system': 'http://localhost:3001',
        'data-visualization': 'http://localhost:3002',
        'authentication': 'http://localhost:3003',
        'analytics': 'http://localhost:3004',
      },
      shared: {
        '@omnitron-dev/aether': {
          singleton: true,
          eager: true,
          version: '1.0.0',
        },
        'chart.js': {
          singleton: true,
          version: '4.0.0',
        },
      },
    }),
  ],
});

/**
 * Dashboard using multiple remote components
 */
export const Dashboard = defineComponent(() => {
  const RemoteChart = lazy(loadRemoteComponent('data-visualization', 'Chart'));
  const RemoteUserMenu = lazy(loadRemoteComponent('authentication', 'UserMenu'));
  const RemoteAnalyticsWidget = lazy(loadRemoteComponent('analytics', 'Widget'));

  return () => (
    <div class="dashboard">
      <header>
        <h1>Dashboard</h1>
        <Suspense fallback={<div>Loading menu...</div>}>
          <RemoteUserMenu />
        </Suspense>
      </header>

      <main>
        <Suspense fallback={<div>Loading chart...</div>}>
          <RemoteChart data={[1, 2, 3, 4, 5]} />
        </Suspense>

        <Suspense fallback={<div>Loading analytics...</div>}>
          <RemoteAnalyticsWidget />
        </Suspense>
      </main>
    </div>
  );
});

// ==============================================
// Example 5: Bidirectional Federation
// ==============================================

/**
 * App 1: Exposes and consumes
 */
export const app1Config = defineConfig({
  plugins: [
    moduleFederationPlugin({
      name: 'app1',
      exposes: {
        './Calculator': './src/features/Calculator.tsx',
        './DataTable': './src/features/DataTable.tsx',
      },
      remotes: {
        'app2': 'http://localhost:3002',
      },
      shared: {
        '@omnitron-dev/aether': {
          singleton: true,
          version: '1.0.0',
        },
      },
    }),
  ],
});

/**
 * App 2: Exposes and consumes
 */
export const app2Config = defineConfig({
  plugins: [
    moduleFederationPlugin({
      name: 'app2',
      exposes: {
        './Editor': './src/features/Editor.tsx',
        './Preview': './src/features/Preview.tsx',
      },
      remotes: {
        'app1': 'http://localhost:3001',
      },
      shared: {
        '@omnitron-dev/aether': {
          singleton: true,
          version: '1.0.0',
        },
      },
    }),
  ],
});

// ==============================================
// Example 6: Runtime Remote Registration
// ==============================================

/**
 * Dynamic remote registration at runtime
 */
export const DynamicRemoteLoader = defineComponent(() => {
  const [remotes, setRemotes] = signal<Array<{ name: string; url: string }>>([]);
  const [selectedRemote, setSelectedRemote] = signal<string | null>(null);

  const addRemote = (name: string, url: string) => {
    // Register with runtime
    window.__FEDERATION__.registerRemote(name, url);

    // Add to state
    setRemotes([...remotes(), { name, url }]);
  };

  const loadRemoteComponent = async (remoteName: string, moduleName: string) => {
    try {
      const component = await window.__FEDERATION__.loadRemote(remoteName, moduleName);
      setSelectedRemote(remoteName);
      return component;
    } catch (error) {
      console.error('Failed to load remote:', error);
      return null;
    }
  };

  return () => (
    <div>
      <h2>Dynamic Remotes</h2>

      <div class="remote-form">
        <input type="text" id="remote-name" placeholder="Remote name" />
        <input type="text" id="remote-url" placeholder="Remote URL" />
        <button
          onClick={() => {
            const name = (document.getElementById('remote-name') as HTMLInputElement).value;
            const url = (document.getElementById('remote-url') as HTMLInputElement).value;
            addRemote(name, url);
          }}
        >
          Add Remote
        </button>
      </div>

      <div class="remote-list">
        <h3>Available Remotes:</h3>
        <ul>
          {remotes().map((remote) => (
            <li>
              {remote.name} ({remote.url})
              <button onClick={() => loadRemoteComponent(remote.name, 'default')}>Load</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
});

// ==============================================
// Example 7: Production Configuration
// ==============================================

/**
 * Production-ready configuration
 */
export const productionConfig = defineConfig({
  plugins: [
    moduleFederationPlugin({
      name: 'production-app',
      remotes: {
        'design-system': process.env.DESIGN_SYSTEM_URL || 'https://cdn.example.com/design-system',
        'analytics': process.env.ANALYTICS_URL || 'https://cdn.example.com/analytics',
      },
      shared: {
        '@omnitron-dev/aether': {
          singleton: true,
          version: '1.0.0',
          requiredVersion: '^1.0.0',
          eager: true,
        },
        'react': {
          singleton: true,
          version: '18.0.0',
          requiredVersion: '^18.0.0',
        },
      },
      runtime: {
        errorBoundaries: true,
        retry: true,
        maxRetries: 3,
        timeout: 30000,
      },
      generateTypes: true,
      typesDir: './types/remotes',
    }),
  ],
});

// ==============================================
// Example 8: Advanced Error Handling
// ==============================================

/**
 * Component with comprehensive error handling
 */
export const RobustRemoteComponent = defineComponent(() => {
  const [error, setError] = signal<Error | null>(null);
  const [loading, setLoading] = signal(true);
  const [component, setComponent] = signal<any>(null);

  const loadComponent = async () => {
    setLoading(true);
    setError(null);

    try {
      const runtime = window.__FEDERATION__;
      if (!runtime) {
        throw new Error('Module Federation runtime not initialized');
      }

      const loaded = await runtime.loadRemote('design-system', 'Button');
      setComponent(() => loaded);
    } catch (err) {
      console.error('Failed to load remote component:', err);
      setError(err as Error);

      // Fallback to local component
      setComponent(() => LocalButtonFallback);
    } finally {
      setLoading(false);
    }
  };

  // Load on mount
  loadComponent();

  return () => (
    <div>
      {loading() && <div class="spinner">Loading...</div>}

      {error() && (
        <div class="error-banner">
          <p>Failed to load remote component</p>
          <button onClick={loadComponent}>Retry</button>
        </div>
      )}

      {component() && <component.default />}
    </div>
  );
});

// ==============================================
// Example 9: Shared State Across Remotes
// ==============================================

/**
 * Shared store that works across remote boundaries
 */
import { createStore } from '@omnitron-dev/aether/store';

// Create shared store
const sharedStore = createStore({
  user: null as { name: string; email: string } | null,
  theme: 'light' as 'light' | 'dark',
  notifications: [] as string[],
});

// Register store globally for remotes
window.__SHARED_STORE__ = sharedStore;

/**
 * Remote component using shared store
 */
export const RemoteUserProfile = defineComponent(() => {
  const store = window.__SHARED_STORE__;

  return () => (
    <div class="user-profile">
      <h2>User Profile</h2>
      {store.user() ? (
        <div>
          <p>Name: {store.user()!.name}</p>
          <p>Email: {store.user()!.email}</p>
        </div>
      ) : (
        <p>Not logged in</p>
      )}
    </div>
  );
});

// ==============================================
// Example 10: Testing Setup
// ==============================================

import { describe, it, expect, beforeEach } from 'vitest';
import { testUtils } from '@omnitron-dev/aether/build/module-federation';

describe('App with Module Federation', () => {
  let mockRuntime: any;

  beforeEach(() => {
    // Create mock runtime
    mockRuntime = testUtils.createMockRuntime({
      retry: false,
      timeout: 5000,
    });

    // Mock remote components
    mockRuntime.mockRemote('design-system', 'Button', {
      default: () => <button>Mocked Button</button>,
    });

    mockRuntime.mockRemote('design-system', 'Input', {
      default: () => <input type="text" placeholder="Mocked Input" />,
    });

    // Setup global runtime
    window.__FEDERATION__ = mockRuntime;
  });

  it('should load and render remote button', async () => {
    const Button = await mockRuntime.loadRemote('design-system', 'Button');
    expect(Button).toBeDefined();
    expect(Button.default).toBeInstanceOf(Function);
  });

  it('should handle loading errors gracefully', async () => {
    const loader = loadRemoteComponent('design-system', 'NonExistent', () => (
      <div>Fallback</div>
    ));

    const component = await loader();
    expect(component).toBeDefined();
  });
});

// ==============================================
// Helper Types and Utilities
// ==============================================

// Fallback button component
const LocalButtonFallback = defineComponent((props: { label?: string; onClick?: () => void }) => {
  return () => (
    <button onClick={props.onClick} class="fallback-button">
      {props.label || 'Button (Local Fallback)'}
    </button>
  );
});

// Type declarations for global federation
declare global {
  interface Window {
    __SHARED_STORE__: any;
  }
}

// Environment type safety
interface RemoteConfig {
  DESIGN_SYSTEM_URL: string;
  ANALYTICS_URL: string;
}

declare module '*.env' {
  const env: RemoteConfig;
  export default env;
}
