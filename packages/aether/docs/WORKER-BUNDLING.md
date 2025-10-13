# Worker Bundling System

Comprehensive worker bundling capabilities for the Aether build system, supporting all major worker types with advanced optimization features.

## Features

- **Multiple Worker Types**: Web Workers, Service Workers, Shared Workers, and Module Workers
- **Automatic Detection**: Detects worker instantiation in source code
- **Smart Inlining**: Inline small workers as blob URLs for optimal performance
- **Code Optimization**: Minification, tree shaking, and source maps
- **Type Safety**: Full TypeScript support with type-safe communication
- **Worker Pool**: Managed worker pools with automatic lifecycle management
- **Service Worker Support**: PWA capabilities with caching strategies
- **HMR Support**: Hot module replacement for workers in development
- **Performance Monitoring**: Track worker performance metrics

## Usage

### Basic Configuration

```typescript
import { aetherBuildPlugin } from '@omnitron-dev/aether/build/vite-plugin';

export default {
  plugins: [
    aetherBuildPlugin({
      workerBundling: true,
      workerOptions: {
        inline: true,
        inlineThreshold: 50000, // 50KB
        minify: true,
        sourcemap: true,
      },
    }),
  ],
};
```

### Web Workers

```typescript
// Automatic detection and bundling
const worker = new Worker('./compute.worker.ts');

worker.postMessage({ value: 42 });
worker.onmessage = (e) => {
  console.log('Result:', e.data);
};
```

### Module Workers

```typescript
// ES Module workers
const worker = new Worker('./module.worker.ts', { type: 'module' });
```

### Service Workers

```typescript
// Service worker with caching strategies
export default {
  plugins: [
    aetherBuildPlugin({
      workerOptions: {
        serviceWorker: {
          strategy: 'cache-first',
          precache: ['/index.html', '/app.js', '/styles.css'],
          backgroundSync: true,
          pushNotifications: true,
        },
      },
    }),
  ],
};

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
```

### Shared Workers

```typescript
const shared = new SharedWorker('./shared.worker.ts', 'my-worker');

shared.port.postMessage({ type: 'connect' });
shared.port.onmessage = (e) => {
  console.log('Shared worker response:', e.data);
};
```

## Advanced Features

### Type-Safe Worker Communication

```typescript
import { TypedWorker } from '@omnitron-dev/aether/build/worker-bundling';

interface SendMessage {
  type: 'calculate';
  value: number;
}

interface ReceiveMessage {
  type: 'result';
  value: number;
}

const rawWorker = new Worker('./worker.ts');
const worker = new TypedWorker<SendMessage, ReceiveMessage>(rawWorker);

// Type-safe send
worker.send('calculate', { type: 'calculate', value: 42 });

// Type-safe receive
worker.on('result', (payload) => {
  console.log('Result:', payload.value); // Type-checked
});

// Request-response pattern
const result = await worker.sendAndWait('calculate', {
  type: 'calculate',
  value: 21,
});
```

### Worker Pool Management

```typescript
import { WorkerPool } from '@omnitron-dev/aether/build/worker-bundling';

const pool = new WorkerPool(
  () => new Worker('./worker.ts'),
  {
    maxWorkers: 4,
    minWorkers: 1,
    idleTimeout: 30000,
    recycleWorkers: true,
  },
);

// Execute task on available worker
const result = await pool.execute('compute', { value: 42 });

// Broadcast to all workers
pool.broadcast('update', { config: newConfig });

// Cleanup
pool.terminate();
```

### Service Worker Caching Strategies

#### Cache First (Default)
```typescript
{
  serviceWorker: {
    strategy: 'cache-first', // Try cache, fallback to network
  }
}
```

#### Network First
```typescript
{
  serviceWorker: {
    strategy: 'network-first', // Try network, fallback to cache
  }
}
```

#### Stale While Revalidate
```typescript
{
  serviceWorker: {
    strategy: 'stale-while-revalidate', // Serve from cache, update in background
  }
}
```

#### Runtime Caching Rules
```typescript
{
  serviceWorker: {
    runtimeCaching: [
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif)$/,
        handler: 'cache-first',
        options: {
          cacheName: 'images',
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          },
        },
      },
      {
        urlPattern: /\/api\//,
        handler: 'network-first',
        options: {
          cacheName: 'api-cache',
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 5 * 60, // 5 minutes
          },
        },
      },
    ],
  }
}
```

### Performance Monitoring

```typescript
import { WorkerPerformanceMonitor } from '@omnitron-dev/aether/build/worker-bundling';

const monitor = new WorkerPerformanceMonitor();

// Track messages
monitor.trackMessage('worker-1', true); // sent
monitor.trackMessage('worker-1', false); // received

// Track latency
monitor.trackLatency('worker-1', 25); // 25ms

// Get metrics
const metrics = monitor.getMetrics('worker-1');
console.log('Messages sent:', metrics.messagesSent);
console.log('Messages received:', metrics.messagesReceived);
console.log('Average latency:', metrics.averageLatency);
```

### HMR Support

Workers are automatically reloaded during development when their source code changes:

```typescript
import { HMRWorkerManager } from '@omnitron-dev/aether/build/worker-bundling';

const manager = new HMRWorkerManager();

// Register worker
const worker = new Worker('./worker.ts');
manager.register('worker-1', worker);

// Reload worker on HMR
if (import.meta.hot) {
  import.meta.hot.accept('./worker.ts', () => {
    manager.reload('worker-1', () => new Worker('./worker.ts'));
  });
}
```

## Configuration Options

### WorkerBundlingConfig

```typescript
interface WorkerBundlingConfig {
  // Inline small workers as blob URLs
  inline?: boolean; // default: true

  // Maximum size for inlining (bytes)
  inlineThreshold?: number; // default: 50000 (50KB)

  // Output format
  format?: 'es' | 'iife'; // default: 'es'

  // Worker-specific plugins
  plugins?: RollupPlugin[];

  // Worker-specific rollup options
  rollupOptions?: RollupOptions;

  // Enable minification
  minify?: boolean; // default: true

  // Generate source maps
  sourcemap?: boolean; // default: true

  // Enable code splitting for workers
  codeSplitting?: boolean; // default: false

  // Enable tree shaking
  treeShaking?: boolean; // default: true

  // Worker pool configuration
  pool?: WorkerPoolConfig;

  // Service worker options
  serviceWorker?: ServiceWorkerConfig;

  // Enable HMR
  hmr?: boolean; // default: true in development

  // Enable caching
  cache?: boolean; // default: true

  // Cache directory
  cacheDir?: string; // default: '.aether/worker-cache'
}
```

### WorkerPoolConfig

```typescript
interface WorkerPoolConfig {
  // Maximum workers in pool
  maxWorkers?: number; // default: 4

  // Minimum workers in pool
  minWorkers?: number; // default: 1

  // Worker idle timeout (ms)
  idleTimeout?: number; // default: 30000 (30 seconds)

  // Enable worker recycling
  recycleWorkers?: boolean; // default: true
}
```

### ServiceWorkerConfig

```typescript
interface ServiceWorkerConfig {
  // PWA manifest path
  manifest?: string;

  // Caching strategy
  strategy?: CacheStrategy; // default: 'cache-first'

  // Enable background sync
  backgroundSync?: boolean; // default: false

  // Enable push notifications
  pushNotifications?: boolean; // default: false

  // Cache name prefix
  cacheName?: string; // default: 'aether-cache'

  // Routes to precache
  precache?: string[];

  // Runtime caching rules
  runtimeCaching?: RuntimeCacheRule[];
}
```

## Best Practices

### 1. Worker Size Management

Keep workers small and focused. Large workers should not be inlined:

```typescript
{
  workerOptions: {
    inline: true,
    inlineThreshold: 50000, // Inline only if < 50KB
  }
}
```

### 2. Code Splitting

For large worker applications, enable code splitting:

```typescript
{
  workerOptions: {
    codeSplitting: true,
  }
}
```

### 3. Error Handling

Always handle worker errors:

```typescript
const worker = new Worker('./worker.ts');

worker.onerror = (error) => {
  console.error('Worker error:', error);
};

worker.onmessageerror = (error) => {
  console.error('Worker message error:', error);
};
```

### 4. Memory Management

Terminate workers when no longer needed:

```typescript
// Terminate single worker
worker.terminate();

// Terminate worker pool
pool.terminate();

// Terminate all workers (HMR)
hmrManager.terminateAll();
```

### 5. Service Worker Lifecycle

Handle service worker lifecycle events:

```typescript
// In your app
navigator.serviceWorker.register('/sw.js').then((registration) => {
  registration.addEventListener('updatefound', () => {
    const newWorker = registration.installing;
    newWorker?.addEventListener('statechange', () => {
      if (newWorker.state === 'activated') {
        // New service worker activated
        window.location.reload();
      }
    });
  });
});
```

## Testing

### Mock Workers

Use the provided MockWorker for testing:

```typescript
import { MockWorker } from '@omnitron-dev/aether/build/worker-bundling';

const mockWorker = new MockWorker();
mockWorker.onmessage = (event) => {
  // Handle message
};

mockWorker.postMessage({ test: true });
```

### Testing Service Workers

```typescript
// Mock service worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('test-cache').then((cache) => {
      return cache.addAll(['/test.html']);
    }),
  );
});
```

## Performance Tips

1. **Use Module Workers**: ES modules enable better tree shaking
2. **Enable Minification**: Reduces worker size significantly
3. **Use Worker Pools**: Reuse workers instead of creating new ones
4. **Inline Small Workers**: Reduces HTTP requests
5. **Use Service Workers**: Cache assets for offline support
6. **Monitor Performance**: Track worker metrics to identify bottlenecks

## Troubleshooting

### Workers Not Detected

Ensure your worker instantiation uses standard patterns:

```typescript
// ✓ Detected
new Worker('./worker.js');
new Worker('./worker.js', { type: 'module' });

// ✗ Not detected
const path = './worker.js';
new Worker(path); // Dynamic path
```

### Service Worker Not Registering

1. Check HTTPS requirement (localhost is exempt)
2. Verify service worker path is correct
3. Check browser console for errors
4. Ensure service worker scope is correct

### Worker Not Inlined

Check the size:

```typescript
// If worker is larger than threshold, it won't be inlined
{
  workerOptions: {
    inlineThreshold: 100000, // Increase threshold
  }
}
```

## Browser Support

- **Web Workers**: All modern browsers
- **Module Workers**: Chrome 80+, Edge 80+, Safari 15+
- **Service Workers**: Chrome 40+, Edge 17+, Safari 11.1+, Firefox 44+
- **Shared Workers**: Chrome, Edge, Firefox (not Safari)

## Examples

See the `/examples` directory for complete working examples:

- `examples/worker-basic/` - Basic Web Worker usage
- `examples/worker-pool/` - Worker pool management
- `examples/service-worker/` - PWA with service worker
- `examples/shared-worker/` - Shared worker communication
- `examples/worker-typescript/` - Type-safe worker communication

## License

MIT
