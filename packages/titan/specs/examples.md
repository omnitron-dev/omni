# Titan Framework - Comprehensive Examples

This document demonstrates how Titan dramatically simplifies application development compared to NestJS through real-world examples.

## Table of Contents

1. [E-Commerce Platform](#e-commerce-platform)
2. [Real-Time Chat Application](#real-time-chat-application)
3. [CLI Tool for Database Management](#cli-tool-for-database-management)
4. [Microservices Architecture](#microservices-architecture)
5. [GraphQL API with Subscriptions](#graphql-api-with-subscriptions)
6. [Event-Driven System](#event-driven-system)
7. [File Processing Pipeline](#file-processing-pipeline)
8. [Multi-Tenant SaaS Platform](#multi-tenant-saas-platform)
9. [IoT Device Management](#iot-device-management)
10. [Blockchain Integration](#blockchain-integration)

---

## E-Commerce Platform

### NestJS Implementation (Complex)

```typescript
// user.entity.ts
@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @OneToMany(() => Order, order => order.user)
  orders: Order[];
}

// user.dto.ts
export class CreateUserDto {
  @IsEmail()
  @ApiProperty()
  email: string;

  @IsString()
  @MinLength(8)
  @ApiProperty()
  password: string;

  @IsString()
  @ApiProperty()
  name: string;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}

// user.service.ts
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private authService: AuthService,
    private eventBus: EventBus
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    const user = this.userRepository.create({
      ...createUserDto,
      password: hashedPassword
    });
    const savedUser = await this.userRepository.save(user);
    this.eventBus.publish(new UserCreatedEvent(savedUser));
    return savedUser;
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}

// user.controller.ts
@Controller('users')
@ApiTags('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe())
  @ApiOperation({ summary: 'Create user' })
  @ApiResponse({ status: 201, type: User })
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(CacheInterceptor)
  @ApiOperation({ summary: 'Get user by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.findOne(id);
  }
}

// user.module.ts
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AuthModule,
    CqrsModule
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService]
})
export class UserModule {}

// Plus separate files for:
// - order.entity.ts
// - order.dto.ts
// - order.service.ts
// - order.controller.ts
// - order.module.ts
// - product.entity.ts
// - product.dto.ts
// - product.service.ts
// - product.controller.ts
// - product.module.ts
// - cart.service.ts
// - payment.service.ts
// - etc...

// Total: 500+ lines for basic e-commerce
```

### Titan Implementation (Simple)

```typescript
// schemas.ts - Single source of truth
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.date()
});

export const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  price: z.number().positive(),
  stock: z.number().int().min(0)
});

export const OrderSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
    price: z.number().positive()
  })),
  total: z.number().positive(),
  status: z.enum(['pending', 'paid', 'shipped', 'delivered'])
});

// ecommerce.service.ts - Complete business logic
@Service()
export class EcommerceService {
  constructor(
    private db: Database,
    private events: EventBus,
    private payment: PaymentGateway
  ) {}
  
  // User management
  @Method({
    input: UserSchema.omit({ id: true, createdAt: true }),
    output: UserSchema,
    auth: true
  })
  async createUser(data) {
    const user = await this.db.users.create({
      id: crypto.randomUUID(),
      ...data,
      createdAt: new Date()
    });
    await this.events.emit('user.created', user);
    return user;
  }
  
  // Product catalog
  @Method({
    input: z.object({
      query: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().default(20)
    }),
    output: z.array(ProductSchema),
    cache: { ttl: 300 }
  })
  async searchProducts({ query, category, limit }) {
    return this.db.products.search({ query, category, limit });
  }
  
  // Shopping cart (using async context)
  @Method({
    input: z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive()
    })
  })
  async addToCart({ productId, quantity }) {
    const ctx = Context.current();
    const cart = ctx.session.cart || [];
    cart.push({ productId, quantity });
    ctx.session.cart = cart;
    return { items: cart.length };
  }
  
  // Order processing
  @Method({
    input: z.object({
      items: z.array(z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive()
      })),
      paymentMethod: z.enum(['card', 'paypal'])
    }),
    output: OrderSchema
  })
  async createOrder({ items, paymentMethod }) {
    const ctx = Context.current();
    
    // Calculate total
    const products = await this.db.products.findByIds(
      items.map(i => i.productId)
    );
    const total = items.reduce((sum, item) => {
      const product = products.find(p => p.id === item.productId);
      return sum + (product.price * item.quantity);
    }, 0);
    
    // Create order
    const order = await this.db.orders.create({
      id: crypto.randomUUID(),
      userId: ctx.user.id,
      items: items.map(item => ({
        ...item,
        price: products.find(p => p.id === item.productId).price
      })),
      total,
      status: 'pending'
    });
    
    // Process payment
    const payment = await this.payment.charge({
      amount: total,
      method: paymentMethod,
      orderId: order.id
    });
    
    if (payment.success) {
      order.status = 'paid';
      await this.db.orders.update(order);
      await this.events.emit('order.paid', order);
    }
    
    return order;
  }
}

// app.ts - Complete application
const app = Titan.create()
  .service(EcommerceService)
  .use(DatabaseModule)
  .use(PaymentModule)
  .use(EventBusModule);

// Expose via HTTP
app.http()
  .use(Security.defaults())
  .listen(3000);

// Expose via GraphQL
app.graphql()
  .playground(true)
  .listen(4000);

// Generate documentation
await app.generateDocs().exportTo('./docs');

// Total: 100 lines for complete e-commerce!
```

---

## Real-Time Chat Application

### NestJS Implementation

```typescript
// Multiple files, complex setup, 300+ lines
// chat.gateway.ts, chat.service.ts, chat.module.ts
// message.entity.ts, room.entity.ts, user.entity.ts
// Plus DTOs, guards, interceptors, etc.
```

### Titan Implementation

```typescript
// Complete chat application in one file
import { Titan, Service, Method, Gateway } from '@titan/core';
import { z } from 'zod';

const MessageSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string(),
  userId: z.string(),
  text: z.string().max(1000),
  timestamp: z.date()
});

@Service()
@Gateway('/chat')
export class ChatService {
  private rooms = new Map<string, Set<string>>();
  private messages = new Map<string, Message[]>();
  
  @Method({
    input: z.object({ roomId: z.string() }),
    transport: 'websocket'
  })
  async joinRoom({ roomId }, client) {
    const ctx = Context.current();
    
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId).add(ctx.user.id);
    
    client.join(roomId);
    client.to(roomId).emit('user.joined', {
      userId: ctx.user.id,
      roomId
    });
    
    // Send recent messages
    const recent = this.messages.get(roomId)?.slice(-50) || [];
    return { messages: recent };
  }
  
  @Method({
    input: z.object({
      roomId: z.string(),
      text: z.string().max(1000)
    }),
    output: MessageSchema,
    transport: 'websocket'
  })
  async sendMessage({ roomId, text }, client) {
    const ctx = Context.current();
    
    const message = {
      id: crypto.randomUUID(),
      roomId,
      userId: ctx.user.id,
      text,
      timestamp: new Date()
    };
    
    // Store message
    if (!this.messages.has(roomId)) {
      this.messages.set(roomId, []);
    }
    this.messages.get(roomId).push(message);
    
    // Broadcast to room
    client.to(roomId).emit('message', message);
    
    return message;
  }
  
  @Method({
    input: z.object({
      roomId: z.string(),
      userId: z.string()
    }),
    transport: 'websocket'
  })
  async typing({ roomId, userId }, client) {
    client.to(roomId).emit('typing', { userId, roomId });
  }
}

// Run the app
Titan.create()
  .service(ChatService)
  .websocket({ cors: true })
  .listen(3000);

// That's it! Complete chat with rooms, history, and typing indicators
```

---

## CLI Tool for Database Management

### NestJS with Nest Commander (Complex)

```typescript
// Requires multiple files and complex setup
// 200+ lines for basic CLI
```

### Titan CLI (Simple)

```typescript
#!/usr/bin/env node
import { Titan, Service, Method } from '@titan/core';
import { z } from 'zod';

@Service()
class DatabaseCLI {
  constructor(private db: Database) {}
  
  @Method({
    input: z.object({
      host: z.string().default('localhost'),
      port: z.number().default(5432),
      database: z.string()
    }),
    description: 'Test database connection'
  })
  async test({ host, port, database }) {
    try {
      await this.db.connect({ host, port, database });
      console.log('✅ Connection successful');
      return true;
    } catch (error) {
      console.error('❌ Connection failed:', error.message);
      return false;
    }
  }
  
  @Method({
    input: z.object({
      query: z.string(),
      format: z.enum(['table', 'json', 'csv']).default('table')
    }),
    description: 'Execute SQL query'
  })
  async query({ query, format }) {
    const results = await this.db.query(query);
    
    switch (format) {
      case 'table':
        console.table(results);
        break;
      case 'json':
        console.log(JSON.stringify(results, null, 2));
        break;
      case 'csv':
        console.log(this.toCSV(results));
        break;
    }
    
    return results;
  }
  
  @Method({
    input: z.object({
      table: z.string(),
      file: z.string()
    }),
    description: 'Export table to file'
  })
  async export({ table, file }) {
    const data = await this.db.query(`SELECT * FROM ${table}`);
    await fs.writeFile(file, JSON.stringify(data, null, 2));
    console.log(`✅ Exported ${data.length} rows to ${file}`);
  }
  
  @Method({
    input: z.object({
      direction: z.enum(['up', 'down']).default('up'),
      steps: z.number().default(1)
    }),
    description: 'Run database migrations'
  })
  async migrate({ direction, steps }) {
    const migrator = new Migrator(this.db);
    
    if (direction === 'up') {
      await migrator.up(steps);
    } else {
      await migrator.down(steps);
    }
    
    console.log('✅ Migrations completed');
  }
}

// Create CLI app
Titan.create()
  .service(DatabaseCLI)
  .cli({
    name: 'dbutil',
    version: '1.0.0',
    description: 'Database management utility'
  })
  .run();

// Usage:
// $ dbutil test --database mydb
// $ dbutil query "SELECT * FROM users" --format json
// $ dbutil export users ./backup.json
// $ dbutil migrate up --steps 3
// $ dbutil --help (auto-generated with descriptions)
```

---

## Microservices Architecture

### Titan Microservices

```typescript
// user-service.ts
@Service()
export class UserService {
  @Method({
    input: z.string().uuid(),
    output: UserSchema,
    pattern: 'user.get' // Message pattern for microservices
  })
  async getUser(id: string) {
    return this.db.users.findById(id);
  }
  
  @Method({
    input: CreateUserSchema,
    output: UserSchema,
    pattern: 'user.create'
  })
  async createUser(data) {
    const user = await this.db.users.create(data);
    await this.events.emit('user.created', user);
    return user;
  }
}

// order-service.ts
@Service()
export class OrderService {
  constructor(
    private db: Database,
    private userService: RemoteService<UserService> // Type-safe remote service
  ) {}
  
  @Method({
    input: CreateOrderSchema,
    output: OrderSchema,
    pattern: 'order.create'
  })
  async createOrder(data) {
    // Call remote user service with full type safety
    const user = await this.userService.getUser(data.userId);
    
    if (!user) throw new Error('User not found');
    
    const order = await this.db.orders.create({
      ...data,
      userName: user.name,
      userEmail: user.email
    });
    
    return order;
  }
  
  @EventListener('user.deleted')
  async onUserDeleted({ userId }) {
    // Handle user deletion across services
    await this.db.orders.updateMany(
      { userId },
      { status: 'cancelled' }
    );
  }
}

// Gateway API that combines microservices
@Service()
export class ApiGateway {
  constructor(
    private users: RemoteService<UserService>,
    private orders: RemoteService<OrderService>
  ) {}
  
  @Method({
    input: z.string().uuid(),
    output: z.object({
      user: UserSchema,
      orders: z.array(OrderSchema)
    })
  })
  async getUserWithOrders(userId: string) {
    // Parallel remote calls
    const [user, orders] = await Promise.all([
      this.users.getUser(userId),
      this.orders.getUserOrders(userId)
    ]);
    
    return { user, orders };
  }
}

// Run microservices
const userApp = Titan.create()
  .service(UserService)
  .microservice({ transport: 'redis' })
  .listen(4001);

const orderApp = Titan.create()
  .service(OrderService)
  .microservice({ transport: 'redis' })
  .listen(4002);

const gateway = Titan.create()
  .service(ApiGateway)
  .http()
  .listen(3000);
```

---

## GraphQL API with Subscriptions

```typescript
// Complete GraphQL API with subscriptions
@Service()
@GraphQL() // Auto-generate GraphQL schema
export class BlogService {
  private posts = new Map();
  private subscriptions = new EventEmitter();
  
  @Query()
  @Method({
    input: z.object({
      limit: z.number().default(10),
      offset: z.number().default(0)
    }),
    output: z.array(PostSchema)
  })
  async posts({ limit, offset }) {
    const all = Array.from(this.posts.values());
    return all.slice(offset, offset + limit);
  }
  
  @Mutation()
  @Method({
    input: CreatePostSchema,
    output: PostSchema
  })
  async createPost(data) {
    const post = {
      id: crypto.randomUUID(),
      ...data,
      createdAt: new Date()
    };
    
    this.posts.set(post.id, post);
    this.subscriptions.emit('post.created', post);
    
    return post;
  }
  
  @Subscription()
  @Method({
    output: PostSchema,
    description: 'Subscribe to new posts'
  })
  postCreated() {
    return this.subscriptions.asyncIterator('post.created');
  }
  
  @Mutation()
  @Method({
    input: z.object({
      postId: z.string().uuid(),
      text: z.string()
    }),
    output: CommentSchema
  })
  async addComment({ postId, text }) {
    const comment = {
      id: crypto.randomUUID(),
      postId,
      text,
      createdAt: new Date()
    };
    
    const post = this.posts.get(postId);
    post.comments = post.comments || [];
    post.comments.push(comment);
    
    this.subscriptions.emit('comment.added', { postId, comment });
    
    return comment;
  }
  
  @Subscription()
  @Method({
    input: z.string().uuid(), // Subscribe to specific post
    output: CommentSchema
  })
  commentAdded(postId: string) {
    return this.subscriptions
      .asyncIterator('comment.added')
      .filter(event => event.postId === postId)
      .map(event => event.comment);
  }
}

// Run with GraphQL
Titan.create()
  .service(BlogService)
  .graphql({
    playground: true,
    subscriptions: {
      path: '/subscriptions',
      keepAlive: 10000
    }
  })
  .listen(4000);

// Automatically generates:
// - GraphQL schema
// - Resolvers
// - Subscriptions
// - Playground at http://localhost:4000/graphql
```

---

## Event-Driven System

```typescript
// Event-driven order processing system
@Service()
export class OrderProcessor {
  @EventHandler('order.created')
  async onOrderCreated(order: Order) {
    // Validate inventory
    const available = await this.inventory.check(order.items);
    if (!available) {
      await this.events.emit('order.failed', {
        orderId: order.id,
        reason: 'insufficient_inventory'
      });
      return;
    }
    
    // Reserve inventory
    await this.inventory.reserve(order.items);
    await this.events.emit('inventory.reserved', { orderId: order.id });
  }
  
  @EventHandler('inventory.reserved')
  async onInventoryReserved({ orderId }) {
    const order = await this.orders.findById(orderId);
    
    // Process payment
    const payment = await this.payment.charge({
      amount: order.total,
      customerId: order.customerId
    });
    
    if (payment.success) {
      await this.events.emit('payment.completed', { orderId, paymentId: payment.id });
    } else {
      await this.events.emit('payment.failed', { orderId });
      await this.inventory.release(order.items);
    }
  }
  
  @EventHandler('payment.completed')
  async onPaymentCompleted({ orderId }) {
    // Update order status
    await this.orders.update(orderId, { status: 'paid' });
    
    // Trigger fulfillment
    await this.events.emit('order.ready_to_ship', { orderId });
    
    // Send confirmation email
    await this.events.emit('email.send', {
      template: 'order_confirmation',
      orderId
    });
  }
  
  @Saga('order.processing')
  async orderProcessingSaga(orderId: string) {
    // Orchestrate the entire order process
    const steps = [
      'inventory.check',
      'payment.process',
      'order.fulfill',
      'notification.send'
    ];
    
    for (const step of steps) {
      try {
        await this.executeStep(step, orderId);
      } catch (error) {
        await this.compensate(step, orderId);
        throw error;
      }
    }
  }
}

// Run event-driven system
Titan.create()
  .service(OrderProcessor)
  .events({
    broker: 'kafka',
    topics: ['orders', 'inventory', 'payments']
  })
  .run();
```

---

## File Processing Pipeline

```typescript
// Stream processing pipeline for large files
@Service()
export class FileProcessor {
  @Method({
    input: z.object({
      file: z.string(),
      format: z.enum(['csv', 'json', 'xml'])
    }),
    stream: true // Enable streaming
  })
  async *processFile({ file, format }) {
    const stream = fs.createReadStream(file);
    const parser = this.getParser(format);
    
    let count = 0;
    for await (const record of parser(stream)) {
      // Validate record
      const validated = RecordSchema.parse(record);
      
      // Transform record
      const transformed = await this.transform(validated);
      
      // Yield processed record
      yield transformed;
      
      count++;
      if (count % 1000 === 0) {
        console.log(`Processed ${count} records`);
      }
    }
  }
  
  @Method({
    input: z.object({
      source: z.string(),
      destination: z.string(),
      batchSize: z.number().default(100)
    })
  })
  async migrateLargeDataset({ source, destination, batchSize }) {
    const processor = this.processFile({ file: source, format: 'csv' });
    
    let batch = [];
    for await (const record of processor) {
      batch.push(record);
      
      if (batch.length >= batchSize) {
        await this.db.insert(destination, batch);
        batch = [];
      }
    }
    
    // Insert remaining records
    if (batch.length > 0) {
      await this.db.insert(destination, batch);
    }
  }
}

// Use as CLI tool
Titan.create()
  .service(FileProcessor)
  .cli()
  .run();

// $ process-file input.csv --format csv
// $ migrate-large-dataset source.csv destinations --batch-size 1000
```

---

## Multi-Tenant SaaS Platform

```typescript
// Multi-tenant SaaS with automatic tenant isolation
@Service()
@MultiTenant() // Automatic tenant isolation
export class SaaSService {
  @Method({
    input: CreateProjectSchema,
    output: ProjectSchema,
    tenantScoped: true // Automatically scoped to current tenant
  })
  async createProject(data) {
    const ctx = Context.current();
    
    // Tenant is automatically available
    const project = await this.db.projects.create({
      ...data,
      tenantId: ctx.tenant.id, // Automatically injected
      ownerId: ctx.user.id
    });
    
    // Check tenant limits
    const usage = await this.usage.get(ctx.tenant.id);
    if (usage.projects >= ctx.tenant.plan.maxProjects) {
      throw new Error('Project limit reached. Please upgrade your plan.');
    }
    
    return project;
  }
  
  @Method({
    output: z.array(ProjectSchema),
    tenantScoped: true,
    cache: { 
      ttl: 60,
      key: (ctx) => `projects:${ctx.tenant.id}` // Tenant-specific cache
    }
  })
  async listProjects() {
    const ctx = Context.current();
    // Query automatically filtered by tenant
    return this.db.projects.find({ tenantId: ctx.tenant.id });
  }
  
  @Method({
    input: z.object({
      plan: z.enum(['starter', 'pro', 'enterprise'])
    }),
    adminOnly: true // Only tenant admins can upgrade
  })
  async upgradePlan({ plan }) {
    const ctx = Context.current();
    
    await this.billing.changePlan({
      tenantId: ctx.tenant.id,
      plan,
      effectiveDate: new Date()
    });
    
    // Update tenant limits
    ctx.tenant.plan = plans[plan];
    
    return { success: true, newPlan: plan };
  }
}

// Multi-tenant application
const app = Titan.create()
  .service(SaaSService)
  .use(MultiTenantModule.configure({
    strategy: 'subdomain', // or 'header', 'path'
    isolation: 'database', // or 'schema', 'row'
    plans: {
      starter: { maxProjects: 3, maxUsers: 5 },
      pro: { maxProjects: 20, maxUsers: 50 },
      enterprise: { maxProjects: -1, maxUsers: -1 }
    }
  }))
  .http()
  .listen(3000);

// Automatically handles:
// - Tenant identification from subdomain
// - Database isolation per tenant
// - Plan-based feature limits
// - Tenant-specific caching
// - Usage tracking and billing
```

---

## IoT Device Management

```typescript
// IoT platform with device management
@Service()
export class IoTService {
  private devices = new Map();
  private telemetry = new TimeSeries();
  
  @Method({
    input: RegisterDeviceSchema,
    output: DeviceSchema,
    transport: 'mqtt' // Support MQTT protocol
  })
  async registerDevice(data) {
    const device = {
      id: crypto.randomUUID(),
      ...data,
      status: 'online',
      registeredAt: new Date()
    };
    
    this.devices.set(device.id, device);
    
    // Create device twin
    await this.twins.create(device.id, {
      reported: {},
      desired: device.config
    });
    
    return device;
  }
  
  @Method({
    input: z.object({
      deviceId: z.string(),
      data: z.record(z.number())
    }),
    transport: 'mqtt',
    rateLimit: { points: 100, duration: 60 } // Rate limit per device
  })
  async sendTelemetry({ deviceId, data }) {
    // Validate device
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('Unknown device');
    
    // Store telemetry
    await this.telemetry.insert({
      deviceId,
      timestamp: Date.now(),
      ...data
    });
    
    // Check for alerts
    for (const [metric, value] of Object.entries(data)) {
      const threshold = device.alerts?.[metric];
      if (threshold && value > threshold) {
        await this.alerts.trigger({
          deviceId,
          metric,
          value,
          threshold
        });
      }
    }
  }
  
  @Method({
    input: z.object({
      deviceId: z.string(),
      command: z.string(),
      params: z.any()
    }),
    output: z.object({ success: z.boolean() })
  })
  async sendCommand({ deviceId, command, params }) {
    const device = this.devices.get(deviceId);
    
    // Send command via MQTT
    await this.mqtt.publish(`devices/${deviceId}/commands`, {
      command,
      params,
      timestamp: Date.now()
    });
    
    // Wait for acknowledgment
    const ack = await this.mqtt.waitFor(`devices/${deviceId}/ack`, 5000);
    
    return { success: ack.status === 'ok' };
  }
  
  @Method({
    input: z.object({
      deviceId: z.string(),
      metric: z.string(),
      start: z.date(),
      end: z.date(),
      aggregation: z.enum(['avg', 'min', 'max', 'sum'])
    }),
    output: z.array(z.object({
      timestamp: z.date(),
      value: z.number()
    }))
  })
  async queryTelemetry({ deviceId, metric, start, end, aggregation }) {
    return this.telemetry.query({
      deviceId,
      metric,
      timeRange: { start, end },
      aggregation,
      interval: '1h'
    });
  }
}

// IoT platform
Titan.create()
  .service(IoTService)
  .mqtt({ broker: 'mqtt://localhost:1883' })
  .http() // Also expose via HTTP for dashboard
  .websocket() // Real-time updates
  .listen(3000);
```

---

## Blockchain Integration

```typescript
// Blockchain integration service
@Service()
export class BlockchainService {
  constructor(
    private web3: Web3Provider,
    private contracts: ContractRegistry
  ) {}
  
  @Method({
    input: z.object({
      to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      amount: z.number().positive(),
      token: z.enum(['ETH', 'USDC', 'USDT'])
    }),
    output: z.object({
      txHash: z.string(),
      status: z.enum(['pending', 'confirmed', 'failed'])
    })
  })
  async transfer({ to, amount, token }) {
    const ctx = Context.current();
    
    // Get user's wallet
    const wallet = await this.wallets.get(ctx.user.id);
    
    // Build transaction
    const tx = await this.buildTransaction({
      from: wallet.address,
      to,
      value: amount,
      token
    });
    
    // Sign and send
    const signed = await wallet.signTransaction(tx);
    const receipt = await this.web3.sendTransaction(signed);
    
    // Track transaction
    await this.transactions.create({
      userId: ctx.user.id,
      txHash: receipt.hash,
      status: 'pending',
      amount,
      token
    });
    
    // Monitor confirmation
    this.monitorTransaction(receipt.hash);
    
    return {
      txHash: receipt.hash,
      status: 'pending'
    };
  }
  
  @Method({
    input: z.object({
      contract: z.string(),
      method: z.string(),
      params: z.array(z.any())
    })
  })
  async callContract({ contract, method, params }) {
    const instance = this.contracts.get(contract);
    return instance.methods[method](...params).call();
  }
  
  @EventHandler('blockchain.event')
  async onBlockchainEvent(event) {
    // Handle blockchain events
    switch (event.type) {
      case 'Transfer':
        await this.handleTransfer(event);
        break;
      case 'Approval':
        await this.handleApproval(event);
        break;
    }
  }
}

// Blockchain-enabled app
Titan.create()
  .service(BlockchainService)
  .use(Web3Module.configure({
    provider: 'https://mainnet.infura.io/v3/YOUR_KEY',
    contracts: [
      { name: 'Token', address: '0x...', abi: TokenABI }
    ]
  }))
  .http()
  .listen(3000);
```

---

## Summary: Why Titan Wins

Looking at these examples, the advantages of Titan over NestJS are clear:

1. **90% Less Code**: Achieve the same functionality with a fraction of the code
2. **Single Source of Truth**: Zod schemas provide validation, types, and documentation
3. **Transport Agnostic**: Same service works with HTTP, GraphQL, WebSocket, CLI, etc.
4. **Built-in Features**: CLS, validation, caching, rate limiting all built-in
5. **Better Developer Experience**: Intuitive APIs, automatic documentation, zero-config testing
6. **Performance**: Lightweight core, no unnecessary abstractions
7. **Type Safety**: Complete type inference from schemas to responses

Titan isn't just an improvement over NestJS - it's a complete reimagining of what a modern application framework should be.