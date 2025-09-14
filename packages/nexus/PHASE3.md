# Nexus DI Container - Phase 3 Features

## Overview

Phase 3 introduces enterprise-grade features to Nexus, making it suitable for large-scale production applications. All Phase 3 features are available through separate export paths to maintain the lightweight core.

## Installation

```bash
npm install @omnitron-dev/nexus

# Optional dependencies for Phase 3 features
npm install reflect-metadata  # For decorator support
npm install ws                 # For DevTools WebSocket server
```

## Phase 3 Features

### 1. Decorator Support

Enable decorator-based dependency injection with optional reflect-metadata:

```typescript
// Must import reflect-metadata before using decorators
import 'reflect-metadata';
import { Injectable, Inject, Module, Container } from '@omnitron-dev/nexus/decorators';

@Injectable()
class UserService {
  constructor(
    @Inject(DatabaseToken) private db: Database,
    @Inject(LoggerToken) private logger: Logger
  ) {}
}

@Module({
  name: 'UserModule',
  providers: [UserService],
  exports: [UserService]
})
class UserModule {}

// Use DecoratorContainer for auto-registration
const container = new Container();
container.loadDecoratedModule(UserModule);
```

Available decorators:
- `@Injectable()` - Mark class as injectable
- `@Inject(token)` - Inject dependency
- `@Optional()` - Mark dependency as optional
- `@Module()` - Define a module
- `@Singleton()`, `@Transient()`, `@Scoped()` - Scope decorators
- `@PostConstruct()`, `@PreDestroy()` - Lifecycle hooks
- `@Controller()`, `@Service()`, `@Repository()` - Semantic decorators
- `@Trace()` - Method tracing

### 2. Module Federation

Share and load modules across applications:

```typescript
import { 
  ModuleFederationContainer, 
  createFederatedModule, 
  createLazyModule 
} from '@omnitron-dev/nexus/federation';

// Register remote module
const federatedModule = createFederatedModule({
  name: 'remote-module',
  remoteUrl: 'http://remote-app/module.js',
  exports: [SharedServiceToken],
  fallback: localFallbackModule,
  retry: 3,
  timeout: 5000
});

// Lazy load modules
const lazyModule = createLazyModule(
  () => import('./heavy-module')
);

container.loadModule(federatedModule);
container.loadModule(lazyModule);
```

Features:
- Dynamic remote module loading
- Fallback support for resilience
- Shared dependency management
- Webpack Module Federation compatible
- Lazy loading with code splitting

### 3. Service Mesh Integration

Build microservices with service discovery and load balancing:

```typescript
import {
  ConsulServiceDiscovery,
  LoadBalancer,
  LoadBalancingStrategy,
  CircuitBreaker,
  ServiceProxy,
  createRemoteProxy
} from '@omnitron-dev/nexus/mesh';

// Service discovery with Consul
const discovery = new ConsulServiceDiscovery('http://consul:8500');

// Register service
await discovery.register({
  id: 'api-1',
  name: 'api-service',
  version: '1.0.0',
  address: 'localhost',
  port: 3000,
  health: 'healthy'
});

// Create service proxy with load balancing
const proxy = new ServiceProxy(discovery, {
  serviceName: 'user-service',
  loadBalancing: LoadBalancingStrategy.RoundRobin,
  circuitBreaker: {
    threshold: 5,
    timeout: 60000,
    resetTimeout: 30000
  },
  retries: 3,
  timeout: 30000
});

const userService = proxy.createProxy<UserService>();
const user = await userService.getUser('123');
```

Load balancing strategies:
- Round Robin
- Random
- Least Connections
- Weighted Round Robin
- Response Time
- Consistent Hash

### 4. Distributed Tracing

Add observability with OpenTelemetry-compatible tracing:

```typescript
import {
  SimpleTracer,
  TracingPlugin,
  JaegerExporter,
  ZipkinExporter,
  W3CTraceContextPropagator,
  Trace
} from '@omnitron-dev/nexus/tracing';

// Setup tracing with Jaeger
const exporter = new JaegerExporter({
  endpoint: 'http://localhost:14268',
  serviceName: 'my-service'
});

const plugin = new TracingPlugin({ exporter });
container.use(plugin);

// Automatic tracing of all resolutions
const service = container.resolve(ServiceToken); // Traced!

// Manual tracing with decorator
class PaymentService {
  @Trace('process-payment')
  async processPayment(amount: number) {
    // Method execution is traced
  }
}

// Context propagation
const propagator = new W3CTraceContextPropagator();
propagator.inject(span.spanContext(), headers);
```

Exporters:
- Jaeger
- Zipkin
- Console (for development)

### 5. DevTools Extension

Debug and visualize your dependency injection container:

```typescript
import {
  DevToolsPlugin,
  DevToolsServer,
  DevToolsExtension
} from '@omnitron-dev/nexus/devtools';

// Enable DevTools
const devtools = new DevToolsPlugin({
  port: 9229,
  autoStart: true
});

container.use(devtools);

// Get dependency graph
const graph = devtools.getDependencyGraph(containerId);
const dot = devtools.generateGraphVisualization(containerId);
const mermaid = devtools.generateMermaidDiagram(containerId);

// Performance metrics
const metrics = devtools.getPerformanceMetrics(containerId);
console.log(`Total resolutions: ${metrics.totalResolutions}`);
console.log(`Average time: ${metrics.averageResolutionTime}ms`);

// Container snapshot
const snapshot = devtools.getSnapshot(containerId);
```

Features:
- Real-time WebSocket communication
- Dependency graph visualization
- Performance metrics tracking
- Container state snapshots
- Browser extension support
- Export to DOT and Mermaid formats

## Usage Examples

### Complete Microservice Setup

```typescript
import { Container } from '@omnitron-dev/nexus';
import { TracingPlugin } from '@omnitron-dev/nexus/tracing';
import { DevToolsPlugin } from '@omnitron-dev/nexus/devtools';
import { ConsulServiceDiscovery } from '@omnitron-dev/nexus/mesh';
import { createFederatedModule } from '@omnitron-dev/nexus/federation';

// Create container with all Phase 3 features
const container = new Container();

// Add tracing
container.use(new TracingPlugin({
  exporter: new JaegerExporter({
    endpoint: process.env.JAEGER_ENDPOINT,
    serviceName: 'my-service'
  })
}));

// Add DevTools
container.use(new DevToolsPlugin({
  port: 9229,
  enabled: process.env.NODE_ENV !== 'production'
}));

// Service discovery
container.register(ServiceDiscoveryToken, {
  useClass: ConsulServiceDiscovery,
  config: { url: process.env.CONSUL_URL }
});

// Load federated modules
const sharedModule = createFederatedModule({
  name: 'shared',
  remoteUrl: process.env.SHARED_MODULE_URL,
  exports: [ConfigToken, LoggerToken]
});

container.loadModule(sharedModule);

// Start application
const app = container.resolve(ApplicationToken);
await app.start();
```

### Using Decorators with NestJS-style Modules

```typescript
import 'reflect-metadata';
import { Module, Injectable, Inject } from '@omnitron-dev/nexus/decorators';

@Module({
  name: 'DatabaseModule',
  providers: [
    { provide: DatabaseToken, useClass: PostgresDatabase }
  ],
  exports: [DatabaseToken]
})
class DatabaseModule {}

@Module({
  name: 'UserModule',
  imports: [DatabaseModule],
  providers: [UserService, UserRepository],
  exports: [UserService]
})
class UserModule {}

@Injectable()
class UserService {
  constructor(
    @Inject(UserRepository) private repo: UserRepository,
    @Inject(LoggerToken) private logger: Logger
  ) {}
  
  @Trace('find-user')
  async findUser(id: string) {
    this.logger.info(`Finding user ${id}`);
    return this.repo.findById(id);
  }
}
```

## Performance Considerations

All Phase 3 features are designed with performance in mind:

1. **Decorator Support**: Zero overhead when not used, tree-shakeable
2. **Module Federation**: Lazy loading with caching and retry logic
3. **Service Mesh**: Connection pooling, circuit breakers prevent cascading failures
4. **Tracing**: Async span export, batching for reduced overhead
5. **DevTools**: Only active in development, minimal production impact

## Migration from Other DI Containers

### From NestJS

```typescript
// NestJS
@Injectable()
export class CatsService {
  constructor(private catsRepository: CatsRepository) {}
}

// Nexus with decorators
import { Injectable, Inject } from '@omnitron-dev/nexus/decorators';

@Injectable()
export class CatsService {
  constructor(
    @Inject(CatsRepositoryToken) private catsRepository: CatsRepository
  ) {}
}
```

### From InversifyJS

```typescript
// InversifyJS
@injectable()
class Ninja implements Warrior {
  constructor(@inject(TYPES.Weapon) private weapon: Weapon) {}
}

// Nexus with decorators
@Injectable()
class Ninja implements Warrior {
  constructor(@Inject(WeaponToken) private weapon: Weapon) {}
}
```

## Best Practices

1. **Use separate imports**: Only import Phase 3 features when needed
2. **Configure for environment**: Disable DevTools and verbose tracing in production
3. **Set up fallbacks**: Always configure fallback modules for federation
4. **Monitor circuit breakers**: Log when circuits open to detect issues
5. **Export metrics**: Use Prometheus or similar for production monitoring

## Troubleshooting

### Decorators not working
- Ensure `reflect-metadata` is imported before any decorators
- Check that `experimentalDecorators` and `emitDecoratorMetadata` are enabled in tsconfig.json

### Module federation failures
- Verify CORS settings on remote module servers
- Check network connectivity and firewall rules
- Ensure fallback modules are configured

### Service mesh issues
- Verify Consul is running and accessible
- Check service health endpoints are responding
- Monitor circuit breaker states

### Tracing not appearing
- Verify exporter endpoint is correct
- Check network connectivity to Jaeger/Zipkin
- Ensure service name is configured

### DevTools not connecting
- Check WebSocket port is not blocked
- Verify browser extension is installed
- Check console for connection errors

## License

MIT