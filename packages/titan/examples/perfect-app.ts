/**
 * Perfect Titan Application
 *
 * This demonstrates the ultimate simplicity and power of Titan Framework.
 * Zero boilerplate, maximum control, enterprise-ready.
 */

import { titan, service, inject, Module, Injectable } from '../src/simple.js';
import { z } from 'zod';

// ============================================
// 1. SIMPLEST POSSIBLE APP (1 line)
// ============================================

// await titan(); // That's it! Full app with config, logging, graceful shutdown

// ============================================
// 2. WITH A SERVICE (5 lines)
// ============================================

const greeter = service({
  greet: (name: string) => `Hello, ${name}!`,
});

// ============================================
// 3. WITH DEPENDENCY INJECTION (10 lines)
// ============================================

@Injectable()
class Database {
  async connect() {
    return 'Connected to DB';
  }
}

@Injectable()
class UserService {
  constructor(private db: Database) {}

  async getUser(id: string) {
    await this.db.connect();
    return { id, name: 'John Doe' };
  }
}

// ============================================
// 4. FULL FEATURED APP (20 lines)
// ============================================

// Configuration schema with validation
const Config = z.object({
  port: z.number().default(3000),
  redis: z.string().default('localhost:6379'),
  database: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(5432),
  }),
});

// Main application module
@Module({
  providers: [Database, UserService],
})
class AppModule {
  constructor(
    private users: UserService,
    private config = inject<z.infer<typeof Config>>('Config')
  ) {}

  async onStart() {
    console.log(`Starting on port ${this.config.port}`);
    const user = await this.users.getUser('1');
    console.log('User:', user);
  }

  async onStop() {
    console.log('Gracefully shutting down...');
  }
}

// ============================================
// 5. MICROSERVICE WITH AUTO-DISCOVERY
// ============================================

@Injectable()
class OrderService {
  async createOrder(items: string[]) {
    return { id: '123', items, total: items.length * 10 };
  }
}

@Injectable()
class PaymentService {
  async charge(amount: number) {
    return { success: true, transactionId: 'tx-456' };
  }
}

@Module({
  // Auto-discovers and registers all decorated classes
  scan: true,

  // Auto-configures from environment
  config: 'auto',

  // Auto-sets up Redis, database, etc.
  features: ['redis', 'scheduler', 'events'],
})
class MicroserviceModule {
  constructor(
    private orders: OrderService,
    private payments: PaymentService
  ) {}

  async processOrder(items: string[]) {
    const order = await this.orders.createOrder(items);
    const payment = await this.payments.charge(order.total);
    return { order, payment };
  }
}

// ============================================
// RUN THE APP
// ============================================

async function main() {
  // Choose your style:

  // 1. Simplest - just start
  // await titan();

  // 2. With module
  // await titan(AppModule);

  // 3. With options
  // await titan({
  //   port: 4000,
  //   redis: 'redis://localhost:6379'
  // });

  // 4. Full control
  const app = await titan({
    module: AppModule,
    config: Config,
    environment: process.env['NODE_ENV'] || 'development',

    // Everything is optional with smart defaults
    features: {
      redis: true, // Auto-connects to Redis
      scheduler: true, // Enables cron jobs
      events: true, // Event bus
      metrics: true, // Prometheus metrics
      health: true, // Health checks
      tracing: true, // OpenTelemetry
    },

    // Auto-scales based on CPU cores
    workers: 'auto',

    // Smart graceful shutdown
    gracefulShutdown: {
      timeout: 30000,
      handlers: 'auto', // Handles SIGTERM, SIGINT, uncaught errors
    },
  });

  // Use the app directly
  const users = app.get(UserService);
  const user = await users.getUser('1');
  console.log('Got user:', user);

  // Or let it run as a server
  // app.listen(3000);

  // Clean shutdown after 5 seconds for demo
  setTimeout(() => app.stop(), 5000);
}

// ============================================
// BONUS: TESTING IS TRIVIAL
// ============================================

// test('user service works', async () => {
//   const app = await titan.test(AppModule);
//   const users = app.get(UserService);
//   const user = await users.getUser('1');
//   expect(user.name).toBe('John Doe');
// });

// ============================================
// MAIN FEATURES DEMONSTRATED:
// ============================================
// ✅ Zero configuration required
// ✅ Smart defaults for everything
// ✅ Type-safe configuration with Zod
// ✅ Dependency injection that just works
// ✅ Automatic service discovery
// ✅ Built-in graceful shutdown
// ✅ Production-ready logging
// ✅ Redis, scheduler, events out of the box
// ✅ Microservice ready
// ✅ Testing is trivial
// ✅ < 100 lines for a full app

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { AppModule, MicroserviceModule };
