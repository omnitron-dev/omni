# Aether Module Federation Guide

Comprehensive guide for using Module Federation in Aether applications to build micro-frontends.

## Table of Contents

1. [Introduction](#introduction)
2. [Quick Start](#quick-start)
3. [Configuration](#configuration)
4. [Exposing Modules](#exposing-modules)
5. [Consuming Remote Modules](#consuming-remote-modules)
6. [Shared Dependencies](#shared-dependencies)
7. [Runtime API](#runtime-api)
8. [TypeScript Support](#typescript-support)
9. [Testing](#testing)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)

## Introduction

Module Federation enables you to:
- Split applications into independently deployable micro-frontends
- Share code between applications at runtime
- Load remote components dynamically
- Manage shared dependencies efficiently

## Quick Start

### Host Application

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { moduleFederationPlugin } from '@omnitron-dev/aether/build/module-federation';

export default defineConfig({
  plugins: [
    moduleFederationPlugin({
      name: 'host-app',
      remotes: {
        'remote-app': 'http://localhost:3001',
      },
      shared: {
        '@omnitron-dev/aether': '1.0.0',
        'react': '18.0.0',
      },
    }),
  ],
});
```

### Remote Application

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { moduleFederationPlugin } from '@omnitron-dev/aether/build/module-federation';

export default defineConfig({
  plugins: [
    moduleFederationPlugin({
      name: 'remote-app',
      filename: 'remoteEntry.js',
      exposes: {
        './Button': './src/components/Button.tsx',
        './Card': './src/components/Card.tsx',
      },
      shared: {
        '@omnitron-dev/aether': '1.0.0',
        'react': '18.0.0',
      },
    }),
  ],
});
```

## Configuration

### ModuleFederationConfig

```typescript
interface ModuleFederationConfig {
  // Unique name for this federated module
  name: string;

  // Remote entry filename (default: 'remoteEntry.js')
  filename?: string;

  // Modules to expose
  exposes?: Record<string, string>;

  // Remote modules to consume
  remotes?: Record<string, string>;

  // Shared dependencies
  shared?: Record<string, string | ShareConfig>;

  // Generate TypeScript types
  generateTypes?: boolean;

  // Types output directory
  typesDir?: string;

  // Runtime configuration
  runtime?: {
    errorBoundaries?: boolean;
    retry?: boolean;
    maxRetries?: number;
    timeout?: number;
  };
}
```

### ShareConfig

```typescript
interface ShareConfig {
  // Module version
  version?: string;

  // Ensure only one instance is loaded
  singleton?: boolean;

  // Required version range
  requiredVersion?: string;

  // Load eagerly (not lazy)
  eager?: boolean;

  // Share scope
  shareScope?: string;
}
```

## Exposing Modules

### Basic Example

```typescript
// Remote App: vite.config.ts
export default defineConfig({
  plugins: [
    moduleFederationPlugin({
      name: 'design-system',
      exposes: {
        './Button': './src/components/Button.tsx',
        './Input': './src/components/Input.tsx',
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
```

### Component Example

```typescript
// src/components/Button.tsx
import { defineComponent, signal } from '@omnitron-dev/aether';

export const Button = defineComponent((props: {
  label: string;
  onClick?: () => void
}) => {
  const [count, setCount] = signal(0);

  return () => (
    <button
      onClick={() => {
        setCount(count() + 1);
        props.onClick?.();
      }}
    >
      {props.label} (clicked {count()} times)
    </button>
  );
});

export default Button;
```

## Consuming Remote Modules

### Static Import (Development)

```typescript
// Host App: src/App.tsx
import RemoteButton from 'design-system/Button';

export const App = defineComponent(() => {
  return () => (
    <div>
      <h1>Host Application</h1>
      <RemoteButton label="Click me" />
    </div>
  );
});
```

### Dynamic Import (Production)

```typescript
// Host App: src/App.tsx
import { loadRemoteComponent } from '@omnitron-dev/aether/build/module-federation';
import { lazy, Suspense } from '@omnitron-dev/aether';

// Load with error boundary
const RemoteButton = lazy(
  loadRemoteComponent('design-system', 'Button', FallbackButton)
);

export const App = defineComponent(() => {
  return () => (
    <div>
      <Suspense fallback={<div>Loading...</div>}>
        <RemoteButton label="Click me" />
      </Suspense>
    </div>
  );
});
```

### With Error Handling

```typescript
import { loadRemoteComponent } from '@omnitron-dev/aether/build/module-federation';

const RemoteButton = lazy(async () => {
  try {
    return await loadRemoteComponent('design-system', 'Button')();
  } catch (error) {
    console.error('Failed to load remote component:', error);
    // Return fallback component
    return FallbackButton;
  }
});
```

## Shared Dependencies

### Basic Sharing

```typescript
shared: {
  'react': '18.0.0',
  'react-dom': '18.0.0',
  '@omnitron-dev/aether': '1.0.0',
}
```

### Singleton Dependencies

```typescript
shared: {
  '@omnitron-dev/aether': {
    singleton: true,
    version: '1.0.0',
    requiredVersion: '^1.0.0',
  },
  'react': {
    singleton: true,
    version: '18.0.0',
    requiredVersion: '^18.0.0',
  },
}
```

### Eager Loading

```typescript
shared: {
  '@omnitron-dev/aether': {
    eager: true,
    singleton: true,
    version: '1.0.0',
  },
}
```

## Runtime API

### ModuleFederationRuntime

```typescript
import { ModuleFederationRuntime } from '@omnitron-dev/aether/build/module-federation';

// Initialize runtime
const runtime = new ModuleFederationRuntime({
  errorBoundaries: true,
  retry: true,
  maxRetries: 3,
  timeout: 30000,
});

// Register remotes
runtime.registerRemote('design-system', 'http://localhost:3001/remoteEntry.js');

// Load remote module
const Button = await runtime.loadRemote('design-system', 'Button');

// Register shared modules
runtime.registerShared('react', React, '18.0.0');

// Get shared module
const sharedReact = runtime.getShared('react');

// Check if remote is loaded
const isLoaded = runtime.isRemoteLoaded('design-system');

// Get remote error
const error = runtime.getRemoteError('design-system');
```

### loadRemoteComponent Helper

```typescript
import { loadRemoteComponent } from '@omnitron-dev/aether/build/module-federation';

const loader = loadRemoteComponent(
  'remote-name',
  'module-name',
  optionalFallback
);

// Use with lazy loading
const RemoteComponent = lazy(loader);
```

## TypeScript Support

### Auto-generated Types

Module Federation automatically generates TypeScript types for exposed modules:

```typescript
// types/Button.d.ts (auto-generated)
declare module 'design-system/Button' {
  const module: any;
  export default module;
}
```

### Custom Type Definitions

```typescript
// types/design-system.d.ts
declare module 'design-system/Button' {
  import type { Component } from '@omnitron-dev/aether';

  interface ButtonProps {
    label: string;
    onClick?: () => void;
  }

  const Button: Component<ButtonProps>;
  export default Button;
}
```

### Configure Type Generation

```typescript
moduleFederationPlugin({
  name: 'design-system',
  generateTypes: true,
  typesDir: './types',
  exposes: {
    './Button': './src/components/Button.tsx',
  },
});
```

## Testing

### Mock Remote Modules

```typescript
import { testUtils } from '@omnitron-dev/aether/build/module-federation';
import { describe, it, expect, beforeEach } from 'vitest';

describe('App with Remote Components', () => {
  let mockRuntime;

  beforeEach(() => {
    mockRuntime = testUtils.createMockRuntime();

    // Mock remote components
    mockRuntime.mockRemote('design-system', 'Button', {
      default: () => <button>Mocked Button</button>,
    });

    // Setup global runtime
    window.__FEDERATION__ = mockRuntime;
  });

  it('should render with mocked remote', async () => {
    const Button = await mockRuntime.loadRemote('design-system', 'Button');
    expect(Button).toBeDefined();
  });
});
```

### Test Utilities

```typescript
import { testUtils } from '@omnitron-dev/aether/build/module-federation';

// Create mock runtime
const runtime = testUtils.createMockRuntime();

// Create mock manifest
const manifest = testUtils.createMockManifest('test-app');

// Create mock remote container
const remote = testUtils.createMockRemote(
  'design-system',
  'http://localhost:3001',
  mockModule
);
```

## Best Practices

### 1. Version Management

```typescript
// Use consistent versioning
shared: {
  '@omnitron-dev/aether': {
    singleton: true,
    version: '1.0.0',
    requiredVersion: '^1.0.0', // Allow patch updates
  },
}
```

### 2. Error Boundaries

```typescript
// Always use error boundaries with remote components
import { ErrorBoundary } from '@omnitron-dev/aether';

<ErrorBoundary fallback={<FallbackComponent />}>
  <RemoteComponent />
</ErrorBoundary>
```

### 3. Loading States

```typescript
// Provide loading feedback
<Suspense fallback={<Spinner />}>
  <RemoteComponent />
</Suspense>
```

### 4. Fallback Components

```typescript
// Always provide fallbacks
const RemoteButton = lazy(
  loadRemoteComponent(
    'design-system',
    'Button',
    LocalButton // Fallback component
  )
);
```

### 5. Security

```typescript
// Only load remotes from trusted sources
remotes: {
  'design-system': process.env.VITE_DESIGN_SYSTEM_URL,
}

// Validate URLs in production
if (!isValidRemoteUrl(remoteUrl)) {
  throw new Error('Invalid remote URL');
}
```

### 6. Performance

```typescript
// Prefetch remote modules
runtime.loadRemote('design-system', 'Button').catch(() => {
  // Prefetch failed, will retry on demand
});

// Use code splitting
const RemoteButton = lazy(
  loadRemoteComponent('design-system', 'Button')
);
```

### 7. Development Workflow

```typescript
// Use environment variables for remote URLs
remotes: {
  'design-system': import.meta.env.DEV
    ? 'http://localhost:3001'
    : 'https://design-system.production.com',
}
```

## Troubleshooting

### Remote Module Not Loading

**Problem**: Remote module fails to load

**Solutions**:
1. Check remote URL is accessible
2. Verify CORS headers are set
3. Check network tab for failed requests
4. Ensure remote entry file is built

```typescript
// Enable detailed error logging
runtime.loadRemote('design-system', 'Button')
  .catch(error => {
    console.error('Remote load failed:', {
      error,
      remoteError: runtime.getRemoteError('design-system'),
    });
  });
```

### Version Conflicts

**Problem**: Multiple versions of shared dependencies

**Solutions**:
1. Use singleton: true for shared dependencies
2. Align versions across applications
3. Use requiredVersion to enforce compatibility

```typescript
shared: {
  'react': {
    singleton: true,
    requiredVersion: '^18.0.0',
    strictVersion: true,
  },
}
```

### TypeScript Errors

**Problem**: TypeScript can't find remote modules

**Solutions**:
1. Ensure types are generated: `generateTypes: true`
2. Add types to tsconfig.json
3. Create manual type definitions

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "design-system/*": ["./types/design-system/*"]
    }
  }
}
```

### HMR Not Working

**Problem**: Hot Module Replacement breaks with remotes

**Solutions**:
1. Restart dev server after remote changes
2. Use import() for dynamic imports
3. Configure HMR properly in Vite

```typescript
if (import.meta.hot) {
  import.meta.hot.accept();
}
```

## Advanced Examples

### Multi-Remote Application

```typescript
// Host with multiple remotes
moduleFederationPlugin({
  name: 'host',
  remotes: {
    'design-system': 'http://localhost:3001',
    'data-viz': 'http://localhost:3002',
    'auth': 'http://localhost:3003',
  },
  shared: {
    '@omnitron-dev/aether': {
      singleton: true,
      eager: true,
    },
  },
});
```

### Bidirectional Sharing

```typescript
// App 1
moduleFederationPlugin({
  name: 'app1',
  exposes: {
    './Feature': './src/Feature.tsx',
  },
  remotes: {
    'app2': 'http://localhost:3002',
  },
});

// App 2
moduleFederationPlugin({
  name: 'app2',
  exposes: {
    './Tool': './src/Tool.tsx',
  },
  remotes: {
    'app1': 'http://localhost:3001',
  },
});
```

### Dynamic Remote Registration

```typescript
import { ModuleFederationRuntime } from '@omnitron-dev/aether/build/module-federation';

const runtime = window.__FEDERATION__;

// Register remote at runtime
function addRemoteApp(name: string, url: string) {
  runtime.registerRemote(name, url);
}

// Use the dynamically registered remote
const module = await runtime.loadRemote('dynamic-app', 'Component');
```

## Resources

- [Webpack Module Federation](https://webpack.js.org/concepts/module-federation/)
- [Vite Plugin Federation](https://github.com/originjs/vite-plugin-federation)
- [Micro-Frontends](https://martinfowler.com/articles/micro-frontends.html)
- [Aether Documentation](https://github.com/omnitron-dev/aether)

## Support

For issues and questions:
- GitHub Issues: https://github.com/omnitron-dev/aether/issues
- Documentation: https://aether.omnitron.dev/module-federation
