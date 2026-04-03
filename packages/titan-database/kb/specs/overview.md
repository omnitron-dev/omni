---
module: titan-database
title: "TitanDatabaseModule - Database & ORM"
tags: [database, kysely, kysera, repository, transactions, rls, migrations, plugins]
summary: "Database module wrapping Kysera/Kysely with connection management, TransactionAwareRepository, plugin system (SoftDelete, Timestamps, Audit), RLS decorators, and migration support."
depends_on: ["@omnitron-dev/titan/nexus", "kysely", "@kysera/core", "@kysera/repository", "@kysera/executor"]
---

# TitanDatabaseModule

Package: `@omnitron-dev/titan-database`
Import: `@omnitron-dev/titan/module/database`

Minimal DI wrapper around Kysera (built on Kysely). Provides connection management, transaction context via AsyncLocalStorage, the TransactionAwareRepository base class, plugin-aware executors, and RLS decorators.

## Module Setup

### Static Configuration (forRoot)

```typescript
import { TitanDatabaseModule } from '@omnitron-dev/titan/module/database';

@Module({
  imports: [
    TitanDatabaseModule.forRoot({
      connection: {
        dialect: 'postgres',
        connection: {
          host: 'localhost',
          port: 5432,
          database: 'mydb',
          user: 'postgres',
          password: 'secret',
        },
        pool: { min: 2, max: 20 },
      },
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
```

### Async Configuration (forRootAsync)

```typescript
TitanDatabaseModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    connection: {
      dialect: 'postgres',
      connection: config.get('database.url'),
      pool: { min: 2, max: 20 },
    },
  }),
  inject: [CONFIG_SERVICE_TOKEN],
  isGlobal: true,
})
```

### Multiple Connections

```typescript
TitanDatabaseModule.forRoot({
  connections: {
    default: {
      dialect: 'postgres',
      connection: 'postgresql://localhost/main',
    },
    analytics: {
      dialect: 'postgres',
      connection: 'postgresql://localhost/analytics',
    },
  },
})
```

### forFeature (Repository Registration)

Register repositories in feature modules:

```typescript
@Module({
  imports: [
    TitanDatabaseModule.forFeature([UserRepository, PostRepository]),
  ],
})
export class UserModule {}
```

## DI Tokens

```typescript
import {
  DATABASE_MANAGER,           // IDatabaseManager (Symbol.for)
  DATABASE_CONNECTION,        // Default Kysely instance
  DATABASE_MODULE_OPTIONS,    // DatabaseModuleOptions
  DATABASE_HEALTH_INDICATOR,  // DatabaseHealthIndicator
  getDatabaseConnectionToken, // Named connection token
  getRepositoryToken,         // Repository DI token
} from '@omnitron-dev/titan/module/database';
```

## DatabaseManager

Central service managing connections and lifecycle.

```typescript
interface IDatabaseManager {
  getConnection(name?: string): Promise<Kysely<unknown>>;
  getPool(name?: string): Pool | mysql.Pool | Database | undefined;
  close(name?: string): Promise<void>;
  closeAll(): Promise<void>;
  isConnected(name?: string): boolean;
  getConnectionNames(): string[];
  getConnectionConfig(name?: string): DatabaseConnection | undefined;
}
```

The module auto-closes all connections on app shutdown (prevents PG `max_connections` exhaustion during dev restarts).

## Repository Pattern

### @Repository Decorator

```typescript
import { Repository, TransactionAwareRepository } from '@omnitron-dev/titan/module/database';

// Simple syntax -- just table name
@Repository('users')
class UserRepository extends TransactionAwareRepository<Database, 'users'> {
  // Inherits: findMany, findOne, findById, insert, update, delete, count...
}

// Full syntax with options
@Repository({
  table: 'users',
  connection: 'secondary',    // Named connection (default: 'default')
  softDelete: true,           // Enable soft delete plugin
  timestamps: true,           // Auto-manage createdAt/updatedAt
  audit: true,                // Log all changes to audit table
})
class UserRepository extends TransactionAwareRepository<Database, 'users'> {}
```

### Injecting Repositories

```typescript
import { InjectRepository } from '@omnitron-dev/titan/module/database';

@Injectable()
class UserService {
  constructor(
    @InjectRepository(UserRepository)
    private readonly users: UserRepository
  ) {}
}
```

### Other Injection Decorators

```typescript
@InjectConnection()           // Default connection (Kysely instance)
@InjectConnection('analytics') // Named connection
@InjectDatabaseManager()      // DatabaseManager instance
```

## Transaction Support

### runInTransaction

AsyncLocalStorage-based transaction context. All repositories within the callback automatically use the transaction.

```typescript
import { runInTransaction, getExecutor } from '@omnitron-dev/titan/module/database';

// Basic usage
await runInTransaction(db, async () => {
  await userRepo.insert({ name: 'Alice' });
  await accountRepo.insert({ userId: '...', balance: 0 });
  // Both operations in same transaction -- auto-rollback on error
});

// With options
await runInTransaction(db, async () => {
  // ...
}, { isolationLevel: 'serializable' });
```

### @AutoTransactional

Class decorator that wraps all repository operations in automatic transaction context.

```typescript
import { AutoTransactional } from '@omnitron-dev/titan/module/database';

@AutoTransactional()
class OrderService {
  async createOrder(data: CreateOrderDto) {
    // All DB operations here run in a transaction
    const order = await this.orderRepo.insert(data);
    await this.inventoryRepo.decrement(data.productId, data.quantity);
    return order;
  }
}
```

### Transaction Context Helpers

```typescript
import {
  getCurrentTransaction,    // Get active Transaction or undefined
  isInTransactionContext,   // Check if inside a transaction
  getExecutor,             // Get Kysely or Transaction (auto-detects)
} from '@omnitron-dev/titan/module/database';
```

## Plugin System

### Decorator-Based Plugins

```typescript
import { Repository, SoftDelete, Timestamps, Audit } from '@omnitron-dev/titan/module/database';

@Repository({ table: 'posts' })
@SoftDelete({ column: 'deleted_at' })
@Timestamps({ createdAt: 'created_at', updatedAt: 'updated_at' })
@Audit({ table: 'audit_logs', captureOldValues: true })
class PostRepository extends TransactionAwareRepository<Database, 'posts'> {
  // SoftDelete adds: softDelete(), restore(), findDeleted(), findWithDeleted()
  // Timestamps: auto-sets created_at on insert, updated_at on update
  // Audit: logs all CRUD operations to audit_logs table
}
```

### @kysera/executor Plugins

For programmatic plugin composition:

```typescript
import {
  createExecutor,
  softDeletePlugin,
  timestampsPlugin,
  auditPlugin,
} from '@omnitron-dev/titan/module/database';

const executor = createExecutor(db, {
  plugins: [
    softDeletePlugin({ column: 'deleted_at' }),
    timestampsPlugin({ createdAt: 'created_at', updatedAt: 'updated_at' }),
  ],
});
```

### Configuration-Level Plugins

```typescript
TitanDatabaseModule.forRoot({
  connection: { /* ... */ },
  plugins: {
    builtIn: {
      softDelete: true,
      timestamps: true,
      audit: { table: 'audit_logs' },
    },
  },
})
```

## RLS (Row-Level Security) Decorators

Declarative row-level security via decorators:

```typescript
import { Repository, Policy, Allow, Deny, Filter, BypassRLS } from '@omnitron-dev/titan/module/database';

@Repository({ table: 'posts' })
@Policy({ skipFor: ['admin', 'service_role'] })
class PostRepository extends TransactionAwareRepository<Database, 'posts'> {

  @Allow({ operations: ['select', 'update', 'delete'] })
  canAccessOwnPosts(ctx: PolicyContext, row: Post) {
    return row.authorId === ctx.auth.userId;
  }

  @Deny({ operations: ['delete'] })
  cannotDeletePublished(ctx: PolicyContext, row: Post) {
    return row.status === 'published';
  }

  @Filter()  // Default: applies to 'select'
  filterByTenant(ctx: PolicyContext) {
    return { tenantId: ctx.auth.tenantId };
  }

  @BypassRLS()
  async adminGetAll() {
    return this.findAll();  // Skips RLS checks
  }
}
```

### @kysera/rls Programmatic API

```typescript
import { defineRLSSchema, allow, deny, filter, rlsPlugin } from '@omnitron-dev/titan/module/database';

const schema = defineRLSSchema({
  posts: {
    rules: [
      allow(['select', 'update'], (ctx, row) => row.authorId === ctx.userId),
      deny(['delete'], (ctx, row) => row.status === 'published'),
    ],
    filters: [
      filter(['select'], (ctx) => ({ tenantId: ctx.tenantId })),
    ],
  },
});
```

## Migrations

Migrations are handled by `@kysera/migrations` and the `kysera` CLI. The module supports a `@Migration` decorator for class-based migrations:

```typescript
import { Migration } from '@omnitron-dev/titan/module/database';

@Migration({ version: '001', description: 'Create users table' })
class CreateUsersTable {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('users')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('username', 'varchar(255)', (col) => col.notNull().unique())
      .execute();
  }

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('users').execute();
  }
}
```

Run migrations via CLI: `kysera migrate up`

## DatabaseModuleOptions Reference

| Option | Type | Description |
|---|---|---|
| `connection` | `DatabaseConnection` | Single connection config |
| `connections` | `Record<string, DatabaseConnection>` | Named connections |
| `kysera.core` | `KyseraCoreOptions` | Debug, health, pagination, error handling |
| `kysera.repository` | `KyseraRepositoryOptions` | Validation, batch size |
| `kysera.plugins` | `Array<Plugin>` | Kysera executor plugins |
| `plugins` | `PluginsConfiguration` | Built-in + custom plugins |
| `transactionOptions` | object | Default isolation level, timeout, retry |
| `migrations` | object | Table name, directory, pattern |
| `rls` | `{ enabled: boolean }` | Enable RLS |
| `circuitBreaker` | object | DB circuit breaker config |
| `camelCase` | `boolean` | Enable CamelCasePlugin |
| `isGlobal` | `boolean` | Register globally |
| `healthCheck` | `boolean` | Enable health checks |
| `queryTimeout` | `number` | Query timeout ms |

## Supported Dialects

- `postgres` (default port 5432) -- via `pg` + `Pool`
- `mysql` (default port 3306) -- via `mysql2`
- `sqlite` (no port) -- via `better-sqlite3`

## Key Re-exports

The module re-exports essential Kysely and Kysera APIs:

```typescript
// Kysely
export { sql } from 'kysely';
export type { Kysely, Transaction, Selectable, Insertable, Updateable } from 'kysely';

// @kysera/core -- error handling, pagination
export { parseDatabaseError, UniqueConstraintError, ForeignKeyError, paginate, paginateCursor } from '@kysera/core';

// @kysera/repository -- utilities
export { upsert, upsertMany, atomicStatusTransition, applyWhereClause } from '@kysera/repository';

// @kysera/infra -- resilience
export { withRetry, CircuitBreaker, isTransientError } from '@kysera/infra';
```

## Default Constants

```typescript
DEFAULT_POOL_CONFIG = { min: 2, max: 20, idleTimeoutMillis: 30000, acquireTimeoutMillis: 60000 }
DEFAULT_TIMEOUTS = { query: 30000, transaction: 60000, shutdown: 10000, health: 5000 }
```

## Critical: PostgreSQL Bigint Coercion

PostgreSQL `bigint` columns return strings via the `pg` driver. Always coerce:

```typescript
// WRONG: Number.isFinite("5") === false
// RIGHT: Number(value) before any numeric operations
const count = Number(await repo.count());
```
