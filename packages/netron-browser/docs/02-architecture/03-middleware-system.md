# Netron Browser Middleware System

Client-side middleware system for Netron Browser RPC clients. Provides a lightweight, browser-compatible middleware pipeline for intercepting and transforming RPC requests and responses.

## Features

- **Lightweight**: Minimal overhead, optimized for browser environments
- **Type-safe**: Full TypeScript support with strong typing
- **Composable**: Chain multiple middleware together
- **Flexible**: Support for pre-request, post-response, and error middleware
- **Built-in middleware**: Auth, logging, timing, and error transformation

## Installation

The middleware system is included with `@omnitron-dev/netron-browser`:

```bash
npm install @omnitron-dev/netron-browser
```

## Basic Usage

### With HTTP Client

```typescript
import { HttpClient } from '@omnitron-dev/netron-browser/client/http';
import {
  createAuthMiddleware,
  createLoggingMiddleware,
  createTimingMiddleware,
  SimpleTokenProvider,
} from '@omnitron-dev/netron-browser/middleware';

// Create client
const client = new HttpClient({
  url: 'http://localhost:3000',
});

// Add middleware
const tokenProvider = new SimpleTokenProvider('your-auth-token');
client.use(createAuthMiddleware({ tokenProvider }));
client.use(createLoggingMiddleware());
client.use(createTimingMiddleware());

// Make requests - middleware will be applied automatically
const result = await client.invoke('UserService', 'getUser', [123]);
```

### With WebSocket Client

```typescript
import { WebSocketClient } from '@omnitron-dev/netron-browser/client/websocket';
import { createAuthMiddleware, StorageTokenProvider } from '@omnitron-dev/netron-browser/middleware';

const client = new WebSocketClient({
  url: 'ws://localhost:3000',
});

// Add auth middleware using localStorage
const tokenProvider = new StorageTokenProvider(localStorage, 'auth_token');
client.use(createAuthMiddleware({ tokenProvider }));

await client.connect();
const result = await client.invoke('ChatService', 'sendMessage', ['Hello!']);
```

## Built-in Middleware

### Authentication Middleware

Automatically inject authentication tokens into requests:

```typescript
import {
  createAuthMiddleware,
  SimpleTokenProvider,
  StorageTokenProvider,
} from '@omnitron-dev/netron-browser/middleware';

// Simple token provider
const provider1 = new SimpleTokenProvider('my-token');

// Storage-based provider (localStorage/sessionStorage)
const provider2 = new StorageTokenProvider(localStorage, 'auth_token');

// Custom provider
const provider3 = {
  getToken: async () => {
    // Fetch token from your auth service
    return await getTokenFromAuthService();
  },
  getTokenType: () => 'Bearer ',
};

// Create middleware
const authMiddleware = createAuthMiddleware({
  tokenProvider: provider1,
  headerName: 'Authorization', // default
  tokenPrefix: 'Bearer ', // default
  skipServices: ['PublicService'], // optional
  skipMethods: ['UserService.logout'], // optional
});

client.use(authMiddleware);
```

### Logging Middleware

Log request and response information:

```typescript
import {
  createLoggingMiddleware,
  ConsoleLogger,
} from '@omnitron-dev/netron-browser/middleware';

const logger = new ConsoleLogger('[MyApp]');

const loggingMiddleware = createLoggingMiddleware({
  logger,
  requestLogLevel: 'info', // default
  responseLogLevel: 'info', // default
  errorLogLevel: 'error', // default
  logRequestPayload: false, // default
  logResponsePayload: false, // default
  skipServices: ['HealthCheckService'], // optional
});

client.use(loggingMiddleware);
```

Custom logger:

```typescript
const customLogger = {
  debug: (msg, data) => console.debug(msg, data),
  info: (msg, data) => console.info(msg, data),
  warn: (msg, data) => console.warn(msg, data),
  error: (msg, data) => console.error(msg, data),
};

client.use(createLoggingMiddleware({ logger: customLogger }));
```

### Timing Middleware

Measure and report performance metrics:

```typescript
import {
  createTimingMiddleware,
  InMemoryMetricsCollector,
} from '@omnitron-dev/netron-browser/middleware';

const collector = new InMemoryMetricsCollector(1000); // keep last 1000 metrics

const timingMiddleware = createTimingMiddleware({
  collector,
  slowThreshold: 1000, // warn if request > 1s
  onSlowRequest: (metrics) => {
    console.warn('Slow request detected:', metrics);
  },
  onMeasure: (metrics) => {
    // Send to analytics
    analytics.track('rpc_call', metrics);
  },
});

client.use(timingMiddleware);

// Access metrics
const avgDuration = collector.getAverageDuration('UserService', 'getUser');
const slowestCalls = collector.getSlowestCalls(10);
```

### Error Transformation Middleware

Normalize and transform errors:

```typescript
import {
  createErrorTransformMiddleware,
  CommonErrorMessages,
  isRetryableError,
  isClientError,
  isServerError,
} from '@omnitron-dev/netron-browser/middleware';

const errorMiddleware = createErrorTransformMiddleware({
  includeStack: true, // default
  includeContext: true, // default
  errorMessages: CommonErrorMessages, // user-friendly messages
  onError: (error) => {
    // Send to error tracking service
    if (isServerError(error)) {
      errorTracker.captureException(error);
    }
  },
});

client.use(errorMiddleware);
```

## Custom Middleware

Create your own middleware:

```typescript
import { MiddlewareStage } from '@omnitron-dev/netron-browser/middleware';

// Pre-request middleware
client.use(
  async (ctx, next) => {
    // Modify request
    ctx.request.headers['X-Client-Version'] = '1.0.0';
    ctx.metadata.set('startTime', Date.now());

    await next();
  },
  { name: 'add-version-header', priority: 1 },
  MiddlewareStage.PRE_REQUEST
);

// Post-response middleware
client.use(
  async (ctx, next) => {
    await next();

    // Transform response
    if (ctx.response?.data) {
      ctx.response.data = transformData(ctx.response.data);
    }
  },
  { name: 'transform-response', priority: 1 },
  MiddlewareStage.POST_RESPONSE
);

// Error middleware
client.use(
  async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      // Handle error
      console.error('RPC Error:', error);

      // Optionally transform or re-throw
      throw error;
    }
  },
  { name: 'error-handler', priority: 1 },
  MiddlewareStage.ERROR
);
```

## Advanced Usage

### Conditional Middleware

Execute middleware based on conditions:

```typescript
client.use(
  async (ctx, next) => {
    // Only for admin methods
    ctx.request.headers['X-Admin-Token'] = 'secret';
    await next();
  },
  {
    name: 'admin-auth',
    condition: (ctx) => ctx.method.startsWith('admin'),
  }
);
```

### Service-Specific Middleware

```typescript
client.getMiddleware().useForService(
  'UserService',
  async (ctx, next) => {
    // Only for UserService
    console.log('Calling UserService');
    await next();
  },
  { name: 'user-service-logger' }
);
```

### Method-Specific Middleware

```typescript
client.getMiddleware().useForMethod(
  'PaymentService',
  'processPayment',
  async (ctx, next) => {
    // Only for PaymentService.processPayment
    ctx.request.headers['X-Idempotency-Key'] = generateIdempotencyKey();
    await next();
  },
  { name: 'payment-idempotency' }
);
```

### Priority Control

```typescript
// Lower priority = executes first
client.use(middleware1, { name: 'first', priority: 1 });
client.use(middleware2, { name: 'second', priority: 2 });
client.use(middleware3, { name: 'third', priority: 3 });
```

### Skip Remaining Middleware

```typescript
client.use(
  async (ctx, next) => {
    // Check cache
    const cached = cache.get(ctx.service, ctx.method, ctx.args);
    if (cached) {
      ctx.response = { data: cached };
      ctx.skipRemaining = true; // Skip remaining middleware and request
      return;
    }

    await next();

    // Store in cache
    if (ctx.response?.data) {
      cache.set(ctx.service, ctx.method, ctx.args, ctx.response.data);
    }
  },
  { name: 'cache' }
);
```

## Middleware Context

The middleware context provides access to request/response data:

```typescript
interface ClientMiddlewareContext {
  // Request details
  service: string;
  method: string;
  args: any[];

  // Request/Response data
  request?: {
    headers?: Record<string, string>;
    timeout?: number;
    metadata?: Record<string, any>;
  };

  response?: {
    data?: any;
    headers?: Record<string, string>;
    metadata?: Record<string, any>;
  };

  // Error handling
  error?: Error;

  // Timing information
  timing: {
    start: number;
    end?: number;
    middlewareTimes: Map<string, number>;
  };

  // Metadata storage
  metadata: Map<string, any>;

  // Control flow
  skipRemaining?: boolean;

  // Transport type
  transport: 'http' | 'websocket';
}
```

## Best Practices

1. **Keep middleware lightweight**: Middleware runs on every request, so keep it fast
2. **Use priorities wisely**: Auth middleware should run first (priority: 1)
3. **Handle errors gracefully**: Always use try-catch in error-sensitive middleware
4. **Use metadata for communication**: Store data in `ctx.metadata` to share between middleware
5. **Be mindful of order**: Middleware execution order matters

## Examples

### Complete Setup

```typescript
import { HttpClient } from '@omnitron-dev/netron-browser/client/http';
import {
  createAuthMiddleware,
  createLoggingMiddleware,
  createTimingMiddleware,
  createErrorTransformMiddleware,
  SimpleTokenProvider,
  InMemoryMetricsCollector,
  CommonErrorMessages,
} from '@omnitron-dev/netron-browser/middleware';

// Create client
const client = new HttpClient({
  url: 'http://localhost:3000',
});

// Setup middleware
const tokenProvider = new SimpleTokenProvider(() => getAuthToken());
const metricsCollector = new InMemoryMetricsCollector();

client
  .use(createAuthMiddleware({ tokenProvider }), { priority: 1 })
  .use(createLoggingMiddleware({ logRequestPayload: true }), { priority: 2 })
  .use(createTimingMiddleware({ collector: metricsCollector }), { priority: 3 })
  .use(
    createErrorTransformMiddleware({
      errorMessages: CommonErrorMessages,
      onError: (error) => errorTracker.capture(error),
    }),
    { priority: 4 }
  );

// Make requests
const result = await client.invoke('UserService', 'getUser', [123]);

// Check metrics
console.log('Average latency:', metricsCollector.getAverageDuration());
```

## License

MIT
