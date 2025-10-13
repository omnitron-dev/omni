# Module Federation for Aether

> Build micro-frontends with Aether's Module Federation support

## Quick Start

### Install

```bash
npm install @omnitron-dev/aether
```

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
        'design-system': 'http://localhost:3001',
      },
      shared: {
        '@omnitron-dev/aether': '1.0.0',
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
      name: 'design-system',
      exposes: {
        './Button': './src/components/Button.tsx',
      },
      shared: {
        '@omnitron-dev/aether': '1.0.0',
      },
    }),
  ],
});
```

### Use Remote Components

```typescript
import { loadRemoteComponent, lazy, Suspense } from '@omnitron-dev/aether';

const RemoteButton = lazy(
  loadRemoteComponent('design-system', 'Button')
);

export const App = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <RemoteButton label="Click me" />
  </Suspense>
);
```

## Features

✅ **Module Exposure** - Share components across applications
✅ **Dynamic Loading** - Load remote modules at runtime
✅ **Shared Dependencies** - Efficient dependency sharing
✅ **TypeScript Support** - Full type safety with auto-generated types
✅ **Error Handling** - Built-in retry logic and fallbacks
✅ **Vite Integration** - Seamless Vite plugin
✅ **Testing Support** - Mock runtime for unit tests
✅ **HMR Support** - Hot module replacement in development

## Documentation

- **[Complete Guide](./src/build/MODULE_FEDERATION_GUIDE.md)** - Comprehensive usage guide
- **[Examples](./src/build/module-federation.example.ts)** - Real-world code examples
- **[Implementation Summary](./src/build/MODULE_FEDERATION_SUMMARY.md)** - Technical details
- **[API Reference](./src/build/module-federation.ts)** - Full API documentation

## API

### Configuration

```typescript
interface ModuleFederationConfig {
  name: string;                              // Unique name
  filename?: string;                          // Remote entry filename
  exposes?: Record<string, string>;          // Exposed modules
  remotes?: Record<string, string>;          // Remote apps
  shared?: Record<string, ShareConfig>;      // Shared dependencies
  generateTypes?: boolean;                   // Auto-generate types
  runtime?: {
    retry?: boolean;                         // Enable retries
    maxRetries?: number;                     // Max retry attempts
    timeout?: number;                        // Load timeout
  };
}
```

### Runtime API

```typescript
import { ModuleFederationRuntime } from '@omnitron-dev/aether/build/module-federation';

const runtime = new ModuleFederationRuntime();

// Register remote
runtime.registerRemote('design-system', 'http://localhost:3001/remoteEntry.js');

// Load module
const Button = await runtime.loadRemote('design-system', 'Button');

// Register shared
runtime.registerShared('react', React, '18.0.0');
```

### Helper Functions

```typescript
import { loadRemoteComponent } from '@omnitron-dev/aether/build/module-federation';

// Load with fallback
const RemoteButton = lazy(
  loadRemoteComponent('design-system', 'Button', LocalButton)
);
```

## Testing

```typescript
import { testUtils } from '@omnitron-dev/aether/build/module-federation';

describe('App', () => {
  let mockRuntime;

  beforeEach(() => {
    mockRuntime = testUtils.createMockRuntime();

    mockRuntime.mockRemote('design-system', 'Button', {
      default: () => <button>Mocked</button>,
    });

    window.__FEDERATION__ = mockRuntime;
  });

  it('should render remote component', async () => {
    const Button = await mockRuntime.loadRemote('design-system', 'Button');
    expect(Button).toBeDefined();
  });
});
```

## Examples

### Basic Setup

Host and remote applications with shared dependencies.

### Multiple Remotes

Load components from multiple remote applications.

### Bidirectional

Applications that both expose and consume modules.

### Dynamic Registration

Register remotes at runtime.

### Production Config

Production-ready configuration with error handling.

See [examples file](./src/build/module-federation.example.ts) for complete code.

## Best Practices

1. **Use Singletons** - Mark framework dependencies as singleton
2. **Error Boundaries** - Always wrap remote components
3. **Loading States** - Show loading indicators
4. **Fallbacks** - Provide fallback components
5. **Version Management** - Use semver for compatibility
6. **Security** - Only load from trusted sources

## Browser Support

- Chrome/Edge (modern)
- Firefox (modern)
- Safari (modern)
- Requires ES2022 and dynamic imports

## Performance

- Core runtime: ~3KB gzipped
- Plugin overhead: ~2KB gzipped
- Lazy loading by default
- Concurrent module loading
- Deduplication of requests

## TypeScript

```typescript
// Auto-generated types
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

## License

MIT

## Support

- [GitHub Issues](https://github.com/omnitron-dev/aether/issues)
- [Documentation](https://aether.omnitron.dev)
- [Examples](https://github.com/omnitron-dev/aether-examples)

---

Built with ❤️ for the Aether framework
