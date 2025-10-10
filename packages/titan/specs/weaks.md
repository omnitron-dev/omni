# 🎯 HTTP Transport Optimization and Process Management Integration

## 📊 Current Status

**✅ ALL TESTS PASSING:**
```
Test Suites:  93 passed, 93 total
Tests:        1822 passed, 28 skipped, 1850 total
Time:         29.003s
```

**Status:** Current implementation works correctly for all deployment scenarios. This document proposes minimal optimizations for HTTP transport internals and integration with the existing PM module for developers who need clustering capabilities.

---

## 💡 Key Insight: HTTP Transport Simplification

### The Core Difference

**HTTP transport is fundamentally stateless and only supports method invocation**, unlike binary transports (WebSocket/TCP) that support property get/set operations.

**Binary transports (WebSocket/TCP):**
```typescript
// Client can:
const service = await peer.queryInterface<UserService>('userService@1.0.0');

// 1. Call methods
await service.createUser({ name: 'John' });

// 2. READ properties
const version = service.version;

// 3. WRITE properties
service.logLevel = 'debug';
```

**HTTP transport:**
```typescript
// Client can ONLY:
const service = await httpPeer.queryInterface<UserService>('userService@1.0.0');

// 1. Call methods (the only real functionality)
await service.createUser({ name: 'John' });

// 2. CANNOT read properties (not natural for HTTP)
// 3. CANNOT write properties (not natural for HTTP)
```

**Conclusion:** HTTP transport uses `queryInterface` + `Definition` + `Interface` ONLY for method invocation. The internal implementation can be optimized while maintaining API compatibility.

---

## 🔄 Proposed Optimizations (MINIMAL CHANGES)

### Philosophy: Preserve API, Optimize Implementation

**CRITICAL:** We keep the public API unchanged for:
- ✅ API compatibility across all transports
- ✅ Isomorphic client code (same API for WS/TCP/HTTP)
- ✅ Type safety through existing mechanisms
- ✅ Developer familiarity

**What changes:** Internal implementation details only

---

## 🎯 IMPLEMENTATION PLAN

### PHASE 1: Internal HTTP Peer Optimization (Week 1)

**Goal:** Optimize internal implementation while keeping `queryInterface<T>()` and `queryFluentInterface<T>()` APIs unchanged.

#### 1.1 Optimize Definition Caching

**File:** `packages/titan/src/netron/transport/http/peer.ts`

**Current implementation:**
```typescript
class HttpPeer {
  // PUBLIC API - UNCHANGED
  async queryInterface<T>(qualifiedName: string): Promise<T> {
    const definition = await this.queryDefinition(qualifiedName);
    return Interface.create(definition, this) as T;
  }

  async queryFluentInterface<T>(qualifiedName: string): Promise<T> {
    const definition = await this.queryDefinition(qualifiedName);
    return Interface.createFluent(definition, this) as T;
  }

  // PRIVATE - CAN BE OPTIMIZED
  private async queryDefinition(qualifiedName: string): Promise<Definition> {
    // Current: Simple cache without TTL or JWT scoping
    const cached = this.definitionCache.get(qualifiedName);
    if (cached) return cached;

    const definition = await this.fetchDefinitionFromServer(qualifiedName);
    this.definitionCache.set(qualifiedName, definition);
    return definition;
  }
}
```

**Optimized implementation:**
```typescript
class HttpPeer {
  // PUBLIC API - UNCHANGED
  async queryInterface<T>(qualifiedName: string): Promise<T> {
    const definition = await this.queryDefinition(qualifiedName);
    return Interface.create(definition, this) as T;
  }

  async queryFluentInterface<T>(qualifiedName: string): Promise<T> {
    const definition = await this.queryDefinition(qualifiedName);
    return Interface.createFluent(definition, this) as T;
  }

  // PRIVATE - OPTIMIZED FOR STATELESS HTTP
  private async queryDefinition(qualifiedName: string): Promise<Definition> {
    // OPTIMIZATION 1: JWT-scoped cache keys
    const cacheKey = this.createCacheKey(qualifiedName);

    // OPTIMIZATION 2: TTL-based caching
    const cached = this.definitionCache.get(cacheKey);
    if (cached && !this.isCacheExpired(cached)) {
      return cached.definition;
    }

    // Fetch from server
    const definition = await this.fetchDefinitionFromServer(qualifiedName);

    // OPTIMIZATION 3: Store with metadata
    this.definitionCache.set(cacheKey, {
      definition,
      timestamp: Date.now(),
      ttl: this.options.definitionCacheTtl || 300000 // 5 minutes default
    });

    return definition;
  }

  private createCacheKey(qualifiedName: string): string {
    // Include JWT user ID in cache key to prevent authorization poisoning
    const userId = this.extractUserIdFromToken();
    return userId ? `${userId}:${qualifiedName}` : qualifiedName;
  }

  private isCacheExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private extractUserIdFromToken(): string | null {
    if (!this.authToken) return null;
    try {
      const payload = JSON.parse(atob(this.authToken.split('.')[1]));
      return payload.sub || payload.userId || null;
    } catch {
      return null;
    }
  }
}
```

**Benefits:**
- ✅ PUBLIC API unchanged - full compatibility
- ✅ JWT-scoped caching prevents authorization cache poisoning
- ✅ TTL prevents stale definitions
- ✅ Simpler implementation for stateless HTTP
- ✅ No breaking changes for existing code

**Testing:**
```typescript
describe('HTTP Peer - Optimized Caching', () => {
  it('should cache definitions with TTL', async () => {
    const peer = new HttpPeer({ definitionCacheTtl: 1000 });
    await peer.queryInterface('service@1.0.0');

    // Should use cache
    const spy = jest.spyOn(peer as any, 'fetchDefinitionFromServer');
    await peer.queryInterface('service@1.0.0');
    expect(spy).not.toHaveBeenCalled();

    // Should expire after TTL
    await new Promise(resolve => setTimeout(resolve, 1100));
    await peer.queryInterface('service@1.0.0');
    expect(spy).toHaveBeenCalled();
  });

  it('should scope cache by JWT user', async () => {
    const peer1 = new HttpPeer({ authToken: createToken({ userId: 'user1' }) });
    const peer2 = new HttpPeer({ authToken: createToken({ userId: 'user2' }) });

    await peer1.queryInterface('admin@1.0.0'); // User1's definition
    await peer2.queryInterface('admin@1.0.0'); // User2's definition

    // Should have separate cache entries
    expect((peer1 as any).definitionCache.size).toBe(1);
    expect((peer2 as any).definitionCache.size).toBe(1);
  });
});
```

---

### PHASE 2: Error Mapping Fixes (Week 2)

**Goal:** Ensure consistent error handling and HTTP status code mapping.

#### 2.1 Fix `createErrorResponse()` in HTTP Server

**File:** `packages/titan/src/netron/transport/http/server.ts`

**Current issues:**
- Inconsistent use of `mapToHttp()` helper
- Direct status code construction instead of using error mapping
- Multiple places with duplicate error logic

**Fixed implementation:**
```typescript
// BEFORE:
private createErrorResponse(status: number, message: string, request: Request): Response {
  // Direct status code, no error mapping
  return new Response(
    JSON.stringify({ error: message }),
    { status }
  );
}

// AFTER:
private createErrorResponse(
  error: TitanError,
  requestId: string,
  request: Request
): Response {
  // Use consistent error mapping
  const httpError = mapToHttp(error);

  const errorResponse = createErrorResponse(requestId, {
    code: String(httpError.status),
    message: error.message,
    details: error.details
  });

  const headers = new Headers({
    ...httpError.headers,
    'X-Netron-Version': '2.0',
    'Content-Type': 'application/json'
  });

  this.applyCorsHeaders(headers, request);

  return new Response(
    JSON.stringify(errorResponse),
    { status: httpError.status, headers }
  );
}
```

**Update all error handling locations:**
1. `handleBatchRequest()` - batch operation errors
2. `handleInvokeRequest()` - method invocation errors
3. `handleAuthenticateRequest()` - authentication errors
4. Request parsing errors
5. CORS preflight errors

**Testing:**
```typescript
describe('HTTP Server - Error Mapping', () => {
  it('should map NotFoundError to 404', async () => {
    const response = await server.handle(request);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: '404', message: expect.any(String) }
    });
  });

  it('should map UnauthorizedError to 401', async () => {
    const response = await server.handle(request);
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('should map ValidationError to 400', async () => {
    const response = await server.handle(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: '400',
        details: expect.objectContaining({ validation: expect.any(Array) })
      }
    });
  });
});
```

---

### PHASE 3: Integration with Existing PM Module (Week 3-4)

**Goal:** Add tests and examples showing how developers can use the existing PM module for clustering when needed.

**IMPORTANT:** The `packages/titan/src/modules/pm` module already provides:
- Process spawning with worker/child isolation
- Process pools with load balancing strategies
- Health monitoring and metrics
- Multiple transport types (IPC/TCP/Unix/HTTP)
- Type-safe RPC through Netron integration

#### 3.1 Add Cluster Testing with PM Module

**File:** `packages/titan/test/integration/pm-http-cluster.spec.ts` (new)

```typescript
import { Application } from '@omnitron-dev/titan';
import { ProcessManagerModule, ProcessManager } from '@omnitron-dev/titan/module/pm';
import { Service, Public } from '@omnitron-dev/titan/netron';

@Service('calculator@1.0.0')
class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }

  @Public()
  getPid(): number {
    return process.pid;
  }
}

describe('PM Module - HTTP Cluster Integration', () => {
  let app: Application;
  let pm: ProcessManager;

  beforeAll(async () => {
    app = await Application.create({
      imports: [ProcessManagerModule],
      providers: [CalculatorService]
    });
    await app.start();
    pm = app.get(ProcessManager);
  });

  afterAll(async () => {
    await app.stop();
  });

  it('should spawn HTTP service in multiple workers', async () => {
    // Create process pool with 4 workers
    const pool = await pm.pool<CalculatorService>(
      './test/fixtures/calculator-worker.js',
      {
        size: 4,
        strategy: 'least-loaded',
        transport: { type: 'http', port: 0 } // Random port
      }
    );

    // All workers should be healthy
    const health = await pool.getHealth();
    expect(health.total).toBe(4);
    expect(health.healthy).toBe(4);

    await pool.terminate();
  });

  it('should distribute load across workers', async () => {
    const pool = await pm.pool<CalculatorService>(
      './test/fixtures/calculator-worker.js',
      {
        size: 4,
        strategy: 'round-robin',
        transport: { type: 'http', port: 0 }
      }
    );

    // Make 100 requests
    const pids = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const service = await pool.getService();
      const pid = await service.getPid();
      pids.add(pid);
    }

    // Should use all 4 workers
    expect(pids.size).toBe(4);

    await pool.terminate();
  });

  it('should handle worker crash and recovery', async () => {
    const pool = await pm.pool<CalculatorService>(
      './test/fixtures/calculator-worker.js',
      {
        size: 2,
        strategy: 'least-loaded',
        transport: { type: 'http', port: 0 },
        restart: { enabled: true, maxRetries: 3 }
      }
    );

    // Get initial workers
    const initialHealth = await pool.getHealth();
    expect(initialHealth.healthy).toBe(2);

    // Kill one worker
    const workers = await pool.getWorkers();
    await workers[0].kill();

    // Wait for auto-restart
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Should have 2 healthy workers again
    const finalHealth = await pool.getHealth();
    expect(finalHealth.healthy).toBe(2);

    await pool.terminate();
  });

  it('should isolate state between workers', async () => {
    @Service('stateful@1.0.0')
    class StatefulService {
      private counter = 0;

      @Public()
      increment(): number {
        return ++this.counter;
      }

      @Public()
      getCounter(): number {
        return this.counter;
      }
    }

    const pool = await pm.pool<StatefulService>(
      './test/fixtures/stateful-worker.js',
      {
        size: 3,
        strategy: 'sticky-session',
        transport: { type: 'http', port: 0 }
      }
    );

    // Get services from different workers
    const service1 = await pool.getService();
    const service2 = await pool.getService();

    // Increment in worker 1
    await service1.increment();
    await service1.increment();
    expect(await service1.getCounter()).toBe(2);

    // Worker 2 should have independent state
    expect(await service2.getCounter()).toBe(0);
    await service2.increment();
    expect(await service2.getCounter()).toBe(1);

    await pool.terminate();
  });

  it('should collect metrics from all workers', async () => {
    const pool = await pm.pool<CalculatorService>(
      './test/fixtures/calculator-worker.js',
      {
        size: 4,
        strategy: 'least-loaded',
        transport: { type: 'http', port: 0 }
      }
    );

    // Make some requests
    for (let i = 0; i < 50; i++) {
      const service = await pool.getService();
      await service.add(1, 1);
    }

    // Get aggregated metrics
    const metrics = await pool.getMetrics();
    expect(metrics.totalRequests).toBe(50);
    expect(metrics.workers).toHaveLength(4);
    expect(metrics.workers.every(w => w.requestCount > 0)).toBe(true);

    await pool.terminate();
  });
});
```

#### 3.2 Add Example Application

**File:** `examples/pm-http-cluster/main.ts` (new)

```typescript
import { Application } from '@omnitron-dev/titan';
import { ProcessManagerModule, ProcessManager } from '@omnitron-dev/titan/module/pm';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';

async function main() {
  const app = await Application.create({
    imports: [
      LoggerModule.forRoot({ level: 'info' }),
      ProcessManagerModule.forRoot({
        // Optional global configuration
        defaultStrategy: 'least-loaded',
        healthCheckInterval: 5000
      })
    ]
  });

  await app.start();

  const pm = app.get(ProcessManager);
  const logger = app.get('Logger');

  // Option 1: Single worker process
  const worker = await pm.spawn('./services/user-service.js', {
    transport: { type: 'http', port: 8080 },
    restart: { enabled: true, maxRetries: 5 }
  });

  logger.info({ pid: worker.pid }, 'User service spawned');

  // Option 2: Process pool for horizontal scaling
  const pool = await pm.pool('./services/order-service.js', {
    size: 4, // 4 workers
    strategy: 'round-robin',
    transport: { type: 'http', port: 8081 },
    restart: { enabled: true, maxRetries: 3 }
  });

  logger.info({ workers: pool.size }, 'Order service pool started');

  // Monitor health
  setInterval(async () => {
    const health = await pool.getHealth();
    logger.info(health, 'Pool health check');
  }, 10000);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    await pool.terminate();
    await worker.kill();
    await app.stop();
  });
}

main().catch(console.error);
```

**File:** `examples/pm-http-cluster/services/user-service.js`

```typescript
import { Application } from '@omnitron-dev/titan';
import { NetronModule } from '@omnitron-dev/titan/netron';
import { Service, Public } from '@omnitron-dev/titan/netron';

@Service('user@1.0.0')
class UserService {
  private users = new Map<string, any>();

  @Public()
  async createUser(data: { name: string; email: string }) {
    const id = crypto.randomUUID();
    const user = { id, ...data };
    this.users.set(id, user);
    return user;
  }

  @Public()
  async getUser(id: string) {
    return this.users.get(id) || null;
  }
}

async function main() {
  const app = await Application.create({
    imports: [NetronModule],
    providers: [UserService]
  });

  await app.start();

  const netron = app.get('Netron');
  const userService = app.get(UserService);

  await netron.expose(userService);
  await netron.useTransport('http', { port: 8080 });

  console.log(`Worker ${process.pid} ready on port 8080`);
}

main().catch(console.error);
```

#### 3.3 Documentation

**File:** `packages/titan/docs/pm-module-clustering.md` (new)

```markdown
# Clustering with PM Module

The PM (Process Manager) module provides built-in clustering capabilities for Titan applications. It's designed for developers who need horizontal scaling, process isolation, and load balancing.

## When to Use PM Module

- **Production deployments** requiring high availability
- **CPU-intensive workloads** that need parallelization
- **Isolated state** per worker process
- **Load balancing** across multiple instances
- **Auto-restart** on worker crashes

## When NOT to Use PM Module

- **Simple applications** with low traffic
- **Development environments** (adds complexity)
- **Applications managed by external orchestrators** (Kubernetes, Docker Swarm)

## Basic Usage

### Single Worker

```typescript
import { ProcessManager } from '@omnitron-dev/titan/module/pm';

const pm = app.get(ProcessManager);

const worker = await pm.spawn('./service.js', {
  transport: { type: 'http', port: 8080 },
  restart: { enabled: true }
});
```

### Process Pool

```typescript
const pool = await pm.pool('./service.js', {
  size: 4,
  strategy: 'least-loaded',
  transport: { type: 'http', port: 8080 }
});
```

## Load Balancing Strategies

- `round-robin` - Distribute evenly
- `least-loaded` - Route to worker with fewest active requests
- `sticky-session` - Pin client to specific worker (for stateful connections)

## Developer Freedom

The PM module is **optional**. You can:
- Run single-process applications
- Use external orchestrators (Kubernetes, PM2)
- Implement custom clustering solutions
- Use the PM module for convenience

**Titan doesn't dictate your deployment architecture.**
```

---

### PHASE 4: Documentation and Examples (Week 4)

#### 4.1 Update Main Documentation

**Add to:** `packages/titan/README.md`

```markdown
## Process Management (Optional)

For applications requiring clustering and load balancing, Titan includes an optional PM (Process Manager) module:

```typescript
import { ProcessManagerModule } from '@omnitron-dev/titan/module/pm';

const app = await Application.create({
  imports: [ProcessManagerModule]
});

const pm = app.get(ProcessManager);
const pool = await pm.pool('./service.js', { size: 4 });
```

See [PM Module Documentation](./docs/pm-module-clustering.md) for details.

**Note:** The PM module is optional. Use it if you need clustering, or manage processes with external tools.
```

#### 4.2 Add Migration Guide

**File:** `packages/titan/docs/http-optimization-migration.md` (new)

```markdown
# HTTP Transport Optimization - Migration Guide

## What Changed?

**Internal implementation optimizations** for HTTP transport. No breaking API changes.

## API Compatibility

All public APIs remain unchanged:
- ✅ `peer.queryInterface<T>(name)` - works exactly the same
- ✅ `peer.queryFluentInterface<T>(name)` - works exactly the same
- ✅ All existing code continues to work

## What's New (Internal)

1. **Optimized definition caching**
   - JWT-scoped cache keys
   - TTL-based expiration
   - Better memory efficiency

2. **Consistent error mapping**
   - All errors use `mapToHttp()` helper
   - Proper HTTP status codes
   - Consistent error format

3. **PM module integration tests**
   - Examples of clustering with PM module
   - Load balancing strategies
   - Worker health monitoring

## Migration Steps

**No migration needed!** Your existing code works without changes.

### Optional: Use PM Module for Clustering

If you want to add clustering:

```typescript
// Before: Single process
const app = await Application.create({...});
await app.start();

// After: Process pool (optional)
import { ProcessManagerModule } from '@omnitron-dev/titan/module/pm';

const app = await Application.create({
  imports: [ProcessManagerModule],
  ...
});

const pm = app.get(ProcessManager);
const pool = await pm.pool('./app.js', { size: 4 });
```
```

---

## 📊 Benefits of This Approach

### Minimal Changes
- ✅ Public API unchanged - full backward compatibility
- ✅ Internal optimizations only
- ✅ No breaking changes for existing applications
- ✅ Gradual adoption possible

### Developer Freedom
- ✅ PM module is **optional**, not mandatory
- ✅ Choose your own deployment strategy
- ✅ Use external orchestrators if preferred
- ✅ No framework lock-in

### Production Ready
- ✅ Existing PM module provides clustering
- ✅ Load balancing strategies included
- ✅ Health monitoring built-in
- ✅ Auto-restart capabilities

### Future Proof
- ✅ Room for further optimizations
- ✅ Can add features without breaking changes
- ✅ Flexible architecture

---

## 🎯 IMPLEMENTATION TASKS

### Week 1: HTTP Peer Optimization
- [ ] **Task 1.1:** Implement JWT-scoped cache keys in `HttpPeer`
- [ ] **Task 1.2:** Add TTL-based cache expiration
- [ ] **Task 1.3:** Extract `createCacheKey()` helper method
- [ ] **Task 1.4:** Extract `isCacheExpired()` helper method
- [ ] **Task 1.5:** Add `extractUserIdFromToken()` helper
- [ ] **Task 1.6:** Add configuration option `definitionCacheTtl`
- [ ] **Task 1.7:** Write unit tests for optimized caching
- [ ] **Task 1.8:** Write tests for JWT-scoped caching
- [ ] **Task 1.9:** Update JSDoc comments
- [ ] **Task 1.10:** Verify no API changes

### Week 2: Error Mapping Fixes
- [ ] **Task 2.1:** Refactor `createErrorResponse()` in HTTP server
- [ ] **Task 2.2:** Update `handleBatchRequest()` error handling
- [ ] **Task 2.3:** Update `handleInvokeRequest()` error handling
- [ ] **Task 2.4:** Update `handleAuthenticateRequest()` error handling
- [ ] **Task 2.5:** Update request parsing error handling
- [ ] **Task 2.6:** Update CORS preflight error handling
- [ ] **Task 2.7:** Add tests for 400/401/403/404/500 error codes
- [ ] **Task 2.8:** Add tests for error response format
- [ ] **Task 2.9:** Add tests for error headers
- [ ] **Task 2.10:** Verify all error paths use consistent mapping

### Week 3: PM Module Integration Tests
- [ ] **Task 3.1:** Create `pm-http-cluster.spec.ts` test file
- [ ] **Task 3.2:** Test spawning HTTP service in workers
- [ ] **Task 3.3:** Test load distribution (round-robin)
- [ ] **Task 3.4:** Test load distribution (least-loaded)
- [ ] **Task 3.5:** Test worker crash and recovery
- [ ] **Task 3.6:** Test state isolation between workers
- [ ] **Task 3.7:** Test health monitoring
- [ ] **Task 3.8:** Test metrics collection
- [ ] **Task 3.9:** Test graceful shutdown
- [ ] **Task 3.10:** Test sticky sessions (if needed)

### Week 4: Documentation and Examples
- [ ] **Task 4.1:** Create `pm-http-cluster` example directory
- [ ] **Task 4.2:** Write main application example
- [ ] **Task 4.3:** Write worker service examples
- [ ] **Task 4.4:** Create `pm-module-clustering.md` documentation
- [ ] **Task 4.5:** Create `http-optimization-migration.md` guide
- [ ] **Task 4.6:** Update main README.md
- [ ] **Task 4.7:** Add JSDoc examples to PM module
- [ ] **Task 4.8:** Add code comments for optimizations
- [ ] **Task 4.9:** Create architecture diagrams (optional)
- [ ] **Task 4.10:** Review all documentation for clarity

---

## 📁 Files to Modify

### High Priority (HTTP Optimization)
1. `packages/titan/src/netron/transport/http/peer.ts` - Optimize caching
2. `packages/titan/src/netron/transport/http/server.ts` - Fix error mapping
3. `packages/titan/test/netron/transport/http/peer.spec.ts` - Add cache tests

### Medium Priority (Error Handling)
4. `packages/titan/src/netron/transport/http/server.ts` - Update all error handlers
5. `packages/titan/test/netron/transport/http/server.spec.ts` - Add error tests

### New Files (PM Integration)
6. `packages/titan/test/integration/pm-http-cluster.spec.ts` - Integration tests
7. `examples/pm-http-cluster/main.ts` - Example application
8. `examples/pm-http-cluster/services/user-service.js` - Worker example
9. `packages/titan/docs/pm-module-clustering.md` - PM documentation
10. `packages/titan/docs/http-optimization-migration.md` - Migration guide

---

## ⚠️ CRITICAL PRINCIPLES

1. **Preserve API Compatibility** - Public methods `queryInterface<T>()` and `queryFluentInterface<T>()` remain unchanged for isomorphic client code across all transports.

2. **Internal Optimization Only** - All changes are to private/internal implementation details. External behavior stays the same.

3. **Use Existing PM Module** - No need for new ClusterManager. The existing `packages/titan/src/modules/pm` provides all clustering capabilities.

4. **Developer Freedom** - PM module is a tool, not a requirement. Developers choose their deployment strategy.

5. **Minimal Changes** - Make only necessary optimizations. Don't break working architecture.

6. **Server-Side Validation** - Definition is still queried (for compatibility), but server validates everything.

---

## 📝 Testing Strategy

### Unit Tests
- HTTP peer caching logic
- JWT extraction and cache key generation
- TTL expiration
- Error mapping helpers

### Integration Tests
- PM module with HTTP transport
- Load balancing strategies
- Worker isolation
- Health monitoring
- Auto-restart

### Regression Tests
- All existing tests must pass
- No API behavior changes
- Same error responses
- Same performance (or better)

---

## 🚀 Future Enhancements (Post-MVP)

### Phase 5: Advanced Caching
- Cache warming strategies
- Predictive cache invalidation
- Cache hit/miss metrics

### Phase 6: PM Module Features
- Hot reload without downtime
- Rolling deployments
- Advanced health checks
- Custom load balancing algorithms

### Phase 7: Monitoring Integration
- OpenTelemetry integration
- Prometheus metrics
- Distributed tracing
- Performance profiling

---

## 📚 Version History

**2025-10-10 (v1):** Initial architectural analysis, identified caching issues

**2025-10-10 (v2):** Revolutionary rethinking with HTTP simplification and node:cluster

**2025-10-10 (v3):** **Minimal changes approach** - preserve API, optimize internals, use existing PM module

---

**Analysis performed:** 2025-10-10
**Titan version:** 0.1.0
**Status:** Ready for implementation (minimal optimizations)
**Priority:** MEDIUM - Incremental improvements without breaking changes
**Philosophy:** Make it better, don't make it different
