/**
 * Custom Core Modules Example
 * 
 * This example demonstrates how to replace Titan's core modules with custom implementations.
 * This showcases the ultimate flexibility of Titan - every single piece can be replaced
 * thanks to the power of Nexus DI container.
 */

import {
  createApp,
  defineModule,
  Application,
  ConfigModuleToken,
  LoggerModuleToken,
  createToken,
  type IConfigModule,
  type ILoggerModule,
  type Logger,
  type LogLevel,
  type HealthStatus
} from '../src';

/**
 * Custom Logger Implementation
 * 
 * Replace the default Pino logger with a custom implementation
 * that outputs structured logs as JSON to console
 */
class CustomLogger implements Logger {
  private context: Record<string, any> = {};

  trace(obj: any, msg?: string): void {
    this.log('trace', obj, msg);
  }

  debug(obj: any, msg?: string): void {
    this.log('debug', obj, msg);
  }

  info(obj: any, msg?: string): void {
    this.log('info', obj, msg);
  }

  warn(obj: any, msg?: string): void {
    this.log('warn', obj, msg);
  }

  error(obj: any, msg?: string): void {
    this.log('error', obj, msg);
  }

  fatal(obj: any, msg?: string): void {
    this.log('fatal', obj, msg);
  }

  child(bindings: Record<string, any>): Logger {
    const childLogger = new CustomLogger();
    childLogger.context = { ...this.context, ...bindings };
    return childLogger;
  }

  private log(level: string, obj: any, msg?: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      ...this.context,
      ...(typeof obj === 'object' ? obj : { data: obj }),
      ...(msg ? { message: msg } : {})
    };

    // Use different console methods based on level
    switch (level) {
      case 'error':
      case 'fatal':
        console.error(JSON.stringify(logEntry));
        break;
      case 'warn':
        console.warn(JSON.stringify(logEntry));
        break;
      default:
        console.log(JSON.stringify(logEntry));
    }
  }
}

/**
 * Custom Logger Module
 * 
 * A complete replacement for the default LoggerModule
 */
const CustomLoggerModule = defineModule<ILoggerModule>({
  name: 'custom-logger',
  version: '1.0.0',

  logger: new CustomLogger(),

  async onStart(app) {
    // Initialize custom logger with app metadata
    this.logger = this.logger.child({
      app: app.config('name'),
      version: app.config('version'),
      pid: process.pid
    });

    this.logger.info({ event: 'logger:started' }, 'Custom logger initialized');
  },

  async onStop() {
    this.logger.info({ event: 'logger:stopping' }, 'Custom logger shutting down');
  },

  async health(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      message: 'Custom logger is operational'
    };
  }
});

/**
 * Custom Configuration Module
 * 
 * Replace the default config module with a simpler implementation
 * that uses environment variables and a plain JavaScript object
 */
const CustomConfigModule = defineModule<IConfigModule>({
  name: 'custom-config',
  version: '1.0.0',

  _config: {} as Record<string, any>,
  _env: process.env.NODE_ENV || 'development',

  // Add loadObject method that's expected by Application
  loadObject(obj: Record<string, any>): void {
    this._config = { ...this._config, ...obj };
  },

  async onStart(app) {
    // Load configuration from environment variables
    this._config = {
      app: {
        name: process.env.APP_NAME || 'custom-app',
        version: process.env.APP_VERSION || '1.0.0',
        port: parseInt(process.env.PORT || '3000', 10)
      },
      database: {
        url: process.env.DATABASE_URL || 'postgresql://localhost/myapp'
      },
      redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      },
      features: {
        enableMetrics: process.env.ENABLE_METRICS === 'true',
        enableTracing: process.env.ENABLE_TRACING === 'true'
      }
    };

    // Log loaded configuration (excluding sensitive data)
    const logger = app.get(LoggerModuleToken).logger;
    logger.info({
      config: {
        app: this._config.app,
        features: this._config.features,
        environment: this._env
      }
    }, 'Configuration loaded');
  },

  get<T = any>(path?: string, defaultValue?: T): T {
    if (!path) {
      return this._config as T;
    }

    const keys = path.split('.');
    let value: any = this._config;

    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) {
        return defaultValue as T;
      }
    }

    return value as T;
  },

  set(path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let target = this._config;

    for (const key of keys) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }

    target[lastKey] = value;
  },

  has(path: string): boolean {
    const keys = path.split('.');
    let value: any = this._config;

    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) {
        return false;
      }
    }

    return true;
  },

  delete(path: string): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let target = this._config;

    for (const key of keys) {
      target = target?.[key];
      if (!target) return;
    }

    delete target[lastKey];
  },

  getEnvironment(): string {
    return this._env;
  },

  isProduction(): boolean {
    return this._env === 'production';
  },

  isDevelopment(): boolean {
    return this._env === 'development';
  },

  isTest(): boolean {
    return this._env === 'test';
  },

  async health(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      message: 'Configuration module is operational',
      details: {
        environment: this._env,
        configKeys: Object.keys(this._config).length
      }
    };
  }
});

/**
 * Custom Metrics Module
 * 
 * An entirely new module that doesn't exist in core Titan
 * This demonstrates that you can add any custom functionality
 */
interface MetricsService {
  increment(metric: string, value?: number): void;
  gauge(metric: string, value: number): void;
  histogram(metric: string, value: number): void;
  getMetrics(): Record<string, any>;
}

const MetricsModule = defineModule<MetricsService>({
  name: 'metrics',
  version: '1.0.0',

  _counters: new Map<string, number>(),
  _gauges: new Map<string, number>(),
  _histograms: new Map<string, number[]>(),

  async onStart(app) {
    const logger = app.get(LoggerModuleToken).logger;
    logger.info({ module: 'metrics' }, 'Metrics collection started');

    // Start collecting system metrics
    setInterval(() => {
      const usage = process.memoryUsage();
      this.gauge('system.memory.heapUsed', usage.heapUsed);
      this.gauge('system.memory.heapTotal', usage.heapTotal);
      this.gauge('system.memory.rss', usage.rss);
    }, 10000);
  },

  increment(metric: string, value: number = 1): void {
    const current = this._counters.get(metric) || 0;
    this._counters.set(metric, current + value);
  },

  gauge(metric: string, value: number): void {
    this._gauges.set(metric, value);
  },

  histogram(metric: string, value: number): void {
    const values = this._histograms.get(metric) || [];
    values.push(value);
    this._histograms.set(metric, values);
  },

  getMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};

    // Add counters
    for (const [key, value] of this._counters) {
      metrics[`counter.${key}`] = value;
    }

    // Add gauges
    for (const [key, value] of this._gauges) {
      metrics[`gauge.${key}`] = value;
    }

    // Add histogram statistics
    for (const [key, values] of this._histograms) {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        metrics[`histogram.${key}`] = {
          count: values.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)]
        };
      }
    }

    return metrics;
  },

  async health(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      message: 'Metrics collection is operational',
      details: {
        counters: this._counters.size,
        gauges: this._gauges.size,
        histograms: this._histograms.size
      }
    };
  }
});

/**
 * Main Application with Custom Core Modules
 */
async function main() {
  console.log('🚀 Starting application with custom core modules...\n');

  // Create application WITHOUT default core modules
  // This gives us complete control over the application architecture
  const app = createApp({
    name: 'custom-modules-app',
    version: '2.0.0',
    disableCoreModules: true  // <-- This is the key! No default modules!
  });

  // Now register our custom core modules
  // Since we disabled the defaults, we have complete control
  
  // Register custom core modules BEFORE starting the app
  // This replaces the default core modules
  app.replaceModule(LoggerModuleToken, CustomLoggerModule);
  app.replaceModule(ConfigModuleToken, CustomConfigModule);
  
  // Register metrics module with app.use
  app.use(MetricsModule);
  
  // Create token for the metrics module
  const MetricsToken = createToken<typeof MetricsModule>('metrics');

  // Add lifecycle hooks that use our custom modules
  app.onStart(async () => {
    const logger = app.get(LoggerModuleToken).logger;
    const config = app.get(ConfigModuleToken);
    const metrics = app.get(MetricsToken);

    logger.info({
      event: 'app:starting',
      config: {
        name: config.get('app.name'),
        version: config.get('app.version'),
        environment: config.getEnvironment()
      }
    }, 'Application startup initiated');

    // Track application starts
    metrics.increment('app.starts');
  });

  app.onStop(async () => {
    const logger = app.get(LoggerModuleToken).logger;
    const metrics = app.get(MetricsToken);

    // Log final metrics
    logger.info({
      event: 'app:metrics',
      metrics: metrics.getMetrics()
    }, 'Final application metrics');

    logger.info({ event: 'app:stopping' }, 'Application shutdown initiated');
  });

  // Error handling with custom logger
  app.onError((error) => {
    const logger = app.get(LoggerModuleToken).logger;
    const metrics = app.get(MetricsToken);

    logger.error({
      event: 'app:error',
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    }, 'Application error occurred');

    metrics.increment('app.errors');
  });

  // Start the application
  await app.start();

  // Use the custom modules
  const logger = app.get(LoggerModuleToken).logger;
  const config = app.get(ConfigModuleToken);
  const metrics = app.get(MetricsToken);

  // Demonstrate custom logger
  logger.info({ demo: 'custom-logger' }, 'This is our custom JSON logger in action!');
  logger.warn({ warning: 'test' }, 'Custom warning message');
  logger.debug({ debug: true }, 'Debug information');

  // Demonstrate custom config
  logger.info({
    configuration: {
      appName: config.get('app.name'),
      appVersion: config.get('app.version'),
      environment: config.getEnvironment(),
      isProduction: config.isProduction(),
      customValue: config.get('custom.value', 'default')
    }
  }, 'Configuration demonstration');

  // Set some custom configuration
  config.set('custom.value', 'Hello from custom config!');
  config.set('custom.nested.deeply.value', 42);

  logger.info({
    updatedConfig: {
      customValue: config.get('custom.value'),
      nestedValue: config.get('custom.nested.deeply.value')
    }
  }, 'Configuration updated dynamically');

  // Demonstrate metrics
  for (let i = 0; i < 100; i++) {
    metrics.increment('demo.counter');
    metrics.histogram('demo.response_time', Math.random() * 1000);
  }

  metrics.gauge('demo.active_connections', 42);
  metrics.gauge('demo.queue_size', 13);

  // Check health of all modules
  const healthChecks = await Promise.all([
    CustomLoggerModule.health?.(),
    CustomConfigModule.health?.(),
    MetricsModule.health?.()
  ]);

  logger.info({
    health: healthChecks.map((h, i) => ({
      module: ['logger', 'config', 'metrics'][i],
      ...h
    }))
  }, 'Health check results');

  // Display metrics
  logger.info({
    metrics: metrics.getMetrics()
  }, 'Current metrics snapshot');

  // Run for a while to demonstrate the system
  logger.info({ message: 'Application will run for 3 seconds...' });
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Get final metrics before shutdown
  const finalMetrics = metrics.getMetrics();
  logger.info({
    summary: {
      uptime: app.uptime,
      state: app.state,
      metrics: {
        totalStarts: finalMetrics['counter.app.starts'],
        totalErrors: finalMetrics['counter.app.errors'] || 0,
        memoryUsage: finalMetrics['gauge.system.memory.rss']
      }
    }
  }, 'Application summary');

  // Graceful shutdown
  logger.info({ message: 'Initiating graceful shutdown...' });
  await app.stop();

  console.log('\n✅ Application with custom core modules terminated successfully');
  process.exit(0);
}

// Run the application
main().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});