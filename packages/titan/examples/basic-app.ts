/**
 * Basic Titan Application Example
 * 
 * This example demonstrates a minimal Titan application with:
 * - Configuration management
 * - Logging
 * - Custom module
 * - Lifecycle hooks
 * - Graceful shutdown
 */

import {
  Module,
  createApp,
  createToken,
  defineModule,
  HealthStatus,
  CONFIG_SERVICE_TOKEN,
  LOGGER_SERVICE_TOKEN
} from '../src/index.js';

/**
 * Custom service interface for additional module methods
 */
interface GreeterService {
  greet(name: string): string;
}

/**
 * Complete module interface combining Module and custom service
 */
interface GreeterModuleInterface extends Module, GreeterService { }

/**
 * Custom service module with strongly typed service methods
 */
const GreeterModule = defineModule<GreeterService>({
  name: 'greeter',
  version: '1.0.0',

  async onStart(app) {
    const logger = app.get(LOGGER_SERVICE_TOKEN).logger;
    const config = app.get(CONFIG_SERVICE_TOKEN);

    const greeting = config.get('greeter.message', 'Hello, World!');
    logger.info({ greeting }, 'Greeter module started');
  },

  async onStop(app) {
    const logger = app.get(LOGGER_SERVICE_TOKEN).logger;
    logger.info('Greeter module stopping');
  },

  async health(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      message: 'Greeter is ready to greet!'
    };
  },

  // Service methods
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
});

/**
 * Create token for the greeter module - must match the name field
 */
const GreeterModuleToken = createToken<GreeterModuleInterface>('greeter');

/**
 * Main application
 */
async function main() {
  // Create application
  const app = createApp({
    name: 'example-app',
    version: '1.0.0',
    config: {
      logger: {
        level: 'debug',
        prettyPrint: true
      },
      greeter: {
        message: 'Welcome to Titan!'
      }
    }
  });

  // Register custom module directly
  app.use(GreeterModule);

  // Add lifecycle hooks
  app.onStart(async () => {
    const logger = app.get(LOGGER_SERVICE_TOKEN).logger;
    logger.info('Running custom startup tasks...');

    // Example: Load additional configuration
    const config = app.get(CONFIG_SERVICE_TOKEN);
    config.set('app.startTime', new Date().toISOString());
  });

  app.onStop(async () => {
    const logger = app.get(LOGGER_SERVICE_TOKEN).logger;
    logger.info('Running custom cleanup tasks...');

    // Example: Save state, flush caches, etc.
  });

  // Error handling
  app.onError((error) => {
    const logger = app.get(LOGGER_SERVICE_TOKEN).logger;
    logger.error({ error }, 'Application error occurred');
  });

  // Start the application
  await app.start();

  // Get services and use them
  const logger = app.get(LOGGER_SERVICE_TOKEN).logger;
  const config = app.get(CONFIG_SERVICE_TOKEN);

  // Get the greeter module using the token
  const greeter = app.get(GreeterModuleToken);

  // Log some information
  logger.info({
    environment: config.getEnvironment(),
    uptime: app.uptime,
    state: app.state,
    metrics: app.metrics
  }, 'Application status');

  // Use the greeter
  const greeting = greeter.greet('Titan User');
  logger.info({ greeting }, 'Greeting generated');

  // Check health
  if (greeter.health) {
    const health = await greeter.health();
    logger.info({ health }, 'Module health check');
  }

  // Simulate running for a while
  logger.info('Application will run for 5 seconds...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Graceful shutdown
  logger.info('Initiating graceful shutdown...');
  await app.stop();

  // Don't use logger after app.stop() as it's already stopped
  console.log('Application terminated successfully');
  process.exit(0);
}

// Run the application
main().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});