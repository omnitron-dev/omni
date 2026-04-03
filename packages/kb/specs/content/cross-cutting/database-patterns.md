---
module: cross-cutting
title: "Database Patterns & Conventions"
tags: [database, postgresql, migrations, repository, transactions, rls]
summary: "How to work with PostgreSQL via Titan Database module — migrations, repositories, transactions, RLS"
depends_on: [titan-database]
---

# Database Patterns

## Migration Conventions

### File naming: `{NNN}_{description}.ts`
```
migrations/
  001_initial_schema.ts
  002_add_orders_table.ts
  003_add_user_settings.ts
  004_audit_logs.ts
```

### Migration structure
```typescript
import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('orders')
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('total', 'numeric(12,2)', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('pending'))
    .addColumn('metadata', 'jsonb')
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('orders').execute();
}
```

### Rules
1. **Never modify existing migrations** — create new ones
2. **Each migration is atomic** — either fully applied or fully rolled back
3. **Include both up and down** — rollbacks must work
4. **Test down migrations** — `pnpm migrate:down` should succeed

## Repository Pattern

```typescript
@Injectable({ scope: Scope.Singleton })
export class OrderRepository {
  constructor(@Inject(DATABASE_TOKEN) private db: DatabaseManager) {}

  private get qb() {
    return this.db.getKysely();
  }

  async findById(id: string): Promise<Order | undefined> {
    return this.qb
      .selectFrom('orders')
      .where('id', '=', id)
      .selectAll()
      .executeTakeFirst();
  }

  // Always return typed results, not raw SQL
  async findByStatus(status: OrderStatus): Promise<Order[]> {
    return this.qb
      .selectFrom('orders')
      .where('status', '=', status)
      .orderBy('created_at', 'desc')
      .selectAll()
      .execute();
  }
}
```

### Repository rules
1. **One repository per aggregate root** (User, Order, etc.)
2. **Return domain types**, not Kysely query builders
3. **No business logic** — pure data access
4. **Use Kysely type-safe query builder** — never raw SQL strings
5. **Singleton scope** — repositories are stateless

## Transaction Pattern

```typescript
// Declarative — wraps entire method in transaction
@AutoTransactional()
async transferFunds(from: string, to: string, amount: number): Promise<void> {
  await this.accounts.debit(from, amount);
  await this.accounts.credit(to, amount);
  await this.auditLog.record('transfer', { from, to, amount });
}

// Imperative — explicit transaction control
async complexOperation(): Promise<void> {
  await this.db.transaction(async (trx) => {
    await trx.insertInto('orders').values(order).execute();
    await trx.updateTable('inventory').set({ quantity: sql`quantity - 1` }).execute();
  });
}
```

## JSONB Columns

```typescript
// Store structured data as JSONB
await db.insertInto('orders')
  .values({
    items: JSON.stringify(items),          // Serialize
    metadata: JSON.stringify(metadata),
  })
  .execute();

// Query JSONB fields
const result = await db
  .selectFrom('orders')
  .where(sql`metadata->>'priority'`, '=', 'high')
  .execute();

// Parse on read
const order = await db.selectFrom('orders').executeTakeFirst();
const items = JSON.parse(order.items as string);  // Deserialize
```

## PostgreSQL Bigint Warning

PostgreSQL `bigint` returns as **string** in Node.js:

```typescript
// ALWAYS coerce bigint values
const count = Number(result.count);        // COUNT(*) returns string
const seq = Number(event.seq);             // BIGSERIAL returns string
const lastRead = Number(membership.last_read_seq);

// Number.isFinite("5") === false — NEVER use for bigint validation
```

## ID Generation

```typescript
import { cuid } from '@omnitron-dev/cuid';

// Use CUID for all primary keys
const id = cuid();  // e.g., "clz4k7m8t0000h6qw..."

// Or UUID v7 (time-ordered) for when ordering matters
import { uuidv7 } from '@omnitron-dev/titan-database';
const timeOrderedId = uuidv7();
```

## Soft Delete Pattern

```typescript
// Enable via @SoftDelete decorator
@SoftDelete({ columnName: 'deleted_at' })
@Injectable()
export class UserRepository {
  // findAll() automatically filters out soft-deleted records
  // Use includeDeleted() to bypass
  async findAllIncludingDeleted(): Promise<User[]> {
    return this.qb
      .selectFrom('users')
      .selectAll()
      .execute(); // Need to use raw query to bypass filter
  }
}
```

## Timestamps

```typescript
// Automatic created_at/updated_at
@Timestamps({ createdAt: 'created_at', updatedAt: 'updated_at' })
@Injectable()
export class OrderRepository {
  // created_at set automatically on insert
  // updated_at set automatically on update
}
```
