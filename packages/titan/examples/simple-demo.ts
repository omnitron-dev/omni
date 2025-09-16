/**
 * Simple Titan Framework Demo
 * 
 * This example demonstrates the core features of Titan in a concise way:
 * - Application creation and lifecycle
 * - Module system
 * - Service injection
 * - Event handling
 * - Configuration management
 * - Logging
 */

import { TitanApplication } from '../src/core/application';
import { ConfigModule } from '../src/modules/config/config.module';
import { LoggerModule } from '../src/modules/logger/logger.module';
import { EventsModule } from '../src/modules/events/events.module';
import { Container, Injectable, Inject, createToken } from '@omnitron-dev/nexus';

// Service tokens
const GreetingServiceToken = createToken<GreetingService>('GreetingService');
const CounterServiceToken = createToken<CounterService>('CounterService');

// Simple greeting service
@Injectable()
class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}! Welcome to Titan Framework.`;
  }

  farewell(name: string): string {
    return `Goodbye, ${name}! See you soon.`;
  }
}

// Counter service with state
@Injectable()
class CounterService {
  private count = 0;

  increment(): number {
    return ++this.count;
  }

  decrement(): number {
    return --this.count;
  }

  getValue(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }
}

// Calculator service that uses other services
@Injectable()
class CalculatorService {
  constructor(
    @Inject(CounterServiceToken) private counter: CounterService
  ) {}

  add(a: number, b: number): number {
    // Also increment counter to track operations
    this.counter.increment();
    return a + b;
  }

  subtract(a: number, b: number): number {
    this.counter.increment();
    return a - b;
  }

  multiply(a: number, b: number): number {
    this.counter.increment();
    return a * b;
  }

  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    this.counter.increment();
    return a / b;
  }

  getOperationCount(): number {
    return this.counter.getValue();
  }
}

async function runDemo() {
  console.log('=== Titan Framework Simple Demo ===\n');

  // Create application
  const app = TitanApplication.create({
    name: 'SimpleDemo',
    version: '1.0.0',
    environment: 'development'
  });

  // Configure modules
  app.module(ConfigModule.forRoot({
    app: {
      name: 'SimpleDemo',
      port: 3000,
      debug: true
    },
    features: {
      greetings: true,
      calculations: true
    }
  }));

  app.module(LoggerModule.forRoot({
    level: 'debug',
    pretty: true
  }));

  app.module(EventsModule.forRoot({
    wildcard: true,
    maxListeners: 100
  }));

  // Register services
  app.service(GreetingServiceToken, GreetingService);
  app.service(CounterServiceToken, CounterService);
  app.service(CalculatorService, {
    useClass: CalculatorService,
    inject: [CounterServiceToken]
  });

  // Start application
  await app.start();

  console.log('✅ Application started successfully\n');

  // Get services from container
  const container = app.getContainer();
  const greeting = container.resolve(GreetingServiceToken);
  const calculator = container.resolve(CalculatorService);
  const logger = app.getLogger();
  const events = app.getEvents();
  const config = app.getConfig();

  // Demo: Configuration
  console.log('📋 Configuration:');
  console.log('  App name:', config.get('app.name'));
  console.log('  Port:', config.get('app.port'));
  console.log('  Debug mode:', config.get('app.debug'));
  console.log('  Features:', config.get('features'));
  console.log();

  // Demo: Greeting service
  console.log('👋 Greeting Service:');
  console.log('  ', greeting.greet('Developer'));
  console.log('  ', greeting.farewell('Developer'));
  console.log();

  // Demo: Calculator service
  console.log('🧮 Calculator Service:');
  console.log('  2 + 3 =', calculator.add(2, 3));
  console.log('  10 - 4 =', calculator.subtract(10, 4));
  console.log('  5 * 6 =', calculator.multiply(5, 6));
  console.log('  20 / 4 =', calculator.divide(20, 4));
  console.log('  Operations performed:', calculator.getOperationCount());
  console.log();

  // Demo: Event system
  console.log('📡 Event System:');
  
  // Subscribe to events
  const subscription = events.subscribe('demo.event', (data: any) => {
    console.log('  Event received:', data);
  });

  // Subscribe with filter
  events.subscribe('calc.*', 
    (data: any) => {
      console.log('  Calculation event:', data);
    },
    {
      filter: (data) => data.result > 10
    }
  );

  // Emit events
  await events.emit('demo.event', { message: 'Hello from event system!' });
  await events.emit('calc.add', { a: 5, b: 3, result: 8 });
  await events.emit('calc.multiply', { a: 5, b: 3, result: 15 }); // This will be logged
  console.log();

  // Demo: Async event handling
  console.log('⚡ Async Event Handling:');
  
  const results = await events.emitAsync('process.data', { 
    items: [1, 2, 3, 4, 5] 
  });
  console.log('  Async results:', results);
  
  // Demo: Event scheduling
  console.log('\n⏰ Scheduled Events:');
  const jobId = events.scheduleEvent('reminder', 
    { message: 'This is a scheduled event' }, 
    1000
  );
  console.log('  Event scheduled with ID:', jobId);
  
  // Wait for scheduled event
  await new Promise(resolve => setTimeout(resolve, 1100));
  
  // Demo: Logging
  console.log('\n📝 Logging:');
  logger.debug({ module: 'demo' }, 'Debug message');
  logger.info({ user: 'developer' }, 'Info message');
  logger.warn({ threshold: 100 }, 'Warning message');
  
  // Demo: Statistics
  console.log('\n📊 Event Statistics:');
  const stats = events.getStatistics();
  console.log('  Events emitted:', stats);
  
  // Demo: Application info
  console.log('\n📦 Application Info:');
  const appInfo = app.getInfo();
  console.log('  Name:', appInfo.name);
  console.log('  Version:', appInfo.version);
  console.log('  Environment:', appInfo.environment);
  console.log('  Uptime:', appInfo.uptime, 'ms');
  console.log('  Modules loaded:', appInfo.modules);
  
  // Clean up
  subscription.unsubscribe();
  
  // Stop application
  console.log('\n🛑 Stopping application...');
  await app.stop();
  console.log('✅ Application stopped successfully');
  
  console.log('\n=== Demo Complete ===');
}

// Run the demo
if (require.main === module) {
  runDemo().catch(error => {
    console.error('Demo failed:', error);
    process.exit(1);
  });
}

export { runDemo };