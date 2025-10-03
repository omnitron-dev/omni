# Titan Database Module

A comprehensive database module for the Titan framework, built on top of Kysely and Kysera, providing type-safe database operations, migrations, transactions, and advanced features for enterprise applications.

## Features

- 🔧 **Multi-Database Support**: PostgreSQL, MySQL, SQLite with dialect-specific optimizations
- 🏗️ **Type-Safe Query Builder**: Full Kysely integration with TypeScript
- 📦 **Repository Pattern**: Built-in repository with CRUD operations
- 🔄 **Migration System**: Version control for database schemas
- 💼 **Transaction Management**: Advanced transaction support with propagation and isolation levels
- 🔌 **Plugin System**: Extensible architecture with built-in and custom plugins
- 🏥 **Health Monitoring**: Comprehensive health checks and metrics
- 🧪 **Testing Utilities**: Isolated test environments with auto-rollback
- 🐳 **Docker Integration**: Built-in Docker support for testing

## Installation

The database module is included with the Titan framework:

```bash
yarn add @omnitron-dev/titan
```

## Quick Start

### Basic Setup

```typescript
import { Application, Module } from '@omnitron-dev/titan';
import { TitanDatabaseModule } from '@omnitron-dev/titan/module/database';

@Module({
  imports: [
    TitanDatabaseModule.forRoot({
      connection: {
        dialect: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'myapp',
        user: 'myuser',
        password: 'mypassword',
      },
      pool: {
        min: 2,
        max: 10,
      },
      isGlobal: true,
    }),
  ],
})
class AppModule {}

const app = await Application.create(AppModule);
await app.start();
```

### Repository Pattern

Define entities and repositories:

```typescript
import { Repository, BaseRepository } from '@omnitron-dev/titan/module/database';

interface User {
  id: number;
  email: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

@Repository<User>({
  table: 'users',
  timestamps: true, // Automatically manage created_at/updated_at
})
class UserRepository extends BaseRepository<any, 'users', User> {
  async findByEmail(email: string): Promise<User | undefined> {
    return this.findOne({ where: { email } });
  }
}
```

Use repositories in services:

```typescript
import { Injectable } from '@omnitron-dev/titan';
import { InjectRepository } from '@omnitron-dev/titan/module/database';

@Injectable()
class UserService {
  constructor(
    @InjectRepository(UserRepository) private userRepo: UserRepository
  ) {}

  async createUser(data: Partial<User>): Promise<User> {
    return this.userRepo.create(data);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return this.userRepo.findByEmail(email);
  }
}
```

## Configuration

### Connection Options

```typescript
TitanDatabaseModule.forRoot({
  // Connection configuration
  connection: {
    dialect: 'postgres' | 'mysql' | 'sqlite',
    host: 'localhost',
    port: 5432,
    database: 'mydb',
    user: 'user',
    password: 'password',

    // Or use connection string
    connectionString: 'postgresql://user:password@localhost:5432/mydb',

    // SSL options (PostgreSQL/MySQL)
    ssl: {
      rejectUnauthorized: false,
      ca: fs.readFileSync('ca-cert.pem'),
    },
  },

  // Connection pool configuration
  pool: {
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 60000,
  },

  // Migration configuration
  migrations: {
    directory: './migrations',
    tableName: 'kysera_migrations',
    autoRun: true,
  },

  // Plugin configuration
  plugins: {
    builtIn: {
      softDelete: true,
      timestamps: true,
      audit: true,
    },
    custom: [
      {
        plugin: './path/to/custom-plugin.js',
        options: { /* plugin options */ },
      },
    ],
  },

  // Make module global
  isGlobal: true,
});
```

### Multiple Connections

```typescript
TitanDatabaseModule.forRoot({
  connections: {
    default: {
      dialect: 'postgres',
      host: 'primary.db.example.com',
      // ... primary connection config
    },
    replica: {
      dialect: 'postgres',
      host: 'replica.db.example.com',
      // ... replica connection config
    },
    analytics: {
      dialect: 'mysql',
      host: 'analytics.db.example.com',
      // ... analytics connection config
    },
  },
});
```

## Migrations

### Creating Migrations

```typescript
import { Migration } from '@omnitron-dev/titan/module/database';

@Migration({
  version: '001',
  description: 'Create users table',
})
export class CreateUsersTable implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('users')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('email', 'varchar', (col) => col.notNull().unique())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addColumn('updated_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('users').execute();
  }
}
```

### Running Migrations

```typescript
import { MigrationRunner } from '@omnitron-dev/titan/module/database';

@Injectable()
class MigrationService {
  constructor(private migrationRunner: MigrationRunner) {}

  async runMigrations(): Promise<void> {
    const result = await this.migrationRunner.migrate();
    console.log(`Applied ${result.migrations.length} migrations`);
  }

  async rollbackLast(): Promise<void> {
    const result = await this.migrationRunner.down();
    console.log(`Rolled back migration: ${result.migration?.name}`);
  }

  async getMigrationStatus(): Promise<void> {
    const status = await this.migrationRunner.status();
    console.log(`Pending migrations: ${status.pending.length}`);
    console.log(`Applied migrations: ${status.applied.length}`);
  }
}
```

## Transactions

### Basic Transactions

```typescript
import { TransactionManager } from '@omnitron-dev/titan/module/database';

@Injectable()
class OrderService {
  constructor(
    @Inject(DATABASE_TRANSACTION_MANAGER) private txManager: TransactionManager,
    @InjectRepository(OrderRepository) private orderRepo: OrderRepository,
    @InjectRepository(InventoryRepository) private inventoryRepo: InventoryRepository
  ) {}

  async createOrder(orderData: any): Promise<Order> {
    return this.txManager.executeInTransaction(async (trx) => {
      // All operations within this function are transactional
      const order = await this.orderRepo.create(orderData);
      await this.inventoryRepo.decrementStock(orderData.productId, orderData.quantity);
      return order;
    });
  }
}
```

### Declarative Transactions

```typescript
import { Transactional } from '@omnitron-dev/titan/module/database';

@Injectable()
class PaymentService {
  @Transactional()
  async processPayment(paymentData: any): Promise<Payment> {
    // Method automatically wrapped in transaction
    const payment = await this.paymentRepo.create(paymentData);
    await this.accountRepo.updateBalance(paymentData.accountId, -paymentData.amount);
    await this.auditRepo.logTransaction(payment);
    return payment;
  }

  @Transactional({
    isolation: TransactionIsolationLevel.SERIALIZABLE,
    readOnly: false,
    timeout: 30000,
  })
  async transferFunds(from: string, to: string, amount: number): Promise<void> {
    // High-isolation transaction for critical operations
    await this.accountRepo.debit(from, amount);
    await this.accountRepo.credit(to, amount);
  }
}
```

### Nested Transactions (Savepoints)

```typescript
@Injectable()
class ComplexService {
  @Transactional()
  async complexOperation(): Promise<void> {
    await this.step1();

    try {
      await this.txManager.executeInTransaction(
        async () => {
          await this.riskyStep2();
        },
        { propagation: TransactionPropagation.NESTED }
      );
    } catch (error) {
      // Step 2 rolled back to savepoint, but step 1 preserved
      await this.handleStep2Failure();
    }

    await this.step3();
  }
}
```

## Plugins

### Built-in Plugins

#### Soft Delete Plugin

```typescript
@Repository({
  table: 'posts',
  softDelete: true, // Enables soft delete
})
class PostRepository extends BaseRepository<any, 'posts', Post> {}

// Usage
await postRepo.softDelete(postId); // Sets deleted_at timestamp
await postRepo.restore(postId); // Clears deleted_at
const activePosts = await postRepo.findAll(); // Excludes soft-deleted by default
const allPosts = await postRepo.findAll({ includeDeleted: true });
```

#### Timestamps Plugin

```typescript
@Repository({
  table: 'articles',
  timestamps: true, // Manages created_at and updated_at
})
class ArticleRepository extends BaseRepository<any, 'articles', Article> {}
```

#### Audit Plugin

```typescript
TitanDatabaseModule.forRoot({
  plugins: {
    builtIn: {
      audit: {
        enabled: true,
        table: 'audit_logs',
        events: ['create', 'update', 'delete'],
        userIdProvider: (context) => context.userId,
      },
    },
  },
});
```

### Custom Plugins

Create custom plugins:

```typescript
import { ITitanPlugin } from '@omnitron-dev/titan/module/database';

export const myCustomPlugin: ITitanPlugin = {
  name: 'my-custom-plugin',
  version: '1.0.0',

  async init(config?: any): Promise<void> {
    console.log('Plugin initialized with config:', config);
  },

  hooks: {
    beforeCreate: async (context) => {
      // Modify data before creation
      context.data.customField = 'value';
      return context;
    },

    afterUpdate: async (context) => {
      // Perform action after update
      console.log('Entity updated:', context.result);
      return context;
    },
  },

  extendDatabase(db: Kysely<any>): Kysely<any> {
    // Add custom methods to database instance
    return db;
  },
};
```

Register custom plugins:

```typescript
TitanDatabaseModule.forRoot({
  plugins: {
    custom: [
      {
        plugin: myCustomPlugin,
        options: { /* plugin configuration */ },
      },
    ],
  },
});
```

## Query Builder Access

Direct access to Kysely query builder:

```typescript
import { InjectConnection } from '@omnitron-dev/titan/module/database';

@Injectable()
class ReportService {
  constructor(
    @InjectConnection() private db: Kysely<any>,
    @InjectConnection('analytics') private analyticsDb?: Kysely<any>
  ) {}

  async getMonthlyRevenue(): Promise<any[]> {
    return this.db
      .selectFrom('orders')
      .innerJoin('order_items', 'orders.id', 'order_items.order_id')
      .where('orders.status', '=', 'completed')
      .where('orders.created_at', '>=', sql`DATE_TRUNC('month', CURRENT_DATE)`)
      .select([
        sql`DATE(orders.created_at)`.as('date'),
        sql`SUM(order_items.price * order_items.quantity)`.as('revenue'),
      ])
      .groupBy('date')
      .orderBy('date', 'asc')
      .execute();
  }

  async getTopProducts(limit: number = 10): Promise<any[]> {
    const db = this.analyticsDb || this.db;

    return db
      .with('product_sales', (qb) =>
        qb
          .selectFrom('order_items')
          .innerJoin('orders', 'orders.id', 'order_items.order_id')
          .where('orders.status', '=', 'completed')
          .select([
            'order_items.product_id',
            sql`SUM(order_items.quantity)`.as('total_quantity'),
            sql`SUM(order_items.price * order_items.quantity)`.as('total_revenue'),
          ])
          .groupBy('order_items.product_id')
      )
      .selectFrom('product_sales')
      .innerJoin('products', 'products.id', 'product_sales.product_id')
      .select([
        'products.name',
        'product_sales.total_quantity',
        'product_sales.total_revenue',
      ])
      .orderBy('total_revenue', 'desc')
      .limit(limit)
      .execute();
  }
}
```

## Pagination

Built-in pagination support:

```typescript
@Injectable()
class ProductService {
  constructor(
    @InjectRepository(ProductRepository) private productRepo: ProductRepository
  ) {}

  @Paginated({
    defaultLimit: 20,
    maxLimit: 100,
  })
  async listProducts(options?: PaginationOptions): Promise<PaginatedResult<Product>> {
    return this.productRepo.paginate(options);
  }

  async searchProducts(query: string, page: number = 1): Promise<PaginatedResult<Product>> {
    return this.productRepo.paginate({
      where: { name: { $like: `%${query}%` } },
      page,
      limit: 20,
      orderBy: [{ column: 'relevance', order: 'desc' }],
    });
  }
}
```

## Health Monitoring

Monitor database health:

```typescript
import { DatabaseHealthIndicator } from '@omnitron-dev/titan/module/database';

@Injectable()
class HealthController {
  constructor(private dbHealth: DatabaseHealthIndicator) {}

  async getHealth(): Promise<any> {
    const health = await this.dbHealth.check();

    return {
      status: health.status,
      connections: health.connections,
      metrics: health.metrics,
      migrations: health.migrations,
      transactions: health.transactions,
    };
  }

  async getHealthReport(): Promise<any> {
    return this.dbHealth.getHealthReport();
    // Returns: {
    //   status: 'healthy' | 'degraded' | 'unhealthy',
    //   connections: [...],
    //   issues: ['High latency on connection "replica": 150ms'],
    //   recommendations: ['Investigate network issues...'],
    // }
  }
}
```

## Testing

### Test Module Setup

```typescript
import { DatabaseTestingModule } from '@omnitron-dev/titan/module/database';

describe('UserService', () => {
  let app: Application;
  let testService: DatabaseTestingService;
  let userService: UserService;

  beforeEach(async () => {
    @Module({
      imports: [
        DatabaseTestingModule.forTest({
          transactional: true, // Auto-rollback after each test
          autoMigrate: true,   // Run migrations automatically
          autoClean: true,     // Clean database between tests
          autoSeed: true,      // Seed test data
        }),
      ],
      providers: [UserService, UserRepository],
    })
    class TestModule {}

    app = await Application.create(TestModule);
    testService = app.get(DatabaseTestingService);
    userService = app.get(UserService);

    await testService.initialize();
    await testService.beforeEach();
  });

  afterEach(async () => {
    await testService.afterEach();
    await app.stop();
  });

  it('should create user', async () => {
    const user = await userService.createUser({
      email: 'test@example.com',
      name: 'Test User',
    });

    expect(user.id).toBeDefined();

    // Assert database state
    const exists = await testService.assertDatabaseHas('users', {
      email: 'test@example.com',
    });
    expect(exists).toBe(true);
  });
});
```

### Test Data Factory

```typescript
it('should handle batch operations', async () => {
  // Create test data using factory
  const users = await testService.factory('users',
    () => ({
      email: faker.internet.email(),
      name: faker.person.fullName(),
      active: faker.datatype.boolean(),
    }),
    10 // Create 10 users
  );

  expect(users).toHaveLength(10);

  const count = await testService.assertDatabaseCount('users', 10);
  expect(count).toBe(true);
});
```

### Docker Integration

```typescript
import { DatabaseTestManager } from '@omnitron-dev/titan/test-utils';

describe('PostgreSQL Integration', () => {
  await DatabaseTestManager.withPostgres(async (container, connectionString) => {
    const app = await Application.create(AppModule, {
      database: { connectionString },
    });

    // Run tests with real PostgreSQL
    const service = app.get(MyService);
    const result = await service.performDatabaseOperation();
    expect(result).toBeDefined();
  });
});
```

## Advanced Features

### Database Manager

```typescript
import { InjectDatabaseManager, DatabaseManager } from '@omnitron-dev/titan/module/database';

@Injectable()
class MultiDatabaseService {
  constructor(
    @InjectDatabaseManager() private dbManager: DatabaseManager
  ) {}

  async copyDataBetweenDatabases(): Promise<void> {
    const sourceDb = await this.dbManager.getConnection('source');
    const targetDb = await this.dbManager.getConnection('target');

    const data = await sourceDb
      .selectFrom('source_table')
      .selectAll()
      .execute();

    await targetDb
      .insertInto('target_table')
      .values(data)
      .execute();
  }

  async getConnectionStatus(): Promise<Record<string, boolean>> {
    const connections = this.dbManager.getConnectionNames();
    const status: Record<string, boolean> = {};

    for (const name of connections) {
      status[name] = this.dbManager.isConnected(name);
    }

    return status;
  }
}
```

### Performance Optimization

```typescript
// Enable query result caching
import { cachingPlugin } from '@omnitron-dev/titan/module/database';

TitanDatabaseModule.forRoot({
  plugins: {
    custom: [{
      plugin: cachingPlugin,
      options: {
        ttl: 60000, // Cache for 60 seconds
        maxSize: 1000,
      },
    }],
  },
});

// Optimistic locking for concurrent updates
import { optimisticLockingPlugin } from '@omnitron-dev/titan/module/database';

@Repository({
  table: 'documents',
  plugins: [optimisticLockingPlugin],
})
class DocumentRepository extends BaseRepository<any, 'documents', Document> {}

// Use version field for optimistic locking
const doc = await docRepo.findById(1);
doc.content = 'Updated content';
await docRepo.update(doc.id, doc); // Throws if version mismatch
```

### Validation

```typescript
import { validationPlugin, CommonSchemas } from '@omnitron-dev/titan/module/database';
import { z } from 'zod';

const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  age: z.number().int().positive().optional(),
  role: CommonSchemas.enum(['admin', 'user', 'guest']),
});

@Repository({
  table: 'users',
  plugins: [{
    plugin: validationPlugin,
    options: { schema: userSchema },
  }],
})
class ValidatedUserRepository extends BaseRepository<any, 'users', User> {}
```

## API Reference

### Decorators

- `@Repository(config)` - Define a repository class
- `@Migration(metadata)` - Define a migration class
- `@Transactional(options?)` - Wrap method in transaction
- `@InjectConnection(name?)` - Inject database connection
- `@InjectDatabaseManager()` - Inject database manager
- `@InjectRepository(RepoClass)` - Inject repository instance
- `@Paginated(options)` - Add pagination to method
- `@UseConnection(name)` - Use specific connection
- `@SoftDelete()` - Enable soft delete for entity
- `@Timestamps()` - Auto-manage timestamps
- `@Audit()` - Enable audit logging

### Classes

- `TitanDatabaseModule` - Main database module
- `BaseRepository` - Base repository implementation
- `DatabaseManager` - Connection management
- `TransactionManager` - Transaction management
- `MigrationRunner` - Migration execution
- `DatabaseHealthIndicator` - Health monitoring
- `PluginManager` - Plugin lifecycle management
- `DatabaseTestingModule` - Testing utilities
- `DatabaseTestingService` - Test helpers

### Types

- `DatabaseModuleOptions` - Module configuration
- `ConnectionConfig` - Connection settings
- `RepositoryConfig` - Repository options
- `TransactionOptions` - Transaction settings
- `MigrationOptions` - Migration configuration
- `PaginationOptions` - Pagination parameters
- `PaginatedResult<T>` - Paginated response
- `DatabaseHealthCheckResult` - Health status

## Performance Tips

1. **Use Connection Pooling**: Configure appropriate pool sizes for your workload
2. **Enable Query Caching**: Use the caching plugin for frequently accessed data
3. **Optimize Queries**: Use indexes and analyze query execution plans
4. **Batch Operations**: Use bulk inserts/updates for large datasets
5. **Read Replicas**: Distribute read queries to replica connections
6. **Transaction Scope**: Keep transactions as short as possible
7. **Lazy Loading**: Use pagination for large result sets
8. **Monitor Health**: Regularly check health metrics and connection pools

## Migration Guide

### From TypeORM

```typescript
// TypeORM
@Entity()
class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;
}

// Titan Database
interface User {
  id: number;
  name: string;
}

@Repository<User>({ table: 'users' })
class UserRepository extends BaseRepository<any, 'users', User> {}
```

### From Prisma

```typescript
// Prisma
const user = await prisma.user.create({
  data: { name: 'John' },
});

// Titan Database
const user = await userRepo.create({ name: 'John' });
```

### From Raw Kysely

```typescript
// Raw Kysely
const users = await db
  .selectFrom('users')
  .selectAll()
  .execute();

// Titan Database (with repository)
const users = await userRepo.findAll();

// Titan Database (with direct access)
const users = await this.db
  .selectFrom('users')
  .selectAll()
  .execute();
```

## Troubleshooting

### Connection Issues

```typescript
// Check connection status
const isConnected = dbManager.isConnected('default');

// Test connection
const healthy = await dbHealth.testConnection('default');

// Get detailed health report
const report = await dbHealth.getHealthReport();
```

### Migration Failures

```typescript
// Check migration status
const status = await migrationRunner.status();
console.log('Pending:', status.pending);
console.log('Issues:', status.issues);

// Run with verbose logging
const result = await migrationRunner.migrate({
  verbose: true,
  dryRun: true, // Test without applying
});
```

### Transaction Deadlocks

```typescript
// Configure retry logic
@Transactional({
  retryOnDeadlock: true,
  maxRetries: 3,
  retryDelay: 100,
})
async riskyOperation() {
  // Automatically retries on deadlock
}
```

## Best Practices

1. **Use Repositories**: Encapsulate database logic in repository classes
2. **Type Safety**: Define TypeScript interfaces for all entities
3. **Migration Versioning**: Use sequential version numbers
4. **Transaction Boundaries**: Clearly define transaction scope
5. **Error Handling**: Implement proper error handling and logging
6. **Connection Management**: Use connection pooling and monitor pool health
7. **Testing**: Use DatabaseTestingModule for isolated tests
8. **Documentation**: Document complex queries and business logic

## License

Part of the Omnitron ecosystem. See main repository for license details.