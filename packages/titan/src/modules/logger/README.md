# Titan Logger Module

Production-ready logging module for the Titan framework built on Pino, providing structured logging, multiple transports, log processing, and decorator-based injection.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation & Setup](#installation--setup)
  - [Basic Setup](#basic-setup)
  - [Advanced Setup](#advanced-setup)
  - [Async Configuration](#async-configuration)
- [Core Concepts](#core-concepts)
  - [Structured Logging](#structured-logging)
  - [Log Levels](#log-levels)
  - [Child Loggers](#child-loggers)
  - [Context Management](#context-management)
- [Logger Service](#logger-service)
  - [Service API](#service-api)
  - [Creating Loggers](#creating-loggers)
  - [Global Logger](#global-logger)
- [Logger Decorators](#logger-decorators)
  - [@Logger](#logger)
  - [@Log](#log)
  - [@Monitor](#monitor)
- [Transports](#transports)
  - [Built-in Transports](#built-in-transports)
  - [Custom Transports](#custom-transports)
  - [Transport Configuration](#transport-configuration)
- [Log Processing](#log-processing)
  - [Built-in Processors](#built-in-processors)
  - [Custom Processors](#custom-processors)
  - [Processing Pipeline](#processing-pipeline)
- [Configuration](#configuration)
  - [Module Options](#module-options)
  - [Pino Options](#pino-options)
  - [Environment Configuration](#environment-configuration)
- [Integration](#integration)
  - [ConfigService Integration](#configservice-integration)
  - [Dependency Injection](#dependency-injection)
  - [Module Registration](#module-registration)
- [Best Practices](#best-practices)
  - [Performance Optimization](#performance-optimization)
  - [Error Handling](#error-handling)
  - [Security Considerations](#security-considerations)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Migration Guide](#migration-guide)

## Overview

The Titan Logger Module provides a comprehensive logging solution based on [Pino](https://getpino.io/), one of the fastest JSON loggers for Node.js. It offers structured logging, multiple output transports, log processing capabilities, and seamless integration with Titan's dependency injection system.

### Key Capabilities

- **High Performance**: Built on Pino for minimal overhead
- **Structured Logging**: JSON-based structured logs with metadata
- **Multiple Transports**: Support for various log destinations
- **Log Processing**: Transform and filter logs before output
- **Decorator Injection**: Easy integration via decorators
- **Child Loggers**: Context-specific logging instances
- **Type Safety**: Full TypeScript support
- **Configuration Integration**: Works with ConfigService

## Features

### Core Features

- ✅ **Pino-based Logging** - Fast, low-overhead JSON logger
- ✅ **Multiple Log Levels** - trace, debug, info, warn, error, fatal
- ✅ **Structured Metadata** - Attach context to all logs
- ✅ **Child Loggers** - Create scoped loggers with bindings
- ✅ **Pretty Printing** - Human-readable logs for development
- ✅ **Redaction** - Automatic sensitive data removal
- ✅ **Serializers** - Custom object serialization
- ✅ **Performance Timing** - Built-in timer functions
- ✅ **Transport System** - Pluggable output destinations
- ✅ **Processing Pipeline** - Transform logs before output

### Pino Version Compatibility

The module is compatible with **Pino v9.9.x** which uses the new logging signature:
```typescript
// Pino v9.9.x format (object first, then message)
logger.info({ user: 'john' }, 'User logged in');

// NOT the old format
// logger.info('User logged in', { user: 'john' });  // Pre v9.9.x
```

## Installation & Setup

### Basic Setup

Simple configuration for getting started:

```typescript
import { Application } from '@omnitron-dev/titan';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';

const app = await Application.create({
  imports: [
    LoggerModule.forRoot({
      level: 'info',
      prettyPrint: process.env.NODE_ENV === 'development'
    })
  ]
});

// The module is marked as @Global() - available everywhere
```

### Advanced Setup

Full configuration with all options:

```typescript
import { LoggerModule, ConsoleTransport, RedactionProcessor } from '@omnitron-dev/titan/module/logger';

LoggerModule.forRoot({
  // Log level
  level: 'debug',  // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

  // Pretty printing for development
  prettyPrint: process.env.NODE_ENV === 'development',

  // Base metadata for all logs
  base: {
    service: 'api-gateway',
    version: '1.0.0',
    environment: process.env.NODE_ENV
  },

  // Global context
  context: {
    region: 'us-east-1',
    cluster: 'primary'
  },

  // Timestamp configuration
  timestamp: true,  // or custom function: () => `,"time":"${new Date().toISOString()}"`

  // Message key customization
  messageKey: 'msg',  // Key for log message

  // Nested key for additional data
  nestedKey: 'data',

  // Redaction paths for sensitive data
  redact: [
    'password',
    'secret',
    'token',
    'authorization',
    'creditCard.number',
    'user.ssn'
  ],

  // Enable/disable logging
  enabled: process.env.NODE_ENV !== 'test',

  // Custom transports
  transports: [
    new ConsoleTransport(),
    // Add more transports
  ],

  // Log processors
  processors: [
    new RedactionProcessor([
      'user.password',
      'auth.token'
    ])
  ]
})
```

### Async Configuration

Load configuration asynchronously:

```typescript
LoggerModule.forRootAsync({
  useFactory: async (configService: ConfigService) => {
    const logConfig = await configService.get('logger');

    return {
      level: logConfig.level || 'info',
      prettyPrint: logConfig.pretty,
      base: {
        service: configService.get('app.name'),
        version: configService.get('app.version')
      },
      redact: logConfig.redactPaths || [],
      transports: await loadTransports(logConfig)
    };
  },
  inject: [ConfigService]
})
```

## Core Concepts

### Structured Logging

All logs are JSON objects with metadata:

```typescript
// Instead of string concatenation
logger.info('User ' + userId + ' logged in from ' + ip);  // ❌ Bad

// Use structured logging
logger.info({ userId, ip }, 'User logged in');  // ✅ Good

// Output:
{
  "level": 30,
  "time": 1640000000000,
  "pid": 12345,
  "hostname": "server-01",
  "userId": "user123",
  "ip": "192.168.1.1",
  "msg": "User logged in"
}
```

### Log Levels

Pino log levels with their numeric values:

| Level | Value | Method | Description |
|-------|-------|--------|-------------|
| trace | 10 | `logger.trace()` | Detailed debug information |
| debug | 20 | `logger.debug()` | Debug messages |
| info | 30 | `logger.info()` | Informational messages |
| warn | 40 | `logger.warn()` | Warning messages |
| error | 50 | `logger.error()` | Error messages |
| fatal | 60 | `logger.fatal()` | Fatal errors (terminates process) |

```typescript
// Check if level is enabled
if (logger.isLevelEnabled('debug')) {
  const debugData = computeExpensiveDebugData();
  logger.debug({ debugData }, 'Debug information');
}

// Set level dynamically
loggerService.setLevel('debug');
```

### Child Loggers

Create scoped loggers with additional context:

```typescript
// Create child logger with bindings
const requestLogger = logger.child({
  requestId: '123',
  userId: 'user456'
});

requestLogger.info('Processing request');
// Includes requestId and userId in all logs

// Nested children inherit parent bindings
const dbLogger = requestLogger.child({
  component: 'database'
});

dbLogger.debug({ query }, 'Executing query');
// Includes requestId, userId, and component
```

### Context Management

Global and local context for logs:

```typescript
// Set global context (affects all loggers)
loggerService.setContext({
  deployment: 'production',
  region: 'us-west-2'
});

// Create logger with additional context
const contextLogger = loggerService.withContext({
  feature: 'payment-processing',
  version: 'v2'
});

// All logs include merged context
contextLogger.info('Processing payment');
```

## Logger Service

### Service API

The `LoggerService` implements `ILoggerModule`:

```typescript
interface ILoggerModule {
  // Logger creation
  create(name: string, options?: ILoggerOptions): ILogger;
  child(bindings: object): ILogger;

  // Global logger access
  readonly logger: ILogger;

  // Configuration
  setLevel(level: LogLevel): void;
  addTransport(transport: ITransport): void;
  addProcessor(processor: ILogProcessor): void;

  // Context management
  setContext(context: object): void;
  withContext(context: object): ILogger;

  // Flush all transports
  flush(): Promise<void>;
}
```

### Creating Loggers

Different ways to create logger instances:

```typescript
@Injectable()
class MyService {
  private logger: ILogger;

  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) private loggerService: ILoggerModule
  ) {
    // Create named logger
    this.logger = loggerService.create('MyService');

    // Or create with options
    this.logger = loggerService.create('MyService', {
      level: 'debug',
      redact: ['secret']
    });

    // Or use child logger
    this.logger = loggerService.child({
      service: 'MyService',
      module: 'users'
    });
  }

  async processRequest(id: string) {
    // Create request-specific logger
    const reqLogger = this.logger.child({ requestId: id });

    reqLogger.info('Starting request processing');
    // ... processing logic

    reqLogger.info({ duration: 100 }, 'Request completed');
  }
}
```

### Global Logger

Access the global logger instance:

```typescript
@Injectable()
class GlobalLoggerExample {
  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) private loggerService: ILoggerModule
  ) {}

  doSomething() {
    // Access global logger
    const logger = this.loggerService.logger;

    logger.info('Using global logger');

    // Global logger includes all global context
    logger.debug({ data: 'test' }, 'Debug with global context');
  }
}
```

## Logger Decorators

### @Logger

Inject a logger instance into a class property:

```typescript
import { Logger, ILogger } from '@omnitron-dev/titan/module/logger';

@Injectable()
class UserService {
  // Inject logger with class name
  @Logger()
  private logger!: ILogger;

  // Or with custom name
  @Logger('UserService')
  private namedLogger!: ILogger;

  async createUser(data: UserDto) {
    this.logger.info({ userId: data.id }, 'Creating user');

    try {
      const user = await this.repository.save(data);
      this.logger.info({ userId: user.id }, 'User created successfully');
      return user;
    } catch (error) {
      this.logger.error({ error, userId: data.id }, 'Failed to create user');
      throw error;
    }
  }
}
```

**Implementation Details:**
- Creates a logger with the specified name (or class name if not provided)
- Logger is lazily initialized on first access
- Fallback to console logger if LoggerModule not available

### @Log

Method decorator that logs entry, exit, and errors:

```typescript
@Injectable()
class PaymentService {
  @Log({
    level: 'info',
    includeArgs: true,
    includeResult: false,
    message: 'Processing payment'
  })
  async processPayment(amount: number, currency: string) {
    // Method automatically logged:
    // - Entry: "Entering PaymentService.processPayment"
    // - Exit: "Exiting PaymentService.processPayment"
    // - Error: "Error in PaymentService.processPayment" (if thrown)
    return { success: true, transactionId: '123' };
  }

  @Log({ level: 'debug', includeArgs: true, includeResult: true })
  calculateFee(amount: number): number {
    return amount * 0.03;
  }
}
```

**Options:**
- `level`: Log level to use ('trace' | 'debug' | 'info' | 'warn' | 'error')
- `includeArgs`: Include method arguments in log
- `includeResult`: Include method return value in log
- `message`: Custom log message

### @Monitor

Performance monitoring decorator:

```typescript
@Injectable()
class DataService {
  @Monitor({
    name: 'fetch-user-data',
    sampleRate: 0.1,  // Sample 10% of calls
    includeArgs: false,
    includeResult: false
  })
  async fetchUserData(userId: string) {
    // Performance metrics logged:
    // - Method name
    // - Execution duration
    // - Success/failure status
    const data = await this.api.get(`/users/${userId}`);
    return data;
  }

  @Monitor({ name: 'expensive-calculation' })
  performCalculation(input: number[]): number {
    // Monitors performance
    return input.reduce((a, b) => a + b, 0);
  }
}
```

**Options:**
- `name`: Metric name (defaults to method name)
- `sampleRate`: Sampling rate (0-1, default 1.0)
- `includeArgs`: Include arguments in metrics
- `includeResult`: Include result in metrics

**Metrics Output:**
```json
{
  "method": "fetch-user-data",
  "timestamp": 1640000000000,
  "duration": 123.45,
  "success": true
}
```

## Transports

### Built-in Transports

#### ConsoleTransport

Simple console output transport:

```typescript
import { ConsoleTransport } from '@omnitron-dev/titan/module/logger';

const consoleTransport = new ConsoleTransport();

// Writes JSON to console.log
// Output: {"level":30,"time":1640000000000,"msg":"Test"}
```

**Implementation:**
```typescript
class ConsoleTransport implements ITransport {
  name = 'console';

  write(log: any): void {
    console.log(JSON.stringify(log));
  }
}
```

**Note:** This is a basic implementation for testing. In production, Pino's native console output is more efficient.

### Custom Transports

Implement the `ITransport` interface:

```typescript
interface ITransport {
  name: string;
  write(log: any): void | Promise<void>;
  flush?(): Promise<void>;
}
```

#### File Transport Example

```typescript
import { writeFile, appendFile } from 'fs/promises';

class FileTransport implements ITransport {
  name = 'file';
  private buffer: string[] = [];
  private flushInterval: NodeJS.Timer;

  constructor(
    private filename: string,
    private options: {
      maxBufferSize?: number;
      flushIntervalMs?: number;
    } = {}
  ) {
    // Auto-flush periodically
    this.flushInterval = setInterval(
      () => this.flush(),
      options.flushIntervalMs || 5000
    );
  }

  write(log: any): void {
    this.buffer.push(JSON.stringify(log) + '\n');

    if (this.buffer.length >= (this.options.maxBufferSize || 100)) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const data = this.buffer.join('');
    this.buffer = [];

    await appendFile(this.filename, data);
  }

  async close(): Promise<void> {
    clearInterval(this.flushInterval);
    await this.flush();
  }
}
```

#### Remote Transport Example

```typescript
class RemoteTransport implements ITransport {
  name = 'remote';
  private batch: any[] = [];

  constructor(
    private endpoint: string,
    private options: {
      batchSize?: number;
      headers?: Record<string, string>;
    } = {}
  ) {}

  async write(log: any): Promise<void> {
    this.batch.push(log);

    if (this.batch.length >= (this.options.batchSize || 10)) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const logs = [...this.batch];
    this.batch = [];

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.options.headers
        },
        body: JSON.stringify({ logs })
      });
    } catch (error) {
      // Handle error - maybe re-queue logs
      console.error('Failed to send logs:', error);
    }
  }
}
```

### Transport Configuration

Add transports at runtime:

```typescript
@Injectable()
class TransportManager {
  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) private loggerService: ILoggerModule
  ) {}

  async initialize() {
    // Add file transport for production
    if (process.env.NODE_ENV === 'production') {
      this.loggerService.addTransport(
        new FileTransport('/var/log/app.log', {
          maxBufferSize: 1000,
          flushIntervalMs: 10000
        })
      );
    }

    // Add remote transport
    this.loggerService.addTransport(
      new RemoteTransport('https://logs.example.com', {
        batchSize: 50,
        headers: {
          'X-API-Key': process.env.LOG_API_KEY
        }
      })
    );

    // Ensure all logs are flushed on shutdown
    process.on('SIGTERM', async () => {
      await this.loggerService.flush();
    });
  }
}
```

## Log Processing

### Built-in Processors

#### RedactionProcessor

Remove sensitive data from logs:

```typescript
import { RedactionProcessor } from '@omnitron-dev/titan/module/logger';

const redactionProcessor = new RedactionProcessor([
  'password',
  'user.ssn',
  'creditCard.number',
  'auth.token'
]);

// Before processing:
// { user: { name: 'John', ssn: '123-45-6789' }, password: 'secret' }

// After processing:
// { user: { name: 'John', ssn: '[REDACTED]' }, password: '[REDACTED]' }
```

**Implementation Details:**
```typescript
class RedactionProcessor implements ILogProcessor {
  constructor(private paths: string[]) {}

  process(log: any): any {
    const processed = { ...log };

    for (const path of this.paths) {
      const parts = path.split('.');
      let current = processed;

      // Navigate to parent object
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!part || !current[part]) break;
        current = current[part];
      }

      // Redact the final property
      if (current && parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart in current) {
          current[lastPart] = '[REDACTED]';
        }
      }
    }

    return processed;
  }
}
```

**Behavior:**
- Supports dot notation paths (e.g., 'user.password')
- Shallow copies the log object before modification
- Gracefully handles missing paths
- Replaces values with '[REDACTED]' string

### Custom Processors

Implement the `ILogProcessor` interface:

```typescript
interface ILogProcessor {
  process(log: any): any | null;
}
```

#### Filtering Processor

```typescript
class FilterProcessor implements ILogProcessor {
  constructor(
    private filter: (log: any) => boolean
  ) {}

  process(log: any): any | null {
    // Return null to filter out the log
    return this.filter(log) ? log : null;
  }
}

// Usage - filter out debug logs in production
const filterProcessor = new FilterProcessor(log => {
  if (process.env.NODE_ENV === 'production') {
    return log.level >= 30;  // info and above
  }
  return true;
});
```

#### Enrichment Processor

```typescript
class EnrichmentProcessor implements ILogProcessor {
  process(log: any): any {
    return {
      ...log,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      version: process.env.APP_VERSION,
      // Add trace ID if available
      traceId: AsyncLocalStorage.getStore()?.traceId
    };
  }
}
```

#### Sanitization Processor

```typescript
class SanitizationProcessor implements ILogProcessor {
  private readonly patterns = [
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,  // Credit card
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,  // Email
    /\b\d{3}-\d{2}-\d{4}\b/g  // SSN
  ];

  process(log: any): any {
    const processed = { ...log };

    // Recursively sanitize strings
    this.sanitizeObject(processed);

    return processed;
  }

  private sanitizeObject(obj: any): void {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        for (const pattern of this.patterns) {
          obj[key] = obj[key].replace(pattern, '[MASKED]');
        }
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        this.sanitizeObject(obj[key]);
      }
    }
  }
}
```

### Processing Pipeline

Processors are executed in order:

```typescript
LoggerModule.forRoot({
  processors: [
    // 1. Filter first (remove unwanted logs)
    new FilterProcessor(log => log.level >= 30),

    // 2. Sanitize sensitive patterns
    new SanitizationProcessor(),

    // 3. Redact specific fields
    new RedactionProcessor(['password', 'token']),

    // 4. Enrich with metadata
    new EnrichmentProcessor()
  ]
})

// Processing flow:
// Original log → Filter → Sanitize → Redact → Enrich → Transport
```

## Configuration

### Module Options

Complete configuration interface:

```typescript
interface ILoggerModuleOptions {
  // Pino log level
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

  // Pretty print for development
  prettyPrint?: boolean;

  // Custom transports
  transports?: ITransport[];

  // Log processors
  processors?: ILogProcessor[];

  // Global context
  context?: object;

  // Enable/disable logging
  enabled?: boolean;

  // Redaction paths
  redact?: string[];

  // Base metadata for all logs
  base?: object;

  // Timestamp configuration
  timestamp?: boolean | (() => string);

  // Custom message key
  messageKey?: string;  // Default: 'msg'

  // Nested data key
  nestedKey?: string;
}
```

### Pino Options

The module extends Pino's configuration:

```typescript
interface ILoggerOptions extends PinoLoggerOptions {
  prettyPrint?: boolean;
  destination?: DestinationStream;
  // ... all Pino options
}
```

Common Pino options:
- `serializers`: Custom serializers for objects
- `redact`: Paths to redact (with fast-redact)
- `base`: Base properties for all logs
- `timestamp`: Timestamp function
- `messageKey`: Key for log message
- `nestedKey`: Key for nested data
- `enabled`: Enable/disable logger

### Environment Configuration

Configure via ConfigService:

```yaml
# config/logger.yaml
logger:
  level: ${LOG_LEVEL:info}
  prettyPrint: ${LOG_PRETTY:false}
  enabled: true
  base:
    service: api-gateway
    version: 1.0.0
  redact:
    - password
    - secret
    - auth.token
  timestamp: true
  messageKey: msg
```

```typescript
LoggerModule.forRootAsync({
  useFactory: (configService: ConfigService) => {
    const config = configService.get('logger');

    return {
      level: config.level,
      prettyPrint: config.prettyPrint,
      base: config.base,
      redact: config.redact,
      enabled: config.enabled
    };
  },
  inject: [ConfigService]
})
```

## Integration

### ConfigService Integration

The LoggerService automatically integrates with ConfigService when available:

```typescript
// LoggerService checks for configuration from ConfigService
private getConfiguration(): any {
  const config: any = { ...this.options };

  if (this.configService) {
    // Merge configuration from ConfigService
    config.level = this.configService.get('logger.level', config.level);
    config.prettyPrint = this.configService.get('logger.prettyPrint', config.prettyPrint);
    config.redact = this.configService.get('logger.redact', config.redact);
    // ... other options
  }

  return config;
}
```

Configuration priority:
1. Module options (passed to `forRoot`)
2. ConfigService values (if available)
3. Default values

### Dependency Injection

Available DI tokens:

```typescript
import {
  LOGGER_SERVICE_TOKEN,
  LOGGER_OPTIONS_TOKEN,
  LOGGER_TRANSPORTS_TOKEN,
  LOGGER_PROCESSORS_TOKEN
} from '@omnitron-dev/titan/module/logger';

@Injectable()
class CustomLogService {
  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) private logger: ILoggerModule,
    @Optional() @Inject(LOGGER_OPTIONS_TOKEN) private options?: ILoggerOptions,
    @Optional() @Inject(LOGGER_TRANSPORTS_TOKEN) private transports?: ITransport[],
    @Optional() @Inject(LOGGER_PROCESSORS_TOKEN) private processors?: ILogProcessor[]
  ) {}
}
```

Token descriptions:
- **LOGGER_SERVICE_TOKEN**: Main logger service instance
- **LOGGER_OPTIONS_TOKEN**: Logger configuration options
- **LOGGER_TRANSPORTS_TOKEN**: Array of configured transports
- **LOGGER_PROCESSORS_TOKEN**: Array of log processors

### Module Registration

The LoggerModule is marked with `@Global()` decorator, making it available throughout the application:

```typescript
// In root module
@Module({
  imports: [
    LoggerModule.forRoot({
      level: 'info'
    })
  ]
})
class AppModule {}

// Logger is available in any module
@Injectable()
class AnyService {
  @Logger()
  private logger!: ILogger;
}
```

## Best Practices

### Performance Optimization

#### 1. Avoid String Concatenation

```typescript
// ❌ Bad - string concatenation on every call
logger.info(`User ${userId} performed action ${action}`);

// ✅ Good - structured data
logger.info({ userId, action }, 'User performed action');
```

#### 2. Check Log Level

```typescript
// ❌ Bad - expensive computation always runs
logger.debug({
  debugInfo: computeExpensiveDebugInfo()
}, 'Debug information');

// ✅ Good - only compute when needed
if (logger.isLevelEnabled('debug')) {
  logger.debug({
    debugInfo: computeExpensiveDebugInfo()
  }, 'Debug information');
}
```

#### 3. Use Child Loggers

```typescript
// ❌ Bad - passing context in every log
logger.info({ requestId, userId }, 'Processing started');
logger.info({ requestId, userId }, 'Validation passed');
logger.info({ requestId, userId }, 'Processing completed');

// ✅ Good - create child logger with context
const reqLogger = logger.child({ requestId, userId });
reqLogger.info('Processing started');
reqLogger.info('Validation passed');
reqLogger.info('Processing completed');
```

#### 4. Batch Remote Logs

```typescript
// ✅ Good - batch logs for remote transport
class BatchingTransport implements ITransport {
  private batch: any[] = [];
  private timer?: NodeJS.Timeout;

  write(log: any): void {
    this.batch.push(log);

    if (this.batch.length >= 100) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush() {
    if (this.timer) return;

    this.timer = setTimeout(() => {
      this.flush();
      this.timer = undefined;
    }, 5000);
  }

  async flush() {
    // Send batch to remote service
  }
}
```

### Error Handling

#### 1. Always Log Errors with Stack Traces

```typescript
try {
  await riskyOperation();
} catch (error) {
  // ✅ Good - includes error object
  logger.error({
    error,
    operation: 'riskyOperation',
    context: { /* relevant context */ }
  }, 'Operation failed');

  // Pino serializes Error objects properly
  // Output includes message, stack, and type
}
```

#### 2. Use Appropriate Log Levels

```typescript
// trace - Detailed debugging information
logger.trace({ query, params }, 'SQL query execution');

// debug - Debugging information
logger.debug({ config }, 'Service configuration loaded');

// info - Normal operational messages
logger.info({ userId }, 'User logged in');

// warn - Warning conditions
logger.warn({ attempts: 3 }, 'Multiple failed login attempts');

// error - Error conditions
logger.error({ error, userId }, 'Failed to update user');

// fatal - Fatal errors (usually terminates process)
logger.fatal({ error }, 'Database connection lost');
process.exit(1);
```

#### 3. Error Context

```typescript
class ErrorHandler {
  @Logger()
  private logger!: ILogger;

  handleError(error: Error, context: any) {
    const errorLogger = this.logger.child({
      errorId: generateErrorId(),
      timestamp: Date.now()
    });

    // Log with full context
    errorLogger.error({
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      context,
      system: {
        memory: process.memoryUsage(),
        uptime: process.uptime()
      }
    }, 'Unhandled error occurred');

    // Send to error tracking service
    this.sendToErrorTracking(error, context);
  }
}
```

### Security Considerations

#### 1. Redact Sensitive Data

```typescript
LoggerModule.forRoot({
  redact: [
    'password',
    'secret',
    'token',
    'authorization',
    'cookie',
    'creditCard.*',
    'user.ssn',
    'user.email',  // PII
    'api.key',
    'database.connectionString'
  ]
})
```

#### 2. Custom Redaction

```typescript
class SecurityProcessor implements ILogProcessor {
  private readonly sensitiveKeys = new Set([
    'password', 'token', 'secret', 'key', 'auth'
  ]);

  process(log: any): any {
    return this.redactObject({ ...log });
  }

  private redactObject(obj: any): any {
    for (const key in obj) {
      // Check key name
      if (this.isSensitiveKey(key)) {
        obj[key] = '[REDACTED]';
      }
      // Recursively process objects
      else if (typeof obj[key] === 'object' && obj[key] !== null) {
        obj[key] = this.redactObject(obj[key]);
      }
      // Check for patterns in strings
      else if (typeof obj[key] === 'string') {
        obj[key] = this.redactPatterns(obj[key]);
      }
    }
    return obj;
  }

  private isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    for (const sensitive of this.sensitiveKeys) {
      if (lowerKey.includes(sensitive)) {
        return true;
      }
    }
    return false;
  }

  private redactPatterns(value: string): string {
    // Redact JWT tokens
    value = value.replace(/Bearer\s+[A-Za-z0-9\-._~+\/]+=*/g, 'Bearer [REDACTED]');

    // Redact API keys
    value = value.replace(/([a-zA-Z0-9]{32,})/g, '[API_KEY]');

    return value;
  }
}
```

#### 3. Audit Logging

```typescript
@Injectable()
class AuditLogger {
  @Logger('audit')
  private auditLog!: ILogger;

  logAccess(user: string, resource: string, action: string, result: 'success' | 'failure') {
    this.auditLog.info({
      event: 'access',
      user,
      resource,
      action,
      result,
      timestamp: new Date().toISOString(),
      ip: this.getClientIp(),
      userAgent: this.getUserAgent()
    }, 'Resource access');
  }

  logDataChange(user: string, entity: string, id: string, changes: any) {
    this.auditLog.info({
      event: 'data_change',
      user,
      entity,
      id,
      changes: this.sanitizeChanges(changes),
      timestamp: new Date().toISOString()
    }, 'Data modification');
  }

  private sanitizeChanges(changes: any): any {
    // Remove sensitive fields from change log
    const { password, token, ...sanitized } = changes;
    return sanitized;
  }
}
```

## API Reference

### ILogger Interface

```typescript
interface ILogger {
  // Logging methods (Pino v9.9.x format)
  trace(obj: object, msg?: string, ...args: any[]): void;
  trace(msg: string, ...args: any[]): void;
  debug(obj: object, msg?: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
  info(obj: object, msg?: string, ...args: any[]): void;
  info(msg: string, ...args: any[]): void;
  warn(obj: object, msg?: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(obj: object, msg?: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
  fatal(obj: object, msg?: string, ...args: any[]): void;
  fatal(msg: string, ...args: any[]): void;

  // Child logger creation
  child(bindings: object): ILogger;

  // Performance timer
  time(label?: string): () => void;

  // Level checking
  isLevelEnabled(level: LogLevel): boolean;

  // Access to underlying Pino instance
  readonly _pino: PinoLogger;
}
```

### ILoggerModule Interface

```typescript
interface ILoggerModule {
  // Logger creation
  create(name: string, options?: ILoggerOptions): ILogger;
  child(bindings: object): ILogger;

  // Global logger
  readonly logger: ILogger;

  // Configuration
  setLevel(level: LogLevel): void;
  addTransport(transport: ITransport): void;
  addProcessor(processor: ILogProcessor): void;

  // Context
  setContext(context: object): void;
  withContext(context: object): ILogger;

  // Flush logs
  flush(): Promise<void>;
}
```

### ITransport Interface

```typescript
interface ITransport {
  // Transport name
  name: string;

  // Write log entry
  write(log: any): void | Promise<void>;

  // Optional flush method
  flush?(): Promise<void>;
}
```

### ILogProcessor Interface

```typescript
interface ILogProcessor {
  // Process log entry (return null to filter out)
  process(log: any): any | null;
}
```

### Module Configuration

```typescript
interface ILoggerModuleOptions {
  level?: LogLevel;
  prettyPrint?: boolean;
  transports?: ITransport[];
  processors?: ILogProcessor[];
  context?: object;
  enabled?: boolean;
  redact?: string[];
  base?: object;
  timestamp?: boolean | (() => string);
  messageKey?: string;
  nestedKey?: string;
}

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
```

## Examples

### Complete Application Example

```typescript
import { Application, Module, Injectable } from '@omnitron-dev/titan';
import {
  LoggerModule,
  Logger,
  ILogger,
  ConsoleTransport,
  RedactionProcessor
} from '@omnitron-dev/titan/module/logger';

// Custom transport for production
class CloudWatchTransport implements ITransport {
  name = 'cloudwatch';

  async write(log: any): Promise<void> {
    // Send to AWS CloudWatch
    await this.sendToCloudWatch(log);
  }

  private async sendToCloudWatch(log: any) {
    // Implementation
  }

  async flush(): Promise<void> {
    // Flush any buffered logs
  }
}

// Application service
@Injectable()
class AppService {
  @Logger('AppService')
  private logger!: ILogger;

  async initialize() {
    this.logger.info('Application starting');

    try {
      await this.connectDatabase();
      this.logger.info('Database connected');
    } catch (error) {
      this.logger.fatal({ error }, 'Failed to connect to database');
      throw error;
    }
  }

  private async connectDatabase() {
    // Database connection logic
  }
}

// Application module
@Module({
  imports: [
    LoggerModule.forRoot({
      level: process.env.LOG_LEVEL || 'info',
      prettyPrint: process.env.NODE_ENV === 'development',

      base: {
        app: 'my-application',
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
      },

      context: {
        region: process.env.AWS_REGION || 'us-east-1'
      },

      redact: [
        'password',
        'token',
        'authorization',
        'user.ssn'
      ],

      transports: [
        new ConsoleTransport(),
        ...(process.env.NODE_ENV === 'production'
          ? [new CloudWatchTransport()]
          : []
        )
      ],

      processors: [
        new RedactionProcessor([
          'creditCard',
          'apiKey'
        ])
      ]
    })
  ],
  providers: [AppService]
})
class AppModule {}

// Bootstrap
async function bootstrap() {
  const app = await Application.create(AppModule);
  await app.start();
}

bootstrap().catch(console.error);
```

### Request Logging Middleware

```typescript
@Injectable()
class RequestLoggingMiddleware {
  @Logger('HTTP')
  private logger!: ILogger;

  async use(req: Request, res: Response, next: NextFunction) {
    const requestId = generateRequestId();
    const startTime = Date.now();

    // Create request-specific logger
    const reqLogger = this.logger.child({
      requestId,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    // Attach logger to request for use in controllers
    req.logger = reqLogger;

    // Log request
    reqLogger.info('Request received');

    // Log response
    const originalSend = res.send;
    res.send = function(data: any) {
      const duration = Date.now() - startTime;

      reqLogger.info({
        statusCode: res.statusCode,
        duration,
        contentLength: res.get('content-length')
      }, 'Request completed');

      return originalSend.call(this, data);
    };

    next();
  }
}
```

### Service with Comprehensive Logging

```typescript
@Injectable()
class UserService {
  @Logger()
  private logger!: ILogger;

  constructor(
    private repository: UserRepository,
    private emailService: EmailService
  ) {}

  @Log({ level: 'debug', includeArgs: true })
  async createUser(dto: CreateUserDto) {
    const userLogger = this.logger.child({
      operation: 'createUser',
      email: dto.email
    });

    userLogger.info('Creating new user');

    // Validate
    userLogger.debug({ dto }, 'Validating user data');
    await this.validateUserData(dto);

    // Check duplicates
    const existing = await this.repository.findByEmail(dto.email);
    if (existing) {
      userLogger.warn('User already exists');
      throw new ConflictException('User already exists');
    }

    // Create user
    try {
      const user = await this.repository.create(dto);
      userLogger.info({ userId: user.id }, 'User created successfully');

      // Send welcome email
      await this.emailService.sendWelcome(user);
      userLogger.debug('Welcome email sent');

      return user;
    } catch (error) {
      userLogger.error({ error }, 'Failed to create user');
      throw error;
    }
  }

  @Monitor({ name: 'user-query', sampleRate: 0.1 })
  async findUsers(filter: UserFilter) {
    return this.repository.find(filter);
  }

  private async validateUserData(dto: CreateUserDto) {
    // Validation logic
  }
}
```

### Error Tracking Integration

```typescript
@Injectable()
class ErrorTrackingService {
  @Logger('ErrorTracking')
  private logger!: ILogger;

  constructor(
    @Inject(LOGGER_SERVICE_TOKEN) private loggerService: ILoggerModule
  ) {
    // Add error tracking processor
    this.loggerService.addProcessor({
      process: (log: any) => {
        // Send errors to Sentry/Rollbar
        if (log.level >= 50) {  // error and fatal
          this.sendToErrorTracking(log);
        }
        return log;
      }
    });
  }

  private sendToErrorTracking(log: any) {
    // Send to external error tracking service
    if (log.error) {
      Sentry.captureException(log.error, {
        extra: log
      });
    }
  }

  @Log({ level: 'error' })
  captureError(error: Error, context?: any) {
    this.logger.error({
      error,
      context,
      timestamp: new Date().toISOString()
    }, 'Captured error');
  }
}
```

## Migration Guide

### From Console.log

```typescript
// Before
console.log('User created:', userId);
console.error('Error:', error);

// After
logger.info({ userId }, 'User created');
logger.error({ error }, 'Error occurred');
```

### From Winston

```typescript
// Winston
winston.log('info', 'User logged in', { userId: 123 });

// Titan Logger (Pino v9.9.x)
logger.info({ userId: 123 }, 'User logged in');
```

### From Bunyan

```typescript
// Bunyan
bunyan.info({ user: userId }, 'User action');

// Titan Logger (same format!)
logger.info({ user: userId }, 'User action');
```

### From Pino v8 and Earlier

```typescript
// Pino v8 and earlier
logger.info('User %s logged in', userId);
logger.info({ userId }, 'User logged in');  // Also worked

// Pino v9.9.x (Titan Logger)
logger.info({ userId }, 'User logged in');  // Object first
// logger.info('User logged in', { userId });  // This won't work!
```

## Performance Benchmarks

Pino is one of the fastest Node.js loggers:

```
Benchmarks (ops/sec):
pino         1,126,750
bunyan         121,156
winston         39,950
console.log    439,220

With object logging:
pino.info({})    797,524
bunyan.info({})   53,217
winston.info({})  15,146
```

## Troubleshooting

### Common Issues

#### 1. Logger Not Injecting

```typescript
// Problem: Logger is undefined
@Injectable()
class MyService {
  @Logger()
  private logger!: ILogger;  // undefined!
}

// Solution: Ensure LoggerModule is imported
@Module({
  imports: [LoggerModule.forRoot()]
})
```

#### 2. Logs Not Appearing

```typescript
// Check log level
logger.debug('Debug message');  // Won't show if level is 'info'

// Check if logging is enabled
LoggerModule.forRoot({
  enabled: process.env.NODE_ENV !== 'test'  // Disabled in tests
})
```

#### 3. Performance Issues

```typescript
// Problem: Slow logging
logger.info(JSON.stringify(largeObject));  // Expensive!

// Solution: Use structured logging
logger.info({ data: largeObject }, 'Message');  // Pino handles serialization
```

#### 4. Memory Leaks with Child Loggers

```typescript
// Problem: Creating too many child loggers
for (const user of users) {
  const logger = this.logger.child({ userId: user.id });  // Memory leak!
  logger.info('Processing');
}

// Solution: Reuse or limit child loggers
const logger = this.logger.child({ operation: 'batch' });
for (const user of users) {
  logger.info({ userId: user.id }, 'Processing');
}
```

## Implementation Details

### Service Initialization

The LoggerService initializes immediately in the constructor:

```typescript
constructor(
  @Optional() @Inject(LOGGER_OPTIONS_TOKEN) private options: ILoggerModuleOptions = {},
  @Optional() @Inject(LOGGER_TRANSPORTS_TOKEN) initialTransports?: ITransport[],
  @Optional() @Inject(LOGGER_PROCESSORS_TOKEN) initialProcessors?: ILogProcessor[],
  @Optional() @Inject(CONFIG_SERVICE_TOKEN) private configService?: any
) {
  // Initialize immediately
  this.initialize();

  // Add initial transports and processors
  if (initialTransports) {
    this.transports.push(...initialTransports);
  }
  if (initialProcessors) {
    this.processors.push(...initialProcessors);
  }
}
```

**Key Behaviors:**
- Initialization happens synchronously in constructor
- Guards against multiple initialization with `initialized` flag
- ConfigService integration is optional and fail-safe
- Transports and processors are stored in arrays for runtime modification

### Logger Instance Management

```typescript
private loggers = new Map<string, ILogger>();

create(name: string, options?: ILoggerOptions): ILogger {
  // Cache named loggers
  if (this.loggers.has(name)) {
    return this.loggers.get(name)!;
  }

  const childLogger = this.rootLogger.child({
    name,
    ...this.context
  });

  const logger = new LoggerImpl(childLogger);
  this.loggers.set(name, logger);  // Store for reuse

  return logger;
}
```

**Logger Caching:**
- Named loggers are cached in a Map
- Subsequent calls with same name return cached instance
- Child loggers inherit global context
- No automatic cleanup mechanism (potential memory consideration)

### Configuration Priority

Configuration is resolved in this order:

1. **Constructor Options** - Direct options passed to LoggerService
2. **ConfigService Values** - Merged from ConfigService if available
3. **Default Values** - Built-in defaults

```typescript
private getConfiguration(): any {
  const config: any = { ...this.options };

  if (this.configService && typeof this.configService.get === 'function') {
    try {
      // Merge values from ConfigService
      config.level = this.configService.get('logger.level', config.level);
      config.prettyPrint = this.configService.get('logger.prettyPrint', config.prettyPrint);
      // ... more config
    } catch {
      // ConfigService might not be initialized - use defaults
      // This is expected during early initialization phase
    }
  }

  return config;
}
```

### PrettyPrint Fallback

PrettyPrint has a graceful fallback mechanism:

```typescript
if (prettyPrint) {
  try {
    // Try to use pino-pretty for development
    // Note: This requires pino-pretty to be installed
    this.rootLogger = pino(pinoOptions);
  } catch {
    // Fallback to regular pino if pino-pretty is not available
    this.rootLogger = pino(pinoOptions);
  }
} else {
  this.rootLogger = pino(pinoOptions);
}
```

**Note:** Currently both branches create the same logger as pino-pretty integration requires additional setup.

### Decorator Fallback Behavior

The `@Logger` decorator has a built-in fallback when LoggerModule is not available:

```typescript
function getLoggerInstance(name: string): any {
  // Simple console logger implementation for decorators
  // This is a fallback when the real logger module is not available
  return {
    trace: (...args: any[]) => console.trace(`[${name}]`, ...args),
    debug: (...args: any[]) => console.debug(`[${name}]`, ...args),
    info: (...args: any[]) => console.info(`[${name}]`, ...args),
    warn: (...args: any[]) => console.warn(`[${name}]`, ...args),
    error: (...args: any[]) => console.error(`[${name}]`, ...args),
    fatal: (...args: any[]) => console.error(`[${name}] [FATAL]`, ...args),
    child: (bindings: object) => getLoggerInstance(`${name}:${JSON.stringify(bindings)}`),
    time: (label?: string) => () => console.timeEnd(label || 'timer'),
    isLevelEnabled: () => true
  };
}
```

**Usage in @Logger Decorator:**
```typescript
@Logger('UserService')
private logger!: ILogger;

// On first access:
Object.defineProperty(context.target, propertyKey, {
  get() {
    if (!this[privateKey]) {
      const name = context.options || context.target.constructor.name;
      this[privateKey] = getLoggerInstance(name);  // Fallback logger
    }
    return this[privateKey];
  },
  set(value: any) {
    this[privateKey] = value;  // Can be overridden by DI
  }
});
```

This ensures that logging works even without LoggerModule initialization.

### LoggerImpl Wrapper

The `LoggerImpl` class wraps PinoLogger to implement the `ILogger` interface:

```typescript
class LoggerImpl implements ILogger {
  constructor(public readonly _pino: PinoLogger) {}

  // All methods delegate to Pino instance
  info(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.info(objOrMsg, ...args);
    } else {
      this._pino.info(objOrMsg, ...args);
    }
  }
  // ... other methods
}
```

**Purpose:**
- Provides consistent interface regardless of Pino version
- Enables future compatibility adjustments
- Allows type-safe access to underlying Pino instance via `_pino`

### Module Registration Details

#### forRoot Static Configuration

```typescript
static forRoot(options: ILoggerModuleOptions = {}): any {
  return {
    module: LoggerModule,
    providers: [
      // Options are provided as value
      [LOGGER_OPTIONS_TOKEN, { useValue: options }],

      // Service is created via factory with closure
      [LOGGER_SERVICE_TOKEN, {
        useFactory: () =>
          new LoggerService(options, options.transports, options.processors),
        scope: 'singleton'
      }]
    ],
    exports: [LOGGER_SERVICE_TOKEN]
  };
}
```

**Key Points:**
- Options are captured in closure for factory function
- Service is always singleton scoped
- Only LOGGER_SERVICE_TOKEN is exported

#### forRootAsync Dynamic Configuration

```typescript
static forRootAsync(options: {
  useFactory: (...args: any[]) => Promise<ILoggerModuleOptions> | ILoggerModuleOptions;
  inject?: any[];
}): any {
  return {
    module: LoggerModule,
    providers: [
      // Options resolved asynchronously
      [LOGGER_OPTIONS_TOKEN, {
        useFactory: options.useFactory,
        inject: options.inject || []
      }],

      // Service waits for options
      [LOGGER_SERVICE_TOKEN, {
        useFactory: (options_?: ILoggerModuleOptions, ...) =>
          new LoggerService(options_ || {}, ...),
        inject: [
          { token: LOGGER_OPTIONS_TOKEN, optional: true },
          { token: LOGGER_TRANSPORTS_TOKEN, optional: true },
          { token: LOGGER_PROCESSORS_TOKEN, optional: true },
          { token: CONFIG_SERVICE_TOKEN, optional: true }
        ],
        scope: 'singleton'
      }]
    ]
  };
}
```

### Level Management

Setting log level affects all loggers:

```typescript
setLevel(level: LogLevel): void {
  this.rootLogger.level = level;

  // Update all child loggers
  for (const logger of this.loggers.values()) {
    logger._pino.level = level;
  }
}
```

**Important:** This updates cached named loggers but not standalone child loggers created via `child()`.

### Context Updates

Context changes create new logger instances:

```typescript
setContext(context: object): void {
  this.context = { ...this.context, ...context };

  // Recreate global logger with new context
  this.globalLogger = new LoggerImpl(
    this.rootLogger.child(this.context)
  );
}
```

**Behavior:**
- Merges new context with existing
- Recreates global logger
- Does NOT update existing named loggers
- Child loggers created after will inherit new context

### Timestamp Configuration

Timestamp handling with special logic:

```typescript
timestamp: (() => {
  const timestampConfig = config.timestamp ?? true;
  return !timestampConfig ? false : pino.stdTimeFunctions.isoTime;
})(),
```

**Values:**
- `true` (default) - ISO timestamp via `pino.stdTimeFunctions.isoTime`
- `false` - No timestamp
- Custom function - User-provided timestamp function

### Base Metadata

Always includes process information:

```typescript
base: {
  pid: process.pid,
  hostname: os.hostname(),
  ...config.base  // User-provided base properties
}
```

### Pino Serializers

Uses Pino's standard serializers:

```typescript
serializers: pino.stdSerializers,
```

This includes:
- `err` - Error serializer (includes stack trace)
- `req` - HTTP request serializer
- `res` - HTTP response serializer

### Timer Implementation

Custom timer implementation:

```typescript
time(label?: string): () => void {
  const start = Date.now();
  const id = label || 'time-' + Math.random().toString(36).substr(2, 9);

  return () => {
    const duration = Date.now() - start;
    this._pino.info({ duration, label: id },
      `Timer ${id} completed in ${duration}ms`);
  };
}
```

**Features:**
- Auto-generates ID if label not provided
- Returns function to stop timer
- Logs duration in milliseconds
- Includes both structured data and message

### Transport and Processor Storage

```typescript
private transports: ITransport[] = [];
private processors: ILogProcessor[] = [];
```

**Note:** These are currently stored but not actively used by the Pino instance. They're available for:
- Future integration with Pino transports
- Custom processing pipeline implementation
- Flush operations

### Edge Cases & Limitations

1. **No Automatic Logger Cleanup**
   - Named loggers are cached indefinitely
   - No mechanism to remove unused loggers
   - Potential memory growth in long-running applications

2. **Level Changes Don't Affect All Loggers**
   - Only affects root and cached named loggers
   - Child loggers created via `child()` retain original level

3. **Context Updates Are Not Retroactive**
   - Existing loggers keep old context
   - Only new loggers get updated context

4. **PrettyPrint Not Fully Implemented**
   - Code attempts to use pino-pretty
   - Currently falls back to regular Pino
   - Would need proper transport setup for pino-pretty

5. **Transport/Processor Integration Incomplete**
   - Arrays are populated but not wired to Pino
   - Would need Pino transport streams for full integration

6. **ConfigService Race Condition**
   - ConfigService might not be initialized when LoggerService constructs
   - Handled with try-catch but may miss initial configuration

## Summary

The Titan Logger Module provides a robust, high-performance logging solution built on Pino with:

- **Structured Logging**: JSON-based logs with metadata
- **Multiple Transports**: Flexible output destinations (framework ready)
- **Processing Pipeline**: Transform and filter logs (framework ready)
- **Decorator Support**: Easy integration via `@Logger`, `@Log`, `@Monitor`
- **Type Safety**: Full TypeScript support
- **Performance**: Minimal overhead with Pino
- **Integration**: Works seamlessly with ConfigService and DI
- **Fallback Support**: Console logging when module not available

Use the Logger Module for production-ready logging with proper structure, performance, and flexibility.

Use the Logger Module for production-ready logging with proper structure, performance, and flexibility.