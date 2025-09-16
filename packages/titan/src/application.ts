/**
 * Titan Application - Core application kernel
 */

import os from 'node:os';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Token, Container, createToken } from '@omnitron-dev/nexus';

import { ConfigModule, ConfigModuleToken } from './modules/config.module';
import { Logger, LoggerModule, LoggerModuleToken } from './modules/logger.module';
import {
  Module,
  Provider,
  EventMeta,
  Environment,
  ModuleInput,
  IApplication,
  EventHandler,
  LifecycleHook,
  DynamicModule,
  ShutdownOptions,
  ApplicationState,
  ApplicationEvent,
  ApplicationConfig,
  ModuleConstructor,
  ApplicationMetrics,
  ApplicationOptions
} from './types';

/**
 * Application token for DI
 */
export const ApplicationToken = createToken<Application>('Application');

/**
 * Titan Application implementation
 */
export class Application implements IApplication {
  private _isStarted = false;
  private _state: ApplicationState = ApplicationState.Created;
  private _container: Container;
  private _config: ApplicationConfig;
  private _startTime: number = 0;
  private _eventEmitter = new EventEmitter();
  private _modules = new Map<Token<any>, Module>();
  private _startHooks: LifecycleHook[] = [];
  private _stopHooks: LifecycleHook[] = [];
  private _errorHandlers: ((error: Error) => void)[] = [];
  private _logger?: Logger;
  private _shutdownHandlers: Map<string, (...args: any[]) => void> = new Map();

  /**
   * Static factory method for creating application instance
   */
  static async create(options?: ApplicationOptions & {
    modules?: ModuleInput[];
    replaceConfig?: Module | ((config?: any) => Module);
    replaceLogger?: Module | ((config?: any) => Module);
  }): Promise<Application> {
    const app = new Application(options);

    // Replace core modules if custom implementations provided
    if (options?.replaceConfig) {
      const configModule = typeof options.replaceConfig === 'function'
        ? options.replaceConfig(options.config?.config)
        : options.replaceConfig;
      app.replaceModule(ConfigModuleToken, configModule);
    }

    if (options?.replaceLogger) {
      const loggerModule = typeof options.replaceLogger === 'function'
        ? options.replaceLogger(options.config?.logger)
        : options.replaceLogger;
      app.replaceModule(LoggerModuleToken, loggerModule);
    }

    // Register additional modules if provided
    if (options?.modules) {
      for (const moduleInput of options.modules) {
        await app.registerModule(moduleInput);
      }
    }

    return app;
  }

  constructor(options: ApplicationOptions = {}) {
    // Initialize container
    this._container = options.container || new Container();

    // Register application itself
    this._container.register(ApplicationToken, {
      useValue: this
    });

    // Initialize configuration
    // Merge logging from top level into config if provided
    const configWithLogging = {
      ...options.config,
      ...(options.logging && { logging: options.logging })
    };

    this._config = {
      name: options.name || 'titan-app',
      version: options.version || '0.0.0',
      environment: process.env['NODE_ENV'] || 'development',
      debug: options.debug || false,
      ...configWithLogging
    };

    // Set graceful shutdown timeout
    const shutdownTimeout = options.gracefulShutdownTimeout || 30000;

    // Register core modules unless disabled
    if (!options.disableCoreModules) {
      this.registerCoreModules();
    }

    // Setup graceful shutdown handlers unless disabled
    if (!options.disableGracefulShutdown) {
      this.setupGracefulShutdown(shutdownTimeout);
    }
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    if (this._state !== ApplicationState.Created && this._state !== ApplicationState.Stopped) {
      throw new Error(`Cannot start application in state: ${this._state}`);
    }

    this._state = ApplicationState.Starting;
    this._startTime = Date.now();
    this._isStarted = true;

    try {
      // Emit starting event
      this.emit('starting');

      // Start config module first if available
      if (this.has(ConfigModuleToken)) {
        const configModule = this.getModule(ConfigModuleToken);
        // Load initial configuration from application options
        if (this._config) {
          configModule.loadObject(this._config);
        }
        await configModule.onStart?.(this);
        this.emit('module:started', { module: configModule.name });
      }

      // Initialize logger after config if available
      if (this.has(LoggerModuleToken)) {
        const loggerModule = this.getModule(LoggerModuleToken);
        await loggerModule.onStart?.(this);
        this._logger = loggerModule.logger;
        this._logger.info({ state: this._state }, 'Application starting');
        this.emit('module:started', { module: loggerModule.name });
      }

      // Register and start modules in dependency order
      const sortedModules = this.sortModulesByDependencies();
      

      for (const entry of sortedModules) {
        const [token, module] = entry;
        this._logger?.debug({ module: module.name }, 'Starting module');

        // Register module
        if (module.onRegister) {
          await module.onRegister(this);
        }

        // Start module
        if (module.onStart) {
          await module.onStart(this);
        }

        this.emit('module:started', { module: module.name });
        this._logger?.debug({ module: module.name }, 'Module started');
      }

      // Run start hooks
      for (const hook of this._startHooks) {
        this._logger?.debug({ hook: hook.name }, 'Running start hook');

        const promise = Promise.resolve(hook.handler());
        if (hook.timeout) {
          await this.withTimeout(promise, hook.timeout, `Start hook ${hook.name || 'unnamed'} timed out`);
        } else {
          await promise;
        }
      }

      this._state = ApplicationState.Started;
      this.emit('started');

      this._logger?.info(
        {
          state: this._state,
          startupTime: this.uptime,
          modules: Array.from(this._modules.values()).map(m => m.name)
        },
        'Application started successfully'
      );
    } catch (error: any) {
      this._state = ApplicationState.Failed;
      this._logger?.error({ error }, 'Application failed to start');
      this.handleError(error);
      throw error;
    }
  }

  /**
   * Stop the application
   */
  async stop(options: ShutdownOptions = {}): Promise<void> {
    if (this._state !== ApplicationState.Started) {
      return;
    }

    this._state = ApplicationState.Stopping;
    this._logger?.info({ options }, 'Application stopping');

    try {
      // Emit stopping event
      this.emit('stopping');

      // Run stop hooks first (in reverse order of registration)
      for (let i = this._stopHooks.length - 1; i >= 0; i--) {
        const hook = this._stopHooks[i];
        if (!hook) continue;
        this._logger?.debug({ hook: hook.name }, 'Running stop hook');

        const promise = Promise.resolve(hook.handler());
        if (hook.timeout) {
          await this.withTimeout(promise, hook.timeout, `Stop hook ${hook.name || 'unnamed'} timed out`);
        } else {
          await promise;
        }
      }

      // Stop modules in reverse dependency order
      const sortedModules = this.sortModulesByDependencies();

      for (let i = sortedModules.length - 1; i >= 0; i--) {
        const entry = sortedModules[i];
        if (!entry) continue;
        const [token, module] = entry;

        this._logger?.debug({ module: module.name }, 'Stopping module');

        if (module.onStop) {
          const promise = Promise.resolve(module.onStop(this));
          if (options.timeout) {
            await this.withTimeout(promise, options.timeout, `Module ${module.name} stop timed out`);
          } else {
            await promise;
          }
        }

        if (module.onDestroy) {
          await module.onDestroy();
        }

        this.emit('module:stopped', { module: module.name });
        this._logger?.debug({ module: module.name }, 'Module stopped');
      }

      // Log successful stop before stopping core modules
      this._logger?.info('Application stopped successfully');
      
      // Stop logger first among core modules
      if (this.has(LoggerModuleToken)) {
        const loggerModule = this.getModule(LoggerModuleToken);
        this._logger?.debug({ module: loggerModule.name }, 'Stopping module');
        await loggerModule.onStop?.(this);
        this.emit('module:stopped', { module: loggerModule.name });
      }
      
      // Stop config module last
      if (this.has(ConfigModuleToken)) {
        const configModule = this.getModule(ConfigModuleToken);
        await configModule.onStop?.(this);
        this.emit('module:stopped', { module: configModule.name });
      }
      
      // Clean up shutdown handlers before setting state
      this.cleanupShutdownHandlers();
      
      // Give pino-pretty time to flush output
      await new Promise(resolve => setImmediate(resolve));
      
      this._state = ApplicationState.Stopped;
      this.emit('stopped');
    } catch (error: any) {
      this._state = ApplicationState.Failed;
      this._logger?.error({ error }, 'Error during application stop');

      if (options.force) {
        this._logger?.warn('Force stopping application');
        process.exit(1);
      }

      throw error;
    }
  }

  /**
   * Restart the application
   */
  async restart(): Promise<void> {
    this._logger?.info('Restarting application');
    await this.stop();
    await this.start();
  }

  /**
   * Replace a core module with a custom implementation
   * This method ensures the replacement happens before the app starts
   */
  replaceModule<T extends Module>(token: Token<T>, module: T): this {
    if (this._isStarted) {
      throw new Error('Cannot replace modules after application has started');
    }

    // Remove old module if exists
    if (this._modules.has(token)) {
      this._modules.delete(token);
    }

    // Unregister from container if exists (using internal method)
    if (this._container.has(token)) {
      const providers = (this._container as any)['_providers'] || (this._container as any)['providers'];
      if (providers && providers instanceof Map) {
        providers.delete(token);
      }
    }

    // Register the new module with override option
    this._container.register(token, {
      useValue: module
    }, { override: true });
    this._modules.set(token, module);

    return this;
  }

  /**
   * Register a module - supports various module input types
   */
  async registerModule(moduleInput: ModuleInput): Promise<Module> {
    let moduleInstance: Module;
    let dynamicModule: DynamicModule | null = null;

    // Resolve the module input to an instance
    if (typeof moduleInput === 'function') {
      // Check if it's a class constructor
      if (moduleInput.prototype && moduleInput.prototype.constructor === moduleInput) {
        const ModuleClass = moduleInput as ModuleConstructor;

        // Check for static forRoot method
        if ((ModuleClass as any).forRoot && typeof (ModuleClass as any).forRoot === 'function') {
          // This is a static module with forRoot - call it to get dynamic module
          dynamicModule = (ModuleClass as any).forRoot();
          moduleInstance = new ModuleClass();
        } else {
          // Regular module class - instantiate it
          moduleInstance = new ModuleClass();
        }
      } else {
        // Factory function - execute it
        const factoryFn = moduleInput as (() => Module | Promise<Module> | DynamicModule | Promise<DynamicModule>);
        const result = await factoryFn();
        if (this.isDynamicModule(result)) {
          dynamicModule = result;
          const ModuleClass = dynamicModule.module;
          moduleInstance = new ModuleClass();
        } else {
          moduleInstance = result as Module;
        }
      }
    } else if (this.isDynamicModule(moduleInput)) {
      // Dynamic module object
      dynamicModule = moduleInput;
      const ModuleClass = dynamicModule.module;
      moduleInstance = new ModuleClass();
    } else {
      // Regular module instance
      moduleInstance = moduleInput as Module;
    }

    // Create token for the module
    const token = createToken<Module>(moduleInstance.name);

    // Register module in container
    if (!this._container.has(token)) {
      this._container.register(token, {
        useValue: moduleInstance
      });
    }

    // Store module
    this._modules.set(token, moduleInstance);

    // Process dynamic module providers if present
    if (dynamicModule) {
      await this.processDynamicModule(dynamicModule, moduleInstance);
    }

    // Configure module if config is available
    if (moduleInstance.configure && this._config[moduleInstance.name]) {
      moduleInstance.configure(this._config[moduleInstance.name]);
    }

    this.emit('module:registered', { module: moduleInstance.name });

    return moduleInstance;
  }

  /**
   * Legacy use method - wraps registerModule for backward compatibility
   */
  use<T extends Module>(module: T | Token<T>): this {
    if (typeof module === 'object' && 'symbol' in module && 'id' in module) {
      // Token provided - resolve from container
      const token = module as Token<T>;
      const moduleInstance = this._container.resolve(token);
      this._modules.set(token, moduleInstance);
    } else {
      // Module instance - register it
      this.registerModule(module as Module).catch(err => {
        this._logger?.error({ error: err }, 'Failed to register module');
        this.handleError(err);
      });
    }

    return this;
  }

  /**
   * Get a module
   */
  getModule<T extends Module>(token: Token<T>): T {
    if (!this._modules.has(token)) {
      // Try to resolve from container
      try {
        const module = this._container.resolve(token);
        if (module) {
          this._modules.set(token, module);
          return module;
        }
      } catch {
        // Module not found
      }

      throw new Error(`Module not found: ${token.name}`);
    }

    return this._modules.get(token) as T;
  }

  /**
   * Check if a module is registered
   */
  has(token: Token<any>): boolean {
    return this._modules.has(token) || this._container.has(token);
  }

  /**
   * Get configuration value
   */
  config<K extends keyof ApplicationConfig>(key: K): ApplicationConfig[K] {
    return this._config[key];
  }

  /**
   * Register event handler
   */
  on<E extends ApplicationEvent>(event: E, handler: EventHandler): void {
    this._eventEmitter.on(event, handler);
  }

  /**
   * Unregister event handler
   */
  off<E extends ApplicationEvent>(event: E, handler?: EventHandler): void {
    if (handler) {
      this._eventEmitter.off(event, handler);
    } else {
      this._eventEmitter.removeAllListeners(event);
    }
  }

  /**
   * Register one-time event handler
   */
  once<E extends ApplicationEvent>(event: E, handler: EventHandler): void {
    this._eventEmitter.once(event, handler);
  }

  /**
   * Emit event
   */
  emit<E extends ApplicationEvent>(event: E, data?: any): void {
    const meta: EventMeta = {
      event,
      timestamp: Date.now(),
      source: 'application'
    };

    // Handle error events specially
    if (event === 'error' && data instanceof Error) {
      // Call error handlers
      for (const handler of this._errorHandlers) {
        try {
          handler(data);
        } catch (err) {
          console.error('Error in error handler:', err);
        }
      }
    }

    this._eventEmitter.emit(event, data, meta);
  }

  /**
   * Register start hook
   */
  onStart(hook: LifecycleHook | (() => void | Promise<void>)): this {
    if (typeof hook === 'function') {
      this._startHooks.push({
        handler: hook,
        priority: 100
      });
    } else {
      this._startHooks.push(hook);
    }

    // Sort by priority
    this._startHooks.sort((a, b) => (a.priority || 100) - (b.priority || 100));
    return this;
  }

  /**
   * Register stop hook
   */
  onStop(hook: LifecycleHook | (() => void | Promise<void>)): this {
    if (typeof hook === 'function') {
      this._stopHooks.push({
        handler: hook,
        priority: 100
      });
    } else {
      this._stopHooks.push(hook);
    }

    // Sort by priority
    this._stopHooks.sort((a, b) => (a.priority || 100) - (b.priority || 100));
    return this;
  }

  /**
   * Register error handler
   */
  onError(handler: (error: Error) => void): this {
    this._errorHandlers.push(handler);
    return this;
  }

  /**
   * Configure application settings
   */
  configure<T = any>(config: T): this {
    // Merge configuration options
    Object.assign(this._config, config);

    // Apply logger configuration if provided
    const options = config as any;
    if (options.logger && this.has(LoggerModuleToken)) {
      const loggerModule = this.getModule(LoggerModuleToken);
      if (loggerModule && typeof loggerModule.configure === 'function') {
        loggerModule.configure(options.logger);
      }
    }

    // Apply event configuration if provided
    if (options.events && this._eventEmitter) {
      // Apply event emitter configuration
      // Note: Our EventEmitter doesn't have setMaxListeners, store in config
      if (options.events.maxListeners) {
        (this._config as any).events = {
          ...(this._config as any).events,
          maxListeners: options.events.maxListeners
        };
      }
    }

    this.emit('config:changed', config);
    return this;
  }

  /**
   * Get application state
   */
  get state(): ApplicationState {
    return this._state;
  }

  /**
   * Get uptime in milliseconds
   */
  get uptime(): number {
    return this._startTime ? Date.now() - this._startTime : 0;
  }

  /**
   * Get environment information
   */
  get environment(): Environment {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      pid: process.pid,
      ppid: process.ppid
    };
  }

  /**
   * Get application metrics
   */
  get metrics(): ApplicationMetrics {
    return {
      uptime: this.uptime,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    };
  }

  /**
   * Get the DI container - public API
   */
  get container(): Container {
    return this._container;
  }

  /**
   * Register a provider in the container - public API
   */
  register<T>(token: Token<T>, provider: any, options?: { override?: boolean }): this {
    this._container.register(token, provider, options);
    return this;
  }

  /**
   * Resolve a dependency from the container - public API
   */
  resolve<T>(token: Token<T>): T {
    return this._container.resolve(token);
  }

  /**
   * Get a dependency from the container - tries modules first, then container
   */
  get<T>(token: Token<T>): T {
    // First check if it's a module
    if (this._modules.has(token)) {
      return this._modules.get(token) as T;
    }

    // Try to resolve from container
    try {
      const resolved = this._container.resolve(token);
      // If it's a module-like object, cache it
      if (resolved && typeof resolved === 'object' && 'name' in resolved) {
        this._modules.set(token, resolved as any);
      }
      return resolved;
    } catch (error) {
      // Provide a better error message
      throw new Error(`Module not found: ${token.name || token.toString()}`);
    }
  }

  /**
   * Check if a token is registered in the container - public API
   */
  hasProvider(token: Token<any>): boolean {
    return this._container.has(token);
  }

  // Private methods

  private registerCoreModules(): void {
    // Always register config module if not already registered
    if (!this._container.has(ConfigModuleToken)) {
      const configModule = new ConfigModule();

      // Initialize config module with all config data if provided
      const hasConfigData = this._config && Object.keys(this._config).length > 0;
      if (hasConfigData) {
        // If there's a nested 'config' object, use it; otherwise use the whole config
        const configData = this._config.config || this._config;
        configModule.merge(configData);
      }

      this._container.register(ConfigModuleToken, {
        useValue: configModule
      });
      this._modules.set(ConfigModuleToken, configModule);
    }

    // Always register logger module if not already registered
    if (!this._container.has(LoggerModuleToken)) {
      const loggerModule = new LoggerModule();

      // Apply logger configuration if provided
      const loggerConfig = this._config?.logger || this._config?.logging;
      if (loggerConfig && typeof loggerConfig === 'object') {
        loggerModule.configure(loggerConfig);
      } else if (this._config?.debug) {
        loggerModule.configure({ level: 'debug', prettyPrint: true });
      } else {
        // Default configuration for testing/development
        loggerModule.configure({ level: 'error', prettyPrint: false });
      }

      this._container.register(LoggerModuleToken, {
        useValue: loggerModule
      });
      this._modules.set(LoggerModuleToken, loggerModule);
    }
  }

  private sortModulesByDependencies(): Array<[Token<any>, Module]> {
    const sorted: Array<[Token<any>, Module]> = [];
    const visited = new Set<Token<any>>();
    const visiting = new Set<Token<any>>();

    const visit = (token: Token<any>) => {
      if (visited.has(token)) {
        return;
      }

      if (visiting.has(token)) {
        throw new Error(`Circular dependency detected in module: ${token.name}`);
      }

      visiting.add(token);

      const module = this._modules.get(token);
      if (module && module.dependencies) {
        for (const dep of module.dependencies) {
          if (this._modules.has(dep)) {
            visit(dep);
          }
        }
      }

      visiting.delete(token);
      visited.add(token);

      if (module) {
        sorted.push([token, module]);
      }
    };

    // Visit all modules
    for (const token of this._modules.keys()) {
      // Skip config and logger modules as they are handled separately
      if (token === ConfigModuleToken || token === LoggerModuleToken) {
        continue;
      }
      visit(token);
    }

    return sorted;
  }

  private setupGracefulShutdown(timeout: number): void {
    const shutdown = async (signal: NodeJS.Signals) => {
      // Only shutdown if we're in a started state
      if (this._state !== ApplicationState.Started) {
        return;
      }
      
      this._logger?.info({ signal }, 'Received shutdown signal');

      try {
        await this.stop({ timeout, signal });
        // Try to exit with success code
        try {
          process.exit(0);
        } catch (mockError) {
          // Ignore error from mocked process.exit in tests
        }
      } catch (error: any) {
        this._logger?.error({ error }, 'Error during graceful shutdown');
        // Try to exit with error code
        try {
          process.exit(1);
        } catch (mockError) {
          // Ignore error from mocked process.exit in tests
        }
      }
    };

    // Create handlers that we can later remove
    const sigtermHandler = () => shutdown('SIGTERM');
    const sigintHandler = () => shutdown('SIGINT');
    
    const uncaughtExceptionHandler = (error: Error) => {
      this._logger?.fatal({ error }, 'Uncaught exception');
      this.handleError(error);
      try {
        process.exit(1);
      } catch (mockError) {
        // Ignore error from mocked process.exit in tests
      }
    };
    
    const unhandledRejectionHandler = (reason: any, promise: Promise<any>) => {
      this._logger?.fatal({ reason, promise }, 'Unhandled rejection');
      this.handleError(new Error(`Unhandled rejection: ${reason}`));
      try {
        process.exit(1);
      } catch (mockError) {
        // Ignore error from mocked process.exit in tests
      }
    };

    // Store handlers for later cleanup
    this._shutdownHandlers.set('SIGTERM', sigtermHandler);
    this._shutdownHandlers.set('SIGINT', sigintHandler);
    this._shutdownHandlers.set('uncaughtException', uncaughtExceptionHandler);
    this._shutdownHandlers.set('unhandledRejection', unhandledRejectionHandler);

    // Handle various shutdown signals
    process.on('SIGTERM', sigtermHandler);
    process.on('SIGINT', sigintHandler);

    // Handle uncaught errors
    process.on('uncaughtException', uncaughtExceptionHandler);
    process.on('unhandledRejection', unhandledRejectionHandler);
  }
  
  private cleanupShutdownHandlers(): void {
    // Only cleanup if handlers were registered
    if (this._shutdownHandlers.size === 0) {
      return;
    }
    
    // Remove all registered handlers
    const sigtermHandler = this._shutdownHandlers.get('SIGTERM');
    const sigintHandler = this._shutdownHandlers.get('SIGINT');
    const uncaughtHandler = this._shutdownHandlers.get('uncaughtException');
    const unhandledHandler = this._shutdownHandlers.get('unhandledRejection');
    
    if (sigtermHandler) process.removeListener('SIGTERM', sigtermHandler);
    if (sigintHandler) process.removeListener('SIGINT', sigintHandler);
    if (uncaughtHandler) process.removeListener('uncaughtException', uncaughtHandler);
    if (unhandledHandler) process.removeListener('unhandledRejection', unhandledHandler);
    
    this._shutdownHandlers.clear();
  }

  /**
   * Check if an object is a DynamicModule
   */
  private isDynamicModule(obj: any): obj is DynamicModule {
    return obj && typeof obj === 'object' && 'module' in obj && typeof obj.module === 'function';
  }

  /**
   * Process a dynamic module's providers and imports
   */
  private async processDynamicModule(dynamicModule: DynamicModule, moduleInstance: Module): Promise<void> {
    // Process imports first
    if (dynamicModule.imports) {
      for (const importModule of dynamicModule.imports) {
        await this.registerModule(importModule);
      }
    }

    // Register providers
    if (dynamicModule.providers) {
      for (const provider of dynamicModule.providers) {
        await this.registerProvider(provider);
      }
    }

    // Mark exports as global if specified
    if (dynamicModule.global && dynamicModule.exports) {
      // Store global exports for later access
      (moduleInstance as any).__globalExports = dynamicModule.exports;
    }
  }

  /**
   * Register a provider in the container
   */
  private async registerProvider(provider: Provider): Promise<void> {
    const { provide: token, useClass, useValue, useFactory, inject, scope } = provider;

    let registration: any;

    if (useClass) {
      registration = {
        useClass,
        scope: scope || 'singleton'
      };
    } else if (useValue !== undefined) {
      registration = { useValue };
    } else if (useFactory) {
      // Check if the factory returns a promise (async factory)
      const isAsyncFactory = async (fn: Function) => {
        try {
          // Test with empty args to check if it returns a promise
          const testResult = fn();
          return testResult && typeof testResult.then === 'function';
        } catch {
          return false;
        }
      };

      // For async factories, resolve the value eagerly and register as useValue
      if (await isAsyncFactory(useFactory)) {
        let value: any;
        if (inject && inject.length > 0) {
          const deps = inject.map(depToken => this._container.resolve(depToken));
          value = await useFactory(...deps);
        } else {
          value = await useFactory();
        }
        registration = { useValue: value };
      } else {
        // Synchronous factory - handle injection properly
        if (inject && inject.length > 0) {
          // Create a factory that resolves dependencies and calls the original factory
          registration = {
            useFactory: (...args: any[]) => {
              // If args are provided, use them (from Nexus container)
              // Otherwise resolve dependencies manually
              if (args.length > 0) {
                return useFactory(...args);
              }
              const deps = inject.map(depToken => this._container.resolve(depToken));
              return useFactory(...deps);
            },
            inject // Also pass the inject array to Nexus
          };
        } else {
          registration = { useFactory };
        }
      }
    } else {
      // Invalid provider, skip
      return;
    }

    // Override any existing registration
    this._container.register(token, registration, { override: true });
  }

  private handleError(error: Error): void {
    // Just emit the error event, which will trigger error handlers
    this.emit('error', error);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    message: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(message)), timeout);
      })
    ]);
  }
}

/**
 * Create a new Titan application
 */
export function createApp(options?: ApplicationOptions): Application {
  return new Application(options);
}

/**
 * Create and start an application
 */
export async function startApp(options?: ApplicationOptions): Promise<Application> {
  const app = createApp(options);
  await app.start();
  return app;
}