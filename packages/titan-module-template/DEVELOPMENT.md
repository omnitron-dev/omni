# Development Guide

## Getting Started

This guide will help you transform this template into your own Titan module.

## Step-by-Step Transformation

### 1. Rename the Module

```bash
# From the packages directory
cp -r titan-module-template your-module-name
cd your-module-name
```

### 2. Update Package Information

Edit `package.json`:
- Change `name` to `@omnitron-dev/your-module-name`
- Update `description`
- Update repository `directory`

### 3. Global Find and Replace

Replace in all files:
- `TemplateModule` → `YourModule`
- `TemplateService` → `YourService`
- `template.module` → `your.module`
- `template.service` → `your.service`
- `TEMPLATE_` → `YOUR_PREFIX_`
- `template:` → `your-prefix:`

### 4. Update Imports

Update all import paths to match your new module name:
```typescript
// Before
import { TemplateModule } from './template.module.js';

// After
import { YourModule } from './your.module.js';
```

### 5. Customize Types

Edit `src/types.ts` to define your module's specific types:
```typescript
export interface YourModuleOptions {
  // Your specific options
}

export interface YourData {
  // Your data structures
}
```

### 6. Implement Your Services

Replace the example services with your actual implementation:
```typescript
@Injectable()
export class YourService {
  async yourMethod(): Promise<YourResult> {
    // Your implementation
  }
}
```

### 7. Update Tests

Modify tests to cover your specific functionality:
```typescript
describe('YourService', () => {
  it('should perform your specific operation', async () => {
    // Your test
  });
});
```

## Common Patterns

### Adding External Dependencies

If your module needs external services (Redis, Database, etc.):

```typescript
export interface YourModuleOptions {
  redis?: RedisOptions;
  database?: DatabaseOptions;
}

@Injectable()
export class YourService {
  private redis?: Redis;

  constructor(
    @Inject(YOUR_MODULE_OPTIONS) private options: YourModuleOptions
  ) {
    if (options.redis) {
      this.redis = new Redis(options.redis);
    }
  }
}
```

### Adding Configuration Validation

Use Zod for configuration validation:

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  apiKey: z.string().min(1),
  endpoint: z.string().url(),
  timeout: z.number().positive().default(5000)
});

export class YourModule {
  static forRoot(options: unknown): YourModule {
    const validated = ConfigSchema.parse(options);
    return new YourModule(validated);
  }
}
```

### Adding Background Jobs

```typescript
@Injectable()
export class YourBackgroundService {
  private interval?: NodeJS.Timer;

  async start(): Promise<void> {
    this.interval = setInterval(() => {
      this.performBackgroundTask();
    }, 60000); // Every minute
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  private async performBackgroundTask(): Promise<void> {
    // Your background logic
  }
}
```

### Adding WebSocket Support

```typescript
import { WebSocket } from 'ws';

@Injectable()
export class YourWebSocketService {
  private ws?: WebSocket;

  async connect(url: string): Promise<void> {
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.logger.info('WebSocket connected');
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });
  }

  private handleMessage(data: any): void {
    // Process WebSocket messages
  }
}
```

### Adding Database Integration

```typescript
import { Pool } from 'pg'; // Example with PostgreSQL

@Injectable()
export class YourDatabaseService {
  private pool: Pool;

  constructor(
    @Inject(YOUR_MODULE_OPTIONS) private options: YourModuleOptions
  ) {
    this.pool = new Pool(options.database);
  }

  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
```

## Testing Strategies

### Unit Tests

Test individual services in isolation:

```typescript
describe('YourService', () => {
  let service: YourService;
  let mockDependency: jest.Mocked<Dependency>;

  beforeEach(() => {
    mockDependency = createMock<Dependency>();
    service = new YourService(mockDependency);
  });

  it('should handle specific case', async () => {
    mockDependency.method.mockResolvedValue('result');
    const result = await service.yourMethod();
    expect(result).toBe('expected');
  });
});
```

### Integration Tests

Test module initialization and integration:

```typescript
describe('YourModule Integration', () => {
  let app: IApplication;

  beforeEach(async () => {
    app = await Titan.create({
      modules: [
        YourModule.forRoot({
          // test config
        })
      ]
    });
  });

  afterEach(async () => {
    await app.stop();
  });

  it('should initialize and provide services', async () => {
    const service = app.container.resolve(YOUR_SERVICE);
    expect(service).toBeDefined();
  });
});
```

### E2E Tests

Test complete workflows:

```typescript
describe('YourModule E2E', () => {
  it('should complete full workflow', async () => {
    // Setup
    const module = YourModule.forRoot({ /* config */ });

    // Execute workflow
    const result = await performCompleteWorkflow();

    // Verify
    expect(result).toMatchObject({
      success: true,
      // expected structure
    });
  });
});
```

## Performance Optimization

### Caching Strategy

```typescript
@Injectable()
export class OptimizedService {
  private cache = new Map<string, CachedValue>();

  async getData(key: string): Promise<Data> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && !this.isExpired(cached)) {
      return cached.value;
    }

    // Fetch fresh data
    const data = await this.fetchData(key);

    // Update cache
    this.cache.set(key, {
      value: data,
      timestamp: Date.now()
    });

    return data;
  }
}
```

### Connection Pooling

```typescript
@Injectable()
export class PooledService {
  private pool: ConnectionPool;

  constructor(options: PoolOptions) {
    this.pool = new ConnectionPool({
      min: 2,
      max: 10,
      idleTimeout: 30000
    });
  }

  async execute<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    const conn = await this.pool.acquire();
    try {
      return await fn(conn);
    } finally {
      this.pool.release(conn);
    }
  }
}
```

## Debugging Tips

### Enable Debug Logging

```typescript
export class YourModule {
  static forRoot(options: YourModuleOptions): YourModule {
    if (process.env.DEBUG) {
      options.debug = true;
    }
    return new YourModule(options);
  }
}
```

### Add Debug Endpoints

```typescript
@Injectable()
export class DebugService {
  getDebugInfo(): DebugInfo {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      connections: this.getConnectionStats(),
      cache: this.getCacheStats()
    };
  }
}
```

### Performance Profiling

```typescript
class ProfilingDecorator {
  @Profile('expensive-operation')
  async expensiveMethod(): Promise<void> {
    // Method is automatically profiled
  }
}
```

## Publishing

### Prepare for Publishing

1. Update version in `package.json`
2. Build the module: `yarn build`
3. Run all tests: `yarn test`
4. Update README with final documentation
5. Add CHANGELOG.md with version history

### Publish to NPM

```bash
# Login to NPM
npm login

# Publish
npm publish --access public
```

### Publish to Private Registry

```bash
# Configure registry
npm config set registry https://your-registry.com

# Publish
npm publish
```

## Troubleshooting

### Common Issues

**Issue: Module doesn't initialize**
- Check that all dependencies are registered
- Verify lifecycle hooks are implemented correctly
- Check for circular dependencies

**Issue: Tests fail with "Cannot find module"**
- Ensure all .js extensions are in imports
- Check tsconfig paths configuration
- Verify jest moduleNameMapper

**Issue: Decorators not working**
- Enable `experimentalDecorators` in tsconfig
- Import `reflect-metadata` in entry point
- Check decorator metadata keys

## Resources

- [Titan Documentation](#)
- [Nexus DI Guide](#)
- [TypeScript Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html)
- [Jest Testing](https://jestjs.io/docs/getting-started)
- [Zod Validation](https://zod.dev/)

## Support

For questions and support:
- Open an issue in the repository
- Check existing modules for examples
- Consult the Titan documentation