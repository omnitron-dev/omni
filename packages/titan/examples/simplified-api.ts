/**
 * Simplified API Example
 * 
 * This example demonstrates the extremely user-friendly API of Titan.
 * You can create a fully functional application with just a few lines of code.
 */

import {
  createApp,
  defineModule,
  createAndStartApp,
  LoggerModuleToken,
  ConfigModuleToken,
  createToken,
  type HealthStatus
} from '../src';

/**
 * Example 1: The absolute simplest application
 * Just one line to create and start an app!
 */
async function simplestApp() {
  console.log('=== Example 1: Simplest App ===\n');
  
  const app = await createAndStartApp({
    name: 'simplest-app',
    version: '1.0.0'
  });

  const logger = app.get(LoggerModuleToken).logger;
  logger.info('This is the simplest possible Titan app!');
  
  await app.stop();
}

/**
 * Example 2: Simple module with inline definition
 * No need for complex setup - just define what you need
 */
async function simpleModuleApp() {
  console.log('\n=== Example 2: Simple Module App ===\n');

  // Define a module in the most straightforward way
  const HelloModule = defineModule({
    name: 'hello',
    
    // Simple lifecycle - just functions
    async onStart(app) {
      console.log('Hello module starting!');
    },
    
    async onStop(app) {
      console.log('Hello module stopping!');
    },
    
    // Add any methods you want - they become part of the module
    sayHello(name: string) {
      return `Hello, ${name}!`;
    },
    
    sayGoodbye(name: string) {
      return `Goodbye, ${name}!`;
    }
  });

  // Create app and use the module
  const app = await createAndStartApp({
    name: 'hello-app',
    modules: [HelloModule]
  });

  // Use the module - it just works!
  const helloToken = createToken<typeof HelloModule>('hello');
  const hello = app.get(helloToken);
  console.log(hello.sayHello('Titan'));
  console.log(hello.sayGoodbye('World'));

  await app.stop();
}

/**
 * Example 3: Fluent API for configuration
 * Chain everything together for a clean, readable setup
 */
async function fluentApiApp() {
  console.log('\n=== Example 3: Fluent API App ===\n');

  const app = createApp()
    .configure({
      name: 'fluent-app',
      version: '2.0.0',
      debug: true,
      custom: {
        message: 'Configured via fluent API'
      }
    })
    .use(defineModule({
      name: 'printer',
      print(text: string) {
        console.log(`[PRINTER] ${text}`);
      }
    }))
    .use(defineModule({
      name: 'calculator',
      add(a: number, b: number) {
        return a + b;
      },
      multiply(a: number, b: number) {
        return a * b;
      }
    }));

  // Add hooks fluently
  app
    .onStart(async () => {
      console.log('App is starting...');
    })
    .onStop(async () => {
      console.log('App is stopping...');
    })
    .onError((error) => {
      console.error('App error:', error);
    });

  await app.start();

  // Use the modules
  const printerToken = createToken<any>('printer');
  const calculatorToken = createToken<any>('calculator');
  const printer = app.get(printerToken);
  const calculator = app.get(calculatorToken);
  
  printer.print('Testing the printer module');
  printer.print(`2 + 3 = ${calculator.add(2, 3)}`);
  printer.print(`4 × 5 = ${calculator.multiply(4, 5)}`);

  await app.stop();
}

/**
 * Example 4: Replace core modules with one-liners
 * Maximum flexibility with minimum code
 */
async function replaceModulesApp() {
  console.log('\n=== Example 4: Replace Core Modules ===\n');

  const app = createApp({
    name: 'custom-core-app'
  });

  // Replace logger with a simple console logger in one line
  app.replaceModule(LoggerModuleToken, defineModule({
    name: 'simple-logger',
    logger: {
      trace: console.log,
      debug: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      fatal: console.error,
      child: function() { return this; }
    }
  }));

  // Replace config with a simple object
  app.replaceModule(ConfigModuleToken, defineModule({
    name: 'simple-config',
    _data: { app: { name: 'replaced' } },
    // Add loadObject method expected by Application
    loadObject(obj: any) {
      Object.assign(this._data, obj);
    },
    get(path?: string, defaultValue?: any) {
      return path ? this._data[path] || defaultValue : this._data;
    },
    set(path: string, value: any) {
      this._data[path] = value;
    },
    has(path: string) {
      return path in this._data;
    },
    delete(path: string) {
      delete this._data[path];
    },
    getEnvironment() {
      return 'custom';
    },
    isProduction() {
      return false;
    },
    isDevelopment() {
      return true;
    },
    isTest() {
      return false;
    }
  }));

  await app.start();

  const logger = app.get(LoggerModuleToken).logger;
  const config = app.get(ConfigModuleToken);
  
  logger.info('Using replaced logger!');
  console.log('Config environment:', config.getEnvironment());

  await app.stop();
}

/**
 * Example 5: Service-oriented modules
 * Define modules as services with TypeScript interfaces
 */
async function serviceOrientedApp() {
  console.log('\n=== Example 5: Service-Oriented App ===\n');

  // Define service interfaces
  interface UserService {
    getUser(id: string): { id: string; name: string };
    createUser(name: string): { id: string; name: string };
  }

  interface EmailService {
    sendEmail(to: string, subject: string, body: string): void;
  }

  // Create service modules with type safety
  const UserModule = defineModule<UserService>({
    name: 'users',
    _users: new Map([
      ['1', { id: '1', name: 'Alice' }],
      ['2', { id: '2', name: 'Bob' }]
    ]),
    
    getUser(id: string) {
      return this._users.get(id) || { id: '0', name: 'Unknown' };
    },
    
    createUser(name: string) {
      const id = String(this._users.size + 1);
      const user = { id, name };
      this._users.set(id, user);
      return user;
    }
  });

  const EmailModule = defineModule<EmailService>({
    name: 'email',
    _sent: [] as any[],
    
    sendEmail(to: string, subject: string, body: string) {
      const email = { to, subject, body, timestamp: new Date() };
      this._sent.push(email);
      console.log(`📧 Email sent to ${to}: "${subject}"`);
    }
  });

  // Create app with services
  const app = await createAndStartApp({
    name: 'service-app',
    modules: [UserModule, EmailModule]
  });

  // Use services with full type safety
  const usersToken = createToken<typeof UserModule>('users');
  const emailToken = createToken<typeof EmailModule>('email');
  const users = app.get(usersToken);
  const email = app.get(emailToken);

  // Use the services
  const user = users.getUser('1');
  console.log('Found user:', user);

  const newUser = users.createUser('Charlie');
  console.log('Created user:', newUser);

  email.sendEmail(
    'charlie@example.com',
    'Welcome!',
    `Hello ${newUser.name}, welcome to our app!`
  );

  await app.stop();
}

/**
 * Example 6: Async modules with resources
 * Handle async initialization and cleanup elegantly
 */
async function asyncModulesApp() {
  console.log('\n=== Example 6: Async Modules App ===\n');

  // Simulate a database connection
  class FakeDatabase {
    connected = false;
    
    async connect() {
      await new Promise(resolve => setTimeout(resolve, 100));
      this.connected = true;
      console.log('📊 Database connected');
    }
    
    async disconnect() {
      await new Promise(resolve => setTimeout(resolve, 50));
      this.connected = false;
      console.log('📊 Database disconnected');
    }
    
    async query(sql: string) {
      if (!this.connected) throw new Error('Not connected');
      return { rows: [], sql };
    }
  }

  const DatabaseModule = defineModule({
    name: 'database',
    _db: null as FakeDatabase | null,
    
    async onStart() {
      this._db = new FakeDatabase();
      await this._db.connect();
    },
    
    async onStop() {
      if (this._db) {
        await this._db.disconnect();
      }
    },
    
    async health(): Promise<HealthStatus> {
      return {
        status: this._db?.connected ? 'healthy' : 'unhealthy',
        message: this._db?.connected ? 'Database is connected' : 'Database is not connected'
      };
    },
    
    async query(sql: string) {
      if (!this._db) throw new Error('Database not initialized');
      return this._db.query(sql);
    }
  });

  const app = createApp({ name: 'async-app' });
  app.use(DatabaseModule);

  // Start will wait for async initialization
  await app.start();

  const dbToken = createToken<typeof DatabaseModule>('database');
  const db = app.get(dbToken);
  
  // Check health
  const health = await db.health?.();
  console.log('Database health:', health);
  
  // Use the database
  await db.query('SELECT * FROM users');
  console.log('Query executed successfully');

  // Stop will wait for async cleanup
  await app.stop();
}

/**
 * Main function to run all examples
 */
async function main() {
  console.log('🚀 Titan Simplified API Examples\n');
  console.log('This demonstrates how user-friendly Titan API is.\n');
  console.log('=' .repeat(50));

  try {
    await simplestApp();
    await simpleModuleApp();
    await fluentApiApp();
    await replaceModulesApp();
    await serviceOrientedApp();
    await asyncModulesApp();
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ All examples completed successfully!');
  } catch (error) {
    console.error('❌ Error running examples:', error);
    process.exit(1);
  }
}

// Removed helper function - using imported createToken from titan

// Run all examples
main();