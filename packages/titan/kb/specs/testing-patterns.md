---
module: titan
title: "Testing Patterns for Titan Applications"
tags: [testing, vitest, integration, e2e, mocking, best-practices]
summary: "Complete guide to testing Titan services: unit, integration, e2e patterns with real examples"
depends_on: [nexus-di, module-system, best-practices]
---

# Testing Patterns

## Test Levels

| Level | What | How | When |
|-------|------|-----|------|
| **Unit** | Single service, isolated | Mock all dependencies | Isolated logic bugs |
| **Integration** | Module interactions | Real DI container, mock external | Cross-module interactions |
| **E2E** | Full stack | Real services + DB + Netron | User-facing flows |

## Unit Testing Services

### Pattern: Direct instantiation with mocks

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  let mockUserRepo: any;
  let mockJwt: any;
  let mockCache: any;

  beforeEach(() => {
    mockUserRepo = {
      findByUsername: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    mockJwt = {
      sign: vi.fn().mockResolvedValue('mock-token'),
      verify: vi.fn(),
    };
    mockCache = {
      get: vi.fn(),
      set: vi.fn(),
    };

    service = new AuthService(mockUserRepo, mockJwt, mockCache);
  });

  describe('signIn', () => {
    it('should return auth response for valid credentials', async () => {
      mockUserRepo.findByUsername.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        passwordHash: await hashPassword('password'),
      });

      const result = await service.signIn('admin', 'password');

      expect(result.accessToken).toBe('mock-token');
      expect(result.user.username).toBe('admin');
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1' }),
      );
    });

    it('should throw on invalid password', async () => {
      mockUserRepo.findByUsername.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'different-hash',
      });

      await expect(service.signIn('admin', 'wrong'))
        .rejects.toThrow('INVALID_CREDENTIALS');
    });

    it('should throw on non-existent user', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(undefined);

      await expect(service.signIn('nobody', 'password'))
        .rejects.toThrow('INVALID_CREDENTIALS');
    });
  });
});
```

### Key Rules for Unit Tests

1. **Never mock the class under test** — only mock its dependencies
2. **Use `vi.fn()` for all mocks** — verify call counts and arguments
3. **Test error paths** — not just happy path
4. **One assertion per behavior** — not one per test (multiple expects per test is fine if they verify one behavior)
5. **Use `beforeEach` to reset mocks** — avoid state leakage between tests

## Integration Testing with DI Container

### Pattern: Real container, mock externals

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Application } from '@omnitron-dev/titan/application';
import { Container } from '@omnitron-dev/titan/nexus';

describe('Auth Module Integration', () => {
  let app: Application;
  let container: Container;

  beforeAll(async () => {
    app = await Application.create({ name: 'test-auth' });
    app.use(ConfigModule.forRoot({
      schema: testConfigSchema,
      sources: [{ type: 'object', data: testConfig }],
    }));
    app.use(DatabaseModule.forRoot({
      dialect: 'better-sqlite3',
      connection: { filename: ':memory:' },
    }));
    app.use(AuthModule);
    await app.start();
    container = app.getContainer();
  });

  afterAll(async () => {
    await app.stop();
  });

  it('should resolve AuthService with all dependencies', () => {
    const auth = container.resolve(AuthService);
    expect(auth).toBeInstanceOf(AuthService);
  });

  it('should create user and sign in', async () => {
    const auth = container.resolve(AuthService);
    const user = await auth.signUp({ username: 'test', password: 'pass123' });
    const session = await auth.signIn('test', 'pass123');
    expect(session.user.id).toBe(user.id);
  });
});
```

## E2E Testing with Netron RPC

### Pattern: Full app with Netron client

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Auth API E2E', () => {
  let app: Application;
  let client: NetronClient;

  beforeAll(async () => {
    app = await Application.create({ name: 'test-e2e' });
    // ... full module setup ...
    await app.start();

    client = new NetronClient({ url: `http://localhost:${testPort}` });
    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await app.stop();
  });

  it('should sign up and sign in via RPC', async () => {
    const authService = client.service('Auth');
    await authService.signUp({ username: 'e2e-user', password: 'test' });
    const result = await authService.signIn('e2e-user', 'test');
    expect(result.accessToken).toBeDefined();
  });
});
```

## Testing Anti-Patterns

### DON'T: Test implementation details
```typescript
// WRONG — testing internal method was called, not behavior
expect(service['_internalMethod']).toHaveBeenCalled();

// CORRECT — test the observable behavior
const result = await service.getUser('123');
expect(result.name).toBe('Alice');
```

### DON'T: Mock the database in integration tests (unless intentional)
```typescript
// WRONG for integration tests — hides real DB issues
const mockDb = { query: vi.fn().mockResolvedValue([]) };

// CORRECT for integration — use real SQLite in-memory
DatabaseModule.forRoot({
  dialect: 'better-sqlite3',
  connection: { filename: ':memory:' },
})
```

### DON'T: Write tests after the fix
```
1. Write test that reproduces the bug (RED)
2. Fix the bug
3. Test passes (GREEN)
4. Never the reverse
```

## Test File Organization

```
modules/auth/
  auth.service.ts
  auth.service.spec.ts       # Unit tests for AuthService
  auth.rpc-service.spec.ts   # Unit tests for RPC layer
  auth.integration.spec.ts   # Integration with real DI
  auth.e2e.spec.ts           # Full E2E with Netron client
```
