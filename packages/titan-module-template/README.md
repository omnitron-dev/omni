# Titan Module Template

A comprehensive template for creating modules for the Titan framework. This template provides a complete structure with examples of services, decorators, dependency injection, and testing patterns.

## 🚀 Quick Start

### Using This Template

1. **Copy the template to create your module:**
```bash
cp -r packages/titan-module-template packages/your-module-name
```

2. **Update package.json:**
```json
{
  "name": "@omnitron-dev/your-module-name",
  "description": "Your module description"
}
```

3. **Rename classes and exports:**
- Replace `TemplateModule` with `YourModule`
- Replace `TemplateService` with `YourService`
- Update all `TEMPLATE_` constants with your prefix

4. **Install dependencies:**
```bash
yarn install
```

5. **Build the module:**
```bash
yarn build
```

## 📦 What's Included

### Directory Structure
```
titan-module-template/
├── src/
│   ├── index.ts                 # Main exports
│   ├── template.module.ts       # Module definition
│   ├── types.ts                 # TypeScript types
│   ├── constants.ts            # Constants and tokens
│   ├── utils.ts                # Utility functions
│   ├── services/               # Service implementations
│   │   ├── index.ts
│   │   ├── template.service.ts # Main service
│   │   ├── cache.service.ts    # Cache service
│   │   └── logger.service.ts   # Logger service
│   └── decorators/             # Custom decorators
│       ├── index.ts
│       ├── cache.decorator.ts   # Caching decorator
│       ├── validate.decorator.ts # Validation decorator
│       └── timed.decorator.ts   # Performance decorators
├── test/                       # Test files
│   ├── template.service.spec.ts
│   ├── cache.service.spec.ts
│   └── decorators.spec.ts
├── package.json
├── tsconfig.json
├── jest.config.ts
└── jest.setup.ts
```

## 🔧 Module Features

### 1. Module Configuration

The template demonstrates three ways to configure a module:

#### Static Configuration
```typescript
import { TemplateModule } from '@omnitron-dev/titan-module-template';

@Module({
  imports: [
    TemplateModule.forRoot({
      debug: true,
      prefix: 'my-prefix',
      enableCache: true,
      cacheTTL: 300
    })
  ]
})
export class AppModule {}
```

#### Async Configuration
```typescript
@Module({
  imports: [
    TemplateModule.forRootAsync({
      useFactory: async (config: ConfigService) => ({
        debug: config.get('debug'),
        prefix: config.get('prefix')
      }),
      inject: [ConfigService]
    })
  ]
})
export class AppModule {}
```

#### Feature Module
```typescript
@Module({
  imports: [
    TemplateModule.forFeature() // Uses root configuration
  ]
})
export class FeatureModule {}
```

### 2. Services

#### Template Service
Main service with CRUD operations, event emission, and health checks:

```typescript
import { Inject, Injectable } from '@omnitron-dev/nexus';
import { TemplateService } from './services/template.service';

@Injectable()
export class MyService {
  constructor(
    @Inject(TEMPLATE_SERVICE) private template: TemplateService
  ) {}

  async createData() {
    const result = await this.template.create({
      name: 'Example',
      description: 'Test data'
    });

    if (result.success) {
      console.log('Created:', result.data);
    }
  }
}
```

#### Cache Service
In-memory caching with TTL support:

```typescript
await cache.set('key', { data: 'value' }, 300); // 5 minutes TTL
const value = await cache.get('key');
await cache.delete('key');
```

#### Logger Service
Pino-based logging with module context:

```typescript
logger.info('Operation completed', { duration: 100 });
logger.error('Operation failed', error, { context: 'data' });
```

### 3. Decorators

#### @Cached
Cache method results:

```typescript
class MyService {
  @Cached({ ttl: 300 })
  async getExpensiveData(id: string) {
    // This will be cached for 5 minutes
    return await this.fetchFromDatabase(id);
  }
}
```

#### @Validate
Validate method parameters:

```typescript
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string(),
  email: z.string().email()
});

class UserService {
  @Validate(UserSchema)
  async createUser(data: any) {
    // Data is validated before method execution
    return this.userRepository.create(data);
  }
}
```

#### @Timed
Measure execution time:

```typescript
class DataService {
  @Timed({ warnThreshold: 1000 })
  async processData() {
    // Will warn if takes more than 1 second
    return await this.heavyComputation();
  }
}
```

#### @Timeout
Set execution timeout:

```typescript
class ApiService {
  @Timeout(5000)
  async fetchExternalData() {
    // Will timeout after 5 seconds
    return await this.externalApi.get('/data');
  }
}
```

#### @Throttle / @Debounce
Rate limiting decorators:

```typescript
class SearchService {
  @Throttle(1000)
  async search(query: string) {
    // Can only be called once per second
  }

  @Debounce(500)
  async autocomplete(query: string) {
    // Waits 500ms after last call
  }
}
```

## 🧪 Testing

### Running Tests
```bash
# Run all tests
yarn test

# Run with coverage
yarn test:coverage

# Run in watch mode
yarn test:watch
```

### Test Examples

The template includes comprehensive test examples:

1. **Service Tests**: Testing CRUD operations, events, and lifecycle
2. **Cache Tests**: Testing caching behavior, TTL, and expiration
3. **Decorator Tests**: Testing all decorator functionalities

Example test:
```typescript
describe('TemplateService', () => {
  let service: TemplateService;

  beforeEach(async () => {
    const container = new Container();
    // Setup container...
    service = container.resolve(TemplateService);
    await service.initialize();
  });

  it('should create data entry', async () => {
    const result = await service.create({ name: 'Test' });
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe('Test');
  });
});
```

## 🏗️ Building Your Module

### Development Workflow

1. **Development Mode:**
```bash
yarn dev
```

2. **Build for Production:**
```bash
yarn build
```

3. **Clean Build:**
```bash
yarn clean && yarn build
```

### Best Practices

1. **Use Dependency Injection:**
```typescript
@Injectable()
export class YourService {
  constructor(
    @Inject(YOUR_TOKEN) private dependency: Dependency
  ) {}
}
```

2. **Create Tokens for Dependencies:**
```typescript
export const YOUR_SERVICE = createToken<YourService>('YOUR_SERVICE');
```

3. **Implement Lifecycle Hooks:**
```typescript
export class YourModule implements ApplicationModule {
  async onApplicationInit(app: IApplication): Promise<void> {
    // Initialize module
  }

  async onApplicationStart(app: IApplication): Promise<void> {
    // Start services
  }

  async onApplicationStop(app: IApplication): Promise<void> {
    // Cleanup resources
  }
}
```

4. **Add Health Checks:**
```typescript
async healthCheck(): Promise<IHealthStatus> {
  const checks = await this.runHealthChecks();
  return {
    status: checks.every(c => c.healthy) ? 'healthy' : 'unhealthy',
    details: checks
  };
}
```

## 📝 Customization Guide

### Creating a New Service

1. Create service file in `src/services/`:
```typescript
import { Injectable, Inject } from '@omnitron-dev/nexus';

@Injectable()
export class YourService {
  constructor(
    @Inject(YOUR_OPTIONS) private options: YourOptions
  ) {}

  async doSomething(): Promise<void> {
    // Implementation
  }
}
```

2. Register in module:
```typescript
container.register(YOUR_SERVICE, {
  useClass: YourService
});
```

### Creating a New Decorator

1. Create decorator file in `src/decorators/`:
```typescript
export function YourDecorator(options?: DecoratorOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args: any[]) {
      // Before method execution
      const result = await originalMethod.apply(this, args);
      // After method execution
      return result;
    };

    return descriptor;
  };
}
```

### Adding Event Support

```typescript
import { EventEmitter } from '@omnitron-dev/eventemitter';

@Injectable()
export class YourService extends EventEmitter {
  async performAction() {
    // Do something
    await this.emit('action:performed', { data });
  }
}
```

## 🔌 Integration with Titan

### Using in Titan Application

```typescript
import { Titan } from '@omnitron-dev/titan';
import { YourModule } from '@omnitron-dev/your-module';

const app = await Titan.create({
  modules: [
    YourModule.forRoot({
      // Configuration
    })
  ]
});

await app.start();
```

### Accessing Module Services

```typescript
import { Inject } from '@omnitron-dev/nexus';
import { YOUR_SERVICE } from '@omnitron-dev/your-module';

@Injectable()
export class AppService {
  constructor(
    @Inject(YOUR_SERVICE) private yourService: YourService
  ) {}
}
```

## 📚 Examples

### Complete Module Example

```typescript
// my-cache.module.ts
import { Container } from '@omnitron-dev/nexus';
import { ApplicationModule, IApplication } from '@omnitron-dev/titan';

export class MyCacheModule implements ApplicationModule {
  static forRoot(options: CacheOptions): MyCacheModule {
    return new MyCacheModule(options);
  }

  constructor(private options: CacheOptions) {}

  async onApplicationInit(app: IApplication): Promise<void> {
    const { container } = app;

    // Register options
    container.register(CACHE_OPTIONS, {
      useValue: this.options
    });

    // Register services
    container.register(CACHE_SERVICE, {
      useClass: CacheService
    });

    // Initialize
    const cache = container.resolve(CACHE_SERVICE);
    await cache.initialize();
  }
}
```

## 🤝 Contributing

When creating a new module:

1. Follow the structure provided in this template
2. Include comprehensive tests
3. Document all public APIs
4. Add usage examples
5. Follow TypeScript best practices

## 📄 License

MIT

## 🔗 Links

- [Titan Documentation](#)
- [Nexus DI Documentation](#)
- [Example Modules](#)

---

**Note:** This is a template. Replace all occurrences of "Template", "template", and "TEMPLATE" with your module's actual name.