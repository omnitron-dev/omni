/**
 * Titan Application - Core application kernel
 */

import os from 'node:os';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Token, Container, createToken, InjectionToken, Provider } from './nexus/index.js';
import { Netron, type NetronOptions } from './netron/index.js';

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
  IProcessMetrics,
  IHealthStatus,
  ConfigValue,
  ConfigObject
} from './types.js';

/**
 * Application token for DI
 */
export const APPLICATION_TOKEN: Token<Application> = createToken<Application>('Application');

/**
 * Netron service token - Core networking and RPC service
 */
export const NETRON_TOKEN: Token<Netron> = createToken<Netron>('Netron');

/**
 * Titan Application implementation
 */
export class Application implements IApplication {
  private _isStarted = false;
  private _state: ApplicationState = ApplicationState.Created;
  private _container: Container;
  private _config: IApplicationConfig;
  private _userConfig: ConfigObject;  // Store original user config separately
  private _name: string;
  private _version: string;
  private _debug: boolean;
  private _startTime: number = 0;
  private _startupTime: number = 0;
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
  private _startPromise: Promise<void> | null = null;
  private _stopPromise: Promise<void> | null = null;

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
    excludePaths?: string[];      // Paths to exclude from scanning
  }): Promise<Application> {
    const app = new Application(options);

    // Register core modules properly with forRoot pattern
    if (!options?.disableCoreModules) {
      await app.initializeCoreModules();
    }

    // Auto-discovery mode - automatically find and register @Module decorated classes
    if (options?.autoDiscovery || options?.scanPaths) {
      const discoveredModules = await app.discoverModules(options.scanPaths, options?.excludePaths);
      // Discovered modules are already registered, but we need to fully process them
      for (const ModuleClass of discoveredModules) {
        const moduleInstance = new ModuleClass();
        // Check if module was already registered during discovery
        const token = createToken<IModule>(moduleInstance.name);
        if (!app._modules.has(token)) {
          await app.registerModule(ModuleClass);
        }
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
    this._container.register(APPLICATION_TOKEN, {
      useValue: this
    });

    // Initialize app metadata
    this._name = options.name || 'titan-app';
    this._version = options.version || '1.0.0';
    this._debug = options.debug || false;

    // Store original user config separately
    this._userConfig = options.config ? { ...options.config } : {};

    // Initialize full configuration with app metadata
    this._config = {
      name: this._name,
      version: this._version,
      debug: this._debug,
      environment: process.env['NODE_ENV'] || 'development',
      ...this._userConfig  // User config overrides app metadata
    };

    // Add specific options to config if provided
    if (options.disableCoreModules !== undefined) {
      this._config['disableCoreModules'] = options.disableCoreModules;
    }
    if (options.disableGracefulShutdown !== undefined) {
      this._config['disableGracefulShutdown'] = options.disableGracefulShutdown;
    }
    if (options['disableProcessExit'] !== undefined) {
      this._config['disableProcessExit'] = options['disableProcessExit'];
    }

    // Add logging if provided at top level
    if (options.logging && !this._config.logging) {
      this._config.logging = options.logging;
    }

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
    // Return existing start promise if already starting
    if (this._state === ApplicationState.Starting && this._startPromise) {
      return this._startPromise;
    }

    // Wait for stop to complete if stopping
    if (this._state === ApplicationState.Stopping && this._stopPromise) {
      await this._stopPromise;
      // After stop completes, proceed to start
    }

    if (this._state !== ApplicationState.Created && this._state !== ApplicationState.Stopped) {
      if (this._state === ApplicationState.Started) {
        throw new Error('Application is already started or starting');
      }
      if (this._state === ApplicationState.Failed) {
        throw new Error('Cannot start from failed state');
      }
      throw new Error(`Cannot start application in state: ${this._state}`);
    }

    // Create and track the start promise
    this._startPromise = this._doStart();
    try {
      await this._startPromise;
    } finally {
      this._startPromise = null;
    }
    return undefined;
  }

  /**
   * Internal start implementation
   */
  private async _doStart(): Promise<void> {
    this.setState(ApplicationState.Starting);
    const startBegin = Date.now();
    this._startTime = startBegin;

    // Ensure state change is observable before continuing
    await new Promise(resolve => setImmediate(resolve));

    try {
      // Emit starting event
      this.emit(ApplicationEvent.Starting);

      // Initialize core modules if not already done
      if (!this._container.has(NETRON_TOKEN) && !this._config?.['disableCoreModules']) {
        await this.initializeCoreModules();
      }

      // Initialize logger after config if available
      if (this._container.has(LOGGER_SERVICE_TOKEN)) {
        try {
          const loggerService = this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
          this._logger = loggerService.logger;
          this._logger.info({ state: this._state }, 'Application starting');
          // Emit ModuleStarted for logger when it exists
          this.emit(ApplicationEvent.ModuleStarted, { module: 'logger' });
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
        const [, module] = entry;
        this._logger?.debug({ module: module.name }, 'Starting module');

        // Register module
        if (module.onRegister) {
          await module.onRegister(this);
        }

        // Start module
        if (module.onStart) {
          await module.onStart(this);
        }

        this.emit(ApplicationEvent.ModuleStarted, { module: module.name });
        this._logger?.debug({ module: module.name }, 'Module started');
      }

      // Start Netron if configured and available
      if (this._container.has(NETRON_TOKEN)) {
        try {
          const netron = await this._container.resolveAsync(NETRON_TOKEN) as Netron;
          if (netron) {
            await netron.start();
            this._logger?.info({ module: 'Netron' }, 'Netron service started');
            // Emit ModuleStarted for Netron when it exists
            this.emit(ApplicationEvent.ModuleStarted, { module: 'netron' });
          }
        } catch (error) {
          this._logger?.warn({ error }, 'Failed to start Netron service');
          // Don't fail application start if Netron fails
        }
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

      this.setState(ApplicationState.Started);
      this._isStarted = true;
      // Ensure startup time is at least 1ms for testing
      this._startupTime = Math.max(1, Date.now() - this._startTime);
      this.emit(ApplicationEvent.Started);

      this._logger?.info(
        {
          state: this._state,
          startupTime: this.uptime,
          modules: Array.from(this._modules.values()).map(m => m.name)
        },
        'Application started successfully'
      );
    } catch (error) {
      this.setState(ApplicationState.Failed);
      this._isStarted = false;
      this._logger?.error({ error }, 'Application failed to start');
      if (error instanceof Error) {
        this.handleError(error);
      }
      throw error;
    }
  }

  /**
   * Stop the application
   */
  async stop(options: IShutdownOptions = {}): Promise<void> {
    // Return existing stop promise if already stopping
    if (this._state === ApplicationState.Stopping && this._stopPromise) {
      return this._stopPromise;
    }

    // Wait for start to complete if starting
    if (this._state === ApplicationState.Starting && this._startPromise) {
      await this._startPromise;
      // After start completes, proceed to stop
    }

    if (this._state !== ApplicationState.Started && this._state !== ApplicationState.Failed) {
      return undefined; // Not in a stoppable state
    }

    // Create and track the stop promise
    this._stopPromise = this._doStop(options);
    try {
      await this._stopPromise;
    } finally {
      this._stopPromise = null;
    }
    return undefined;
  }

  /**
   * Internal stop implementation
   */
  private async _doStop(options: IShutdownOptions = {}): Promise<void> {
    this.setState(ApplicationState.Stopping);
    this._logger?.info({ options }, 'Application stopping');

    // Ensure state change is observable before continuing
    await new Promise(resolve => setImmediate(resolve));

    try {
      // Emit stopping event
      this.emit(ApplicationEvent.Stopping);

      // Use timeout if provided
      const stopTimeout = options.timeout;

      // Run stop hooks first (in reverse order of registration)
      if (!options.force || stopTimeout) {
        for (let i = this._stopHooks.length - 1; i >= 0; i--) {
          const hook = this._stopHooks[i];
          if (!hook) continue;
          this._logger?.debug({ hook: hook.name }, 'Running stop hook');

          try {
            const promise = Promise.resolve(hook.handler());
            const timeout = stopTimeout || hook.timeout;
            if (timeout) {
              await this.withTimeout(promise, timeout, `Stop hook ${hook.name || 'unnamed'} timed out`);
            } else if (!options.force) {
              await promise;
            }
          } catch (error) {
            if (!options.force) throw error;
            this._logger?.warn({ error, hook: hook.name }, 'Ignoring stop hook error due to force stop');
          }
        }
      }

      // Execute shutdown tasks (unless being called from shutdown)
      if (!this._isShuttingDown && this._shutdownTasks.size > 0) {
        // Get all tasks and ensure priority is a number
        const tasksArray = Array.from(this._shutdownTasks.values()).map(task => ({
          ...task,
          priority: Number(task.priority ?? 50)
        }));

        // Sort tasks by priority (lower numbers first), then by ID for stable sorting
        const sortedTasks = tasksArray.sort((a, b) => {
          // Ensure priorities are numbers
          const aPriority = Number(a.priority ?? 50);
          const bPriority = Number(b.priority ?? 50);

          // Compare priorities
          if (aPriority < bPriority) return -1;
          if (aPriority > bPriority) return 1;

          // If priorities are equal, sort by ID to ensure stable order
          return (a.id || '').localeCompare(b.id || '');
        });

        for (const task of sortedTasks) {
          try {
            this._logger?.debug({ taskName: task.name }, 'Executing shutdown task');
            await Promise.resolve(task.handler(ShutdownReason.Manual, options));
            this._logger?.debug({ taskName: task.name }, 'Shutdown task completed');
          } catch (error) {
            this._logger?.error({ error, taskName: task.name }, 'Shutdown task failed');
            if (task.critical && !options.force) {
              throw error;  // Re-throw the original error for critical tasks
            }
          }
        }
      }

      // Stop modules in reverse dependency order
      const sortedModules = this.sortModulesByDependencies();

      for (let i = sortedModules.length - 1; i >= 0; i--) {
        const entry = sortedModules[i];
        if (!entry) continue;
        const [, module] = entry;

        this._logger?.debug({ module: module.name }, 'Stopping module');

        try {
          if (module.onStop) {
            // With force and no timeout, skip the stop hooks entirely
            if (options.force && !stopTimeout) {
              this._logger?.debug({ module: module.name }, 'Skipping module stop due to force stop without timeout');
            } else {
              const promise = Promise.resolve(module.onStop(this));
              if (stopTimeout) {
                await this.withTimeout(promise, stopTimeout, `Module ${module.name} stop timed out`);
              } else {
                await promise;
              }
            }
          }

          if (module.onDestroy && !options.force) {
            await module.onDestroy();
          }
        } catch (error) {
          this._logger?.error({ error, module: module.name }, 'Module stop failed');

          // Handle timeout errors
          if (error instanceof Error && error.message.includes('timed out')) {
            if (!options.force) {
              // Only throw timeout errors if not force stop
              throw error;
            } else {
              // For force stop, log and continue even on timeout
              this._logger?.warn({ module: module.name }, 'Module timed out during force stop, continuing');
            }
          } else {
            // By default, continue stopping to ensure cleanup
            // Only throw if explicitly requested via graceful: false
            if (options.graceful === false && !options.force) {
              throw error;
            }
            // Log and continue for normal, graceful, or force stop
            this._logger?.warn('Continuing stop despite module error');
          }
        }

        this.emit(ApplicationEvent.ModuleStopped, { module: module.name });
        this._logger?.debug({ module: module.name }, 'Module stopped');
      }

      // Log successful stop before stopping core modules
      this._logger?.info('Application stopped successfully');

      // Stop Netron service before core modules
      if (this._container.has(NETRON_TOKEN)) {
        try {
          const netron = this._container.resolve(NETRON_TOKEN) as Netron;
          if (netron) {
            this._logger?.debug({ module: 'Netron' }, 'Stopping Netron service');
            await netron.stop();
            this.emit(ApplicationEvent.ModuleStopped, { module: 'netron' });
            this._logger?.info({ module: 'Netron' }, 'Netron service stopped');
          }
        } catch (error) {
          this._logger?.warn({ error }, 'Error stopping Netron service');
          // Continue shutdown even if Netron fails to stop
        }
      }

      // Stop logger first among core modules
      if (this._container.has(LOGGER_SERVICE_TOKEN)) {
        try {
          // Ensure logger service is resolved before stopping
          this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
          this._logger?.debug({ module: 'logger' }, 'Stopping module');
          // Logger service doesn't need explicit stop
          this.emit(ApplicationEvent.ModuleStopped, { module: 'logger' });
        } catch {
          // Logger not found
        }
      }

      // Config module shutdown is handled separately

      // Run cleanup handlers (unless being called from shutdown)
      if (!this._isShuttingDown && this._cleanupHandlers.size > 0) {
        await this.runCleanupHandlers();
      }

      // Cleanup signal handlers if this is not being called from shutdown
      if (!this._isShuttingDown) {
        this.cleanupSignalHandlers();
      }

      // Give pino-pretty time to flush output
      await new Promise(resolve => setImmediate(resolve));

      this.setState(ApplicationState.Stopped);
      this._lifecycleState = LifecycleState.Stopped;
      this._isStarted = false;
      this.emit(ApplicationEvent.Stopped);

      // Also emit ShutdownComplete for compatibility with shutdown flow
      this.emit(ApplicationEvent.ShutdownComplete, { reason: ShutdownReason.Manual, success: true });
    } catch (error) {
      this.setState(ApplicationState.Failed);
      this._isStarted = false;
      this._logger?.error({ error }, 'Error during application stop');

      if (options.force) {
        this._logger?.warn('Force stopping application despite errors');
        this.setState(ApplicationState.Stopped);
        this._lifecycleState = LifecycleState.Stopped;
        this._isStarted = false;

        // Only exit process if not in test environment and explicitly requested
        if (process.env['NODE_ENV'] !== 'test' && !this._config['disableProcessExit']) {
          process.exit(1);
        }
      } else {
        throw error;
      }
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
   * Replace a module with a custom implementation
   */
  replaceModule<T extends IModule = IModule>(nameOrToken: string | Token<T>, module: T): this {
    // Prevent module replacement after the application has started
    if (this._isStarted || this._state === ApplicationState.Started || this._state === ApplicationState.Starting) {
      throw new Error('Cannot replace modules after application has started');
    }

    // Find the token if string name provided
    let token: Token<T> | undefined;

    if (typeof nameOrToken === 'string') {
      // Find the token by module name
      for (const [tok, mod] of this._modules) {
        if (mod.name === nameOrToken) {
          token = tok as Token<T>;
          break;
        }
      }

      if (!token) {
        // Create a new token if not found
        token = createToken<T>(nameOrToken);
      }
    } else {
      token = nameOrToken;
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

    // Validate that we have a module instance
    if (!moduleInstance) {
      throw new Error('Failed to create module instance from provided input');
    }

    // Get module metadata from @Module decorator
    // Check on the constructor of the instance first, then fallback to moduleInput
    const moduleConstructor = moduleInstance.constructor;
    const metadata = Reflect.getMetadata('module', moduleConstructor) ||
      Reflect.getMetadata('nexus:module', moduleConstructor) ||
      Reflect.getMetadata('module', moduleInput) ||
      Reflect.getMetadata('nexus:module', moduleInput) ||
      Reflect.getMetadata('module:metadata', moduleInput) ||
      (moduleConstructor as any).__titanModuleMetadata ||
      (moduleInput as any).__titanModuleMetadata;

    // Ensure module has a name - use class name or metadata
    let moduleName = moduleInstance.name;
    if (!moduleName) {
      if (metadata?.name) {
        moduleName = metadata.name;
      } else if (dynamicModule && dynamicModule.module) {
        // For dynamic modules, use the module class name
        moduleName = dynamicModule.module.name || 'UnnamedModule';
      } else if (typeof moduleInput === 'function') {
        // Use constructor name as fallback
        moduleName = moduleInput.name || 'UnnamedModule';
      } else if (moduleConstructor && moduleConstructor.name) {
        // Use the constructor name from the instance
        moduleName = moduleConstructor.name || 'UnnamedModule';
      } else {
        moduleName = 'UnnamedModule';
      }

      // Create a new module instance with the correct name
      moduleInstance = {
        ...moduleInstance,
        name: moduleName
      };
    }

    // Process @Module decorator metadata if not a dynamic module
    if (!dynamicModule && metadata) {
      // Create a dynamic module from metadata
      dynamicModule = {
        name: moduleName,
        module: moduleInput as any,
        providers: metadata.providers || [],
        imports: metadata.imports || [],
        exports: metadata.exports || []
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

    this.emit(ApplicationEvent.ModuleRegistered, { module: moduleInstance.name });

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

      // Check for duplicate
      if (this._modules.has(token)) {
        throw new Error(`Module ${token.name || 'unknown'} already registered`);
      }

      this._modules.set(token, moduleInstance);
    } else {
      // Module instance - check for duplicate by reference
      const moduleInstance = module as IModule;

      // Check if this exact module instance is already registered
      for (const [, existingModule] of this._modules) {
        if (existingModule === moduleInstance) {
          // Module instance already registered, just return
          return this;
        }
      }

      // Register module synchronously for instances
      // Store the token and module
      const token = createToken<IModule>(moduleInstance.name);
      this._modules.set(token, moduleInstance);

      // Configure module if config exists
      if (moduleInstance.configure && typeof moduleInstance.configure === 'function') {
        const moduleConfig = this._config[moduleInstance.name];
        if (moduleConfig !== undefined) {
          moduleInstance.configure(moduleConfig);
        }
      }

      // Emit registration event immediately
      this.emit(ApplicationEvent.ModuleRegistered, { module: moduleInstance.name });
    }

    return this;
  }

  /**
   * Get a module by name or token
   */
  getModule<T extends IModule = IModule>(nameOrToken: string | Token<T>): T {
    // If string, find module by name
    if (typeof nameOrToken === 'string') {
      for (const [, module] of this._modules) {
        if (module.name === nameOrToken) {
          return module as T;
        }
      }
      throw new Error(`Module not found: ${nameOrToken}`);
    }

    // Otherwise use token
    const token = nameOrToken;
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
   * Get configuration value or entire configuration
   */
  config(): IApplicationConfig;
  config<K extends keyof IApplicationConfig>(key: K): IApplicationConfig[K];
  config<K extends keyof IApplicationConfig>(key?: K): IApplicationConfig | IApplicationConfig[K] {
    if (key === undefined) {
      return this.getConfig();
    }
    // Return from user config first, fallback to full config for app metadata
    return this._userConfig[key] !== undefined ? this._userConfig[key] : this._config[key];
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
   * Prepend event handler (add to beginning of listener list)
   */
  prependListener<E extends ApplicationEvent>(event: E, handler: EventHandler): void {
    // EventEmitter doesn't have prependListener, so we need to work around it
    const existingListeners = this._eventEmitter.listeners(event);
    this._eventEmitter.removeAllListeners(event);
    this._eventEmitter.on(event, handler);
    for (const listener of existingListeners) {
      this._eventEmitter.on(event, listener);
    }
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners<E extends ApplicationEvent>(event?: E): void {
    if (event) {
      this._eventEmitter.removeAllListeners(event);
    } else {
      this._eventEmitter.removeAllListeners();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount<E extends ApplicationEvent>(event: E): number {
    return this._eventEmitter.listenerCount(event);
  }

  /**
   * Emit event asynchronously and wait for all handlers
   */
  async emitAsync<E extends ApplicationEvent | string>(event: E, data?: unknown): Promise<void> {
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
          await Promise.resolve(handler(data));
        } catch (err) {
          if (this._logger) {
            this._logger.error('Error in error handler:', err);
          } else {
            console.error('Error in error handler:', err);
          }
        }
      }
    }

    try {
      // Get listeners for this event
      const listeners = this._eventEmitter.listeners(event);

      // Execute all listeners and wait for them
      const promises = listeners.map((listener) =>
        Promise.resolve(listener(data, meta))
      );

      await Promise.all(promises);

      // Also emit to wildcard listeners if event is not already '*'
      if (event !== '*') {
        const wildcardListeners = this._eventEmitter.listeners('*');
        const wildcardPromises = wildcardListeners.map((listener) =>
          Promise.resolve(listener(data, meta))
        );
        await Promise.all(wildcardPromises);
      }
    } catch (error) {
      // Handle errors in event handlers
      this._logger?.error({ error, event }, 'Error in async event handler');
      // Emit error event for handler errors
      if (event !== ApplicationEvent.Error) {
        this.emit(ApplicationEvent.Error, { error });
      }
    }
  }

  /**
   * Emit event synchronously
   */
  emit<E extends ApplicationEvent | string>(event: E, data?: unknown): void {
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

    // Wrap handler execution to catch errors
    const listeners = this._eventEmitter.listeners(event);
    for (const listener of listeners) {
      try {
        listener(data, meta);
      } catch (handlerError) {
        // Log the error
        this._logger?.error({ error: handlerError, event }, 'Error in event handler');
        // Emit error event if not already handling an error event
        if (event !== ApplicationEvent.Error) {
          this.emit(ApplicationEvent.Error, handlerError);
        }
      }
    }

    // Also emit to wildcard listeners if event is not already '*'
    if (event !== '*') {
      const wildcardListeners = this._eventEmitter.listeners('*');
      for (const listener of wildcardListeners) {
        try {
          listener(data, meta);
        } catch (handlerError) {
          // Log the error
          this._logger?.error({ error: handlerError, event: '*' }, 'Error in wildcard handler');
          // Emit error event if not already handling an error event
          if (event !== ApplicationEvent.Error) {
            this.emit(ApplicationEvent.Error, handlerError);
          }
        }
      }
    }
  }

  /**
   * Register start hook
   */
  onStart(hook: ILifecycleHook | (() => void | Promise<void>), priority?: number, timeout?: number): this {
    if (typeof hook === 'function') {
      this._startHooks.push({
        handler: hook,
        priority: priority ?? 100,  // Default priority is 100
        timeout
      });
    } else {
      this._startHooks.push(hook);
    }

    // Sort by priority (lower priority numbers execute first)
    this._startHooks.sort((a, b) => (a.priority || 100) - (b.priority || 100));
    return this;
  }

  /**
   * Register stop hook
   */
  onStop(hook: ILifecycleHook | (() => void | Promise<void>), priority?: number, timeout?: number): this {
    if (typeof hook === 'function') {
      this._stopHooks.push({
        handler: hook,
        priority: priority ?? 100,
        timeout
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
   * Deep merge helper function
   */
  private deepMerge(target: ConfigObject, source: ConfigObject): ConfigObject {
    if (!source || typeof source !== 'object') return source;
    if (Array.isArray(source)) return source;

    const result = { ...target };

    for (const key of Object.keys(source)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
        if (targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
          result[key] = this.deepMerge(targetValue, sourceValue);
        } else {
          result[key] = sourceValue;
        }
      } else {
        result[key] = sourceValue;
      }
    }

    return result;
  }

  /**
   * Configure application settings
   */
  configure<T = ConfigObject>(configOrKey: T | string, value?: ConfigValue): this {
    let options: ConfigObject;

    // Support both full config object and key-value pairs
    if (typeof configOrKey === 'string') {
      options = { [configOrKey]: value };
    } else {
      options = configOrKey as ConfigObject;
    }

    // Merge configuration
    const newConfig = { ...this._config };

    for (const key of Object.keys(options)) {
      // Replace top-level config sections completely
      // This matches the test expectations where configure replaces sections
      newConfig[key] = options[key];
    }

    // Apply the merged configuration
    this._config = newConfig;

    // Update user config - replace sections same as main config
    for (const key of Object.keys(options)) {
      this._userConfig[key] = options[key];
    }

    // Apply logger configuration if provided
    if (options['logger'] && this._container.has(LOGGER_SERVICE_TOKEN)) {
      // Logger service configuration is handled via forRoot pattern now
      // We could add a reconfigure method if needed in future
    }

    // Apply event configuration if provided
    if (options['events'] && this._eventEmitter) {
      // Apply event emitter configuration
      // Note: Our EventEmitter doesn't have setMaxListeners, store in config
      const eventsConfig = options['events'] as ConfigObject;
      if (eventsConfig && typeof eventsConfig === 'object' && eventsConfig['maxListeners']) {
        this._config = {
          ...this._config,
          events: {
            ...(this._config['events'] as ConfigObject || {}),
            maxListeners: eventsConfig['maxListeners']
          }
        };
      }
    }

    // Reconfigure modules that have configure method
    for (const [, module] of this._modules.entries()) {
      if (module.configure && module.name && this._config[module.name]) {
        module.configure(this._config[module.name]);
      }
    }

    // Update module configurations if they have configure method
    for (const [, module] of this._modules) {
      if (module.configure && typeof module.configure === 'function') {
        const moduleConfig = this._config[module.name];
        if (moduleConfig !== undefined) {
          module.configure(moduleConfig);
        }
      }
    }

    // Emit only the changed config, not the entire config
    this.emit(ApplicationEvent.ConfigChanged, { config: options });
    return this;
  }

  /**
   * Set a configuration value and emit change event
   */
  setConfig(key: string, value: ConfigValue): void {
    const parts = key.split('.');
    let obj: ConfigObject = this._config as ConfigObject;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part && !(part in obj)) {
        obj[part] = {};
      }
      const nextObj = obj[part!];
      if (!nextObj || typeof nextObj !== 'object' || Array.isArray(nextObj)) {
        obj[part!] = {};
      }
      obj = obj[part!] as ConfigObject;
    }
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      obj[lastPart] = value;
    }

    // Emit configuration change event
    this.emit(ApplicationEvent.ConfigChanged, { key, value });
  }

  /**
   * Get application state
   */
  get state(): ApplicationState {
    return this._state;
  }

  /**
   * Set application state (internal method for testing)
   */
  private setState(state: ApplicationState): void {
    this._state = state;
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
      cpuUsage: process.cpuUsage(),
      startupTime: this._startupTime,
      modules: this._modules.size
    };
  }

  /**
   * Get the DI container - public API
   */
  get container(): Container {
    return this._container;
  }

  /**
   * Get application name
   */
  get name(): string {
    return this._name;
  }

  /**
   * Get application version
   */
  get version(): string {
    return this._version;
  }

  /**
   * Get debug mode
   */
  get debug(): boolean {
    return this._debug;
  }

  /**
   * Check if application is started
   */
  get isStarted(): boolean {
    return this._state === ApplicationState.Started;
  }

  /**
   * Check health of a specific module
   */
  async checkHealth(moduleName: string): Promise<IHealthStatus> {
    const module = this.getModule(moduleName);

    if (!module) {
      return {
        status: 'unhealthy',
        message: `Module ${moduleName} not found`
      };
    }

    if (!module.health) {
      return {
        status: 'healthy',
        message: `Module ${moduleName} does not have health check`,
        details: {
          started: this._isStarted
        }
      };
    }

    try {
      return await module.health();
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Health check failed for module ${moduleName}`,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Perform health check on the application and all modules
   */
  async health(): Promise<IHealthStatus> {
    const modules: Record<string, IHealthStatus> = {};
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

    // Check each module's health
    for (const [, module] of this._modules) {
      try {
        if (module.health) {
          const moduleHealth = await module.health();
          modules[module.name] = moduleHealth;

          // Update overall status based on module health
          if (moduleHealth.status === 'unhealthy') {
            overallStatus = 'unhealthy';
          } else if (moduleHealth.status === 'degraded' && overallStatus === 'healthy') {
            overallStatus = 'degraded';
          }
        }
      } catch (error) {
        // If a health check throws, mark that module as unhealthy
        modules[module.name] = {
          status: 'unhealthy',
          message: 'Health check failed',
          details: {
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        };
        overallStatus = 'unhealthy';
      }
    }

    return {
      status: overallStatus,
      message: `Application is ${overallStatus}`,
      modules,  // Add modules at top level for easy access
      details: {
        name: this.name,
        version: this.version,
        uptime: this.getMetrics().uptime,
        state: this._state,
        modules  // Also keep in details for backward compatibility
      }
    };
  }


  /**
   * Get application metrics
   */
  getMetrics(): IApplicationMetrics {
    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      startupTime: this._startTime ? Date.now() - this._startTime : 0,
      modules: this._modules.size
    };
  }

  /**
   * Get configuration - method for compatibility
   */
  getConfig(): IApplicationConfig {
    // Return user configuration, preserving user-provided values even if they overlap with app metadata
    const result = { ...this._config };

    // Only exclude app metadata if they weren't provided by user
    if (this._userConfig['name'] === undefined) {
      delete result.name;
    }
    if (this._userConfig['version'] === undefined) {
      delete result.version;
    }
    if (this._userConfig['debug'] === undefined) {
      delete result.debug;
    }
    if (this._userConfig['environment'] === undefined) {
      delete result.environment;
    }

    return result;
  }

  /**
   * Modules getter property - returns modules by name for easy access
   */
  get modules(): Map<string, IModule> {
    const result = new Map<string, IModule>();
    for (const [, module] of this._modules) {
      result.set(module.name, module);
    }
    return result;
  }

  /**
   * Register a provider in the container - public API
   */
  register<T>(token: Token<T>, provider: Provider<T>, options?: { override?: boolean }): this {
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
    } catch {
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
   * Check if a module exists by name or token
   */
  hasModule(nameOrToken: string | Token<any>): boolean {
    if (typeof nameOrToken === 'string') {
      for (const [, module] of this._modules) {
        if (module.name === nameOrToken) {
          return true;
        }
      }
      return false;
    } else {
      return this._modules.has(nameOrToken);
    }
  }

  /**
   * Get all registered modules in dependency order
   */
  getModules(): IModule[] {
    // If application is started, return modules sorted by dependencies
    if (this._state === ApplicationState.Started || this._state === ApplicationState.Starting) {
      try {
        const sorted = this.sortModulesByDependencies();
        return sorted.map(([, module]) => module);
      } catch {
        // If there's an error in sorting (e.g., circular dependencies), return unsorted
        return Array.from(this._modules.values());
      }
    }

    // Otherwise return in registration order
    return Array.from(this._modules.values());
  }


  /**
   * Register a module dynamically at runtime
   */
  async registerDynamic(module: IModule): Promise<void> {
    // Check if app is running
    if (this._state !== ApplicationState.Started) {
      throw new Error('Application must be running to register dynamic modules');
    }

    // Check dependencies
    if (module.dependencies) {
      for (const dep of module.dependencies) {
        if (!this.hasModule(dep)) {
          throw new Error(`Module ${module.name} requires missing dependency: ${typeof dep === 'string' ? dep : dep.toString()}`);
        }
      }
    }

    // Register the module
    await this.registerModule(module);

    // If module has onStart, call it
    if (module.onStart) {
      await module.onStart(this);
    }
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

  /**
   * Get the Netron instance
   * Lazily initialized on first access
   */
  get netron(): Netron | undefined {
    if (this._container.has(NETRON_TOKEN)) {
      try {
        return this._container.resolve(NETRON_TOKEN) as Netron;
      } catch {
        // Netron not available
      }
    }
    return undefined;
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

    // 3. Register Netron service as a singleton instance
    if (!this._container.has(NETRON_TOKEN)) {
      const netronConfig = this._config?.['netron'] || {};
      const netronOptions: NetronOptions = {
        ...netronConfig,
        // Use application ID as Netron ID if not specified
        id: netronConfig.id || `${this._name}-netron`
      };

      // Create Netron instance directly with logger if available
      if (this._logger) {
        const netron = new Netron(this._logger, netronOptions);

        // Register as singleton instance
        this._container.register(NETRON_TOKEN, {
          useValue: netron
        });

        this._logger.debug({ module: 'Application' }, 'Netron service registered as singleton instance');
      } else {
        console.warn('[Application] Logger not available, skipping Netron registration');
      }
    }
  }

  /**
   * Register a dynamic module (with forRoot pattern)
   */
  private async registerDynamicModule(moduleConfig: IDynamicModule): Promise<void> {
    const { module: ModuleClass, providers = [], exports = [] } = moduleConfig;

    // Register providers
    for (const provider of providers) {
      if (Array.isArray(provider) && provider.length === 2) {
        const [token, providerDef] = provider;
        try {
          this._container.register(token, providerDef);
          this._logger?.debug({
            module: 'Application',
            tokenName: typeof token === 'function' && 'name' in token ? token.name : token?.toString()
          }, 'Provider registered');
        } catch (error) {
          this._logger?.error({
            module: 'Application',
            tokenName: typeof token === 'function' && 'name' in token ? token.name : token?.toString(),
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

            // Check if dependency was found
            if (!depToken) {
              // Log warning but continue - dependency is optional
              this._logger?.warn(`Module ${module.name} dependency '${dep}' not found - continuing without it`);
              continue;
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

              // Check if dependency was found
              if (!this._modules.has(depToken)) {
                // Log warning but continue - dependency is optional
                this._logger?.warn(`Module ${module.name} dependency '${depName}' not found - continuing without it`);
                continue;
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
      this.emit(ApplicationEvent.UncaughtException, { error });

      this.shutdown(ShutdownReason.UncaughtException, { error }).catch(err => {
        this._logger?.fatal({ error: err }, 'Failed to handle uncaught exception');
        this.exitProcess(1);
      });
    };

    this._signalHandlers.set('uncaughtException', uncaughtHandler);
    process.on('uncaughtException', uncaughtHandler);

    // Unhandled rejection handler
    const rejectionHandler = (reason: unknown, promise: Promise<unknown>) => {
      this._logger?.error({ reason, promise }, 'Unhandled promise rejection');
      this.emit(ApplicationEvent.UnhandledRejection, { reason, promise });

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
    this.emit(ApplicationEvent.Signal, { signal });

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
        this.emit(ApplicationEvent.StateSave);
      }
    });
  }

  /**
   * Register a shutdown task
   */
  registerShutdownTask(taskOrName: IShutdownTask | string, handler?: () => void | Promise<void>, priority?: number, isCritical?: boolean): string {
    let task: IShutdownTask;

    if (typeof taskOrName === 'string') {
      // Multi-parameter API
      task = {
        name: taskOrName,
        handler: handler || (() => { }),
        priority: priority ?? ShutdownPriority.Normal,
        critical: isCritical
      };
    } else {
      // Object API
      task = taskOrName;
    }

    if (!task.id) {
      task.id = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Set default priority if not provided
    if (task.priority === undefined) {
      task.priority = ShutdownPriority.Normal;
    }

    this._shutdownTasks.set(task.id, task);
    this._logger?.debug({ taskId: task.id, taskName: task.name }, 'Registered shutdown task');

    return task.id;
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
   * Register a cleanup handler (alias for registerCleanup)
   */
  registerCleanupHandler(handler: () => Promise<void> | void): void {
    this.registerCleanup(handler);
  }

  /**
   * Perform graceful shutdown
   */
  async shutdown(reason: ShutdownReason, details?: { signal?: string; error?: Error; reason?: unknown; promise?: Promise<unknown> }): Promise<void> {
    // Prevent multiple concurrent shutdowns
    if (this._isShuttingDown) {
      await this._shutdownPromise!;
      return;
    }

    this._isShuttingDown = true;
    this._lifecycleState = LifecycleState.ShuttingDown;

    this._logger?.info({ reason, details }, 'Starting graceful shutdown');
    this.emit(ApplicationEvent.ShutdownStart, { reason, details });

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
      this.emit(ApplicationEvent.ShutdownComplete, { reason, success: true });

      // Exit process if configured
      if (reason !== ShutdownReason.Manual) {
        this.exitProcess(0);
      }
    } catch (error) {
      this._logger?.error({ error }, 'Graceful shutdown failed or timed out');
      this.emit(ApplicationEvent.ShutdownError, { reason, error });

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
  private async executeShutdown(reason: ShutdownReason, details?: unknown): Promise<void> {
    // Get all tasks and ensure priority is a number
    const tasksArray = Array.from(this._shutdownTasks.values()).map(task => ({
      ...task,
      priority: Number(task.priority ?? 50)
    }));

    // Sort tasks by priority (lower numbers first), then by ID for stable sorting
    const sortedTasks = tasksArray.sort((a, b) => {
      // Ensure priorities are numbers
      const aPriority = Number(a.priority ?? 50);
      const bPriority = Number(b.priority ?? 50);

      // Compare priorities
      if (aPriority < bPriority) return -1;
      if (aPriority > bPriority) return 1;

      // If priorities are equal, sort by ID to ensure stable order
      return (a.id || '').localeCompare(b.id || '');
    });

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
        this.emit(ApplicationEvent.ShutdownTaskComplete, { task: task.name });

      } catch (error) {
        this._logger?.error({ error, taskName: task.name }, 'Shutdown task failed');
        this.emit(ApplicationEvent.ShutdownTaskError, { task: task.name, error });

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
      signal: (details as any)?.signal as NodeJS.Signals | undefined
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
      this.emit(ApplicationEvent.ProcessExit, { code });
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
    // Ensure startTime is properly set - use process.uptime() as fallback
    const uptime = this._startTime > 0 ? Math.max(1, Date.now() - this._startTime) : Math.max(1, process.uptime() * 1000);

    return {
      uptime,
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
  private isDynamicModule(obj: unknown): obj is IDynamicModule {
    return !!(obj && typeof obj === 'object' && 'module' in obj && typeof (obj as any).module === 'function');
  }

  /**
   * Discover modules automatically from the filesystem
   * Scans for @Module decorated classes and registers them
   */
  async discoverModules(scanPaths?: string | string[], excludePaths?: string[]): Promise<ModuleConstructor[]> {
    const modules: ModuleConstructor[] = [];
    const criticalErrors: Error[] = [];
    const validationErrors: Error[] = [];
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { pathToFileURL } = await import('node:url');

    // Convert single path to array
    let paths: string[];
    if (typeof scanPaths === 'string') {
      // Check if it's a glob pattern
      if (scanPaths.includes('*')) {
        // Use glob to resolve files
        const glob = (await import('glob')).glob;
        const resolvedFiles = await glob(scanPaths, { absolute: true });
        paths = resolvedFiles;
      } else {
        paths = [scanPaths];
      }
    } else if (Array.isArray(scanPaths)) {
      paths = scanPaths;
    } else {
      // Default scan paths
      paths = [
        path.join(process.cwd(), 'src', 'modules'),
        path.join(process.cwd(), 'dist', 'modules'),
        path.join(process.cwd(), 'lib', 'modules'),
      ];
    }

    for (const scanPath of paths) {
      try {
        let files: string[] = [];

        // Check if scanPath is a file or directory
        const stat = await fs.stat(scanPath).catch(() => null);
        if (stat?.isFile()) {
          files = [scanPath];
        } else if (stat?.isDirectory()) {
          // Recursively find all .js and .ts files
          files = await this.findModuleFiles(scanPath, fs, path);
        } else {
          continue; // Path doesn't exist
        }

        for (const file of files) {
          try {
            // Skip test files
            if (file.includes('.test.') || file.includes('.spec.')) {
              continue;
            }

            // Check if file should be excluded
            if (excludePaths && excludePaths.length > 0) {
              const shouldExclude = excludePaths.some(pattern => {
                // Simple pattern matching (supports **/filename.ext patterns)
                if (pattern.includes('**')) {
                  const filename = pattern.replace('**/', '');
                  return file.endsWith(filename);
                }
                return file.includes(pattern);
              });
              if (shouldExclude) {
                this._logger?.debug(`Excluding file from discovery: ${file}`);
                continue;
              }
            }

            // Dynamically import the file
            const fileUrl = pathToFileURL(file).href;
            const moduleExports = await import(fileUrl);

            // Check all exports for @Module decorated classes
            for (const exportName in moduleExports) {
              const exported = moduleExports[exportName];

              // Check if it's a module (has __titanModule metadata)
              if (exported && typeof exported === 'function' && exported.__titanModule) {
                // Validate module before adding
                try {
                  const moduleInstance = new exported();

                  // Validate that module has required properties
                  if (!moduleInstance.name) {
                    const error = new Error(`Module ${exported.name || exportName} is missing required 'name' property`);
                    validationErrors.push(error);
                    this._logger?.warn(`Invalid module: ${error.message}`);
                    continue;
                  }

                  modules.push(exported as ModuleConstructor);
                  this._logger?.debug(`Discovered module: ${exported.name || exportName} from ${file}`);

                  // Also register the module so it's available immediately
                  const token = createToken<IModule>(moduleInstance.name);
                  if (!this._modules.has(token)) {
                    this._modules.set(token, moduleInstance);
                    this._logger?.debug(`Registered module: ${moduleInstance.name}`);
                  }
                } catch (err: any) {
                  const error = new Error(`Failed to instantiate module ${exported.name}: ${err.message}`);
                  validationErrors.push(error);
                  this._logger?.warn(error.message);
                }
              }
            }
          } catch (error) {
            // Treat actual syntax errors in the file content as critical
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (error instanceof Error && errorMessage && (errorMessage.includes('Unexpected end of input') || (errorMessage.includes('SyntaxError') && !errorMessage.includes("Unexpected token 'export'")))) {
              criticalErrors.push(error);
              this._logger?.error(`Critical error loading module from ${file}: ${errorMessage}`);
            } else {
              // Module format issues or other import errors are just warnings
              this._logger?.warn(`Failed to load potential module from ${file}: ${errorMessage}`);
            }
          }
        }
      } catch {
        // Path doesn't exist, skip it
        this._logger?.debug(`Scan path not found: ${scanPath}`);
      }
    }

    // Throw if there are validation errors for modules that are explicitly marked as modules
    if (validationErrors.length > 0) {
      this._logger?.warn(`Module discovery found ${validationErrors.length} validation error(s)`);
      // If there are validation errors and we found modules with __titanModule metadata, throw
      const hasInvalidModules = validationErrors.some(e => e.message.includes('missing required'));
      if (hasInvalidModules) {
        const errorMessages = validationErrors.map(e => e.message).join('; ');
        throw new Error(`Module discovery failed: ${errorMessages}`);
      }
    }

    // Also throw for critical errors (syntax errors)
    if (criticalErrors.length > 0) {
      const errorMessages = criticalErrors.map(e => e.message).join('; ');
      throw new Error(`Module discovery failed with ${criticalErrors.length} critical error(s): ${errorMessages}`);
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
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts') || entry.name.endsWith('.cjs') || entry.name.endsWith('.mjs'))) {
        // Include all JS/TS/CJS/MJS files
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
          // Constructor - register with the class as both token and implementation
          this._container.register(provider, { useClass: provider });
        } else if (typeof provider === 'object' && 'provide' in provider) {
          // Provider object format { provide: token, useValue/useClass/useFactory: ... }
          const { provide, ...providerDef } = provider as any;
          this._container.register(provide, providerDef);
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
    this.emit(ApplicationEvent.Error, error);
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