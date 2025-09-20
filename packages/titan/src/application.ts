/**
 * Titan Application - Core application kernel
 */

import os from 'node:os';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Token, Container, createToken, InjectionToken, Provider } from '@omnitron-dev/nexus';

import { ConfigModule, ConfigModuleToken, ConfigServiceToken } from './modules/config/index.js';
import { ILogger, LoggerModule, LoggerModuleToken } from './modules/logger.module.js';
import { ProcessLifecycleModule, ProcessLifecycleToken, IShutdownTask } from './modules/process-lifecycle/index.js';
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
  IApplicationOptions
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
  private _processLifecycle?: ProcessLifecycleModule;

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

    // Register core modules with async initialization
    if (!options?.disableCoreModules) {
      await app.registerCoreModules();
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
    const shutdownTimeout = options.gracefulShutdownTimeout || 30000;

    // Note: Core modules are registered asynchronously in the static create method

    // Register process lifecycle module unless disabled
    if (!options.disableGracefulShutdown) {
      this.registerProcessLifecycle(shutdownTimeout);
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
        // Configuration is already initialized through the module forRoot
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

      // Start ProcessLifecycle module if registered
      if (this.has(ProcessLifecycleToken)) {
        const lifecycleModule = this.getModule(ProcessLifecycleToken);
        await lifecycleModule.start();

        // Register any pending shutdown tasks
        if (global.__titanShutdownTasks) {
          for (const task of global.__titanShutdownTasks) {
            lifecycleModule.registerShutdownTask(task);
          }
          delete global.__titanShutdownTasks;
        }

        this.emit('module:started', { module: lifecycleModule.name });
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
   * Legacy use method - wraps registerModule for backward compatibility
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

  // Private methods

  private async registerCoreModules(): Promise<void> {
    // Always register config module if not already registered
    if (!this._container.has(ConfigModuleToken)) {
      // Use the new automatic configuration initialization
      const configModule = await ConfigModule.createAutomatic(this._config);

      this._container.register(ConfigModuleToken, {
        useValue: configModule
      });
      this._modules.set(ConfigModuleToken, configModule);

      // Also register the ConfigService directly for easy access
      const configService = ConfigModule.getService();
      this._logger?.debug('[Application] ConfigService after init:', { available: configService ? true : false });
      if (configService) {
        // Register with ConfigServiceToken if not already registered
        if (!this._container.has(ConfigServiceToken)) {
          this._container.register(ConfigServiceToken, {
            useValue: configService
          });
          this._logger?.debug('[Application] Registered ConfigServiceToken');
        }
        // Also register with string tokens for backward compatibility
        const configServiceToken = createToken('ConfigService');
        if (!this._container.has(configServiceToken)) {
          this._container.register(configServiceToken, {
            useValue: configService
          });
          this._logger?.debug('[Application] Registered ConfigService token');
        }
        const configToken = createToken('Config');
        if (!this._container.has(configToken)) {
          this._container.register(configToken, {
            useValue: configService
          });
          this._logger?.debug('[Application] Registered Config token');
        }
      } else {
        if (this._logger) {
          this._logger.error('[Application] ConfigService not available after ConfigModule initialization');
        } else {
          console.error('[Application] ConfigService not available after ConfigModule initialization');
        }
      }
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
      // Skip config and logger modules as they are handled separately
      if (token === ConfigModuleToken || token === LoggerModuleToken) {
        continue;
      }
      visit(token);
    }

    return sorted;
  }

  private registerProcessLifecycle(timeout: number): void {
    // Create and register the ProcessLifecycleModule
    const processLifecycle = new ProcessLifecycleModule(
      this._logger,
      this.has(ConfigModuleToken) ? this.getModule(ConfigModuleToken) : undefined
    );

    this._processLifecycle = processLifecycle;

    // Register the module in the container
    this._container.register(ProcessLifecycleToken, {
      useValue: processLifecycle
    });
    this._modules.set(ProcessLifecycleToken, processLifecycle);

    // Initialize the module (will be properly started during app start)
    processLifecycle.initialize(this).catch(error => {
      this._logger?.error({ error }, 'Failed to initialize process lifecycle module');
    });
  }

  /**
   * Register a shutdown task
   */
  registerShutdownTask(task: IShutdownTask): void {
    if (this._processLifecycle) {
      this._processLifecycle.registerShutdownTask(task);
    } else {
      // Store for later if process lifecycle not yet initialized
      if (!global.__titanShutdownTasks) {
        global.__titanShutdownTasks = [];
      }
      global.__titanShutdownTasks.push(task);
    }
  }

  /**
   * Unregister a shutdown task
   */
  unregisterShutdownTask(taskId: string): void {
    if (this._processLifecycle) {
      this._processLifecycle.unregisterShutdownTask(taskId);
    }
  }

  /**
   * Register a cleanup handler
   */
  registerCleanup(handler: () => Promise<void> | void): void {
    if (this._processLifecycle) {
      this._processLifecycle.registerCleanup(handler);
    }
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