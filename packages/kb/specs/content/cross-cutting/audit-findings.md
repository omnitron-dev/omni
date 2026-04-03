---
module: cross-cutting
title: "Backend Audit Findings & Compliance Status"
tags: [audit, compliance, violations, fixes, quality, mandatory]
summary: "Results of full Titan pattern compliance audit across all 5 backend apps — violations, reference implementations, and fix priorities"
depends_on: [titan/best-practices, service-rpc-module, error-handling]
---

# Backend Audit Findings

Audit date: 2026-03-28. All 5 backend apps analyzed for Titan pattern compliance.

## Compliance Scorecard

| App | Error Handling | DI Tokens | @Public | Service Pattern | @ts-nocheck | Package Name |
|-----|---------------|-----------|---------|-----------------|-------------|-------------|
| **main** | AppError (not TitanError) | 2 raw Symbol() | All covered | Correct | **23 files** | @omnitron-dev/main |
| **storage** | StorageError (not TitanError) | All createToken() | All covered | Correct | None | @omnitron-dev/storage |
| **messaging** | MessagingError (not TitanError) | All createToken() | All covered | Correct | None | @omnitron-dev/messaging |
| **priceverse** | PriceVerseError (not TitanError) | All createToken() | All covered | Mixed @Service | None | **priceverse** (unscoped!) |
| **paysys** | **TitanError (CORRECT)** | **2 raw Symbol()** | All covered | Correct | None | **paysys** (unscoped!) |

**Reference implementation: paysys** — best error handling, TransactionAwareRepository, typed interfaces.

## CRITICAL Findings

### 1. Error classes don't extend TitanError (3 of 5 apps)

| App | Base Class | Impact |
|-----|-----------|--------|
| main | `AppError extends Error` | Errors don't serialize correctly over Netron RPC |
| messaging | `MessagingError extends Error` | Same |
| priceverse | `PriceVerseError extends Error` | Same |
| storage | `StorageError extends Error` | Same |
| **paysys** | **`extends TitanError`** | **CORRECT — reference implementation** |

**Fix**: All error base classes must extend `TitanError` from `@omnitron-dev/titan/errors`. Follow paysys pattern.

### 2. @ts-nocheck in 23 repository files (main)

`apps/main/src/database/repositories/` — 23 of 72 repository files have `@ts-nocheck`, completely disabling TypeScript checking. This violates the mandatory "No @ts-nocheck in production code" rule.

**Fix**: Remove @ts-nocheck, fix Kysely types using the existing `query-types.ts` helper.

### 3. Raw Symbol() instead of Symbol.for() (main + paysys)

```
main:   users.service.ts → Symbol('FollowRepository'), Symbol('BlockRepository')
paysys: cache.decorator.ts → Symbol('cache:metadata'), Symbol('cache:invalidate')
```

**Fix**: Use `createToken()` or `Symbol.for('titan:...')`.

### 4. JWT_SECRET non-null assertion without validation (main)

`app.module.ts:113` — `process.env['JWT_SECRET']!` — if undefined, JWTs are signed with `undefined` as secret (silent catastrophic security failure).

**Fix**: Add startup validation that throws if JWT_SECRET is missing.

### 5. Webhook tenant isolation bypass (storage)

`webhook.rpc-service.ts` — Any authenticated user can read/update/delete any webhook across tenants. `getCurrentAuth()` is called but `tenantId` is not used for authorization.

**Fix**: Pass tenantId to service layer, enforce tenant-scoped queries.

## HIGH Findings

### 6. Raw `throw new Error()` in RPC services

| App | Files | Instances |
|-----|-------|-----------|
| main | commerce, vacancies, auctions, rbac, users, config | ~20 |
| storage | webhook.service.ts | 11 |

**Fix**: Use typed error subclasses — `NotFoundError`, `ForbiddenError`, `BadRequestError`.

### 7. `as any` casts — 131 occurrences (main)

Concentrated in: commerce.service.ts (27), help.service.ts (13), notifications.rpc-service.ts (8).

**Fix**: Replace with proper generics, type narrowing, or interface refinements.

### 8. Unscoped package names (priceverse, paysys)

```json
"name": "priceverse"  // Should be @omnitron-dev/priceverse
"name": "paysys"      // Should be @omnitron-dev/paysys
```

### 9. @Service shorthand vs object form (priceverse)

```typescript
@Service('ChartsService')     // WRONG — shorthand string
@Service({ name: 'Charts' })  // CORRECT — object form
```

### 10. require() in ESM context (paysys)

`health.rpc-service.ts:25` — `const { createRequire } = require('node:module')` in an ESM module. Will throw at runtime.

**Fix**: Use `import { createRequire } from 'node:module'`.

### 11. `any` types in DTO service interfaces (paysys)

```typescript
listWallets(): Promise<any[]>   // WRONG
listCoins(): Promise<any[]>     // WRONG
```

## MEDIUM Findings

### 12. @Service name inconsistency (main)

Mixed: `Auth`, `Organizations`, `Commerce` vs `UsersService`, `AuditService`, `CaptchaService`.
**Standard**: Use domain nouns without "Service" suffix.

### 13. Missing `implements IXxxService` on RPC classes (main)

7 of 16 RPC services lack `implements IXxxService`, losing compile-time contract verification.

### 14. Messaging BaseRepository doesn't extend TransactionAwareRepository

Hand-rolled with extensive `(this.db as any)` casts instead of using Titan's `TransactionAwareRepository`.

### 15. TransformWorkerService has @Service but no @Public (storage)

Worker service methods exposed via Netron without auth decorators.

### 16. Missing RPC services for internal modules

| App | Module | Has service.ts | Missing rpc-service.ts |
|-----|--------|---------------|----------------------|
| messaging | dispute | Yes | Yes |
| messaging | support | Yes | Yes |
| messaging | org-chat | Yes | Yes |
| priceverse | alerts | Yes | Yes |

### 17. Duplicate PaginationSchema (main)

4 nearly identical copies across organizations, content, vacancies, geolocation RPC services.

### 18. No test files (main)

`test/unit/` and `test/integration/` directories exist but are empty. Zero test coverage for 16 modules.

## Pattern Reference: How Each App Should Look

### Error Handling (follow paysys)
```typescript
import { TitanError } from '@omnitron-dev/titan/errors';

export class AppError extends TitanError {
  constructor(code: string, message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message, code, statusCode, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super('NOT_FOUND', `${resource}${id ? ` '${id}'` : ''} not found`, 404);
  }
}
```

### Repository (follow paysys)
```typescript
import { TransactionAwareRepository } from '@omnitron-dev/titan-database/repository';

export abstract class BaseRepository<T> extends TransactionAwareRepository {
  // Automatic transaction context via AsyncLocalStorage
}
```

### Token Definition (follow main/messaging)
```typescript
import { createToken } from '@omnitron-dev/titan/nexus';

export const AUTH_SERVICE = createToken<IAuthService>('AuthService');
export const USER_REPO = createToken<IUserRepository>('UserRepository');
```

### Service Interface (follow paysys)
```typescript
// shared/interfaces/auth.interface.ts
export interface IAuthService {
  signIn(username: string, password: string): Promise<AuthResponseDto>;
  signOut(sessionId: string): Promise<void>;
}

// shared/dto/services.ts — re-export for consumers
export type { IAuthService } from '../interfaces/auth.interface.js';
```

## Fix Priority Order

1. **CRITICAL**: Fix raw Symbol() (main, paysys) — dual-package hazard
2. **CRITICAL**: Fix require() in ESM (paysys) — runtime crash
3. **CRITICAL**: Add JWT_SECRET startup validation (main) — silent security failure
4. **CRITICAL**: Fix webhook tenant isolation (storage) — data leak
5. **HIGH**: Remove @ts-nocheck from 23 files (main)
6. **HIGH**: Refactor error base classes to extend TitanError (main, storage, messaging, priceverse)
7. **HIGH**: Scope package names (priceverse, paysys)
8. **HIGH**: Replace raw throw new Error() with typed errors (main, storage)
9. **HIGH**: Fix @Service shorthand (priceverse)
10. **HIGH**: Fix any types in DTO interfaces (paysys)
11. **MEDIUM**: Add implements IXxxService to RPC classes (main)
12. **MEDIUM**: Migrate BaseRepository to TransactionAwareRepository (messaging)
13. **MEDIUM**: Extract shared PaginationSchema (main)
14. **MEDIUM**: Add tests (main — highest priority)
