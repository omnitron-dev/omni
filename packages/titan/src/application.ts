/**
 * Titan Application - Core application kernel
 */

import os from 'node:os';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Token, Container, createToken, InjectionToken, Provider } from '@omnitron-dev/nexus';

import { ConfigModule, CONFIG_SERVICE_TOKEN } from './modules/config/index.js';
import { LoggerModule, LOGGER_SERVICE_TOKEN } from './modules/logger/index.js';
import type { ILogger, ILoggerModule } from './modules/logger/index.js';
import {
  IModule,
  IEventMeta,
  ModuleInput,
  IEnvironment,
  IApplication,
  EventHandler,
  ILifecycleHook,
  IDynamicModule,
  IShutdownOptions,
  ApplicationState,
  ApplicationEvent,
  ModuleConstructor,
  IApplicationConfig,
  IApplicationMetrics,
  IApplicationOptions,
  IShutdownTask,
  ShutdownReason,
  ProcessSignal,
  ShutdownPriority,
  LifecycleState,
  IProcessMetrics
} from './types.js';

/**
 * Application token for DI
 */
export const ApplicationToken: Token<Application> = createToken<Application>('Application');

/**
 * Titan Application implementation
 */
export class Application implements IApplication {
  private _isStarted = false;
  private _state: ApplicationState = ApplicationState.Created;
  private _container: Container;
  private _config: IApplicationConfig;
  private _startTime: number = 0;
  private _eventEmitter = new EventEmitter();
  private _modules = new Map<Token<any>, IModule>();
  private _startHooks: ILifecycleHook[] = [];
  private _stopHooks: ILifecycleHook[] = [];
  private _errorHandlers: ((error: Error) => void)[] = [];
  private _logger?: ILogger;

  // Process lifecycle management
  private _shutdownTasks = new Map<string, IShutdownTask>();
  private _signalHandlers = new Map<string, (...args: any[]) => any>();
  private _cleanupHandlers = new Set<() => Promise<void> | void>();
  private _isShuttingDown = false;
  private _shutdownPromise: Promise<void> | null = null;
  private _lifecycleState: LifecycleState = LifecycleState.Created;
  private _disableProcessExit = false;
  private _shutdownTimeout = 30000;

  /**
   * Static factory method for creating application instance
   * Supports multiple usage patterns for maximum flexibility
   */
  static async create(options?: IApplicationOptions & {
    modules?: ModuleInput[];
    imports?: Token<IModule>[];  // Support direct imports like AppModule had
    providers?: Array<[InjectionToken<any>, Provider<any>]>;      // Support direct providers
    autoDiscovery?: boolean;       // Enable automatic module discovery
    scanPaths?: string[];         // Paths to scan for modules
  }): Promise<Application> {
    const app = new Application(options);

    // Register core modules properly with forRoot pattern
    if (!options?.disableCoreModules) {
      await app.initializeCoreModules();
    }

    // Auto-discovery mode - automatically find and register @Module decorated classes
    if (options?.autoDiscovery) {
      const discoveredModules = await app.discoverModules(options.scanPaths);
      for (const module of discoveredModules) {
        await app.registerModule(module);
      }
    }

    // Register modules passed via modules array
    if (options?.modules) {
      for (const moduleInput of options.modules) {
        await app.registerModule(moduleInput);
      }
    }

    // Support imports like the old AppModule pattern
    if (options?.imports) {
      for (const moduleToken of options.imports) {
        await app.registerModule(moduleToken);
      }
    }

    // Register direct providers if provided
    if (options?.providers) {
      // Create an anonymous root module to hold these providers
      const rootModule = {
        name: 'RootContext',
        providers: options.providers,
        onRegister: () => { },
        onStart: () => { },
        onStop: () => { },
      };
      const rootToken = createToken<IModule>('RootContext');
      app._modules.set(rootToken, rootModule);

      // Register providers in container
      for (const provider of options.providers) {
        // Provider is in tuple format [token, providerDef]
        const [token, providerDef] = provider;
        app._container.register(token, providerDef);
      }
    }

    return app;
  }

  constructor(options: IApplicationOptions = {}) {
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
    this._shutdownTimeout = options.gracefulShutdownTimeout || 30000;

    // Note: Core modules are registered asynchronously in the static create method

    // Setup process lifecycle management
    if (!options.disableGracefulShutdown) {
      this._disableProcessExit = options['environment'] === 'test' || process.env['NODE_ENV'] === 'test' || process.env['JEST_WORKER_ID'] !== undefined;
      this.setupProcessLifecycle();
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

      // Config module initialization is handled in registerCoreModules

      // Initialize logger after config if available
      if (this._container.has(LOGGER_SERVICE_TOKEN)) {
        try {
          const loggerService = this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
          this._logger = loggerService.logger;
          this._logger.info({ state: this._state }, 'Application starting');
          this.emit('module:started', { module: 'logger' });
        } catch {
          // Logger not found
        }
      }

      // Setup signal handlers and error handlers
      this.setupSignalHandlers();
      this.setupErrorHandlers();

      // Register any pending shutdown tasks
      if (global.__titanShutdownTasks) {
        for (const task of global.__titanShutdownTasks) {
          this.registerShutdownTask(task);
        }
        delete global.__titanShutdownTasks;
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
  async stop(options: IShutdownOptions = {}): Promise<void> {
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
      if (this._container.has(LOGGER_SERVICE_TOKEN)) {
        try {
          const loggerService = this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
          this._logger?.debug({ module: 'logger' }, 'Stopping module');
          // Logger service doesn't need explicit stop
          this.emit('module:stopped', { module: 'logger' });
        } catch {
          // Logger not found
        }
      }

      // Config module shutdown is handled separately

      // Cleanup signal handlers if this is not being called from shutdown
      if (!this._isShuttingDown) {
        this.cleanupSignalHandlers();
      }

      // Give pino-pretty time to flush output
      await new Promise(resolve => setImmediate(resolve));

      this._state = ApplicationState.Stopped;
      this._lifecycleState = LifecycleState.Stopped;
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
  replaceModule<T extends IModule>(token: Token<T>, module: T): this {
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
  async registerModule(moduleInput: ModuleInput): Promise<IModule> {
    let moduleInstance: IModule;
    let dynamicModule: IDynamicModule | null = null;

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
        const factoryFn = moduleInput as (() => IModule | Promise<IModule> | IDynamicModule | Promise<IDynamicModule>);
        const result = await factoryFn();
        if (this.isDynamicModule(result)) {
          dynamicModule = result;
          const ModuleClass = dynamicModule.module;
          moduleInstance = new ModuleClass();
        } else {
          moduleInstance = result as IModule;
        }
      }
    } else if (this.isDynamicModule(moduleInput)) {
      // Dynamic module object
      dynamicModule = moduleInput;
      const ModuleClass = dynamicModule.module;
      moduleInstance = new ModuleClass();
    } else {
      // Regular module instance
      moduleInstance = moduleInput as IModule;
    }

    // Ensure module has a name - use class name or metadata
    let moduleName = moduleInstance.name;
    if (!moduleName) {
      // Try to get from metadata
      const metadata = Reflect.getMetadata('module', moduleInput) ||
        Reflect.getMetadata('module:metadata', moduleInput) ||
        (moduleInput as any).__titanModuleMetadata;

      if (metadata?.name) {
        moduleName = metadata.name;
      } else if (typeof moduleInput === 'function') {
        // Use constructor name as fallback
        moduleName = moduleInput.name || 'UnnamedModule';
      } else {
        moduleName = 'UnnamedModule';
      }

      // Create a new module instance with the correct name
      moduleInstance = {
        ...moduleInstance,
        name: moduleName
      };
    }

    // Create token for the module
    const token = createToken<IModule>(moduleInstance.name);

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
   * Use a module - wraps registerModule for convenience
   */
  use<T extends IModule>(module: T | Token<T>): this {
    if (typeof module === 'object' && 'symbol' in module && 'id' in module) {
      // Token provided - resolve from container
      const token = module as Token<T>;
      const moduleInstance = this._container.resolve(token);
      this._modules.set(token, moduleInstance);
    } else {
      // Module instance - register it
      this.registerModule(module as IModule).catch(err => {
        this._logger?.error({ error: err }, 'Failed to register module');
        this.handleError(err);
      });
    }

    return this;
  }

  /**
   * Get a module
   */
  getModule<T extends IModule>(token: Token<T>): T {
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
  config<K extends keyof IApplicationConfig>(key: K): IApplicationConfig[K] {
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
    const meta: IEventMeta = {
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
          if (this._logger) {
            this._logger.error('Error in error handler:', err);
          } else {
            console.error('Error in error handler:', err);
          }
        }
      }
    }

    this._eventEmitter.emit(event, data, meta);
  }

  /**
   * Register start hook
   */
  onStart(hook: ILifecycleHook | (() => void | Promise<void>)): this {
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
  onStop(hook: ILifecycleHook | (() => void | Promise<void>)): this {
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
    if (options.logger && this._container.has(LOGGER_SERVICE_TOKEN)) {
      try {
        const loggerService = this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
        // Logger service configuration is handled via forRoot pattern now
        // We could add a reconfigure method if needed
      } catch {
        // Logger not found
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
  get environment(): IEnvironment {
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
  get metrics(): IApplicationMetrics {
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

  /**
   * Get the logger instance
   */
  get logger(): ILogger | undefined {
    if (!this._logger && this._container.has(LOGGER_SERVICE_TOKEN)) {
      try {
        const loggerService = this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
        this._logger = loggerService.logger;
      } catch {
        // Logger not found
      }
    }
    return this._logger;
  }

  // Private methods

  private async initializeCoreModules(): Promise<void> {
    // 1. First, register Logger module (it initializes immediately)
    if (!this._container.has(LOGGER_SERVICE_TOKEN)) {
      // Get logger configuration from application config
      const loggerConfig = this._config?.logger || this._config?.logging || {};
      const loggerOptions = {
        ...loggerConfig,
        level: loggerConfig.level || (this._config?.debug ? 'debug' : 'info'),
        prettyPrint: loggerConfig.prettyPrint ?? (this._config?.environment === 'development'),
        name: this._config?.name || 'titan-app'
      };

      // Register Logger module with forRoot pattern
      const loggerModuleConfig = LoggerModule.forRoot(loggerOptions);
      await this.registerDynamicModule(loggerModuleConfig);

      // Get logger service for internal use
      try {
        const loggerService = await this._container.resolveAsync(LOGGER_SERVICE_TOKEN) as ILoggerModule;
        this._logger = loggerService.logger;
        this._logger.info({ module: 'Application' }, 'Logger module initialized');
      } catch (error) {
        console.error('[Application] Failed to resolve logger service:', error);
      }
    }

    // 2. Then, register Config module if not already registered
    if (!this._container.has(CONFIG_SERVICE_TOKEN)) {
      // Register Config module with forRoot pattern
      const configOptions = {
        sources: [
          { type: 'object' as const, data: this._config },
          { type: 'env' as const }
        ]
      };

      const configModuleConfig = ConfigModule.forRoot(configOptions);
      await this.registerDynamicModule(configModuleConfig);

      // Initialize ConfigService immediately after registration
      try {
        this._logger?.debug({ module: 'Application' }, 'Attempting to resolve ConfigService...');
        const configService = await this._container.resolveAsync(CONFIG_SERVICE_TOKEN) as any;
        this._logger?.debug({ module: 'Application', hasService: !!configService }, 'ConfigService resolved');

        if (configService && typeof configService.initialize === 'function') {
          await configService.initialize();
          this._logger?.debug({ module: 'Application' }, 'ConfigService initialized');
        } else if (configService) {
          this._logger?.debug({ module: 'Application' }, 'ConfigService does not need initialization');
        }
      } catch (error) {
        this._logger?.warn({ module: 'Application', error }, 'Failed to initialize ConfigService');
      }
    }
  }

  /**
   * Register a dynamic module (with forRoot pattern)
   */
  private async registerDynamicModule(moduleConfig: any): Promise<void> {
    const { module: ModuleClass, providers = [], exports = [] } = moduleConfig;

    // Register providers
    for (const provider of providers) {
      if (Array.isArray(provider) && provider.length === 2) {
        const [token, providerDef] = provider;
        try {
          this._container.register(token, providerDef);
          this._logger?.debug({
            module: 'Application',
            tokenName: token?.name || token?.toString()
          }, 'Provider registered');
        } catch (error) {
          this._logger?.error({
            module: 'Application',
            tokenName: token?.name || token?.toString(),
            error
          }, 'Failed to register provider');
          throw error;
        }
      }
    }

    // Store module metadata for exports
    if (ModuleClass && exports.length > 0) {
      // Module exports are already handled by the container
      this._logger?.debug({ module: 'Application' }, 'Dynamic module registered', {
        module: ModuleClass.name,
        providers: providers.length,
        exports: exports.map((t: any) => t.name || t.toString())
      });
    }
  }

  private sortModulesByDependencies(): Array<[Token<any>, IModule]> {
    const sorted: Array<[Token<any>, IModule]> = [];
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
          // Check if dependency is a token or a string name
          let depToken: Token<any> | undefined;

          if (typeof dep === 'string') {
            // Find the token by module name
            for (const [t, m] of this._modules.entries()) {
              if (m.name === dep) {
                depToken = t;
                break;
              }
            }
          } else {
            // It's already a token, try to find it
            depToken = dep;
            // If the token isn't in our modules, try to find by its name
            if (depToken && !this._modules.has(depToken)) {
              const depName = depToken.name; // Use the string name, not the symbol id
              for (const [t, m] of this._modules.entries()) {
                if (m.name === depName) {
                  depToken = t;
                  break;
                }
              }
            }
          }

          if (depToken && this._modules.has(depToken)) {
            visit(depToken);
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
      // Skip logger module as it is handled separately
      if (token === LOGGER_SERVICE_TOKEN) {
        continue;
      }
      visit(token);
    }

    return sorted;
  }

  private setupProcessLifecycle(): void {
    // Register default shutdown tasks
    this.registerDefaultShutdownTasks();

    this._logger?.debug('Process lifecycle management initialized');
  }

  /**
   * Setup signal handlers
   */
  private setupSignalHandlers(): void {
    const signals: ProcessSignal[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

    for (const signal of signals) {
      const handler = () => this.handleSignal(signal);
      this._signalHandlers.set(signal, handler);
      process.on(signal as any, handler);
      this._logger?.debug({ signal }, 'Registered signal handler');
    }
  }

  /**
   * Setup error handlers
   */
  private setupErrorHandlers(): void {
    // Uncaught exception handler
    const uncaughtHandler = (error: Error) => {
      this._logger?.fatal({ error }, 'Uncaught exception');
      this.emit('uncaughtException', { error });

      this.shutdown(ShutdownReason.UncaughtException, { error }).catch(err => {
        this._logger?.fatal({ error: err }, 'Failed to handle uncaught exception');
        this.exitProcess(1);
      });
    };

    this._signalHandlers.set('uncaughtException', uncaughtHandler);
    process.on('uncaughtException', uncaughtHandler);

    // Unhandled rejection handler
    const rejectionHandler = (reason: any, promise: Promise<any>) => {
      this._logger?.error({ reason, promise }, 'Unhandled promise rejection');
      this.emit('unhandledRejection', { reason, promise });

      // Only shutdown if not in test environment
      if (!this._disableProcessExit) {
        this.shutdown(ShutdownReason.UnhandledRejection, { reason, promise }).catch(error => {
          this._logger?.fatal({ error }, 'Failed to handle unhandled rejection');
          this.exitProcess(1);
        });
      }
    };

    this._signalHandlers.set('unhandledRejection', rejectionHandler);
    process.on('unhandledRejection', rejectionHandler);
  }

  /**
   * Handle process signal
   */
  private handleSignal(signal: ProcessSignal): void {
    this._logger?.info({ signal }, `Received ${signal} signal, initiating graceful shutdown...`);
    this.emit('signal', { signal });

    let reason: ShutdownReason;
    switch (signal) {
      case 'SIGTERM':
        reason = ShutdownReason.SIGTERM;
        break;
      case 'SIGINT':
        reason = ShutdownReason.SIGINT;
        break;
      case 'SIGHUP':
        reason = ShutdownReason.Reload;
        break;
      default:
        reason = ShutdownReason.Signal;
    }

    this.shutdown(reason, { signal }).catch(error => {
      this._logger?.fatal({ error }, 'Failed to handle signal');
      this.exitProcess(1);
    });
  }

  /**
   * Register default shutdown tasks
   */
  private registerDefaultShutdownTasks(): void {
    // Flush logs
    this.registerShutdownTask({
      id: 'flush-logs',
      name: 'Flush Logs',
      priority: ShutdownPriority.Last,
      handler: async () => {
        this._logger?.info('Flushing logs...');

        // Flush the logger properly if available
        if (this._container.has(LOGGER_SERVICE_TOKEN)) {
          try {
            const loggerService = this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
            if (loggerService && typeof loggerService.flush === 'function') {
              await loggerService.flush();
              this._logger?.info('Logs flushed successfully');
            }
          } catch (error) {
            this._logger?.warn({ error }, 'Failed to flush logger');
          }
        }

        // Also wait a bit to ensure everything is written
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });

    // Close connections
    this.registerShutdownTask({
      id: 'close-connections',
      name: 'Close Active Connections',
      priority: ShutdownPriority.High,
      handler: async () => {
        this._logger?.info('Closing active connections');
      }
    });

    // Save state
    this.registerShutdownTask({
      id: 'save-state',
      name: 'Save Application State',
      priority: ShutdownPriority.VeryHigh,
      handler: async () => {
        this._logger?.info('Saving application state');
        this.emit('state:save');
      }
    });
  }

  /**
   * Register a shutdown task
   */
  registerShutdownTask(task: IShutdownTask): void {
    if (!task.id) {
      task.id = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Set default priority if not provided
    if (task.priority === undefined) {
      task.priority = ShutdownPriority.Normal;
    }

    this._shutdownTasks.set(task.id, task);
    this._logger?.debug({ taskId: task.id, taskName: task.name }, 'Registered shutdown task');
  }

  /**
   * Unregister a shutdown task
   */
  unregisterShutdownTask(taskId: string): void {
    this._shutdownTasks.delete(taskId);
  }

  /**
   * Register a cleanup handler
   */
  registerCleanup(handler: () => Promise<void> | void): void {
    this._cleanupHandlers.add(handler);
  }

  /**
   * Perform graceful shutdown
   */
  async shutdown(reason: ShutdownReason, details?: any): Promise<void> {
    // Prevent multiple concurrent shutdowns
    if (this._isShuttingDown) {
      await this._shutdownPromise!;
      return;
    }

    this._isShuttingDown = true;
    this._lifecycleState = LifecycleState.ShuttingDown;

    this._logger?.info({ reason, details }, 'Starting graceful shutdown');
    this.emit('shutdown:start', { reason, details });

    // Create shutdown promise with timeout
    this._shutdownPromise = this.executeShutdown(reason, details);

    // Add timeout
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Shutdown timeout after ${this._shutdownTimeout}ms`));
      }, this._shutdownTimeout);
    });

    try {
      await Promise.race([this._shutdownPromise, timeoutPromise]);

      this._logger?.info('Graceful shutdown completed successfully');
      this.emit('shutdown:complete', { reason, success: true });

      // Exit process if configured
      if (reason !== ShutdownReason.Manual) {
        this.exitProcess(0);
      }
    } catch (error) {
      this._logger?.error({ error }, 'Graceful shutdown failed or timed out');
      this.emit('shutdown:error', { reason, error });

      // Force exit after additional timeout
      setTimeout(() => {
        this._logger?.fatal('Force killing process after timeout');
        this.exitProcess(1);
      }, 5000);

      throw error;
    }
  }

  /**
   * Execute shutdown tasks
   */
  private async executeShutdown(reason: ShutdownReason, details?: any): Promise<void> {
    // Sort tasks by priority (lower numbers first)
    const sortedTasks = Array.from(this._shutdownTasks.values())
      .sort((a, b) => (a.priority || 50) - (b.priority || 50));

    // Execute tasks in priority order
    for (const task of sortedTasks) {
      try {
        this._logger?.debug({ taskName: task.name }, 'Executing shutdown task');

        // Create task promise with optional timeout
        let taskPromise = Promise.resolve(task.handler(reason, details));

        if (task.timeout) {
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error(`Task timeout: ${task.name}`)), task.timeout);
          });
          taskPromise = Promise.race([taskPromise, timeoutPromise]);
        }

        await taskPromise;

        this._logger?.debug({ taskName: task.name }, 'Shutdown task completed');
        this.emit('shutdown:task:complete', { task: task.name });

      } catch (error) {
        this._logger?.error({ error, taskName: task.name }, 'Shutdown task failed');
        this.emit('shutdown:task:error', { task: task.name, error });

        // Continue with other tasks even if one fails
        if (task.critical) {
          // Critical task failed, abort shutdown
          throw new Error(`Critical shutdown task failed: ${task.name}`);
        }
      }
    }

    // Stop the application
    await this.stop({
      timeout: this._shutdownTimeout,
      signal: details?.signal
    });

    // Run cleanup handlers
    await this.runCleanupHandlers();
  }

  /**
   * Run cleanup handlers
   */
  private async runCleanupHandlers(): Promise<void> {
    for (const handler of this._cleanupHandlers) {
      try {
        await handler();
      } catch (error) {
        this._logger?.error({ error }, 'Cleanup handler failed');
      }
    }
    this._cleanupHandlers.clear();
  }

  /**
   * Exit process with code
   */
  private exitProcess(code: number): void {
    if (!this._disableProcessExit) {
      process.exit(code);
    } else {
      this._logger?.debug(`Process exit with code ${code} (disabled in test mode)`);
      this.emit('process:exit', { code });
    }
  }

  /**
   * Force immediate shutdown
   */
  forceShutdown(code: number = 1): void {
    this._logger?.fatal(`Force shutdown with code ${code}`);
    this.exitProcess(code);
  }

  /**
   * Get process metrics
   */
  getProcessMetrics(): IProcessMetrics {
    return {
      uptime: Date.now() - this._startTime,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      pid: process.pid,
      ppid: process.ppid,
      platform: process.platform,
      nodeVersion: process.version,
      state: this._lifecycleState,
      shutdownTasksCount: this._shutdownTasks.size,
      cleanupHandlersCount: this._cleanupHandlers.size
    };
  }

  /**
   * Cleanup signal handlers
   */
  private cleanupSignalHandlers(): void {
    for (const [event, handler] of this._signalHandlers.entries()) {
      process.removeListener(event as any, handler as any);
    }
    this._signalHandlers.clear();
  }

  /**
   * Check if an object is a DynamicModule
   */
  private isDynamicModule(obj: any): obj is IDynamicModule {
    return obj && typeof obj === 'object' && 'module' in obj && typeof obj.module === 'function';
  }

  /**
   * Discover modules automatically from the filesystem
   * Scans for @Module decorated classes and registers them
   */
  private async discoverModules(scanPaths?: string[]): Promise<ModuleConstructor[]> {
    const modules: ModuleConstructor[] = [];
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { pathToFileURL } = await import('node:url');

    // Default scan paths
    const defaultPaths = [
      path.join(process.cwd(), 'src', 'modules'),
      path.join(process.cwd(), 'dist', 'modules'),
      path.join(process.cwd(), 'lib', 'modules'),
    ];

    const paths = scanPaths || defaultPaths;

    for (const scanPath of paths) {
      try {
        // Check if path exists
        await fs.access(scanPath);

        // Recursively find all .js and .ts files
        const files = await this.findModuleFiles(scanPath, fs, path);

        for (const file of files) {
          try {
            // Skip test files
            if (file.includes('.test.') || file.includes('.spec.')) {
              continue;
            }

            // Dynamically import the file
            const fileUrl = pathToFileURL(file).href;
            const moduleExports = await import(fileUrl);

            // Check all exports for @Module decorated classes
            for (const exportName in moduleExports) {
              const exported = moduleExports[exportName];

              // Check if it's a module (has __titanModule metadata)
              if (exported && typeof exported === 'function' && exported.__titanModule) {
                modules.push(exported as ModuleConstructor);
                this._logger?.debug(`Discovered module: ${exported.name || exportName} from ${file}`);
              }
            }
          } catch (error) {
            this._logger?.warn(`Failed to load potential module from ${file}: ${error}`);
          }
        }
      } catch (error) {
        // Path doesn't exist, skip it
        this._logger?.debug(`Scan path not found: ${scanPath}`);
      }
    }

    return modules;
  }

  /**
   * Recursively find all potential module files
   */
  private async findModuleFiles(dir: string, fs: any, path: any): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        // Recursively search subdirectories
        const subFiles = await this.findModuleFiles(fullPath, fs, path);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.module.js') || entry.name.endsWith('.module.ts')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Process a dynamic module's providers and imports
   */
  private async processDynamicModule(dynamicModule: IDynamicModule, moduleInstance: IModule): Promise<void> {
    // Process imports first
    if (dynamicModule.imports) {
      for (const importModule of dynamicModule.imports) {
        await this.registerModule(importModule);
      }
    }

    // Register providers
    if (dynamicModule.providers) {
      for (const provider of dynamicModule.providers) {
        // Handle both tuple format and direct providers
        if (Array.isArray(provider)) {
          await this.registerProvider(provider as [InjectionToken<any>, Provider<any>]);
        } else if (typeof provider === 'function') {
          // Constructor - convert to tuple format
          await this.registerProvider([provider, { useClass: provider }]);
        }
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
  private async registerProvider(provider: [InjectionToken<any>, Provider<any>]): Promise<void> {
    const [token, providerDef] = provider;
    this._container.register(token, providerDef);
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
export function createApp(options?: IApplicationOptions): Application {
  return new Application(options);
}

/**
 * Create and start an application
 */
export async function startApp(options?: IApplicationOptions): Promise<Application> {
  const app = createApp(options);
  await app.start();
  return app;
}