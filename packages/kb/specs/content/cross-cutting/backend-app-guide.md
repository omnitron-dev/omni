---
module: cross-cutting
title: "Complete Guide: Building a Backend App on Titan + Omnitron"
tags: [guide, backend, app, tutorial, complete, architecture]
summary: "Step-by-step guide for creating a production-quality backend app managed by Omnitron"
depends_on: [titan/philosophy, titan/nexus-di, titan/netron-rpc, titan/module-system, titan/best-practices]
---

# Building a Backend App on Titan + Omnitron

## Step 1: App Scaffold

```
apps/my-app/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── src/
│   ├── index.ts                    # Package exports (DTOs, interfaces)
│   ├── bootstrap.ts                # App entry point (Application.create)
│   ├── app.module.ts               # Root module
│   ├── modules/                    # Feature modules
│   │   └── {feature}/
│   │       ├── {feature}.module.ts
│   │       ├── {feature}.service.ts
│   │       ├── {feature}.rpc-service.ts
│   │       ├── {feature}.repository.ts
│   │       ├── {feature}.types.ts
│   │       └── {feature}.errors.ts
│   ├── shared/
│   │   ├── dto/                    # DTOs exported to consumers
│   │   │   ├── services.ts         # Service interface re-exports
│   │   │   └── index.ts
│   │   ├── tokens.ts               # All DI tokens
│   │   └── errors.ts               # Shared error classes
│   ├── database/
│   │   ├── schema.ts               # Table definitions
│   │   └── migrations/             # Numbered migrations
│   └── config/
│       ├── schema.ts               # Zod config schema
│       └── types.ts
├── kb/
│   ├── kb.config.ts
│   └── specs/
└── test/
```

## Step 2: package.json

```json
{
  "name": "@omnitron-dev/my-app",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./dist/index.js"
    },
    "./dto/services": {
      "types": "./src/shared/dto/services.ts",
      "default": "./dist/shared/dto/services.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@omnitron-dev/titan": "workspace:*",
    "@omnitron-dev/titan-auth": "workspace:*",
    "@omnitron-dev/titan-database": "workspace:*",
    "@omnitron-dev/titan-redis": "workspace:*"
  }
}
```

## Step 3: Bootstrap

```typescript
// src/bootstrap.ts
import { Application } from '@omnitron-dev/titan/application';
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';
import { AppModule } from './app.module.js';
import { AppConfigSchema } from './config/schema.js';

const app = await Application.create({
  name: 'my-app',
  version: '0.1.0',
});

app.use(ConfigModule.forRoot({
  schema: AppConfigSchema,
  sources: [{ type: 'env', prefix: 'MY_APP_' }],
}));

app.use(LoggerModule.forRoot({
  level: 'info',
  pretty: process.env.NODE_ENV !== 'production',
}));

app.use(AppModule);

await app.start();
export default app;
```

## Step 4: Root Module

```typescript
// src/app.module.ts
import { Module } from '@omnitron-dev/titan/decorators';
import { TitanDatabaseModule } from '@omnitron-dev/titan-database';
import { TitanRedisModule } from '@omnitron-dev/titan-redis';
import { TitanAuthModule } from '@omnitron-dev/titan-auth';
import { FeatureAModule } from './modules/feature-a/feature-a.module.js';
import { FeatureBModule } from './modules/feature-b/feature-b.module.js';

@Module({
  imports: [
    TitanDatabaseModule.forRoot({
      dialect: 'pg',
      connection: {
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'my_app',
        user: process.env.DB_USER ?? 'postgres',
        password: process.env.DB_PASSWORD ?? '',
      },
    }),
    TitanRedisModule.forRoot({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      db: 0, // Use appropriate DB index
    }),
    TitanAuthModule.forRoot({
      secret: process.env.JWT_SECRET!,
      expiresIn: '1h',
    }),
  ],
  modules: [FeatureAModule, FeatureBModule],
})
export class AppModule {}
```

## Step 5: Feature Module (Complete Example)

### Tokens
```typescript
// src/shared/tokens.ts
export const ORDER_SERVICE_TOKEN = Symbol.for('titan:order:service');
export const ORDER_REPOSITORY_TOKEN = Symbol.for('titan:order:repository');
```

### Types
```typescript
// src/modules/order/order.types.ts
export interface IOrder {
  id: string;
  userId: string;
  items: IOrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: Date;
}

export enum OrderStatus {
  Pending = 'pending',
  Confirmed = 'confirmed',
  Shipped = 'shipped',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
}

// Input DTOs
export interface CreateOrderDto {
  items: Array<{ productId: string; quantity: number }>;
}

// Response DTOs (never expose internal fields)
export interface OrderResponseDto {
  id: string;
  items: IOrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: string; // ISO string, not Date
}
```

### Errors
```typescript
// src/modules/order/order.errors.ts
import { ServiceError } from '@omnitron-dev/titan/errors';

export class OrderNotFoundError extends ServiceError {
  constructor(orderId: string) {
    super('ORDER_NOT_FOUND', `Order ${orderId} not found`, 404);
  }
}

export class InsufficientStockError extends ServiceError {
  constructor(productId: string) {
    super('INSUFFICIENT_STOCK', `Product ${productId} is out of stock`, 400);
  }
}

export class OrderAlreadyCancelledError extends ServiceError {
  constructor(orderId: string) {
    super('ORDER_ALREADY_CANCELLED', `Order ${orderId} is already cancelled`, 409);
  }
}
```

### Repository
```typescript
// src/modules/order/order.repository.ts
import { Injectable } from '@omnitron-dev/titan/decorators';
import { Inject } from '@omnitron-dev/titan/decorators';
import { DATABASE_TOKEN } from '@omnitron-dev/titan-database';
import type { DatabaseManager } from '@omnitron-dev/titan-database';
import { cuid } from '@omnitron-dev/cuid';
import type { IOrder, CreateOrderDto, OrderStatus } from './order.types.js';

@Injectable({ scope: Scope.Singleton })
export class OrderRepository {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: DatabaseManager,
  ) {}

  async findById(id: string): Promise<IOrder | undefined> {
    return this.db.getKysely()
      .selectFrom('orders')
      .where('id', '=', id)
      .selectAll()
      .executeTakeFirst();
  }

  async findByUserId(userId: string, limit = 50): Promise<IOrder[]> {
    return this.db.getKysely()
      .selectFrom('orders')
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .selectAll()
      .execute();
  }

  async create(userId: string, dto: CreateOrderDto, total: number): Promise<IOrder> {
    return this.db.getKysely()
      .insertInto('orders')
      .values({
        id: cuid(),
        user_id: userId,
        items: JSON.stringify(dto.items),
        total,
        status: 'pending',
        created_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    await this.db.getKysely()
      .updateTable('orders')
      .set({ status, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
```

### Service (Domain Logic)
```typescript
// src/modules/order/order.service.ts
import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { getCurrentAuth } from '@kysera/rls';
import { ORDER_REPOSITORY_TOKEN } from '../../shared/tokens.js';
import { OrderNotFoundError, OrderAlreadyCancelledError } from './order.errors.js';
import { OrderStatus } from './order.types.js';
import type { OrderRepository } from './order.repository.js';
import type { CreateOrderDto, IOrder, OrderResponseDto } from './order.types.js';

@Injectable({ scope: Scope.Singleton })
export class OrderService {
  constructor(
    @Inject(ORDER_REPOSITORY_TOKEN) private readonly orders: OrderRepository,
  ) {}

  async create(dto: CreateOrderDto): Promise<OrderResponseDto> {
    const auth = getCurrentAuth();
    if (!auth) throw new ServiceError('UNAUTHORIZED', 'Not authenticated', 401);

    const total = await this.calculateTotal(dto.items);
    const order = await this.orders.create(auth.userId, dto, total);
    return this.toDto(order);
  }

  async getById(orderId: string): Promise<OrderResponseDto> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    return this.toDto(order);
  }

  async getMyOrders(): Promise<OrderResponseDto[]> {
    const auth = getCurrentAuth();
    if (!auth) throw new ServiceError('UNAUTHORIZED', 'Not authenticated', 401);

    const orders = await this.orders.findByUserId(auth.userId);
    return orders.map(o => this.toDto(o));
  }

  async cancel(orderId: string): Promise<void> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    if (order.status === OrderStatus.Cancelled) {
      throw new OrderAlreadyCancelledError(orderId);
    }
    await this.orders.updateStatus(orderId, OrderStatus.Cancelled);
  }

  private async calculateTotal(items: CreateOrderDto['items']): Promise<number> {
    // Business logic for price calculation
    return items.reduce((sum, item) => sum + item.quantity * 10, 0); // Placeholder
  }

  private toDto(order: IOrder): OrderResponseDto {
    return {
      id: order.id,
      items: order.items,
      total: order.total,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
    };
  }
}
```

### RPC Service (Transport Layer)
```typescript
// src/modules/order/order.rpc-service.ts
import { Service, Public } from '@omnitron-dev/titan/decorators';
import type { OrderService } from './order.service.js';
import type { CreateOrderDto, OrderResponseDto } from './order.types.js';

@Service({ name: 'Order' })
export class OrderRpcService {
  constructor(private readonly orderService: OrderService) {}

  @Public({ auth: { roles: ['user'] } })
  async createOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    return this.orderService.create(dto);
  }

  @Public({ auth: { roles: ['user'] } })
  async getOrder(orderId: string): Promise<OrderResponseDto> {
    return this.orderService.getById(orderId);
  }

  @Public({ auth: { roles: ['user'] } })
  async getMyOrders(): Promise<OrderResponseDto[]> {
    return this.orderService.getMyOrders();
  }

  @Public({ auth: { roles: ['user', 'admin'] } })
  async cancelOrder(orderId: string): Promise<void> {
    return this.orderService.cancel(orderId);
  }
}
```

### Module (DI Wiring)
```typescript
// src/modules/order/order.module.ts
import { Module } from '@omnitron-dev/titan/decorators';
import { ORDER_SERVICE_TOKEN, ORDER_REPOSITORY_TOKEN } from '../../shared/tokens.js';
import { OrderService } from './order.service.js';
import { OrderRpcService } from './order.rpc-service.js';
import { OrderRepository } from './order.repository.js';

@Module({
  providers: [
    { provide: ORDER_REPOSITORY_TOKEN, useClass: OrderRepository },
    { provide: ORDER_SERVICE_TOKEN, useClass: OrderService },
    OrderRpcService,
  ],
  exports: [ORDER_SERVICE_TOKEN],
})
export class OrderModule {}
```

## Step 6: DTO Exports for Frontend

```typescript
// src/shared/dto/services.ts
export type { IOrderService } from '../../modules/order/order.rpc-service.js';
export type {
  CreateOrderDto,
  OrderResponseDto,
  OrderStatus,
} from '../../modules/order/order.types.js';
```

## Step 7: Register in omnitron.config.ts

```typescript
// omnitron.config.ts (monorepo root)
import { defineEcosystem } from '@omnitron-dev/omnitron';

export default defineEcosystem({
  apps: [
    {
      name: 'my-app',
      bootstrap: './apps/my-app/src/bootstrap.ts',
      requires: {
        postgres: true,
        redis: true,
      },
    },
  ],
});
```

## Step 8: Database Migration

```typescript
// src/database/migrations/001_initial.ts
import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('orders')
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull())
    .addColumn('items', 'jsonb', col => col.notNull())
    .addColumn('total', 'numeric', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('pending'))
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_orders_user_id')
    .on('orders')
    .column('user_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('orders').execute();
}
```

## Checklist

- [ ] Three-file pattern for every feature module
- [ ] @Public on every RPC method with explicit auth
- [ ] @Service without version suffix
- [ ] Symbol.for('titan:...') for all DI tokens
- [ ] ServiceError subclasses for domain errors (not raw Error)
- [ ] DTOs exported via package.json exports
- [ ] Repository pattern for all DB access
- [ ] ConfigModule with Zod schema validation
- [ ] No @ts-nocheck, no `any` casts
- [ ] Integration tests with real DI container
- [ ] pnpm fix:all before commit
