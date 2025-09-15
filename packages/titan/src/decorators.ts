/**
 * Titan-specific decorators built on top of Nexus decorator API
 * 
 * @module titan/decorators
 * @packageDocumentation
 */

import {
  createDecorator,
  createMethodInterceptor,
  createPropertyInterceptor,
  DecoratorContext,
  Injectable,
  Singleton,
  Module as NexusModule,
  ModuleDecoratorOptions
} from '@nexus/core/decorators';

/**
 * Titan module metadata
 */
export interface TitanModuleOptions extends ModuleDecoratorOptions {
  nexusModule?: any;
  dependencies?: string[];
  config?: Record<string, any>;
}

/**
 * Titan module decorator
 */
export const TitanModule = createDecorator<TitanModuleOptions>()
  .withName('TitanModule')
  .forClass((context) => {
    const options = context.options!;
    
    // Apply Nexus module decorator if nexusModule is provided
    if (options.nexusModule) {
      NexusModule({
        name: options.name,
        imports: options.imports,
        providers: options.providers,
        exports: options.exports,
        global: options.global
      })(context.target);
    }
    
    // Store Titan-specific metadata
    context.metadata.set('titan:module', true);
    context.metadata.set('titan:dependencies', options.dependencies);
    context.metadata.set('titan:config', options.config);
    
    // Mark as Injectable and Singleton by default
    Injectable({ scope: 'singleton' as any })(context.target);
  })
  .build();

/**
 * Application lifecycle phases
 */
export type LifecyclePhase = 'bootstrap' | 'startup' | 'ready' | 'shutdown' | 'error';

/**
 * Application lifecycle decorator
 */
export const AppLifecycle = createDecorator<{ 
  phase: LifecyclePhase;
  priority?: number;
}>()
  .withName('AppLifecycle')
  .forMethod()
  .withMetadata((context) => ({
    phase: context.options?.phase,
    priority: context.options?.priority ?? 0,
    lifecycle: true
  }))
  .withHooks({
    afterApply: (context) => {
      // Register with Titan's lifecycle manager
      const phase = context.options?.phase;
      const method = context.propertyKey;
      const target = context.target;
      
      // This would be handled by Titan's lifecycle manager
      registerLifecycleHook(target, method as string, phase!);
    }
  })
  .build();

/**
 * Module event listener decorator
 */
export const OnModuleEvent = createDecorator<{ 
  event: string;
  filter?: (data: any) => boolean;
}>()
  .withName('OnModuleEvent')
  .forMethod((context) => {
    const event = context.options?.event;
    const filter = context.options?.filter;
    const handler = context.descriptor!.value;
    
    // Wrap handler with filter if provided
    if (filter) {
      context.descriptor!.value = function(...args: any[]) {
        if (filter(args[0])) {
          return handler.apply(this, args);
        }
      };
    }
    
    // Store event handler metadata
    context.metadata.set('event', event);
    context.metadata.set('handler', true);
    
    return context.descriptor;
  })
  .build();

/**
 * Health check decorator options
 */
export interface HealthCheckOptions {
  name: string;
  critical?: boolean;
  timeout?: number;
  interval?: number;
}

/**
 * Health check decorator
 */
export const HealthCheck = createDecorator<HealthCheckOptions>()
  .withName('HealthCheck')
  .forMethod()
  .withMetadata((context) => ({
    healthCheck: true,
    name: context.options?.name,
    critical: context.options?.critical ?? false,
    timeout: context.options?.timeout ?? 5000,
    interval: context.options?.interval ?? 30000
  }))
  .withValidation((options) => {
    if (!options?.name) {
      return 'Health check name is required';
    }
    if (options.timeout && options.timeout <= 0) {
      return 'Timeout must be positive';
    }
    if (options.interval && options.interval <= 0) {
      return 'Interval must be positive';
    }
  })
  .build();

/**
 * Configuration watcher decorator
 */
export const ConfigWatch = createPropertyInterceptor<{ 
  path: string;
  deep?: boolean;
}>('ConfigWatch', {
  get(value, context) {
    // Get latest config value if not cached
    if (value === undefined) {
      return getConfigValue(context.options?.path!);
    }
    return value;
  },
  set(value, context) {
    // Update config when property is set
    updateConfigValue(context.options?.path!, value);
    
    // Notify watchers if deep watching is enabled
    if (context.options?.deep) {
      notifyConfigWatchers(context.options.path, value);
    }
    
    return value;
  }
});

/**
 * Performance monitoring decorator
 */
export const Monitor = createMethodInterceptor<{
  name?: string;
  sampleRate?: number;
  includeArgs?: boolean;
  includeResult?: boolean;
}>('Monitor', async (originalMethod, args, context) => {
  const sampleRate = context.options?.sampleRate ?? 1.0;
  
  // Skip monitoring based on sample rate
  if (Math.random() > sampleRate) {
    return originalMethod(...args);
  }
  
  const metricName = context.options?.name || 
    `${context.target.constructor.name}.${String(context.propertyKey)}`;
  const start = performance.now();
  
  const metadata: any = {
    method: metricName,
    timestamp: Date.now()
  };
  
  if (context.options?.includeArgs) {
    metadata.args = args;
  }
  
  try {
    const result = await originalMethod(...args);
    
    const duration = performance.now() - start;
    metadata.duration = duration;
    metadata.success = true;
    
    if (context.options?.includeResult) {
      metadata.result = result;
    }
    
    // Record metrics
    recordMetric('method.duration', duration, { method: metricName });
    recordMetric('method.success', 1, { method: metricName });
    
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    metadata.duration = duration;
    metadata.success = false;
    metadata.error = error;
    
    // Record error metrics
    recordMetric('method.duration', duration, { method: metricName });
    recordMetric('method.error', 1, { method: metricName, error: (error as Error).name });
    
    throw error;
  }
});

/**
 * Rate limiting decorator
 */
export const RateLimit = createMethodInterceptor<{
  requests: number;
  window: number; // milliseconds
  key?: (context: DecoratorContext) => string;
}>('RateLimit', (originalMethod, args, context) => {
  const { requests, window, key } = context.options!;
  
  const rateLimitKey = key 
    ? key(context)
    : `${context.target.constructor.name}.${String(context.propertyKey)}`;
  
  if (!checkRateLimit(rateLimitKey, requests, window)) {
    throw new RateLimitError(`Rate limit exceeded for ${rateLimitKey}`);
  }
  
  return originalMethod(...args);
});

/**
 * Caching decorator
 */
export const Cacheable = createMethodInterceptor<{
  ttl?: number; // milliseconds
  key?: (...args: any[]) => string;
  condition?: (...args: any[]) => boolean;
}>('Cacheable', async (originalMethod, args, context) => {
  const { ttl = 60000, key, condition } = context.options || {};
  
  // Check if caching should be applied
  if (condition && !condition(...args)) {
    return originalMethod(...args);
  }
  
  // Generate cache key
  const cacheKey = key 
    ? key(...args)
    : `${context.target.constructor.name}.${String(context.propertyKey)}:${JSON.stringify(args)}`;
  
  // Check cache
  const cached = getFromCache(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  
  // Execute method and cache result
  const result = await originalMethod(...args);
  setInCache(cacheKey, result, ttl);
  
  return result;
});

/**
 * Retry decorator with exponential backoff
 */
export const Retryable = createMethodInterceptor<{
  attempts?: number;
  delay?: number;
  maxDelay?: number;
  backoff?: number;
  retryOn?: (error: any) => boolean;
}>('Retryable', async (originalMethod, args, context) => {
  const {
    attempts = 3,
    delay = 1000,
    maxDelay = 30000,
    backoff = 2,
    retryOn
  } = context.options || {};
  
  let lastError: any;
  let currentDelay = delay;
  
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await originalMethod(...args);
    } catch (error) {
      lastError = error;
      
      // Check if we should retry this error
      if (retryOn && !retryOn(error)) {
        throw error;
      }
      
      if (attempt < attempts) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        
        // Apply exponential backoff
        currentDelay = Math.min(currentDelay * backoff, maxDelay);
        
        // Log retry attempt
        console.warn(
          `Retry attempt ${attempt}/${attempts} for ${context.target.constructor.name}.${String(context.propertyKey)}`,
          { error, delay: currentDelay }
        );
      }
    }
  }
  
  throw lastError;
});

/**
 * Timeout decorator
 */
export const Timeout = createMethodInterceptor<{ ms: number }>('Timeout', (originalMethod, args, context) => {
  const timeoutMs = context.options?.ms || 5000;
  
  return Promise.race([
    originalMethod(...args),
    new Promise((_, reject) => 
      setTimeout(() => reject(new TimeoutError(
        `Method ${context.target.constructor.name}.${String(context.propertyKey)} timed out after ${timeoutMs}ms`
      )), timeoutMs)
    )
  ]);
});

/**
 * Logging decorator
 */
export const Log = createMethodInterceptor<{
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  includeArgs?: boolean;
  includeResult?: boolean;
  message?: string;
}>('Log', async (originalMethod, args, context) => {
  const level = context.options?.level || 'info';
  const methodName = `${context.target.constructor.name}.${String(context.propertyKey)}`;
  
  const logData: any = {
    method: methodName,
    timestamp: new Date().toISOString()
  };
  
  if (context.options?.includeArgs) {
    logData.args = args;
  }
  
  if (context.options?.message) {
    logData.message = context.options.message;
  }
  
  // Log method entry
  logger[level](`Entering ${methodName}`, logData);
  
  try {
    const result = await originalMethod(...args);
    
    if (context.options?.includeResult) {
      logData.result = result;
    }
    
    // Log method exit
    logger[level](`Exiting ${methodName}`, logData);
    
    return result;
  } catch (error) {
    logData.error = error;
    logger.error(`Error in ${methodName}`, logData);
    throw error;
  }
});

/**
 * Validation decorator
 */
export const ValidateArgs = createMethodInterceptor<{
  schema: any; // Would use a real validation library like Joi or Yup
  throwOnError?: boolean;
}>('ValidateArgs', (originalMethod, args, context) => {
  const { schema, throwOnError = true } = context.options!;
  
  const validation = validateWithSchema(schema, args);
  
  if (!validation.valid) {
    if (throwOnError) {
      throw new ValidationError(
        `Validation failed for ${context.target.constructor.name}.${String(context.propertyKey)}: ${validation.errors.join(', ')}`
      );
    }
    
    // Log validation errors but continue
    console.warn(`Validation warning for ${context.target.constructor.name}.${String(context.propertyKey)}`, validation.errors);
  }
  
  return originalMethod(...args);
});

/**
 * Event emitter decorator
 */
export const EmitEvent = createMethodInterceptor<{
  event: string;
  mapResult?: (result: any) => any;
  mapError?: (error: any) => any;
}>('EmitEvent', async (originalMethod, args, context) => {
  const { event, mapResult, mapError } = context.options!;
  
  try {
    const result = await originalMethod(...args);
    
    // Emit success event
    emitEvent(`${event}.success`, mapResult ? mapResult(result) : result);
    
    return result;
  } catch (error) {
    // Emit error event
    emitEvent(`${event}.error`, mapError ? mapError(error) : error);
    
    throw error;
  }
});

// Placeholder functions - these would be implemented by Titan
function registerLifecycleHook(target: any, method: string, phase: LifecyclePhase) {
  // Implementation would register with Titan's lifecycle manager
}

function getConfigValue(path: string): any {
  // Implementation would get from Titan's config manager
}

function updateConfigValue(path: string, value: any): void {
  // Implementation would update Titan's config manager
}

function notifyConfigWatchers(path: string, value: any): void {
  // Implementation would notify config watchers
}

function recordMetric(name: string, value: number, tags?: Record<string, any>): void {
  // Implementation would record to Titan's metrics system
}

function checkRateLimit(key: string, requests: number, window: number): boolean {
  // Implementation would check Titan's rate limiter
  return true;
}

function getFromCache(key: string): any {
  // Implementation would get from Titan's cache
}

function setInCache(key: string, value: any, ttl: number): void {
  // Implementation would set in Titan's cache
}

function validateWithSchema(schema: any, data: any): { valid: boolean; errors: string[] } {
  // Implementation would use a real validation library
  return { valid: true, errors: [] };
}

function emitEvent(event: string, data: any): void {
  // Implementation would emit through Titan's event system
}

const logger = {
  trace: (message: string, data?: any) => console.trace(message, data),
  debug: (message: string, data?: any) => console.debug(message, data),
  info: (message: string, data?: any) => console.info(message, data),
  warn: (message: string, data?: any) => console.warn(message, data),
  error: (message: string, data?: any) => console.error(message, data)
};

// Custom error classes
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Re-export commonly used Nexus decorators
export {
  Injectable,
  Singleton,
  Inject,
  Optional,
  PostConstruct,
  PreDestroy,
  Module,
  Service,
  Controller,
  Repository
} from '@nexus/core/decorators';