/**
 * Titan Process Manager Usage Examples
 *
 * This file demonstrates the revolutionary capabilities of Titan PM
 * where every process becomes a Netron service with full type safety.
 */

import { Application } from '@omnitron-dev/titan';
import { ProcessManagerModule } from '@omnitron-dev/titan/module/pm';
import {
  Process,
  Public,
  RateLimit,
  Cache,
  HealthCheck,
  CircuitBreaker,
  Supervisor,
  Child,
  Workflow,
  Stage,
  InjectProcess
} from '@omnitron-dev/titan/module/pm';

// ============================================================================
// Example 1: Basic Process as Service
// ============================================================================

@Process({
  name: 'user-service',
  version: '1.0.0',
  health: { enabled: true, interval: 30000 }
})
class UserService {
  private users = new Map<string, any>();

  @Public()
  async createUser(data: { name: string; email: string }): Promise<{ id: string; name: string }> {
    const user = {
      id: Math.random().toString(36).substr(2, 9),
      ...data,
      createdAt: Date.now()
    };
    this.users.set(user.id, user);
    return user;
  }

  @Public()
  @Cache({ ttl: 60000 })
  async getUser(id: string): Promise<any | null> {
    return this.users.get(id) || null;
  }

  @Public()
  @RateLimit({ rps: 100, strategy: 'token-bucket' })
  async listUsers(): Promise<any[]> {
    return Array.from(this.users.values());
  }

  @HealthCheck()
  async checkHealth() {
    return {
      status: 'healthy' as const,
      checks: [{
        name: 'memory',
        status: 'pass' as const,
        details: { userCount: this.users.size }
      }]
    };
  }
}

// ============================================================================
// Example 2: Process Pool for CPU-Intensive Tasks
// ============================================================================

@Process({
  name: 'compute-service',
  memory: { limit: '256MB' }
})
class ComputeService {
  @Public()
  async calculatePrimes(max: number): Promise<number[]> {
    const primes: number[] = [];
    for (let n = 2; n <= max; n++) {
      let isPrime = true;
      for (let i = 2; i * i <= n; i++) {
        if (n % i === 0) {
          isPrime = false;
          break;
        }
      }
      if (isPrime) primes.push(n);
    }
    return primes;
  }

  @Public()
  async fibonacci(n: number): Promise<number> {
    if (n <= 1) return n;
    return await this.fibonacci(n - 1) + await this.fibonacci(n - 2);
  }
}

// ============================================================================
// Example 3: Microservices with Dependencies
// ============================================================================

@Process()
class PaymentService {
  @Public()
  @CircuitBreaker({ threshold: 5, timeout: 60000, fallback: 'useBackupProvider' })
  async chargeCard(payment: { amount: number; card: string }): Promise<{ transactionId: string }> {
    // Simulate payment processing
    console.log(`Processing payment of $${payment.amount}`);
    return {
      transactionId: `tx_${Date.now()}`
    };
  }

  async useBackupProvider(payment: any): Promise<{ transactionId: string }> {
    console.log('Using backup payment provider');
    return { transactionId: `backup_tx_${Date.now()}` };
  }
}

@Process()
class InventoryService {
  private inventory = new Map<string, number>([
    ['item1', 100],
    ['item2', 50]
  ]);

  @Public()
  async checkAvailability(itemId: string, quantity: number): Promise<boolean> {
    const stock = this.inventory.get(itemId) || 0;
    return stock >= quantity;
  }

  @Public()
  async reserve(itemId: string, quantity: number): Promise<boolean> {
    const stock = this.inventory.get(itemId) || 0;
    if (stock >= quantity) {
      this.inventory.set(itemId, stock - quantity);
      return true;
    }
    return false;
  }
}

@Process()
class OrderService {
  constructor(
    @InjectProcess(PaymentService) private payment: any,
    @InjectProcess(InventoryService) private inventory: any
  ) {}

  @Public()
  async createOrder(order: {
    itemId: string;
    quantity: number;
    payment: { amount: number; card: string };
  }): Promise<{ orderId: string; status: string }> {
    // Check inventory
    const available = await this.inventory.checkAvailability(order.itemId, order.quantity);
    if (!available) {
      return { orderId: '', status: 'out-of-stock' };
    }

    // Reserve items
    const reserved = await this.inventory.reserve(order.itemId, order.quantity);
    if (!reserved) {
      return { orderId: '', status: 'reservation-failed' };
    }

    // Process payment
    const payment = await this.payment.chargeCard(order.payment);

    return {
      orderId: `order_${Date.now()}`,
      status: 'completed'
    };
  }
}

// ============================================================================
// Example 4: Supervisor Tree for Fault Tolerance
// ============================================================================

@Supervisor({
  strategy: 'one-for-one',
  maxRestarts: 3,
  window: 60000
})
class ApplicationSupervisor {
  @Child({ critical: true })
  database = UserService;

  @Child({ pool: { size: 4 } })
  workers = ComputeService;

  @Child({ optional: true })
  cache = class CacheService {
    @Public()
    async get(key: string): Promise<any> {
      return null; // Simple in-memory cache
    }
  };

  async onChildCrash(child: any, error: Error): Promise<'restart' | 'ignore'> {
    console.error(`Child ${child.name} crashed:`, error);
    return 'restart';
  }
}

// ============================================================================
// Example 5: Workflow Orchestration
// ============================================================================

@Workflow()
class DataProcessingWorkflow {
  @Stage({ parallel: true })
  async extractData(): Promise<any[]> {
    console.log('Extracting data from multiple sources...');
    return [
      { source: 'api', data: [1, 2, 3] },
      { source: 'database', data: [4, 5, 6] }
    ];
  }

  @Stage({ dependsOn: 'extractData' })
  async transformData(data: any[]): Promise<any[]> {
    console.log('Transforming data...');
    return data.map(item => ({
      ...item,
      transformed: true,
      timestamp: Date.now()
    }));
  }

  @Stage({ dependsOn: 'transformData' })
  async loadData(data: any[]): Promise<void> {
    console.log('Loading data to destination...');
    // Save to database
  }
}

// ============================================================================
// Example 6: Streaming Data Processing
// ============================================================================

@Process()
class StreamProcessor {
  @Public()
  async *processLargeFile(filePath: string): AsyncGenerator<string> {
    // Simulate reading large file line by line
    const lines = [
      'line 1: data',
      'line 2: more data',
      'line 3: even more data'
    ];

    for (const line of lines) {
      // Process each line
      const processed = line.toUpperCase();
      yield processed;

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  @Public()
  async *generateReports(count: number): AsyncGenerator<{ id: number; report: string }> {
    for (let i = 0; i < count; i++) {
      yield {
        id: i,
        report: `Report #${i}: Generated at ${new Date().toISOString()}`
      };
    }
  }
}

// ============================================================================
// Main Application Setup
// ============================================================================

async function main() {
  // Create application with Process Manager
  const app = await Application.create({
    name: 'example-app',
    imports: [
      ProcessManagerModule.forRoot({
        netron: {
          transport: 'tcp',
          discovery: 'redis'
        },
        monitoring: {
          metrics: true,
          tracing: true
        }
      })
    ]
  });

  // Get Process Manager
  const pm = app.get(ProcessManager);

  // ============================================================================
  // Usage Examples
  // ============================================================================

  // 1. Spawn a single process as a service
  console.log('\n=== Example 1: Single Process ===');
  const userService = await pm.spawn(UserService);
  const user = await userService.createUser({ name: 'John', email: 'john@example.com' });
  console.log('Created user:', user);

  // 2. Create a process pool for load balancing
  console.log('\n=== Example 2: Process Pool ===');
  const computePool = await pm.pool(ComputeService, {
    size: 4,
    strategy: 'least-loaded'
  });

  // Parallel computation across pool
  const results = await Promise.all([
    computePool.calculatePrimes(100),
    computePool.calculatePrimes(200),
    computePool.calculatePrimes(300)
  ]);
  console.log('Prime calculations distributed across pool');

  // 3. Microservices with automatic wiring
  console.log('\n=== Example 3: Microservices ===');
  const paymentService = await pm.spawn(PaymentService);
  const inventoryService = await pm.spawn(InventoryService);
  const orderService = await pm.spawn(OrderService);

  const order = await orderService.createOrder({
    itemId: 'item1',
    quantity: 2,
    payment: { amount: 99.99, card: '4242424242424242' }
  });
  console.log('Order created:', order);

  // 4. Supervisor for fault tolerance
  console.log('\n=== Example 4: Supervisor Tree ===');
  const supervisor = await pm.supervisor(ApplicationSupervisor);
  console.log('Supervisor started with child processes');

  // 5. Workflow orchestration
  console.log('\n=== Example 5: Workflow ===');
  const workflow = await pm.workflow(DataProcessingWorkflow);
  await workflow.run();
  console.log('Workflow completed');

  // 6. Streaming data processing
  console.log('\n=== Example 6: Streaming ===');
  const streamProcessor = await pm.spawn(StreamProcessor);

  console.log('Processing stream:');
  for await (const line of streamProcessor.processLargeFile('/path/to/file')) {
    console.log('  Processed:', line);
  }

  // 7. Service discovery
  console.log('\n=== Example 7: Service Discovery ===');
  const discoveredUser = await pm.discover<UserService>('user-service');
  if (discoveredUser) {
    const users = await discoveredUser.listUsers();
    console.log('Discovered service returned users:', users);
  }

  // 8. Health monitoring
  console.log('\n=== Example 8: Health & Metrics ===');
  const health = await pm.getHealth(userService.__processId);
  console.log('Service health:', health);

  const metrics = await pm.getMetrics(userService.__processId);
  console.log('Service metrics:', metrics);

  // 9. Pool scaling
  console.log('\n=== Example 9: Dynamic Scaling ===');
  console.log('Pool size before scaling:', computePool.size);
  await computePool.scale(8);
  console.log('Pool size after scaling:', computePool.size);

  // Pool metrics
  console.log('Pool metrics:', computePool.metrics);

  // ============================================================================
  // Cleanup
  // ============================================================================

  // Graceful shutdown
  console.log('\n=== Shutting down ===');
  await pm.shutdown();
  await app.stop();
}

// Run the example
if (import.meta.main) {
  main().catch(console.error);
}

export { main };