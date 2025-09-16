/**
 * Custom Core Modules Example - Demonstrates how to replace core modules
 */

import {
  TitanApplication,
  ApplicationModule,
  ConfigModule,
  LoggerModule,
  ConfigModuleToken,
  LoggerModuleToken,
  createConfigModule,
  createLoggerModule,
  type IApplication
} from '../src/index';

/**
 * Custom Config Module - extends the default ConfigModule
 */
class CustomConfigModule extends ConfigModule {
  override readonly name = 'custom-config';
  override readonly version = '2.0.0';

  override async onStart(app: IApplication): Promise<void> {
    console.log('[CustomConfig] Starting custom config module');
    await super.onStart(app);

    // Add custom initialization
    this.set('custom.initialized', true);
    this.set('custom.timestamp', new Date().toISOString());
  }

  // Custom method
  getWithPrefix(prefix: string, path: string): any {
    return this.get(`${prefix}.${path}`);
  }
}

/**
 * Custom Logger Module - adds file transport
 */
class CustomLoggerModule extends LoggerModule {
  override readonly name = 'custom-logger';

  override async onStart(app: IApplication): Promise<void> {
    console.log('[CustomLogger] Starting custom logger module');
    await super.onStart(app);

    // Add custom file transport (in real app)
    this.logger.info('Custom logger initialized with file transport');
  }

  // Custom method
  logToFile(message: string): void {
    // In real app, write to file
    console.log(`[FILE] ${message}`);
  }
}

async function exampleWithFactories() {
  console.log('=== Example 1: Using Factory Functions ===\n');

  // Factory functions create and configure modules
  const app = await TitanApplication.create({
    name: 'AppWithFactories',
    version: '1.0.0',
    config: {
      app: { environment: 'production' },
      logging: { level: 'info', prettyPrint: false }
    },
    // Replace core modules using factory functions
    replaceConfig: (config) => {
      const module = new CustomConfigModule();
      if (config) {
        module.merge(config);
      }
      return module;
    },
    replaceLogger: (config) => {
      const module = new CustomLoggerModule();
      if (config) {
        module.configure(config);
      }
      return module;
    }
  });

  await app.start();

  // Use custom modules
  const configModule = app.get(ConfigModuleToken) as CustomConfigModule;
  console.log('Custom config initialized:', configModule.get('custom.initialized'));
  console.log('App environment:', configModule.getWithPrefix('app', 'environment'));

  const loggerModule = app.get(LoggerModuleToken) as CustomLoggerModule;
  loggerModule.logToFile('Application started successfully');

  await app.stop();
}

async function exampleWithDirectInstances() {
  console.log('\n=== Example 2: Using Direct Module Instances ===\n');

  // Create and configure custom modules manually
  const customConfig = createConfigModule({
    sources: [
      { type: 'object', data: { app: { name: 'DirectApp' } } }
    ]
  });

  const customLogger = createLoggerModule({
    level: 'debug',
    prettyPrint: true,
    context: { service: 'DirectApp' }
  });

  const app = await TitanApplication.create({
    name: 'AppWithDirectInstances',
    version: '1.0.0',
    // Pass modules array - they will replace core modules by name
    modules: [customConfig, customLogger]
  });

  await app.start();

  const configModule = app.get(ConfigModuleToken);
  console.log('App name from config:', configModule.get('app.name'));

  await app.stop();
}

async function exampleWithAutomaticInit() {
  console.log('\n=== Example 3: Automatic Core Module Initialization ===\n');

  // Core modules are automatically created when config is provided
  const app = await TitanApplication.create({
    name: 'AutoApp',
    version: '1.0.0',
    // These trigger automatic core module initialization
    config: {
      database: {
        url: 'postgres://localhost/mydb'
      }
    },
    logging: {
      level: 'warn',
      prettyPrint: false
    }
  });

  await app.start();

  // Core modules were auto-initialized
  const configModule = app.get(ConfigModuleToken);
  const loggerModule = app.get(LoggerModuleToken);

  console.log('Database URL:', configModule.get('database.url'));
  loggerModule.logger.warn('This is a warning message');

  await app.stop();
}

async function exampleWithNoAutoInit() {
  console.log('\n=== Example 4: No Automatic Initialization ===\n');

  // No config provided, so no automatic core modules
  const app = await TitanApplication.create({
    name: 'MinimalApp',
    version: '1.0.0'
    // No config or logging - core modules won't be auto-initialized
  });

  await app.start();

  // Check if modules exist
  console.log('Has ConfigModule:', app.has(ConfigModuleToken));
  console.log('Has LoggerModule:', app.has(LoggerModuleToken));

  await app.stop();
}

async function main() {
  try {
    await exampleWithFactories();
    await exampleWithDirectInstances();
    await exampleWithAutomaticInit();
    await exampleWithNoAutoInit();

    console.log('\n=== All Examples Completed Successfully ===');
  } catch (error) {
    console.error('Error in examples:', error);
    process.exit(1);
  }
}

// Run examples
if (require.main === module) {
  main();
}

export { main };