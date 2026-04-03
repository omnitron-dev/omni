---
module: titan
title: "Titan Best Practices & Anti-Patterns"
tags: [best-practices, anti-patterns, quality, production, industrial-grade]
summary: "Comprehensive best practices for writing production-quality code with Titan — what to do, what to avoid, and why"
depends_on: [philosophy, nexus-di, netron-rpc, decorators, module-system]
---

# Best Practices & Anti-Patterns

## 1. DI Token Management

### DO: Use Symbol.for with titan: prefix for all tokens
```typescript
// Correct — dual-package safe, globally unique
export const AUTH_SERVICE_TOKEN = Symbol.for('titan:auth:service');
export const USER_REPOSITORY_TOKEN = Symbol.for('titan:user:repository');
```

### DO: Use createToken() for typed tokens with metadata
```typescript
import { createToken } from '@omnitron-dev/titan/nexus';

export const CACHE_TOKEN = createToken<ICacheService>('CacheService', {
  scope: Scope.Singleton,
  description: 'Application cache service',
});
```

### DON'T: Use plain Symbol()
```typescript
// WRONG — breaks with dual-package loading
const MY_TOKEN = Symbol('service');

// WRONG — different tokens in ESM vs CJS
export const TOKEN = Symbol.for(Math.random().toString());
```

### DON'T: Define tokens inline
```typescript
// WRONG — scattered tokens, impossible to track
@Inject(Symbol.for('titan:db')) private db: IDatabase;

// CORRECT — centralized token definitions
// tokens.ts
export const DB_TOKEN = Symbol.for('titan:database');
// service.ts
@Inject(DB_TOKEN) private db: IDatabase;
```

---

## 2. Service Architecture

### DO: Three-file pattern for every feature
```
modules/{feature}/
  {feature}.service.ts       # Pure domain logic
  {feature}.rpc-service.ts   # Netron RPC exposure
  {feature}.module.ts        # DI wiring
```

### DO: Separate domain logic from RPC concerns
```typescript
// service.ts — PURE domain logic, no @Public, no @Service
@Injectable({ scope: Scope.Singleton })
export class OrderService {
  constructor(
    @Inject(ORDER_REPO_TOKEN) private orders: IOrderRepository,
    @Inject(PAYMENT_TOKEN) private payments: IPaymentService,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    // Business rules only — no auth checks, no rate limits
    const order = await this.orders.create(dto);
    await this.payments.charge(order.total);
    return order;
  }
}

// rpc-service.ts — RPC exposure with auth + validation
@Service({ name: 'Order' })
export class OrderRpcService {
  constructor(private orderService: OrderService) {}

  @Public({ auth: { roles: ['user'] } })
  async createOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    return this.orderService.createOrder(dto);
  }

  @Public({ auth: { roles: ['admin'] } })
  async cancelOrder(orderId: string): Promise<void> {
    return this.orderService.cancel(orderId);
  }
}
```

### DON'T: Mix domain logic with RPC/transport concerns
```typescript
// WRONG — business logic + auth + RPC in one class
@Service({ name: 'Order' })
export class OrderService {
  @Public({ auth: { roles: ['user'] } })
  async createOrder(dto: CreateOrderDto): Promise<Order> {
    // Don't put business rules in RPC service
    if (dto.total > this.config.maxOrder) throw new Error('Too large');
    const order = await this.db.insert(dto);
    return order;
  }
}
```

### DON'T: Use @Service without a separate domain service
```typescript
// WRONG — all logic in RPC layer, untestable
@Service({ name: 'Auth' })
export class AuthRpcService {
  async signIn(u: string, p: string) {
    const user = await this.db.query('SELECT * FROM users WHERE username = ?', [u]);
    const valid = await bcrypt.compare(p, user.passwordHash);
    // 50 more lines of business logic...
  }
}
```

---

## 3. Auth Decorators

### DO: @Public on EVERY RPC method — no exceptions
```typescript
@Service({ name: 'Users' })
export class UsersRpcService {
  // Anonymous access
  @Public({ auth: { allowAnonymous: true } })
  async getPublicProfile(userId: string): Promise<PublicProfile> { ... }

  // Authenticated user
  @Public({ auth: { roles: ['user'] } })
  async updateProfile(dto: UpdateProfileDto): Promise<Profile> { ... }

  // Admin only
  @Public({ auth: { roles: ['admin'] } })
  async deleteUser(userId: string): Promise<void> { ... }

  // Owner only (policy-based)
  @Public({ auth: { policies: [BuiltInPolicies.OWNER_ONLY] } })
  async getMyData(): Promise<UserData> { ... }
}
```

### DON'T: Leave methods without @Public
```typescript
// WRONG — method without auth decorator is a security hole
@Service({ name: 'Admin' })
export class AdminRpcService {
  async dangerousOperation() { /* no @Public = no auth check! */ }
}
```

### DON'T: Use @Service name with version
```typescript
// WRONG
@Service({ name: 'Auth@1.0.0' })

// CORRECT
@Service({ name: 'Auth' })
```

---

## 4. Error Handling

### DO: Define domain errors extending TitanError or ServiceError
```typescript
import { ServiceError } from '@omnitron-dev/titan/errors';

export class UserNotFoundError extends ServiceError {
  constructor(userId: string) {
    super('USER_NOT_FOUND', `User ${userId} not found`, 404);
  }
}

export class InsufficientBalanceError extends ServiceError {
  constructor(required: number, available: number) {
    super('INSUFFICIENT_BALANCE', `Need ${required}, have ${available}`, 400, {
      required,
      available,
    });
  }
}
```

### DO: Use error codes, not just messages
```typescript
// CORRECT — structured, machine-readable
throw new ServiceError('SESSION_EXPIRED', 'Your session has expired', 401);

// WRONG — unstructured, hard to handle on frontend
throw new Error('Session expired');
```

### DON'T: Use raw Error or AppError (custom base class)
```typescript
// WRONG — not a Titan error, won't serialize correctly over Netron
throw new Error('Something went wrong');

// WRONG — custom base class bypasses Titan error handling
export class AppError extends Error { ... }

// CORRECT — extends Titan's error hierarchy
import { ServiceError, TitanError } from '@omnitron-dev/titan/errors';
```

---

## 5. Module Definition

### DO: Keep modules focused and cohesive
```typescript
@Module({
  providers: [
    AuthService,
    AuthRpcService,
    UserRepository,
    SessionRepository,
  ],
  exports: [AuthService], // Only export what other modules need
})
export class AuthModule {}
```

### DO: Use factory providers with Scope.Singleton for stateful services
```typescript
@Module({
  providers: [
    {
      provide: REDIS_CLIENT_TOKEN,
      useFactory: (config: ConfigService) => {
        return new Redis(config.get('redis'));
      },
      inject: [CONFIG_SERVICE_TOKEN],
      scope: Scope.Singleton, // CRITICAL — share one connection
    },
  ],
})
export class RedisModule {}
```

### DON'T: Forget scope on factory providers
```typescript
// WRONG — creates new Redis connection on every injection
{
  provide: REDIS_TOKEN,
  useFactory: () => new Redis(), // Missing scope = Transient by default
}

// CORRECT — singleton, shared across all consumers
{
  provide: REDIS_TOKEN,
  useFactory: () => new Redis(),
  scope: Scope.Singleton,
}
```

---

## 6. Repository Pattern

### DO: Use repositories for all data access
```typescript
@Injectable({ scope: Scope.Singleton })
export class UserRepository {
  constructor(
    @Inject(DATABASE_TOKEN) private db: DatabaseManager,
  ) {}

  async findById(id: string): Promise<User | undefined> {
    return this.db.getKysely()
      .selectFrom('users')
      .where('id', '=', id)
      .selectAll()
      .executeTakeFirst();
  }

  async create(dto: CreateUserDto): Promise<User> {
    return this.db.getKysely()
      .insertInto('users')
      .values({ id: cuid(), ...dto, created_at: new Date() })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
```

### DON'T: Put SQL/DB queries in services or RPC services
```typescript
// WRONG — DB access in service layer
@Injectable()
export class UserService {
  async getUser(id: string) {
    return this.db.selectFrom('users').where('id', '=', id).execute();
  }
}
```

---

## 7. DTO Design

### DO: Export DTOs from shared/dto/ via package.json exports
```typescript
// apps/main/src/shared/dto/auth.dto.ts
export interface AuthResponseDto {
  accessToken: string;
  session: SessionDto;
  user: AuthUserDto;
}

// apps/main/package.json
{
  "exports": {
    "./dto/services": {
      "types": "./src/shared/dto/services.ts",
      "default": "./dist/shared/dto/services.js"
    }
  }
}

// Consumer (frontend)
import type { AuthResponseDto } from '@omnitron-dev/main/dto/services';
```

### DO: Separate input DTOs from response DTOs
```typescript
// Input — what the client sends
export interface CreateUserDto {
  username: string;
  password: string;
}

// Response — what the server returns (never includes password hash)
export interface UserDto {
  id: string;
  username: string;
  createdAt: string;
}
```

### DON'T: Expose internal types as DTOs
```typescript
// WRONG — database entity leaked to frontend
export interface UserDto {
  id: string;
  passwordHash: string; // NEVER expose internal fields
  internalFlags: number; // Internal implementation detail
}
```

---

## 8. Configuration

### DO: Use ConfigModule with Zod validation
```typescript
import { z } from 'zod';

const AppConfigSchema = z.object({
  port: z.number().default(3000),
  database: z.object({
    host: z.string(),
    port: z.number().default(5432),
    name: z.string(),
  }),
  redis: z.object({
    url: z.string(),
    db: z.number().default(0),
  }),
});

@Module({
  imports: [
    ConfigModule.forRoot({
      schema: AppConfigSchema,
      sources: [
        { type: 'env', prefix: 'APP_' },
        { type: 'file', path: './config.yaml' },
      ],
    }),
  ],
})
export class AppModule {}
```

### DON'T: Hardcode configuration values
```typescript
// WRONG — hardcoded, can't change per environment
const redis = new Redis({ host: 'localhost', port: 6379, db: 0 });

// CORRECT — from config
const redis = new Redis(this.config.get('redis'));
```

---

## 9. Import Rules

### DO: Use subpath exports
```typescript
import { Application } from '@omnitron-dev/titan/application';
import { Injectable, Service, Public } from '@omnitron-dev/titan/decorators';
import { Container, createToken } from '@omnitron-dev/titan/nexus';
import { Netron } from '@omnitron-dev/titan/netron';
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';
import { z } from 'zod';  // Re-exported from titan/validation
```

### DON'T: Import from root barrel
```typescript
// WRONG — imports everything, breaks tree-shaking
import { Application, Injectable, Container } from '@omnitron-dev/titan';
```

### DON'T: Import from internal paths
```typescript
// WRONG — bypasses public API, breaks on version updates
import { Container } from '@omnitron-dev/titan/dist/nexus/container';
import { something } from '@omnitron-dev/titan/src/internal/utils';
```

---

## 10. Testing

### DO: Test domain services in isolation
```typescript
import { describe, it, expect, vi } from 'vitest';

describe('AuthService', () => {
  it('should return user on valid credentials', async () => {
    const mockRepo = { findByUsername: vi.fn().mockResolvedValue(testUser) };
    const service = new AuthService(mockRepo, mockJwt);

    const result = await service.signIn('admin', 'password');
    expect(result.user.username).toBe('admin');
  });
});
```

### DO: Use integration tests for module interactions
```typescript
import { createTestContainer } from '@omnitron-dev/testing/titan';

describe('Auth Module Integration', () => {
  it('should resolve AuthService with all dependencies', async () => {
    const container = await createTestContainer({
      modules: [AuthModule, DatabaseModule.forRoot(testDbConfig)],
    });

    const auth = container.get(AuthService);
    expect(auth).toBeInstanceOf(AuthService);
  });
});
```

### DON'T: Skip tests for "obvious" changes
Even single-line fixes must have a test that reproduces the bug first.

---

## 11. Cross-Cutting Concerns

### DO: Use getCurrentAuth() from RLS context
```typescript
import { getCurrentAuth } from '@kysera/rls';

@Injectable()
export class FileService {
  async getMyFiles(): Promise<File[]> {
    const auth = getCurrentAuth();
    if (!auth) throw new ServiceError('UNAUTHORIZED', 'Not authenticated', 401);
    return this.repo.findByOwner(auth.userId);
  }
}
```

### DO: Use invocationWrapper in Netron for auth context
The `invocationWrapper` bridges JWT auth from HTTP → AsyncLocalStorage → RLS for every RPC call.

### DON'T: Pass authContext as method parameter
```typescript
// WRONG — pollutes every method signature
async getUser(authContext: AuthContext, userId: string): Promise<User> { ... }

// CORRECT — use RLS AsyncLocalStorage
async getUser(userId: string): Promise<User> {
  const auth = getCurrentAuth(); // From AsyncLocalStorage
  ...
}
```

---

## 12. PostgreSQL Specifics

### DO: Coerce bigint columns
```typescript
// PostgreSQL bigint returns as string
const count = Number(result.count); // Always coerce
const seq = Number(event.seq);
```

### DO: Use UUID v7 for primary keys (time-ordered)
```typescript
import { uuidv7 } from '@omnitron-dev/titan-database';
const id = uuidv7();
```

### DON'T: Rely on Number.isFinite for bigint values
```typescript
// WRONG — Number.isFinite("5") === false (string)
if (Number.isFinite(row.count)) { ... }

// CORRECT
if (typeof row.count === 'string' || typeof row.count === 'number') {
  const count = Number(row.count);
}
```

---

## 13. Redis DB Index Convention

| App/Purpose | DB Index |
|------------|----------|
| Main | 0 (default) |
| Storage | 1 |
| Messaging | 2 |
| Priceverse | 3 |
| PaySys | 4 |

Always configure explicitly — never rely on default DB 0:
```typescript
RedisModule.forRoot({ db: 1 }) // Storage app
```
