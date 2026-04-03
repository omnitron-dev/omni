---
module: titan-database
title: "Database Best Practices"
tags: [database, postgresql, best-practices, migrations, performance, anti-patterns]
summary: "Production database patterns: migrations, queries, transactions, connection pooling, performance"
depends_on: [overview]
---

# Database Best Practices

## Connection Pooling

### DO: Configure pool size based on workload
```typescript
TitanDatabaseModule.forRoot({
  dialect: 'pg',
  connection: {
    host: 'localhost',
    database: 'app',
    // Pool size = CPU cores * 2 + 1 (rule of thumb)
    pool: { min: 2, max: 10 },
  },
})
```

### DON'T: Unlimited connections
```typescript
// WRONG — can exhaust PostgreSQL max_connections
pool: { min: 0, max: 100 }

// PostgreSQL default: max_connections = 100
// Each app should use 5-20 connections max
```

## Query Patterns

### DO: Select only needed columns
```typescript
// CORRECT — select specific columns
const users = await db.selectFrom('users')
  .select(['id', 'username', 'created_at'])
  .execute();

// WRONG for large tables — selects all columns including blobs
const users = await db.selectFrom('users')
  .selectAll()
  .execute();
```

### DO: Use indexes for filtered queries
```typescript
// Migration: create index for common query patterns
await db.schema
  .createIndex('idx_orders_user_id_status')
  .on('orders')
  .columns(['user_id', 'status'])
  .execute();
```

### DO: Paginate large result sets
```typescript
async findOrders(userId: string, page: number, limit: number = 50) {
  return this.qb
    .selectFrom('orders')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .offset((page - 1) * limit)
    .limit(limit)
    .selectAll()
    .execute();
}
```

### DON'T: N+1 queries
```typescript
// WRONG — N+1 problem
const orders = await this.orders.findAll();
for (const order of orders) {
  order.user = await this.users.findById(order.userId); // N queries!
}

// CORRECT — join or batch load
const orders = await db
  .selectFrom('orders')
  .innerJoin('users', 'users.id', 'orders.user_id')
  .selectAll('orders')
  .select(['users.username', 'users.email'])
  .execute();
```

## Transaction Patterns

### DO: Use @AutoTransactional for multi-step mutations
```typescript
@AutoTransactional()
async transferFunds(from: string, to: string, amount: number): Promise<void> {
  await this.accountRepo.debit(from, amount);
  await this.accountRepo.credit(to, amount);
  await this.auditRepo.log('transfer', { from, to, amount });
  // If any step fails, ALL are rolled back
}
```

### DO: Keep transactions short
```typescript
// CORRECT — fast transaction, no external calls inside
await db.transaction(async (trx) => {
  await trx.updateTable('balances').set({ amount: sql`amount - ${n}` }).execute();
  await trx.insertInto('ledger').values(entry).execute();
});

// WRONG — API call inside transaction holds lock
await db.transaction(async (trx) => {
  await trx.updateTable('orders').set({ status: 'processing' }).execute();
  await externalPaymentApi.charge(amount); // SLOW — blocks other transactions
});
```

## Migration Practices

### DO: Idempotent migrations
```typescript
// CORRECT — safe to run multiple times
await db.schema
  .createTable('users')
  .ifNotExists()
  .addColumn('id', 'text', col => col.primaryKey())
  .execute();

// CORRECT — check before adding column
const hasColumn = await db.schema
  .introspect('users')
  .then(info => info.some(c => c.name === 'new_column'));
if (!hasColumn) {
  await db.schema.alterTable('users')
    .addColumn('new_column', 'text')
    .execute();
}
```

### DO: Non-blocking migrations for production
```typescript
// CORRECT — CREATE INDEX CONCURRENTLY doesn't lock table
await sql`CREATE INDEX CONCURRENTLY idx_users_email ON users(email)`.execute(db);

// WRONG — blocks all writes during index creation
await db.schema.createIndex('idx_users_email').on('users').column('email').execute();
```

### DON'T: Drop columns in same release as code change
```
Release 1: Deploy code that stops using column
Release 2: Migration that drops column
// This prevents errors if Release 1 rolls back
```

## Bigint Coercion (CRITICAL)

```typescript
// PostgreSQL bigint → JavaScript string (pg driver behavior)
// ALWAYS coerce:
const count = Number(result.count);
const seq = Number(event.seq);

// NEVER:
if (Number.isFinite(row.count)) // false for string "5"
if (row.count > 0)              // string comparison, not numeric
```

## RLS (Row-Level Security)

### DO: Use @Policy for multi-tenant data isolation
```typescript
@Policy('tenant_isolation')
@Injectable()
export class TenantDataRepository {
  // All queries automatically filtered by current auth tenant
  async findAll(): Promise<Data[]> {
    // SELECT * FROM data WHERE tenant_id = current_setting('app.tenant_id')
  }
}
```

### DON'T: Manual tenant filtering everywhere
```typescript
// WRONG — easy to forget, security risk
async findAll(tenantId: string) {
  return db.selectFrom('data').where('tenant_id', '=', tenantId).execute();
}

// CORRECT — automatic via RLS policy
```

## Anti-Patterns Summary

| Anti-Pattern | Fix |
|-------------|-----|
| Raw SQL strings | Use Kysely type-safe builder |
| N+1 queries | JOINs or batch loading |
| Long transactions | Keep <100ms, no external calls inside |
| Missing indexes | Create indexes for WHERE/JOIN columns |
| selectAll on big tables | Select specific columns |
| Hardcoded connection | Use ConfigModule |
| Missing bigint coercion | Always Number(value) |
| Mutable migrations | Create new migration, never edit existing |
