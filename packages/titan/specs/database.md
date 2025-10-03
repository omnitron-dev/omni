# Titan Database Module Specification

## Overview

The Titan Database Module (`@omnitron-dev/titan/module/database`) provides seamless integration between Titan Framework and Kysera ORM, offering a production-ready database solution with enterprise features including multi-database support, migrations, repository pattern, plugins, and comprehensive health monitoring.

## Architecture Analysis

### Kysera ORM Capabilities

#### Core Features
- **Minimal Core**: Built on Kysely with minimal overhead (~10KB)
- **Type Safety**: Full TypeScript support with proper type inference
- **Multi-Database**: PostgreSQL, MySQL, SQLite support
- **Production Ready**: Health checks, graceful shutdown, connection lifecycle management
- **Plugin System**: Extensible architecture with interceptors and repository extensions
- **Smart Validation**: Configurable validation strategy (strict/none) with Zod schemas
- **Testing Utilities**: Transaction-based test isolation

#### Key Packages
1. **@kysera/core**: Debug utilities, health checks, pagination, error handling
2. **@kysera/repository**: Repository pattern with factory, validation, and plugin support
3. **@kysera/migrations**: Database migration system with up/down and dry-run
4. **@kysera/soft-delete**: Soft delete functionality with method override pattern
5. **@kysera/audit**: Audit logging with transaction awareness
6. **@kysera/timestamps**: Automatic created_at/updated_at management
7. **@kysera/cli**: Comprehensive CLI for database management

#### CLI Capabilities
- Migration management (create, up, down, status, reset)
- Database operations (console, dump, restore, introspect, seed)
- Code generation (models, repositories, schemas, CRUD)
- Health monitoring (check, metrics, watch)
- Plugin management
- Debug tools (profiler, SQL analyzer, circuit breaker)
- Testing utilities (fixtures, setup, teardown)

## Module Design

### Core Concepts

#### 1. Database Manager
Central service managing database connections, lifecycle, and configuration:
- Multi-database connection management
- Connection pooling with configurable limits
- Graceful shutdown handling
- Health monitoring integration
- Transaction coordination

#### 2. Repository Pattern Integration
Type-safe repositories with Titan dependency injection:
- Factory pattern for repository creation
- Automatic schema validation
- Plugin application
- Transaction support
- Batch operations optimization

#### 3. Migration System
Integrated migration management:
- Programmatic migration execution
- CLI command integration via Titan
- Migration state tracking
- Rollback capabilities
- Dry-run support

#### 4. Plugin Architecture
Extensible plugin system:
- Query interceptors
- Result transformers
- Repository method extensions
- Lifecycle hooks

### Module Structure

```
packages/titan/src/modules/database/
├── index.ts                    # Public API exports
├── database.module.ts          # Main module definition
├── database.manager.ts         # Database connection manager
├── database.service.ts         # Core service implementation
├── database.health.ts          # Health indicator
├── database.types.ts           # Type definitions
├── database.constants.ts       # Constants and tokens
├── database.decorators.ts      # Decorators
├── database.utils.ts           # Utilities
├── repository/
│   ├── repository.factory.ts   # Repository factory service
│   ├── repository.decorator.ts # @Repository decorator
│   └── repository.types.ts     # Repository types
├── migration/
│   ├── migration.service.ts    # Migration runner service
│   ├── migration.decorator.ts  # @Migration decorator
│   └── migration.types.ts      # Migration types
├── transaction/
│   ├── transaction.manager.ts  # Transaction manager
│   ├── transaction.decorator.ts # @Transactional decorator
│   └── transaction.types.ts    # Transaction types
└── plugins/
    ├── plugin.manager.ts       # Plugin manager
    └── plugin.types.ts         # Plugin interfaces
```

## Implementation Specification

### Phase 1: Core Infrastructure (Week 1)

#### 1.1 Module Bootstrap
```typescript
// database.module.ts
@Module()
export class TitanDatabaseModule {
  static forRoot(options: DatabaseModuleOptions): DynamicModule {
    // Initialize database manager
    // Register health indicators
    // Set up lifecycle hooks
  }

  static forRootAsync(options: DatabaseModuleAsyncOptions): DynamicModule {
    // Async configuration support
  }

  static forFeature(entities: string[]): DynamicModule {
    // Register specific repositories
  }
}
```

#### 1.2 Database Manager
```typescript
// database.manager.ts
@Injectable()
export class DatabaseManager {
  private connections: Map<string, Kysely<any>>;
  private pools: Map<string, Pool>;

  async init(): Promise<void>;
  async getConnection(name?: string): Promise<Kysely<any>>;
  async close(name?: string): Promise<void>;
  async closeAll(): Promise<void>;
  getPool(name?: string): Pool;
}
```

#### 1.3 Configuration Schema
```typescript
// database.types.ts
interface DatabaseModuleOptions {
  // Default connection
  connection?: DatabaseConnection;

  // Multiple named connections
  connections?: Record<string, DatabaseConnection>;

  // Kysera integration
  kysera?: {
    core?: KyseraCoreOptions;
    repository?: KyseraRepositoryOptions;
    plugins?: KyseraPlugin[];
  };

  // Module behavior
  isGlobal?: boolean;
  autoMigrate?: boolean;
  healthCheck?: boolean;
}

interface DatabaseConnection {
  name?: string;
  dialect: 'postgres' | 'mysql' | 'sqlite';
  connection: string | ConnectionConfig;
  pool?: PoolConfig;
  debug?: boolean;
  plugins?: string[];
}
```

### Phase 2: Repository Integration (Week 2)

#### 2.1 Repository Factory Service
```typescript
// repository/repository.factory.ts
@Injectable()
export class RepositoryFactory {
  constructor(
    private manager: DatabaseManager,
    private pluginManager: PluginManager
  ) {}

  create<Entity, DB = any>(config: RepositoryConfig<Entity>): Repository<Entity, DB> {
    // Create Kysera repository
    // Apply plugins
    // Wrap with Titan integration
  }

  createWithValidation<Entity>(config: ValidatedRepositoryConfig<Entity>): Repository<Entity> {
    // Create with Zod validation
  }
}
```

#### 2.2 Repository Decorator
```typescript
// repository/repository.decorator.ts
@Repository({
  table: 'users',
  connection: 'main',
  validate: true,
  plugins: ['softDelete', 'timestamps']
})
export class UserRepository {
  // Auto-injected repository methods
}
```

#### 2.3 Repository Registration
```typescript
// Auto-discovery of @Repository classes
// Dynamic provider registration
// Lazy loading support
```

### Phase 3: Migration System (Week 3)

#### 3.1 Migration Service
```typescript
// migration/migration.service.ts
@Injectable()
export class MigrationService {
  constructor(
    private manager: DatabaseManager,
    private logger: LoggerService
  ) {}

  async up(options?: MigrationOptions): Promise<void>;
  async down(steps?: number): Promise<void>;
  async status(): Promise<MigrationStatus>;
  async reset(): Promise<void>;
  async create(name: string): Promise<void>;
}
```

#### 3.2 Migration Decorator
```typescript
// migration/migration.decorator.ts
@Migration({
  version: '20250103_001',
  description: 'Create users table'
})
export class CreateUsersTable implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    // Migration up logic
  }

  async down(db: Kysely<any>): Promise<void> {
    // Migration down logic
  }
}
```

#### 3.3 CLI Integration
```typescript
// Integration with Titan CLI
// Commands: migrate:up, migrate:down, migrate:status, etc.
```

### Phase 4: Transaction Management (Week 4)

#### 4.1 Transaction Manager
```typescript
// transaction/transaction.manager.ts
@Injectable()
export class TransactionManager {
  async executeInTransaction<T>(
    fn: (trx: Transaction<any>) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>;

  getCurrentTransaction(): Transaction<any> | null;

  async withTransaction<T>(
    connection: string,
    fn: (trx: Transaction<any>) => Promise<T>
  ): Promise<T>;
}
```

#### 4.2 Transactional Decorator
```typescript
// transaction/transaction.decorator.ts
@Injectable()
export class UserService {
  @Transactional()
  async createUserWithProfile(data: CreateUserData): Promise<User> {
    // Automatically wrapped in transaction
  }

  @Transactional({ connection: 'replica', isolation: 'READ_COMMITTED' })
  async complexOperation(): Promise<void> {
    // Custom transaction options
  }
}
```

### Phase 5: Plugin Integration (Week 5)

#### 5.1 Built-in Plugins
```typescript
// Automatic registration of Kysera plugins
const plugins = {
  softDelete: softDeletePlugin,
  audit: auditPlugin,
  timestamps: timestampsPlugin
};
```

#### 5.2 Plugin Manager
```typescript
// plugins/plugin.manager.ts
@Injectable()
export class PluginManager {
  registerPlugin(name: string, plugin: KyseraPlugin): void;
  getPlugin(name: string): KyseraPlugin;
  applyPlugins(repository: any, plugins: string[]): any;
}
```

#### 5.3 Custom Plugin Support
```typescript
// Allow custom plugin registration
TitanDatabaseModule.forRoot({
  kysera: {
    plugins: [
      customPlugin(),
      anotherPlugin({ option: 'value' })
    ]
  }
})
```

### Phase 6: Advanced Features (Week 6)

#### 6.1 Health Monitoring
```typescript
// database.health.ts
@Injectable()
export class DatabaseHealthIndicator {
  async check(): Promise<HealthCheckResult> {
    // Connection health
    // Pool statistics
    // Query performance metrics
    // Migration status
  }
}
```

#### 6.2 Query Builder Integration
```typescript
// Direct Kysely query builder access
@Injectable()
export class UserService {
  constructor(
    @InjectConnection() private db: Kysely<Database>,
    @InjectConnection('replica') private replica: Kysely<Database>
  ) {}

  async complexQuery(): Promise<any> {
    return this.db
      .selectFrom('users')
      .innerJoin('profiles', 'users.id', 'profiles.user_id')
      .where('users.active', '=', true)
      .execute();
  }
}
```

#### 6.3 Pagination Utilities
```typescript
// Integrated pagination
@Injectable()
export class UserService {
  constructor(private userRepo: UserRepository) {}

  @Paginated({ defaultLimit: 20, maxLimit: 100 })
  async listUsers(options: PaginationOptions): Promise<PaginatedResult<User>> {
    return this.userRepo.paginate(options);
  }
}
```

## Usage Examples

### Basic Configuration
```typescript
// app.module.ts
import { TitanDatabaseModule } from '@omnitron-dev/titan/module/database';

@Module({
  imports: [
    TitanDatabaseModule.forRoot({
      connection: {
        dialect: 'postgres',
        connection: process.env.DATABASE_URL,
        pool: { min: 2, max: 10 }
      },
      kysera: {
        plugins: ['softDelete', 'timestamps', 'audit']
      },
      autoMigrate: true,
      isGlobal: true
    })
  ]
})
export class AppModule {}
```

### Multi-Database Setup
```typescript
TitanDatabaseModule.forRoot({
  connections: {
    main: {
      dialect: 'postgres',
      connection: process.env.MAIN_DATABASE_URL
    },
    analytics: {
      dialect: 'mysql',
      connection: process.env.ANALYTICS_DATABASE_URL
    },
    cache: {
      dialect: 'sqlite',
      connection: './cache.db'
    }
  }
})
```

### Repository Creation
```typescript
// user.repository.ts
@Repository({
  table: 'users',
  connection: 'main',
  schema: UserSchema,
  plugins: ['softDelete', 'timestamps']
})
export class UserRepository extends BaseRepository<User> {
  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ email });
  }

  async findActive(): Promise<User[]> {
    return this.query()
      .where('active', '=', true)
      .execute();
  }
}
```

### Service with Transactions
```typescript
// user.service.ts
@Injectable()
export class UserService {
  constructor(
    private userRepo: UserRepository,
    private profileRepo: ProfileRepository
  ) {}

  @Transactional()
  async createUser(data: CreateUserDto): Promise<User> {
    const user = await this.userRepo.create(data);
    await this.profileRepo.create({
      userId: user.id,
      ...data.profile
    });
    return user;
  }

  @Transactional({ isolation: 'SERIALIZABLE' })
  async transferCredits(fromId: number, toId: number, amount: number): Promise<void> {
    const from = await this.userRepo.findById(fromId, { lock: true });
    const to = await this.userRepo.findById(toId, { lock: true });

    if (from.credits < amount) {
      throw new Error('Insufficient credits');
    }

    await this.userRepo.update(fromId, { credits: from.credits - amount });
    await this.userRepo.update(toId, { credits: to.credits + amount });
  }
}
```

### Migration Example
```typescript
// migrations/001_create_users.ts
@Migration({
  version: '001',
  description: 'Create users table'
})
export class CreateUsersTable implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('email', 'varchar(255)', col => col.notNull().unique())
      .addColumn('name', 'varchar(255)', col => col.notNull())
      .addColumn('active', 'boolean', col => col.defaultTo(true))
      .addColumn('credits', 'integer', col => col.defaultTo(0))
      .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp')
      .addColumn('deleted_at', 'timestamp')
      .execute();

    await db.schema
      .createIndex('idx_users_email')
      .on('users')
      .column('email')
      .execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('users').execute();
  }
}
```

## Integration Points

### 1. Titan Config Module
```typescript
// Automatic configuration loading
const dbConfig = this.configService.get('database');
```

### 2. Titan Logger Module
```typescript
// Query logging integration
this.logger.debug({ sql, params }, 'Executing query');
```

### 3. Titan Events Module
```typescript
// Database events
@OnEvent('database.connected')
async handleConnection(event: DatabaseConnectionEvent) {}

@OnEvent('database.migration.completed')
async handleMigration(event: MigrationCompletedEvent) {}
```

### 4. Titan Health Module
```typescript
// Automatic health check registration
const health = await this.health.check(['database']);
```

### 5. Titan CLI Integration
```typescript
// CLI commands
titan db:migrate:up
titan db:migrate:status
titan db:seed
titan db:console
```

## Testing Support

### Test Module
```typescript
// Test module with transaction rollback
TitanDatabaseModule.forTest({
  connection: 'sqlite::memory:',
  autoMigrate: true,
  transactional: true // Auto rollback after each test
})
```

### Test Utilities
```typescript
// database.testing.ts
export class DatabaseTestingModule {
  static async createTestingModule(): Promise<TestingModule> {
    // Create isolated test database
    // Run migrations
    // Provide test utilities
  }

  async cleanDatabase(): Promise<void>;
  async seedDatabase(fixtures: any[]): Promise<void>;
  async truncateTables(): Promise<void>;
}
```

## Performance Considerations

### 1. Connection Pooling
- Configurable pool sizes per connection
- Connection reuse and lifecycle management
- Automatic reconnection with exponential backoff

### 2. Query Optimization
- Query builder with optimal SQL generation
- Batch operations support
- Prepared statement caching

### 3. Transaction Management
- Connection-level transaction isolation
- Nested transaction support (savepoints)
- Deadlock detection and retry

### 4. Caching Integration
- Query result caching (optional)
- Repository-level caching decorators
- Cache invalidation strategies

## Security Features

### 1. SQL Injection Prevention
- Parameterized queries by default
- Type-safe query builders
- Input validation with Zod schemas

### 2. Connection Security
- SSL/TLS support for connections
- Connection string encryption
- Credential rotation support

### 3. Audit Trail
- Built-in audit plugin support
- User context tracking
- Query execution logging

## Monitoring & Observability

### 1. Metrics
- Query execution time
- Connection pool metrics
- Transaction duration
- Error rates

### 2. Logging
- Structured query logging
- Error logging with context
- Slow query logging

### 3. Health Checks
- Connection liveness
- Pool availability
- Migration status
- Query performance

## Error Handling

### 1. Database Errors
```typescript
// Typed error handling
try {
  await userRepo.create(data);
} catch (error) {
  if (error instanceof UniqueConstraintError) {
    // Handle duplicate
  } else if (error instanceof ForeignKeyError) {
    // Handle reference error
  }
}
```

### 2. Connection Errors
- Automatic reconnection
- Circuit breaker pattern
- Fallback strategies

### 3. Transaction Errors
- Automatic rollback
- Retry mechanisms
- Deadlock resolution

## CLI Commands

### Migration Commands
```bash
titan db:migrate:create <name>    # Create new migration
titan db:migrate:up               # Run pending migrations
titan db:migrate:down [steps]     # Rollback migrations
titan db:migrate:status           # Show migration status
titan db:migrate:reset            # Reset all migrations
```

### Database Commands
```bash
titan db:console                  # Open database console
titan db:seed                     # Run database seeders
titan db:dump                     # Dump database
titan db:restore <file>           # Restore from dump
titan db:introspect               # Generate types from database
```

### Repository Commands
```bash
titan generate:repository <name>  # Generate repository
titan generate:migration <name>   # Generate migration
titan generate:model <table>      # Generate model from table
```

## Best Practices

### 1. Repository Organization
- One repository per aggregate root
- Thin repositories (business logic in services)
- Consistent naming conventions

### 2. Migration Management
- Sequential versioning
- Reversible migrations when possible
- Test migrations in development first

### 3. Transaction Scope
- Keep transactions short
- Avoid nested transactions when possible
- Use appropriate isolation levels

### 4. Connection Management
- Use connection pooling
- Close connections properly
- Monitor connection health

## Future Enhancements

### Phase 7: Advanced Features
1. **Read/Write Splitting**: Automatic query routing to replicas
2. **Sharding Support**: Horizontal scaling capabilities
3. **Event Sourcing**: Integration with event store
4. **Cache Integration**: Redis/Memcached query caching
5. **GraphQL Integration**: Auto-generated GraphQL resolvers

### Phase 8: Ecosystem Integration
1. **ORM Compatibility Layer**: Support for Prisma/TypeORM migrations
2. **Database Versioning**: Schema version management
3. **Data Synchronization**: Multi-database sync capabilities
4. **Backup Management**: Automated backup scheduling

### Phase 9: Developer Experience
1. **Studio Integration**: Visual database management UI
2. **Migration Visualizer**: Graphical migration timeline
3. **Query Analyzer**: Performance analysis tools
4. **Schema Designer**: Visual schema design tools

## Dependencies

### Required Packages
```json
{
  "dependencies": {
    "kysely": "^0.28.7",
    "@kysera/core": "^0.3.0",
    "@kysera/repository": "^0.3.0",
    "@kysera/migrations": "^0.3.0",
    "@kysera/soft-delete": "^0.3.0",
    "@kysera/audit": "^0.3.0",
    "@kysera/timestamps": "^0.3.0",
    "pg": "^8.16.0",
    "mysql2": "^3.15.0",
    "better-sqlite3": "^12.4.0",
    "zod": "^4.1.0"
  }
}
```

## Implementation Timeline

- **Week 1**: Core infrastructure (Module, Manager, Service)
- **Week 2**: Repository integration (Factory, Decorators, Registration)
- **Week 3**: Migration system (Service, Decorators, CLI)
- **Week 4**: Transaction management (Manager, Decorators, Isolation)
- **Week 5**: Plugin integration (Built-in plugins, Custom support)
- **Week 6**: Advanced features (Health, Query builder, Pagination)
- **Week 7**: Testing & Documentation
- **Week 8**: Performance optimization & Production readiness

## Conclusion

The Titan Database Module leverages Kysera ORM's production-ready capabilities while providing seamless integration with the Titan framework. This design ensures:

1. **Zero-overhead abstraction** over Kysely
2. **Type-safe database operations** with full TypeScript support
3. **Enterprise features** including multi-database, migrations, and plugins
4. **Seamless Titan integration** with DI, decorators, and lifecycle hooks
5. **Production readiness** with health monitoring, error handling, and performance optimization

The modular architecture allows teams to adopt features incrementally, starting with basic database operations and progressively adding advanced capabilities as needed.