# Titan-Netron Integration Specification

## Overview

This document specifies how Netron is integrated as the core service communication layer within Titan, providing a unified and minimalist approach to building distributed systems.

## Vision

Transform Titan into the ultimate framework for building distributed TypeScript applications where:
- Services can be exposed through any transport (WebSocket, TCP, IPC, HTTP) with zero code changes
- Type safety and validation extend across network boundaries
- Service discovery and communication are transparent
- The complexity of distributed systems is hidden behind elegant APIs

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Application                        │
│                 @TitanService decorators                    │
├─────────────────────────────────────────────────────────────┤
│                   Titan Service Layer                       │
│          (Service Registry, Validation, Contracts)          │
├─────────────────────────────────────────────────────────────┤
│                    Netron Core Engine                       │
│      (RPC Protocol, Service Mesh, Event Bus, Streams)       │
├─────────────────────────────────────────────────────────────┤
│                  Transport Abstraction Layer                │
│        (WebSocket, TCP, IPC, Unix Sockets, HTTP/2)          │
├─────────────────────────────────────────────────────────────┤
│                      Titan Core                             │
│      (Lifecycle, Config, Logger, Events, Metrics)           │
├─────────────────────────────────────────────────────────────┤
│                    Nexus DI Container                       │
│        (Dependency Injection, Module System)                │
└─────────────────────────────────────────────────────────────┘
```

## Core Integration Points

### 1. Unified Service Decorator

Replace both Titan's basic `@Service` and Netron's `@Service` with a unified, powerful decorator:

```typescript
import { z } from 'zod';
import { TitanService, Public, Stream } from '@titan/core';

// Unified service decorator combining Titan and Netron capabilities
@TitanService({
  name: 'users',
  version: '1.0.0',

  // Zod schema for validation (Titan feature)
  contract: {
    createUser: {
      input: z.object({
        email: z.string().email(),
        name: z.string().min(2),
        password: z.string().min(8)
      }),
      output: UserSchema
    },
    getUser: {
      input: z.string().uuid(),
      output: UserSchema.nullable()
    }
  },

  // Transport configuration (new abstraction)
  transports: {
    netron: { enabled: true },
    http: { path: '/api/users' },
    grpc: { proto: './users.proto' }
  },

  // Service mesh features
  discovery: {
    enabled: true,
    healthCheck: true,
    loadBalancing: 'round-robin'
  },

  // Security
  auth: {
    required: true,
    roles: ['user', 'admin']
  },

  // Performance
  cache: { ttl: 300 },
  rateLimit: { rpm: 100 }
})
export class UserService {
  constructor(
    private db: Database,
    private logger: Logger,
    private events: EventBus
  ) {}

  @Public()
  async createUser(data: CreateUserInput) {
    // Validation happens automatically via Zod contract
    const user = await this.db.users.create(data);
    await this.events.emit('user.created', user);
    return user;
  }

  @Public({ cache: { ttl: 60 } })
  async getUser(id: string) {
    return this.db.users.findById(id);
  }

  @Public()
  @Stream() // New decorator for streaming methods
  async *listUsers(filter?: UserFilter) {
    const cursor = this.db.users.cursor(filter);
    for await (const batch of cursor) {
      yield batch;
    }
  }
}
```

### 2. Transport Abstraction Layer

Create a pluggable transport system to replace Netron's hardcoded WebSocket dependency:

```typescript
// Transport interface
export interface Transport {
  name: string;
  connect(url: string, options?: TransportOptions): Promise<Connection>;
  listen(port: number, options?: TransportOptions): Promise<Server>;
  supports: TransportCapabilities;
}

export interface TransportCapabilities {
  streaming: boolean;
  bidirectional: boolean;
  binary: boolean;
  reconnection: boolean;
}

// WebSocket transport (current Netron implementation)
export class WebSocketTransport implements Transport {
  name = 'websocket';
  supports = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: true
  };

  async connect(url: string, options?: WebSocketOptions) {
    // Use native WebSocket in browser, ws in Node.js
    const WS = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
    return new WebSocketConnection(new WS(url), options);
  }

  async listen(port: number, options?: WebSocketOptions) {
    if (typeof window !== 'undefined') {
      throw new Error('Cannot create WebSocket server in browser');
    }
    const { WebSocketServer } = require('ws');
    return new WebSocketServerAdapter(new WebSocketServer({ port }), options);
  }
}

// TCP transport for high-performance internal communication
export class TcpTransport implements Transport {
  name = 'tcp';
  supports = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: true
  };

  async connect(host: string, port: number, options?: TcpOptions) {
    const socket = net.createConnection({ host, port });
    return new TcpConnection(socket, options);
  }

  async listen(port: number, options?: TcpOptions) {
    const server = net.createServer();
    await promisify(server.listen).call(server, port);
    return new TcpServer(server, options);
  }
}

// IPC transport for parent-child process communication
export class IpcTransport implements Transport {
  name = 'ipc';
  supports = {
    streaming: true,
    bidirectional: true,
    binary: false, // Uses structured clone
    reconnection: false
  };

  async connect(target: ChildProcess | Worker) {
    return new IpcConnection(target);
  }

  async listen() {
    if (!process.send) {
      throw new Error('IPC transport requires process to be spawned with IPC');
    }
    return new IpcServer(process);
  }
}

// Unix socket transport for local high-performance communication
export class UnixSocketTransport implements Transport {
  name = 'unix';
  supports = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: true
  };

  async connect(path: string, options?: UnixSocketOptions) {
    const socket = net.createConnection({ path });
    return new UnixSocketConnection(socket, options);
  }

  async listen(path: string, options?: UnixSocketOptions) {
    const server = net.createServer();
    await promisify(server.listen).call(server, path);
    return new UnixSocketServer(server, options);
  }
}

// Windows named pipes transport
export class NamedPipeTransport implements Transport {
  name = 'pipe';
  supports = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: true
  };

  async connect(pipeName: string, options?: PipeOptions) {
    const path = `\\\\.\\pipe\\${pipeName}`;
    const socket = net.createConnection({ path });
    return new NamedPipeConnection(socket, options);
  }

  async listen(pipeName: string, options?: PipeOptions) {
    const path = `\\\\.\\pipe\\${pipeName}`;
    const server = net.createServer();
    await promisify(server.listen).call(server, path);
    return new NamedPipeServer(server, options);
  }
}
```

### 3. Enhanced Netron Integration

#### Configuration Integration

Replace Netron's basic configuration with Titan's Config module:

```typescript
// Before (Netron standalone)
const netron = await Netron.create({
  listenPort: 8080,
  discoveryEnabled: true,
  logLevel: 'debug'
});

// After (Titan integrated)
const app = createApp();
const config = app.get(ConfigModule);

// Load Netron configuration through Titan's config system
await config.loadWithSchema({
  schema: NetronConfigSchema,
  sources: [
    { type: 'file', path: './config/netron.yaml' },
    { type: 'env', prefix: 'NETRON_' }
  ]
});

// Netron uses Titan's configuration
const netron = app.get(NetronModule);
await netron.start({
  transports: config.get('netron.transports'),
  discovery: config.get('netron.discovery'),
  security: config.get('netron.security')
});
```

#### Logging Integration

Replace Netron's console logging with Titan's Logger module:

```typescript
// Netron module uses Titan's logger
export class NetronModule implements Module {
  constructor(
    @Inject(LoggerModule) private logger: Logger,
    @Inject(ConfigModule) private config: ConfigModule
  ) {
    this.logger = logger.child({ module: 'netron' });
  }

  async onStart(app: Application) {
    this.logger.info('Starting Netron module');

    // Configure with Titan's logger
    this.netron = await Netron.create({
      logger: this.logger,
      config: this.config.get('netron')
    });

    this.logger.info({
      transports: this.netron.transports,
      peers: this.netron.peers.size
    }, 'Netron started successfully');
  }
}
```

### 4. Service Discovery Enhancement

Extend Netron's Redis-based discovery with additional backends:

```typescript
export interface ServiceDiscovery {
  register(service: ServiceInfo): Promise<void>;
  unregister(serviceId: string): Promise<void>;
  discover(query: ServiceQuery): Promise<ServiceInfo[]>;
  watch(query: ServiceQuery, callback: (services: ServiceInfo[]) => void): () => void;
  health(serviceId: string): Promise<HealthStatus>;
}

// Redis discovery (current Netron implementation, enhanced)
export class RedisDiscovery implements ServiceDiscovery {
  constructor(
    private redis: Redis,
    private logger: Logger,
    private config: RedisDiscoveryConfig
  ) {}

  async register(service: ServiceInfo) {
    // Enhanced with metadata and health info
    const registration = {
      ...service,
      metadata: {
        version: service.version,
        capabilities: service.capabilities,
        transports: service.transports,
        load: await this.getSystemLoad()
      },
      health: {
        status: 'healthy',
        lastCheck: Date.now()
      }
    };

    await this.redis.hset(
      `${this.config.prefix}:services`,
      service.id,
      JSON.stringify(registration)
    );

    // Set TTL for automatic cleanup
    await this.redis.expire(
      `${this.config.prefix}:services:${service.id}`,
      this.config.ttl
    );

    // Publish registration event
    await this.redis.publish(
      `${this.config.prefix}:events`,
      JSON.stringify({ type: 'registered', service })
    );
  }
}

// Consul discovery
export class ConsulDiscovery implements ServiceDiscovery {
  constructor(
    private consul: Consul,
    private logger: Logger
  ) {}

  async register(service: ServiceInfo) {
    await this.consul.agent.service.register({
      name: service.name,
      id: service.id,
      address: service.address,
      port: service.port,
      tags: [service.version, ...service.transports],
      check: {
        http: `http://${service.address}:${service.port}/health`,
        interval: '10s'
      }
    });
  }
}

// Kubernetes discovery
export class K8sDiscovery implements ServiceDiscovery {
  constructor(
    private k8s: KubernetesClient,
    private logger: Logger
  ) {}

  async discover(query: ServiceQuery) {
    const services = await this.k8s.listServices({
      labelSelector: `app=${query.name},version=${query.version}`
    });

    return services.items.map(svc => ({
      id: svc.metadata.uid,
      name: svc.metadata.name,
      version: svc.metadata.labels.version,
      address: svc.spec.clusterIP,
      port: svc.spec.ports[0].port,
      transports: svc.metadata.annotations['netron/transports']?.split(',')
    }));
  }
}

// Composite discovery supporting multiple backends
export class CompositeDiscovery implements ServiceDiscovery {
  constructor(private discoveries: ServiceDiscovery[]) {}

  async discover(query: ServiceQuery) {
    const results = await Promise.all(
      this.discoveries.map(d => d.discover(query))
    );
    return results.flat().filter(unique);
  }
}
```

### 5. Validation Integration

Integrate Zod validation at the Netron level:

```typescript
import { z } from 'zod';

// Service method with automatic validation
export class ValidatedService {
  @Public()
  @Validate({
    input: z.object({
      email: z.string().email(),
      age: z.number().int().min(0).max(120)
    }),
    output: z.object({
      id: z.string().uuid(),
      success: z.boolean()
    })
  })
  async createUser(input: any) {
    // Input is automatically validated before method execution
    // Output is validated before sending response
    return { id: uuid(), success: true };
  }
}

// Netron packet validation
const PacketSchema = z.object({
  type: z.number().int().min(0).max(255),
  impulse: z.boolean(),
  error: z.boolean(),
  streamId: z.number().optional(),
  streamIndex: z.number().optional(),
  streamLast: z.boolean().optional(),
  data: z.any()
});

// Validate all packets for security
class ValidatedTransport {
  async send(packet: unknown) {
    const validated = PacketSchema.parse(packet);
    await this.transport.send(validated);
  }

  async receive(): Promise<Packet> {
    const raw = await this.transport.receive();
    return PacketSchema.parse(raw);
  }
}
```

### 6. Enhanced Security

Add security features missing in current Netron:

```typescript
export interface NetronSecurity {
  authentication: AuthProvider;
  authorization: AuthzProvider;
  encryption: EncryptionProvider;
  rateLimit: RateLimiter;
}

// JWT-based authentication
export class JwtAuthProvider implements AuthProvider {
  constructor(
    private secret: string,
    private issuer: string
  ) {}

  async authenticate(token: string): Promise<AuthContext> {
    const decoded = jwt.verify(token, this.secret);
    return {
      userId: decoded.sub,
      roles: decoded.roles,
      permissions: decoded.permissions
    };
  }

  async createToken(user: User): Promise<string> {
    return jwt.sign({
      sub: user.id,
      roles: user.roles,
      permissions: user.permissions
    }, this.secret, {
      issuer: this.issuer,
      expiresIn: '24h'
    });
  }
}

// Role-based authorization
export class RbacAuthzProvider implements AuthzProvider {
  async authorize(
    context: AuthContext,
    resource: string,
    action: string
  ): Promise<boolean> {
    // Check if user has permission for resource:action
    const permission = `${resource}:${action}`;

    // Direct permission check
    if (context.permissions?.includes(permission)) {
      return true;
    }

    // Role-based permission check
    for (const role of context.roles || []) {
      const rolePermissions = await this.getRolePermissions(role);
      if (rolePermissions.includes(permission)) {
        return true;
      }
    }

    return false;
  }
}

// TLS encryption for TCP transports
export class TlsEncryption implements EncryptionProvider {
  constructor(
    private cert: string,
    private key: string,
    private ca?: string
  ) {}

  async createSecureServer(server: net.Server): Promise<tls.Server> {
    return tls.createServer({
      cert: this.cert,
      key: this.key,
      ca: this.ca,
      requestCert: true, // mTLS
      rejectUnauthorized: true
    });
  }

  async createSecureClient(socket: net.Socket): Promise<tls.TLSSocket> {
    return tls.connect({
      socket,
      cert: this.cert,
      key: this.key,
      ca: this.ca,
      rejectUnauthorized: true
    });
  }
}

// Rate limiting with sliding window
export class SlidingWindowRateLimiter implements RateLimiter {
  constructor(
    private redis: Redis,
    private limits: RateLimitConfig
  ) {}

  async checkLimit(
    key: string,
    cost: number = 1
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const window = this.limits.window;
    const limit = this.limits.limit;

    // Use Redis sorted set for sliding window
    const pipe = this.redis.pipeline();

    // Remove old entries
    pipe.zremrangebyscore(key, 0, now - window);

    // Count current entries
    pipe.zcard(key);

    // Add new entry if under limit
    pipe.zadd(key, now, `${now}-${Math.random()}`);

    // Set expiry
    pipe.expire(key, Math.ceil(window / 1000));

    const results = await pipe.exec();
    const count = results[1][1] as number;

    if (count + cost > limit) {
      return {
        allowed: false,
        remaining: Math.max(0, limit - count),
        reset: now + window
      };
    }

    return {
      allowed: true,
      remaining: limit - count - cost,
      reset: now + window
    };
  }
}
```

### 7. Production Features

Add missing production features to Netron:

```typescript
// Health checks
export class NetronHealthCheck {
  async check(): Promise<HealthStatus> {
    const checks = {
      transports: await this.checkTransports(),
      discovery: await this.checkDiscovery(),
      peers: await this.checkPeers(),
      memory: await this.checkMemory(),
      eventLoop: await this.checkEventLoop()
    };

    const unhealthy = Object.values(checks).filter(c => !c.healthy);

    return {
      status: unhealthy.length === 0 ? 'healthy' :
              unhealthy.some(c => c.critical) ? 'unhealthy' : 'degraded',
      checks,
      timestamp: Date.now()
    };
  }
}

// Metrics collection
export class NetronMetrics {
  private metrics = new Map<string, Metric>();

  recordRpcCall(service: string, method: string, duration: number, success: boolean) {
    this.metrics.get('rpc.calls')?.labels({
      service,
      method,
      status: success ? 'success' : 'failure'
    }).observe(duration);
  }

  recordStreamBytes(direction: 'in' | 'out', bytes: number) {
    this.metrics.get('stream.bytes')?.labels({ direction }).inc(bytes);
  }

  recordPeerConnection(event: 'connect' | 'disconnect') {
    this.metrics.get('peer.connections')?.labels({ event }).inc();
  }

  getPrometheusMetrics(): string {
    return Array.from(this.metrics.values())
      .map(m => m.toPrometheus())
      .join('\n');
  }
}

// Circuit breaker for resilience
export class NetronCircuitBreaker {
  private states = new Map<string, CircuitState>();

  async call<T>(
    key: string,
    fn: () => Promise<T>,
    options: CircuitBreakerOptions = {}
  ): Promise<T> {
    const state = this.states.get(key) || this.createState(key, options);

    if (state.isOpen()) {
      throw new CircuitOpenError(key);
    }

    try {
      const result = await fn();
      state.recordSuccess();
      return result;
    } catch (error) {
      state.recordFailure();
      if (state.shouldOpen()) {
        state.open();
        this.scheduleHalfOpen(key, options.resetTimeout || 60000);
      }
      throw error;
    }
  }
}

// Distributed tracing
export class NetronTracing {
  constructor(private tracer: Tracer) {}

  startRpcSpan(
    service: string,
    method: string,
    parentContext?: SpanContext
  ): Span {
    return this.tracer.startSpan(`rpc.${service}.${method}`, {
      parent: parentContext,
      tags: {
        'rpc.service': service,
        'rpc.method': method,
        'span.kind': 'server'
      }
    });
  }

  injectContext(span: Span, packet: Packet): void {
    packet.traceContext = {
      traceId: span.context().traceId,
      spanId: span.context().spanId,
      flags: span.context().flags
    };
  }

  extractContext(packet: Packet): SpanContext | undefined {
    if (!packet.traceContext) return undefined;

    return {
      traceId: packet.traceContext.traceId,
      spanId: packet.traceContext.spanId,
      flags: packet.traceContext.flags
    };
  }
}
```

### 8. Developer Experience Enhancements

#### CLI Tool for Service Generation

```typescript
// CLI command: titan generate:service user
export class ServiceGenerator {
  async generate(name: string, options: GenerateOptions) {
    const template = `
import { TitanService, Public } from '@titan/core';
import { z } from 'zod';

const ${capitalize(name)}Schema = z.object({
  id: z.string().uuid(),
  // Add your fields here
});

@TitanService({
  name: '${name}',
  version: '1.0.0',
  contract: {
    // Define your method contracts here
  }
})
export class ${capitalize(name)}Service {
  @Public()
  async create(input: any) {
    // Implementation
  }

  @Public()
  async get(id: string) {
    // Implementation
  }

  @Public()
  async update(id: string, input: any) {
    // Implementation
  }

  @Public()
  async delete(id: string) {
    // Implementation
  }
}
`;

    await fs.writeFile(`./src/services/${name}.service.ts`, template);
    console.log(`✅ Generated ${name} service`);
  }
}
```

#### Development UI

```typescript
// Development UI for service inspection and testing
export class NetronDevUI {
  async start(port: number = 3001) {
    const app = express();

    // Service explorer
    app.get('/api/services', (req, res) => {
      const services = this.netron.getServices();
      res.json(services.map(s => ({
        name: s.name,
        version: s.version,
        methods: s.getMethods(),
        schema: s.getSchema()
      })));
    });

    // Service tester
    app.post('/api/test/:service/:method', async (req, res) => {
      try {
        const result = await this.netron.call(
          req.params.service,
          req.params.method,
          req.body
        );
        res.json({ success: true, result });
      } catch (error) {
        res.json({ success: false, error: error.message });
      }
    });

    // Real-time event monitor
    app.ws('/events', (ws) => {
      const unsubscribe = this.netron.on('*', (event, data) => {
        ws.send(JSON.stringify({ event, data, timestamp: Date.now() }));
      });

      ws.on('close', unsubscribe);
    });

    // Serve UI
    app.use(express.static(path.join(__dirname, 'ui')));

    app.listen(port);
    console.log(`Netron Dev UI available at http://localhost:${port}`);
  }
}
```

## Implementation Roadmap

### Phase 1: Core Integration (Week 1-2)

1. **Transport Abstraction**
   - [ ] Define transport interfaces
   - [ ] Implement WebSocket transport (migrate existing)
   - [ ] Implement TCP transport
   - [ ] Implement IPC transport
   - [ ] Add transport tests

2. **Configuration Integration**
   - [ ] Replace Netron config with Titan ConfigModule
   - [ ] Add NetronConfigSchema with Zod
   - [ ] Migrate configuration loading

3. **Logging Integration**
   - [ ] Replace console.log with Titan Logger
   - [ ] Add structured logging
   - [ ] Add log levels and filtering

### Phase 2: Service Enhancement (Week 3-4)

1. **Unified Service Decorator**
   - [ ] Create @TitanService decorator
   - [ ] Integrate Zod validation
   - [ ] Add transport configuration
   - [ ] Implement caching and rate limiting

2. **Service Discovery**
   - [ ] Abstract discovery interface
   - [ ] Enhance Redis discovery
   - [ ] Add Consul backend
   - [ ] Add Kubernetes backend

3. **Security Features**
   - [ ] Implement JWT authentication
   - [ ] Add RBAC authorization
   - [ ] Add TLS support for TCP
   - [ ] Implement rate limiting

### Phase 3: Production Features (Week 5-6)

1. **Observability**
   - [ ] Add health checks
   - [ ] Implement metrics collection
   - [ ] Add distributed tracing
   - [ ] Create monitoring dashboard

2. **Resilience**
   - [ ] Implement circuit breakers
   - [ ] Add retry mechanisms
   - [ ] Implement bulkheads
   - [ ] Add timeout handling

3. **Performance**
   - [ ] Add connection pooling
   - [ ] Implement caching layer
   - [ ] Add compression support
   - [ ] Optimize serialization

### Phase 4: Developer Experience (Week 7-8)

1. **Tooling**
   - [ ] Create service generator CLI
   - [ ] Build development UI
   - [ ] Add service testing tools
   - [ ] Create migration utilities

2. **Documentation**
   - [ ] Write integration guide
   - [ ] Create API documentation
   - [ ] Add example applications
   - [ ] Write best practices guide

3. **Testing**
   - [ ] Unit tests for all components
   - [ ] Integration tests
   - [ ] Performance benchmarks
   - [ ] E2E test scenarios

## Migration Guide

### For Existing Netron Users

```typescript
// Before (Netron standalone)
import { Netron, Service, Public } from '@netron/core';

@Service('calculator@1.0.0')
class CalculatorService {
  @Public()
  add(a: number, b: number) {
    return a + b;
  }
}

const netron = await Netron.create({ listenPort: 8080 });
await netron.peer.exposeService(new CalculatorService());

// After (Titan integrated)
import { createApp, TitanService, Public } from '@titan/core';
import { z } from 'zod';

@TitanService({
  name: 'calculator',
  version: '1.0.0',
  contract: {
    add: {
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.number()
    }
  }
})
class CalculatorService {
  @Public()
  add({ a, b }: { a: number; b: number }) {
    return a + b;
  }
}

const app = createApp();
app.service(CalculatorService);
await app.start(); // Automatically starts Netron with configured transports
```

### For Existing Titan Users

```typescript
// Before (Titan without Netron)
@Service()
class UserService {
  async getUser(id: string) {
    return this.db.users.findById(id);
  }
}

// After (Titan with Netron)
@TitanService({
  name: 'users',
  version: '1.0.0',
  transports: {
    netron: true,  // Enable RPC
    http: '/api/users' // Also expose via HTTP
  }
})
class UserService {
  @Public() // Mark as remotely accessible
  async getUser(id: string) {
    return this.db.users.findById(id);
  }
}

// Now accessible via RPC from other services
const client = app.connectToService('users@1.0.0');
const user = await client.getUser('123');
```

## Example Applications

### 1. Microservices Architecture

```typescript
// Auth Service
@TitanService({
  name: 'auth',
  version: '1.0.0',
  transports: { netron: true },
  discovery: { enabled: true }
})
class AuthService {
  @Public()
  async authenticate(credentials: Credentials): Promise<Token> {
    // Authentication logic
  }

  @Public()
  async verify(token: string): Promise<User> {
    // Token verification
  }
}

// User Service
@TitanService({
  name: 'users',
  version: '1.0.0',
  transports: { netron: true },
  discovery: { enabled: true }
})
class UserService {
  constructor(
    @RemoteService('auth@1.0.0') private auth: AuthService
  ) {}

  @Public()
  @Authenticated() // Uses auth service internally
  async getProfile(token: string): Promise<UserProfile> {
    const user = await this.auth.verify(token);
    return this.db.profiles.findByUserId(user.id);
  }
}

// API Gateway
const gateway = createApp({ name: 'api-gateway' });

// Automatically discover and expose services
gateway.use(NetronGateway, {
  discovery: true,
  expose: {
    http: { port: 3000, path: '/api' },
    graphql: { port: 4000, path: '/graphql' }
  }
});

await gateway.start();
```

### 2. Real-time Collaboration

```typescript
@TitanService({
  name: 'collaboration',
  version: '1.0.0',
  transports: {
    netron: true,
    websocket: { port: 8080 } // Direct WebSocket for browsers
  }
})
class CollaborationService {
  private documents = new Map<string, Document>();

  @Public()
  @Stream()
  async *subscribeToDocument(docId: string): AsyncGenerator<DocumentUpdate> {
    const doc = this.documents.get(docId);
    if (!doc) throw new NotFoundError();

    const subscription = doc.subscribe();
    try {
      for await (const update of subscription) {
        yield update;
      }
    } finally {
      subscription.unsubscribe();
    }
  }

  @Public()
  async applyOperation(docId: string, op: Operation): Promise<void> {
    const doc = this.documents.get(docId);
    if (!doc) throw new NotFoundError();

    await doc.apply(op);

    // Broadcast to all subscribers
    await this.emit(`doc:${docId}:update`, op);
  }
}
```

### 3. IoT Device Management

```typescript
@TitanService({
  name: 'device-manager',
  version: '1.0.0',
  transports: {
    tcp: { port: 5000 }, // For devices
    netron: true, // For service mesh
    http: { port: 3000 } // For management UI
  }
})
class DeviceManager {
  private devices = new Map<string, DeviceConnection>();

  @Public({ transport: 'tcp' })
  async registerDevice(deviceId: string, capabilities: DeviceCapabilities) {
    const connection = this.getConnection();
    this.devices.set(deviceId, connection);

    // Health monitoring
    connection.on('health', (data) => {
      this.metrics.record(`device.${deviceId}.health`, data);
    });

    return { registered: true, token: this.generateToken(deviceId) };
  }

  @Public()
  async sendCommand(deviceId: string, command: Command) {
    const device = this.devices.get(deviceId);
    if (!device) throw new DeviceNotFoundError();

    return device.send(command);
  }

  @Public()
  @Stream()
  async *streamTelemetry(deviceId: string): AsyncGenerator<TelemetryData> {
    const device = this.devices.get(deviceId);
    if (!device) throw new DeviceNotFoundError();

    for await (const data of device.telemetry()) {
      yield data;
    }
  }
}
```

## Benefits of Integration

### For Developers

1. **Unified API**: One framework for all application needs
2. **Type Safety**: End-to-end type safety across network boundaries
3. **Automatic Validation**: Zod schemas validate all data automatically
4. **Multiple Transports**: Same service works with WebSocket, TCP, IPC, HTTP
5. **Service Discovery**: Automatic service registration and discovery
6. **Developer Tools**: CLI generators, development UI, testing utilities

### For Operations

1. **Production Ready**: Health checks, metrics, tracing out of the box
2. **Security**: Built-in authentication, authorization, rate limiting
3. **Resilience**: Circuit breakers, retries, timeouts
4. **Observability**: Comprehensive monitoring and debugging
5. **Performance**: Connection pooling, caching, compression
6. **Scalability**: Horizontal scaling with load balancing

### For Architecture

1. **Microservices**: Build true microservices with minimal boilerplate
2. **Event-Driven**: First-class event bus and streaming support
3. **Polyglot**: Services can be in different languages via standard protocols
4. **Cloud Native**: Kubernetes and cloud-ready from day one
5. **Flexibility**: Start monolith, split to microservices when needed
6. **Evolution**: Safe schema evolution and versioning

## Conclusion

The integration of Netron into Titan's core creates a framework that is unmatched in the TypeScript ecosystem for building distributed applications. By combining:

- Titan's minimal yet powerful application framework
- Netron's elegant RPC and service mesh capabilities
- Nexus's robust dependency injection
- Zod's comprehensive validation
- Multiple transport support
- Production-ready features

We create a platform where building distributed services is as simple as writing TypeScript classes, while maintaining all the safety, performance, and operational excellence required for production systems.

This integration transforms Titan from a great application framework into the definitive platform for building modern TypeScript applications, whether they're simple CLIs, monolithic APIs, or complex distributed systems.

The key innovation is making distribution a deployment choice, not a development constraint. Developers write services once and deploy them anywhere - as a monolith, as microservices, or anything in between - without changing code.

This is not just an integration - it's a paradigm shift in how we build and deploy TypeScript applications.