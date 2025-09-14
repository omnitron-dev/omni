# Nexus DI Container

[![npm version](https://img.shields.io/npm/v/@omnitron-dev/nexus.svg)](https://www.npmjs.com/package/@omnitron-dev/nexus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.2-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/bun-compatible-f472b6)](https://bun.sh/)
[![Deno](https://img.shields.io/badge/deno-compatible-black)](https://deno.land/)

**Nexus** is a next-generation dependency injection container for TypeScript that represents the evolutionary pinnacle of IoC architecture. It synthesizes the best qualities from InversifyJS, NestJS, TSyringe, and other leading solutions while eliminating their collective weaknesses through innovative design patterns.

## ✨ Features

### Phase 1 (Current Release)
- ✅ **Zero-Reflection Mode** - Works without experimental decorators or metadata
- ✅ **Type-Safe Tokens** - Full TypeScript support with compile-time safety
- ✅ **Flexible Providers** - Class, Factory, Value, Token, and Conditional providers
- ✅ **Lifecycle Management** - Singleton, Transient, Scoped, and Request scopes
- ✅ **Async Support** - First-class async provider and resolution support
- ✅ **Comprehensive Error Handling** - Detailed error messages with resolution chains
- ✅ **Testing Utilities** - Built-in mocking, spying, and test container
- ✅ **Cross-Platform** - Works in Node.js, Bun, Deno, and browsers
- ✅ **Module System** - Organize providers with modules
- ✅ **Multi-Token Support** - Register multiple providers for plugin systems

## 📦 Installation

```bash
npm install @omnitron-dev/nexus
# or
yarn add @omnitron-dev/nexus
# or
pnpm add @omnitron-dev/nexus
# or
bun add @omnitron-dev/nexus
```

## 🚀 Quick Start

```typescript
import { Container, createToken } from '@omnitron-dev/nexus';

// Create tokens for type-safe injection
const DatabaseToken = createToken<Database>('Database');
const UserServiceToken = createToken<UserService>('UserService');

// Create container
const container = new Container();

// Register providers
container.register(DatabaseToken, {
  useClass: PostgresDatabase,
  scope: Scope.Singleton
});

container.register(UserServiceToken, {
  useFactory: (db) => new UserService(db),
  inject: [DatabaseToken]
});

// Resolve dependencies
const userService = container.resolve(UserServiceToken);
```

## 📖 Core Concepts

### Tokens

Tokens provide type-safe identifiers for dependencies:

```typescript
import { createToken, createMultiToken, createOptionalToken } from '@omnitron-dev/nexus';

// Basic token
const LoggerToken = createToken<Logger>('Logger');

// Multi-token for plugin systems
const MiddlewareToken = createMultiToken<Middleware>('Middleware');

// Optional token that won't throw if not found
const CacheToken = createOptionalToken<Cache>('Cache');

// Scoped token with metadata
const ConfigToken = createToken<Config>('Config', {
  scope: Scope.Singleton,
  description: 'Application configuration',
  tags: ['infrastructure']
});
```

### Providers

Multiple provider types for different scenarios:

```typescript
// Class Provider
container.register(ServiceToken, {
  useClass: ServiceImplementation,
  scope: Scope.Singleton
});

// Factory Provider
container.register(ApiToken, {
  useFactory: (config) => new ApiClient(config.apiUrl),
  inject: [ConfigToken]
});

// Value Provider
container.register(ConfigToken, {
  useValue: { apiUrl: 'https://api.example.com' }
});

// Token Provider (aliasing)
container.register(AliasToken, {
  useToken: OriginalToken
});

// Conditional Provider
container.register(LoggerToken, {
  when: (context) => context.environment === 'production',
  useFactory: () => new CloudLogger(),
  fallback: { useClass: ConsoleLogger }
});
```

### Lifecycle Management

Control instance creation and sharing:

```typescript
enum Scope {
  Transient,   // New instance each time
  Singleton,   // One instance per container
  Scoped,      // One instance per scope
  Request      // One instance per request
}

// Singleton - shared instance
container.register(DatabaseToken, {
  useClass: Database,
  scope: Scope.Singleton
});

// Transient - new instance each time
container.register(RequestToken, {
  useClass: Request,
  scope: Scope.Transient
});

// Scoped - shared within scope
const scope = container.createScope({ 
  metadata: { requestId: '123' } 
});
const scopedService = scope.resolve(ServiceToken);
```

### Dependency Injection

Inject dependencies into constructors and factories:

```typescript
class UserRepository {
  constructor(private db: Database, private logger: Logger) {}
}

container.register(UserRepositoryToken, {
  useClass: UserRepository,
  inject: [DatabaseToken, LoggerToken]
});

// Factory with dependencies
container.register(EmailServiceToken, {
  useFactory: (config, logger) => {
    return new EmailService(config.smtp, logger);
  },
  inject: [ConfigToken, LoggerToken]
});
```

### Async Resolution

Handle asynchronous initialization:

```typescript
// Register async provider
container.registerAsync(DatabaseToken, {
  useFactory: async () => {
    const connection = await createConnection(config);
    await connection.runMigrations();
    return new Database(connection);
  }
});

// Resolve async
const db = await container.resolveAsync(DatabaseToken);

// Async with dependencies
container.registerAsync(ServiceToken, {
  useFactory: async (db, cache) => {
    const service = new Service(db, cache);
    await service.initialize();
    return service;
  },
  inject: [DatabaseToken, CacheToken]
});
```

### Module System

Organize providers into reusable modules:

```typescript
const DatabaseModule = {
  name: 'DatabaseModule',
  providers: [
    [DatabaseToken, { useClass: PostgresDatabase }],
    [MigrationToken, { useClass: MigrationService }]
  ],
  exports: [DatabaseToken]
};

const AppModule = {
  name: 'AppModule',
  imports: [DatabaseModule],
  providers: [
    [AppServiceToken, { useClass: AppService }]
  ]
};

container.loadModule(AppModule);
```

### Error Handling

Comprehensive error messages with resolution chains:

```typescript
try {
  container.resolve(UnregisteredToken);
} catch (error) {
  // ResolutionError with detailed message:
  // Failed to resolve: UnregisteredToken
  // 
  // Resolution chain:
  //   → ServiceToken
  //   → RepositoryToken
  //   → UnregisteredToken
  // 
  // Token not registered in container
  // 
  // Suggestions:
  // • Check if 'UnregisteredToken' is registered
  // • Verify all dependencies are properly registered
  // • Look for circular dependencies
  // • If using async providers, use resolveAsync()
}
```

## 🧪 Testing

Built-in testing utilities for easy unit testing:

```typescript
import { TestContainer, createTestContainer } from '@omnitron-dev/nexus';

describe('UserService', () => {
  let container: TestContainer;

  beforeEach(() => {
    container = createTestContainer({
      providers: [
        [UserServiceToken, { useClass: UserService }]
      ]
    });

    // Mock dependencies
    container.mock(DatabaseToken, {
      findUser: jest.fn().mockResolvedValue({ id: 1, name: 'Test' })
    });

    container.spy(LoggerToken, 'log');
  });

  it('should find user', async () => {
    const service = container.resolve(UserServiceToken);
    const user = await service.getUser(1);

    expect(user.name).toBe('Test');
    expect(container.getMock(DatabaseToken).findUser).toHaveBeenCalledWith(1);
    expect(container.getSpy(LoggerToken, 'log')).toHaveBeenCalled();
  });
});
```

## 🌍 Cross-Platform Support

Nexus works seamlessly across different JavaScript runtimes:

```typescript
import { getRuntimeInfo, isNode, isBun, isDeno } from '@omnitron-dev/nexus';

const info = getRuntimeInfo();
console.log(`Running on: ${info.runtime}`);

// Runtime-specific providers
container.register(StorageToken, {
  useFactory: () => {
    if (isBun()) return new BunStorage();
    if (isDeno()) return new DenoStorage();
    if (isNode()) return new NodeStorage();
    return new BrowserStorage();
  }
});
```

## 📚 Advanced Examples

### Multi-Token for Plugin Systems

```typescript
interface Plugin {
  name: string;
  execute(): void;
}

const PluginToken = createMultiToken<Plugin>('Plugin');

// Register multiple plugins
container.register(PluginToken, { useClass: LoggingPlugin });
container.register(PluginToken, { useClass: MetricsPlugin });
container.register(PluginToken, { useClass: SecurityPlugin });

// Resolve all plugins
const plugins = container.resolveMany(PluginToken);
plugins.forEach(plugin => plugin.execute());
```

### Conditional Resolution

```typescript
container.register(CacheToken, {
  when: (context) => context.features?.includes('caching'),
  useFactory: () => new RedisCache(),
  fallback: { useClass: MemoryCache }
});
```

### Lifecycle Hooks

```typescript
class DatabaseService implements Initializable, Disposable {
  async initialize() {
    await this.connect();
  }

  async dispose() {
    await this.disconnect();
  }
}

container.register(DatabaseToken, {
  useClass: DatabaseService,
  scope: Scope.Singleton
});

// Automatically called on resolution
const db = container.resolve(DatabaseToken); // calls initialize()

// Clean up
await container.dispose(); // calls dispose() on all instances
```

## 🔧 API Reference

### Container Methods

| Method | Description |
|--------|-------------|
| `register(token, provider, options?)` | Register a provider |
| `registerAsync(token, provider, options?)` | Register an async provider |
| `resolve(token)` | Resolve a dependency |
| `resolveAsync(token)` | Resolve async dependency |
| `resolveMany(token)` | Resolve all providers for multi-token |
| `resolveOptional(token)` | Resolve or return undefined |
| `has(token)` | Check if token is registered |
| `createScope(context?)` | Create child container |
| `loadModule(module)` | Load a module |
| `dispose()` | Dispose container and resources |
| `clearCache()` | Clear instance cache |

### Token Functions

| Function | Description |
|----------|-------------|
| `createToken<T>(name, metadata?)` | Create a typed token |
| `createMultiToken<T>(name, metadata?)` | Create multi-token |
| `createOptionalToken<T>(name, metadata?)` | Create optional token |
| `createScopedToken<T>(name, scope, metadata?)` | Create scoped token |
| `isToken(value)` | Check if value is a token |
| `isMultiToken(token)` | Check if token is multi-token |
| `getTokenName(identifier)` | Get display name |

## 🎯 Use Cases

Nexus is designed to be the foundation for **any** type of application:

- 🎯 **CLI Applications** - Minimal overhead, fast startup
- 🌐 **Web Services** - REST APIs, GraphQL, WebSocket servers
- ⚡ **Real-time Systems** - Live streaming, gaming servers
- ☁️ **Cloud-Native** - Serverless functions, edge computing
- 🏢 **Enterprise** - CQRS/Event Sourcing, microservices
- 📊 **Data Processing** - ETL pipelines, stream processing
- 🤖 **AI/ML Systems** - Model serving, inference pipelines
- 🔗 **Blockchain/Web3** - DApps, smart contract integration

## 🚦 Roadmap

### Phase 1: Core (v1.0) ✅
- Basic container implementation
- Token system
- Provider types
- Lifecycle management
- Error handling
- Basic testing utilities

### Phase 2: Advanced (v1.5) 🚧
- Decorator support (optional)
- Advanced module system
- Contextual injection
- Plugin architecture
- DevTools integration

### Phase 3: Enterprise (v2.0) 📋
- Module federation
- Service mesh integration
- Distributed tracing
- Performance profiling
- Visual dependency analyzer

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

MIT © Omnitron

## 🔗 Links

- [GitHub Repository](https://github.com/omnitron-dev/omni/tree/main/packages/nexus)
- [npm Package](https://www.npmjs.com/package/@omnitron-dev/nexus)
- [Full Specification](./docs/spec.md)
- [Issue Tracker](https://github.com/omnitron-dev/omni/issues)