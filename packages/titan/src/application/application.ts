/**
 * Titan Application — orchestrator kernel.
 *
 * The `Application` class is the public entry point of the framework.
 * Historically it was a single 3,200-line god class that owned every
 * concern from filesystem module discovery to OS signal handling. The
 * T#33 refactor split those concerns into nine focused collaborators in
 * `internal/`:
 *
 *   - `EventBus`              — sync + async dispatch with wildcard fan-out
 *   - `LifecycleStateMachine` — state, hooks, in-flight start/stop promises
 *   - `ConfigStore`           — merged + user config + deep merge
 *   - `ModuleRegistry`        — module map, dedup, topo sort, registration paths
 *   - `ModuleDiscovery`       — filesystem `@Module` scan
 *   - `ShutdownCoordinator`   — tasks, cleanup, LifecycleController wiring
 *   - `ProcessHost`           — signals, uncaught/rejection, exit
 *   - `HealthAggregator`      — per-module health roll-up
 *   - `ServiceExposer`        — @Service → Netron auto-exposure
 *
 * This file is the orchestrator: it wires those collaborators, exposes
 * the public API the framework documents, and runs the two operations
 * that genuinely require all collaborators in one place — `_doStart`
 * and `_doStop`.
 *
 * Public API surface is preserved byte-for-byte from the legacy
 * implementation. The internal split is transparent to consumers.
 *
 * @stable
 * @since 0.1.0
 */

import 'reflect-metadata';
import os from 'node:os';
import {
  Token,
  Container,
  createToken,
  type InjectionToken,
  type Provider,
} from '../nexus/index.js';
import { Netron, type NetronOptions } from '../netron/index.js';
import { Errors } from '../errors/index.js';

import { ConfigModule, CONFIG_SERVICE_TOKEN, CONFIG_OPTIONS_TOKEN } from '../modules/config/index.js';
import { LoggerModule, LOGGER_SERVICE_TOKEN, LOGGER_OPTIONS_TOKEN } from '../modules/logger/index.js';
import type { ILogger, ILoggerModule } from '../modules/logger/index.js';

import {
  type IModule,
  type ModuleInput,
  type IEnvironment,
  type IApplication,
  type EventHandler,
  type ILifecycleHook,
  type IDynamicModule,
  type IShutdownOptions,
  ApplicationState,
  ApplicationEvent,
  type ModuleConstructor,
  type IApplicationConfig,
  type IApplicationMetrics,
  type IApplicationOptions,
  type IShutdownTask,
  ShutdownReason,
  type ProcessSignal,
  type IProcessMetrics,
  type IHealthStatus,
  type ConfigValue,
  type ConfigObject,
} from '../types.js';

import {
  ConfigStore,
  EventBus,
  HealthAggregator,
  hookTimeoutError,
  isDynamicModule as isDynamicModuleInternal,
  LifecycleStateMachine,
  makeRootContextModule,
  ModuleDiscovery,
  ModuleRegistry,
  ProcessHost,
  ServiceExposer,
  ShutdownCoordinator,
  DEFAULT_HOOK_TIMEOUT_MS,
} from './_internal/index.js';

// Well-known token for optional scheduler integration (Symbol.for so the
// identity matches across packages without importing the scheduler).
const SCHEDULER_SERVICE_TOKEN = Symbol.for('titan:SCHEDULER_SERVICE');

/**
 * Application token for dependency injection.
 *
 * @stable
 * @since 0.1.0
 */
export const APPLICATION_TOKEN: Token<Application> = createToken<Application>('Application');

/**
 * Netron service token — core networking and RPC.
 *
 * @stable
 * @since 0.1.0
 */
export const NETRON_TOKEN: Token<Netron> = createToken<Netron>('Netron');

/**
 * Options blob accepted by the static `create()` factory. Extends the
 * declared `IApplicationOptions` with the "convenience" fields the
 * factory understands directly (modules array, imports, providers,
 * autoDiscovery, scanPaths, excludePaths).
 */
type CreateOptions = IApplicationOptions & {
  modules?: ModuleInput[];
  imports?: Token<IModule>[];
  providers?: Array<[InjectionToken<unknown>, Provider<unknown>]>;
  autoDiscovery?: boolean;
  scanPaths?: string[];
  excludePaths?: string[];
};

export class Application implements IApplication {
  // ─── Identity ────────────────────────────────────────────────────────
  private readonly _container: Container;
  private readonly _name: string;
  private readonly _version: string;
  private readonly _debug: boolean;

  // ─── Collaborators ───────────────────────────────────────────────────
  //
  // Names prefixed with `__` so the simpler `_config`, `_modules`, `_state`
  // identifiers remain free for legacy backward-compat accessors at the
  // bottom of this class. Several test suites poke private fields (e.g.
  // `(app as any)._config.name`) — the accessor shims preserve that
  // contract while routing through the collaborators internally.
  private readonly _events = new EventBus();
  private readonly _lifecycle = new LifecycleStateMachine();
  private readonly __configStore: ConfigStore;
  private readonly __moduleRegistry: ModuleRegistry;
  private readonly _discovery: ModuleDiscovery;
  private readonly _shutdown: ShutdownCoordinator;
  private readonly _process: ProcessHost;
  private readonly _health: HealthAggregator;
  private readonly _exposer: ServiceExposer;

  /** Cached logger — set after the logger module starts. */
  private _logger?: ILogger;

  constructor(options: IApplicationOptions = {}) {
    this._container = options.container || new Container();
    this._container.register(APPLICATION_TOKEN, { useValue: this });

    this._name = options.name || 'titan-app';
    this._version = options.version || '1.0.0';
    this._debug = options.debug || false;

    this.__configStore = new ConfigStore({
      name: this._name,
      version: this._version,
      debug: this._debug,
      environment: process.env['NODE_ENV'] || 'development',
      userConfig: (options.config as ConfigObject | undefined) ?? {},
      logging: options.logging,
      disableCoreModules: options.disableCoreModules,
      disableGracefulShutdown: options.disableGracefulShutdown,
      disableProcessExit: (options as { disableProcessExit?: boolean }).disableProcessExit,
    });

    this.__moduleRegistry = new ModuleRegistry({
      container: this._container,
      emit: (e, d) => this._events.emit(e, d),
      getModuleConfig: (name) => this.__configStore.rawGet(name),
      getLogger: () => this._logger,
      getAppState: () => this._lifecycle.state,
    });

    this._discovery = new ModuleDiscovery({
      has: (token) => this.__moduleRegistry.has(token),
      cacheDiscovered: (token, instance) => {
        // `discoverModules` historically pre-cached discovered classes
        // into the module map directly; the registry's internal map is
        // not exposed, so we mimic the legacy behaviour by going through
        // a synchronous `use()` which inserts the instance and (for
        // bare instances) does no further work.
        this.__moduleRegistry.use(instance);
      },
      getLogger: () => this._logger,
    });

    this._shutdown = new ShutdownCoordinator({
      shutdownTimeoutMs: options.gracefulShutdownTimeout ?? 30_000,
      emit: (e, d) => this._events.emit(e, d),
      getLogger: () => this._logger,
      diStop: async (signal, timeout) => {
        await this.stop({ timeout, signal });
      },
    });

    this._process = new ProcessHost({
      disableProcessExit:
        options['environment'] === 'test' ||
        process.env['NODE_ENV'] === 'test' ||
        process.env['JEST_WORKER_ID'] !== undefined ||
        (options as { disableProcessExit?: boolean }).disableProcessExit === true,
    });

    // The health aggregator needs to read live values from THIS instance.
    // We pass an object whose getters close over the freshly-constructed
    // collaborators, sidestepping the class-field-init "no this in
    // initializer" restriction with explicit closures.
    const appName = this._name;
    const appVersion = this._version;
    const lifecycle = this._lifecycle;
    const modules = this.__moduleRegistry;
    this._health = new HealthAggregator({
      getModule: (name) => modules.get<IModule>(name),
      modules: () => modules.values(),
      get appName() { return appName; },
      get appVersion() { return appVersion; },
      get state() { return lifecycle.state; },
      get uptime() { return lifecycle.uptime; },
      get isStarted() { return lifecycle.isStarted; },
    });

    this._exposer = new ServiceExposer(this._container, () => this._logger);

    // Graceful-shutdown wiring (default-on).
    if (!options.disableGracefulShutdown) {
      this._shutdown.seedDefaults({
        flushLogs: () => this.flushLoggerService(),
        emitStateSave: () => this._events.emit(ApplicationEvent.StateSave),
      });
    }
  }

  // ─── Static factory ──────────────────────────────────────────────────

  static async create(module: ModuleInput, options?: IApplicationOptions): Promise<Application>;
  static async create(options?: CreateOptions): Promise<Application>;
  static async create(
    moduleOrOptions?: ModuleInput | CreateOptions,
    optionsArg?: IApplicationOptions,
  ): Promise<Application> {
    let mainModule: ModuleInput | undefined;
    let options: CreateOptions | undefined;

    if (typeof moduleOrOptions === 'function') {
      mainModule = moduleOrOptions;
      options = optionsArg as CreateOptions | undefined;
    } else {
      options = moduleOrOptions as CreateOptions | undefined;
    }

    const app = new Application(options);

    if (mainModule) await app.registerModule(mainModule);
    if (!options?.disableCoreModules) await app.initializeCoreModules();

    if (options?.autoDiscovery || options?.scanPaths) {
      const discovered = await app.discoverModules(options.scanPaths, options.excludePaths);
      for (const ModuleClass of discovered) {
        const instance = new ModuleClass();
        const token = createToken<IModule>(instance.name);
        if (!app._modules.has(token)) await app.registerModule(ModuleClass);
      }
    }

    if (options?.modules) {
      for (const input of options.modules) await app.registerModule(input);
    }
    if (options?.imports) {
      for (const token of options.imports) await app.registerModule(token);
    }

    if (options?.providers) {
      // Synthetic root module so providers participate in module-map
      // invariants. The registry doesn't currently surface a "register
      // synthetic" path, so the orchestrator inserts directly: this is
      // the ONLY place outside the registry that touches its internals,
      // and it does so through documented hooks (`use(instance)` +
      // `container.register`).
      const root = makeRootContextModule(options.providers);
      app.__moduleRegistry.use(root);
      for (const [token, providerDef] of options.providers) {
        app._container.register(token, providerDef);
      }
    }

    // Eagerly initialise singleton providers AFTER all modules are
    // registered so cross-module dependencies are visible during
    // resolution.
    await app._container.eagerlyInitialize();

    return app;
  }

  // ─── Lifecycle (start) ───────────────────────────────────────────────

  async start(): Promise<void> {
    // Join an in-flight start.
    if (this._lifecycle.state === ApplicationState.Starting && this._lifecycle.startPromise) {
      return this._lifecycle.startPromise;
    }
    // Wait for an in-flight stop to settle then proceed.
    if (this._lifecycle.state === ApplicationState.Stopping && this._lifecycle.stopPromise) {
      await this._lifecycle.stopPromise;
    }
    this._lifecycle.ensureCanStart();

    // setState() is the legacy observation point — route the transition
    // through it so test consumers that monkey-patch setState see every
    // change. The state-machine's `beginStart` captures the side-effects
    // (start time, in-flight promise) without touching state.
    this.setState(ApplicationState.Starting);
    const work = this._doStart();
    const handle = this._lifecycle.beginStart(work);
    try {
      await work;
    } finally {
      handle.dispose();
    }
  }

  private async _doStart(): Promise<void> {
    // Ensure state change is observable before continuing.
    await new Promise((resolve) => setImmediate(resolve));

    // Tracks modules that successfully completed onStart — so a later
    // failure rolls them back in reverse order. Without this, a mid-
    // start failure left every preceding module's side-effects in
    // place.
    const startedForRollback: IModule[] = [];

    try {
      this._events.emit(ApplicationEvent.Starting);

      // Initialize core modules if not already done.
      if (!this._container.has(NETRON_TOKEN) && !this.__configStore.rawGet('disableCoreModules')) {
        await this.initializeCoreModules();
      }

      // Resolve the logger early so the rest of start has structured output.
      if (this._container.has(LOGGER_SERVICE_TOKEN)) {
        try {
          const loggerService = this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
          this._logger = loggerService.logger;
          this._events.setLogger(this._logger);
          this._logger.info({ state: this._lifecycle.state }, 'Application starting');
          this._events.emit(ApplicationEvent.ModuleStarted, { module: 'logger' });
        } catch { /* logger optional during boot */ }
      }

      // Install process listeners (signals + error events).
      this._process.setLogger(this._logger);
      this._process.install({
        onSignal: (signal, reason) => {
          void this.shutdown(reason, { signal }).catch((error) => {
            this._logger?.fatal({ error }, 'Failed to handle signal');
            this._process.exit(1, { emit: (e, d) => this._events.emit(e, d) });
          });
        },
        onRecoverableException: () => undefined,
        onFatalException: (error) => {
          void this.shutdown(ShutdownReason.UncaughtException, { error }).catch((err) => {
            this._logger?.fatal({ error: err }, 'Failed to handle uncaught exception');
            this._process.exit(1, { emit: (e, d) => this._events.emit(e, d) });
          });
        },
        onRecoverableRejection: () => undefined,
        onFatalRejection: (reason, promise) => {
          void this.shutdown(ShutdownReason.UnhandledRejection, { reason, promise }).catch((error) => {
            this._logger?.fatal({ error }, 'Failed to handle unhandled rejection');
            this._process.exit(1, { emit: (e, d) => this._events.emit(e, d) });
          });
        },
        emit: (event, data) => this._events.emit(event, data),
      });

      // Pull any pending shutdown tasks registered before the app instance existed.
      const pending = (globalThis as { __titanShutdownTasks?: IShutdownTask[] }).__titanShutdownTasks;
      if (pending) {
        for (const task of pending) this._shutdown.registerTask(task);
        delete (globalThis as { __titanShutdownTasks?: IShutdownTask[] }).__titanShutdownTasks;
      }

      // Start modules in topological order.
      const sortedModules = this.__moduleRegistry.sorted();
      for (const [, module] of sortedModules) {
        this._logger?.debug({ module: module.name }, 'Starting module');

        if (module.onRegister) {
          try {
            await module.onRegister(this);
          } catch (error) {
            await this.rollbackStartedModules(startedForRollback);
            throw new Error(
              `Module "${module.name}" failed during onRegister: ${(error as Error).message}`,
              { cause: error },
            );
          }
        }
        if (module.onStart) {
          try {
            await module.onStart(this);
          } catch (error) {
            await this.rollbackStartedModules(startedForRollback);
            throw new Error(
              `Module "${module.name}" failed during onStart: ${(error as Error).message}`,
              { cause: error },
            );
          }
        }
        startedForRollback.push(module);
        this._events.emit(ApplicationEvent.ModuleStarted, { module: module.name });
        this._logger?.debug({ module: module.name }, 'Module started');
      }

      // Start Netron if available. Failure is non-fatal.
      if (this._container.has(NETRON_TOKEN)) {
        try {
          const netron = (await this._container.resolveAsync(NETRON_TOKEN)) as Netron;
          if (netron) {
            await netron.start();
            this._logger?.info({ module: 'Netron' }, 'Netron service started');
            this._events.emit(ApplicationEvent.ModuleStarted, { module: 'netron' });
          }
        } catch (error) {
          this._logger?.warn({ error }, 'Failed to start Netron service');
        }
      }

      // Run start hooks — every hook bounded by its own timeout
      // (defaults to DEFAULT_HOOK_TIMEOUT_MS) so a stuck hook can't
      // hang start indefinitely.
      for (const hook of this._lifecycle.startHooks) {
        this._logger?.debug({ hook: hook.name }, 'Running start hook');
        const timeout = hook.timeout ?? DEFAULT_HOOK_TIMEOUT_MS;
        await withTimeout(
          Promise.resolve(hook.handler()),
          timeout,
          hookTimeoutError(hook.name ?? '', timeout),
        );
      }

      // Auto-expose @Service-decorated classes to Netron.
      if (this._container.has(NETRON_TOKEN)) {
        try {
          const netron = (await this._container.resolveAsync(NETRON_TOKEN)) as Netron;
          if (netron) await this._exposer.expose(netron);
        } catch (error) {
          this._logger?.warn({ error }, 'Failed to auto-expose services to Netron');
        }
      }

      // SchedulerService onInit() runs cron/interval discovery; eagerly
      // resolve so it gets a chance to bind providers.
      if (this._container.has(SCHEDULER_SERVICE_TOKEN)) {
        try {
          await this._container.resolveAsync(SCHEDULER_SERVICE_TOKEN);
        } catch (error) {
          this._logger?.warn({ error }, 'Failed to eagerly resolve SchedulerService');
        }
      }

      // Run @PostConstruct on every tracked DI instance.
      try {
        await this._container.initialize();
        this._logger?.debug('Container lifecycle initialization completed');
      } catch (error) {
        this._logger?.error({ error }, 'Failed to initialize container lifecycle hooks');
        throw error;
      }

      this.setState(ApplicationState.Started);
      this._lifecycle.markStarted();
      this._events.emit(ApplicationEvent.Started);
      this._logger?.info(
        {
          state: this._lifecycle.state,
          startupTime: this._lifecycle.uptime,
          modules: this.__moduleRegistry.list().map((m) => m.name),
        },
        'Application started successfully',
      );
    } catch (error) {
      // Roll back any module that successfully reached onStart.
      // Idempotent: a no-op if the inner-loop catch already ran.
      await this.rollbackStartedModules(startedForRollback);
      try {
        await this._container.dispose();
      } catch (disposeErr) {
        this._logger?.warn(
          { error: disposeErr },
          'Container disposal during start-rollback failed',
        );
      }
      this.setState(ApplicationState.Failed);
      this._lifecycle.markFailed();
      this._logger?.error({ error }, 'Application failed to start');
      if (error instanceof Error) this._events.emit(ApplicationEvent.Error, error);
      throw error;
    }
  }

  private async rollbackStartedModules(started: IModule[]): Promise<void> {
    while (started.length > 0) {
      const mod = started.pop()!;
      if (!mod.onStop) continue;
      try {
        await mod.onStop(this);
        this._logger?.debug({ module: mod.name }, 'Rolled back module on failed start');
      } catch (err) {
        this._logger?.warn(
          { module: mod.name, error: err },
          'Module rollback (onStop) failed during failed-start cleanup',
        );
      }
    }
  }

  // ─── Lifecycle (stop) ────────────────────────────────────────────────

  async stop(options: IShutdownOptions = {}): Promise<void> {
    if (this._lifecycle.state === ApplicationState.Stopping && this._lifecycle.stopPromise) {
      return this._lifecycle.stopPromise;
    }
    if (this._lifecycle.state === ApplicationState.Starting && this._lifecycle.startPromise) {
      await this._lifecycle.startPromise;
    }
    if (!this._lifecycle.canStop()) return;

    this.setState(ApplicationState.Stopping);
    const work = this._doStop(options);
    const handle = this._lifecycle.beginStop(work);
    try {
      await work;
    } finally {
      handle.dispose();
    }
  }

  private async _doStop(options: IShutdownOptions = {}): Promise<void> {
    this._logger?.info({ options }, 'Application stopping');
    await new Promise((resolve) => setImmediate(resolve));

    try {
      this._events.emit(ApplicationEvent.Stopping);

      const stopTimeout = options.timeout;

      // Stop hooks (in reverse-registration order).
      if (!options.force || stopTimeout) {
        for (let i = this._lifecycle.stopHooks.length - 1; i >= 0; i--) {
          const hook = this._lifecycle.stopHooks[i]!;
          this._logger?.debug({ hook: hook.name }, 'Running stop hook');
          try {
            const promise = Promise.resolve(hook.handler());
            const timeout = stopTimeout || hook.timeout;
            if (timeout) {
              await withTimeout(
                promise,
                timeout,
                Errors.timeout(`Stop hook ${hook.name || 'unnamed'}`, timeout),
              );
            } else if (!options.force) {
              await promise;
            }
          } catch (error) {
            if (!options.force) throw error;
            this._logger?.warn({ error, hook: hook.name }, 'Ignoring stop hook error due to force stop');
          }
        }
      }

      // Run shutdown tasks unless we're INSIDE a shutdown-driven stop —
      // in that case `ShutdownCoordinator.shutdown()` already ran them.
      if (!this._shutdown.isShuttingDown && this._shutdown.hasTasks) {
        const sortedTasks = Array.from(this._shutdown.taskValues())
          .map((t) => ({ ...t, priority: Number(t.priority ?? 50) }))
          .sort((a, b) => {
            const ap = Number(a.priority ?? 50);
            const bp = Number(b.priority ?? 50);
            if (ap !== bp) return ap - bp;
            return (a.id ?? '').localeCompare(b.id ?? '');
          });
        for (const task of sortedTasks) {
          try {
            this._logger?.debug({ taskName: task.name }, 'Executing shutdown task');
            await Promise.resolve(task.handler(ShutdownReason.Manual, options));
            this._logger?.debug({ taskName: task.name }, 'Shutdown task completed');
          } catch (error) {
            this._logger?.error({ error, taskName: task.name }, 'Shutdown task failed');
            if (task.critical && !options.force) throw error;
          }
        }
      }

      // Stop modules in reverse topological order.
      const sortedModules = this.__moduleRegistry.sorted();
      for (let i = sortedModules.length - 1; i >= 0; i--) {
        const [, module] = sortedModules[i]!;
        this._logger?.debug({ module: module.name }, 'Stopping module');
        try {
          if (module.onStop) {
            if (options.force && !stopTimeout) {
              this._logger?.debug(
                { module: module.name },
                'Skipping module stop due to force stop without timeout',
              );
            } else {
              const promise = Promise.resolve(module.onStop(this));
              if (stopTimeout) {
                await withTimeout(
                  promise,
                  stopTimeout,
                  Errors.timeout(`Module ${module.name} stop`, stopTimeout),
                );
              } else {
                await promise;
              }
            }
          }
          if (module.onDestroy && !options.force) await module.onDestroy();
        } catch (error) {
          this._logger?.error({ error, module: module.name }, 'Module stop failed');
          if (error instanceof Error && error.message.includes('timed out')) {
            if (!options.force) throw error;
            this._logger?.warn(
              { module: module.name },
              'Module timed out during force stop, continuing',
            );
          } else {
            if (options.graceful === false && !options.force) throw error;
            this._logger?.warn('Continuing stop despite module error');
          }
        }
        this._events.emit(ApplicationEvent.ModuleStopped, { module: module.name });
        this._logger?.debug({ module: module.name }, 'Module stopped');
      }

      this._logger?.info('Application stopped successfully');

      // Stop Netron + logger (in that order — logger flushes from the
      // shutdown task list).
      if (this._container.has(NETRON_TOKEN)) {
        try {
          const netron = this._container.resolve(NETRON_TOKEN) as Netron;
          if (netron) {
            this._logger?.debug({ module: 'Netron' }, 'Stopping Netron service');
            await netron.stop();
            this._events.emit(ApplicationEvent.ModuleStopped, { module: 'netron' });
            this._logger?.info({ module: 'Netron' }, 'Netron service stopped');
          }
        } catch (error) {
          this._logger?.warn({ error }, 'Error stopping Netron service');
        }
      }
      if (this._container.has(LOGGER_SERVICE_TOKEN)) {
        try {
          this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
          this._logger?.debug({ module: 'logger' }, 'Stopping module');
          this._events.emit(ApplicationEvent.ModuleStopped, { module: 'logger' });
        } catch { /* logger optional */ }
      }

      // Cleanup handlers (unless already invoked by shutdown coordinator).
      if (!this._shutdown.isShuttingDown && this._shutdown.hasCleanupHandlers) {
        await this._shutdown.runCleanupHandlers();
      }

      // ALWAYS tear down process listeners. The legacy gate
      // (`!isShuttingDown`) left listeners attached when shutdown drove
      // stop — restart cycles then accumulated listeners forever.
      this._process.cleanup();

      // Give pino-pretty a tick to flush its output buffer.
      await new Promise((resolve) => setImmediate(resolve));

      this.setState(ApplicationState.Stopped);
      this._lifecycle.markStopped();
      this._events.emit(ApplicationEvent.Stopped);
      this._events.emit(ApplicationEvent.ShutdownComplete, {
        reason: ShutdownReason.Manual,
        success: true,
      });
    } catch (error) {
      this.setState(ApplicationState.Failed);
      this._lifecycle.markFailed();
      this._logger?.error({ error }, 'Error during application stop');
      if (options.force) {
        this._logger?.warn('Force stopping application despite errors');
        this.setState(ApplicationState.Stopped);
        this._lifecycle.markStopped();
        if (process.env['NODE_ENV'] !== 'test' && !this.__configStore.rawGet('disableProcessExit')) {
          process.exit(1);
        }
      } else {
        throw error;
      }
    }
  }

  async restart(): Promise<void> {
    this._logger?.info('Restarting application');
    await this.stop();
    await this.start();
  }

  // ─── Module registration ─────────────────────────────────────────────

  replaceModule<T extends IModule = IModule>(nameOrToken: string | Token<T>, module: T): this {
    this.__moduleRegistry.replace(nameOrToken, module, this._lifecycle.state, this._lifecycle.isStarted);
    return this;
  }

  async registerModule(moduleInput: ModuleInput): Promise<IModule> {
    return this.__moduleRegistry.register(moduleInput);
  }

  use<T extends IModule>(module: T | Token<T>): this {
    this.__moduleRegistry.use(module);
    return this;
  }

  getModule<T extends IModule = IModule>(nameOrToken: string | Token<T>): T {
    return this.__moduleRegistry.get<T>(nameOrToken);
  }

  has(token: Token<unknown>): boolean {
    return this.__moduleRegistry.has(token);
  }

  hasModule(nameOrToken: string | Token<unknown>): boolean {
    if (typeof nameOrToken === 'string') return this.__moduleRegistry.hasByName(nameOrToken);
    return this.__moduleRegistry.has(nameOrToken);
  }

  getModules(): IModule[] {
    return this.__moduleRegistry.list();
  }

  async registerDynamic(module: IModule): Promise<void> {
    await this.__moduleRegistry.registerDynamic(module);
    if (module.onStart) await module.onStart(this);
  }

  async discoverModules(scanPaths?: string | string[], excludePaths?: string[]): Promise<ModuleConstructor[]> {
    return this._discovery.discover(scanPaths, excludePaths);
  }

  // ─── Configuration ───────────────────────────────────────────────────

  config(): IApplicationConfig;
  config<K extends keyof IApplicationConfig>(key: K): IApplicationConfig[K];
  config<K extends keyof IApplicationConfig>(key?: K): IApplicationConfig | IApplicationConfig[K] {
    if (key === undefined) return this.getConfig();
    return this.__configStore.get(key);
  }

  getConfig(): IApplicationConfig {
    return this.__configStore.toUserView();
  }

  configure<T = ConfigObject>(configOrKey: T | string, value?: ConfigValue): this {
    const options: ConfigObject =
      typeof configOrKey === 'string'
        ? { [configOrKey as string]: value }
        : (configOrKey as ConfigObject);

    this.__configStore.merge(options);

    // Module-level reconfigure pass — invoke once per module that has
    // a `configure` method and a config section under its name.
    for (const module of this.__moduleRegistry.values()) {
      if (module.configure) {
        const moduleConfig = this.__configStore.rawGet(module.name);
        if (moduleConfig !== undefined) module.configure(moduleConfig);
      }
    }

    this._events.emit(ApplicationEvent.ConfigChanged, { config: this.getConfig() });
    return this;
  }

  setConfig(key: string, value: ConfigValue): void {
    this.__configStore.setNested(key, value);
    this._events.emit(ApplicationEvent.ConfigChanged, { key, value });
  }

  // ─── Event system ────────────────────────────────────────────────────

  on<E extends ApplicationEvent>(event: E, handler: EventHandler): void {
    this._events.on(event, handler);
  }

  off<E extends ApplicationEvent>(event: E, handler?: EventHandler): void {
    if (handler) this._events.off(event, handler);
    else this._events.removeAllListeners(event);
  }

  once<E extends ApplicationEvent>(event: E, handler: EventHandler): void {
    this._events.once(event, handler);
  }

  prependListener<E extends ApplicationEvent>(event: E, handler: EventHandler): void {
    this._events.prependListener(event, handler);
  }

  removeAllListeners<E extends ApplicationEvent>(event?: E): void {
    this._events.removeAllListeners(event);
  }

  listenerCount<E extends ApplicationEvent>(event: E): number {
    return this._events.listenerCount(event);
  }

  emit<E extends ApplicationEvent | string>(event: E, data?: unknown): void {
    this._events.emit(event, data);
  }

  async emitAsync<E extends ApplicationEvent | string>(event: E, data?: unknown): Promise<void> {
    return this._events.emitAsync(event, data);
  }

  // ─── Lifecycle hooks ─────────────────────────────────────────────────

  onStart(hook: ILifecycleHook | (() => void | Promise<void>), priority?: number, timeout?: number): this {
    this._lifecycle.addStartHook(hook, priority, timeout);
    return this;
  }

  onStop(hook: ILifecycleHook | (() => void | Promise<void>), priority?: number, timeout?: number): this {
    this._lifecycle.addStopHook(hook, priority, timeout);
    return this;
  }

  onError(handler: (error: Error) => void): this {
    this._events.registerErrorHandler(handler);
    return this;
  }

  // ─── Runtime info ────────────────────────────────────────────────────

  get state(): ApplicationState {
    return this._lifecycle.state;
  }

  get uptime(): number {
    return this._lifecycle.uptime;
  }

  get isStarted(): boolean {
    return this._lifecycle.isStarted;
  }

  get container(): Container {
    return this._container;
  }

  get name(): string {
    return this._name;
  }

  get version(): string {
    return this._version;
  }

  get debug(): boolean {
    return this._debug;
  }

  get environment(): IEnvironment {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      pid: process.pid,
      ppid: process.ppid,
    };
  }

  get metrics(): IApplicationMetrics {
    return {
      uptime: this._lifecycle.uptime,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      startupTime: this._lifecycle.startupTime,
      modules: this.__moduleRegistry.size,
    };
  }

  getMetrics(): IApplicationMetrics {
    // Historical divergence: this method reports `process.uptime()` (in ms)
    // rather than `this._lifecycle.uptime`. Preserved verbatim because at
    // least one consumer (omnitron metrics-bridge) reads each independently
    // and treats the divergence as the "wall-clock vs since-start" pair.
    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      startupTime: this._lifecycle.uptime,
      modules: this.__moduleRegistry.size,
    };
  }

  get modules(): Map<string, IModule> {
    return this.__moduleRegistry.byName();
  }

  // ─── DI surface ──────────────────────────────────────────────────────

  register<T>(token: Token<T>, provider: Provider<T>, options?: { override?: boolean }): this {
    this._container.register(token, provider, options);
    return this;
  }

  resolve<T>(token: Token<T>): T {
    return this._container.resolve(token);
  }

  async resolveAsync<T>(token: Token<T>): Promise<T> {
    return this._container.resolveAsync(token);
  }

  get<T>(token: Token<T>): T {
    return this.__moduleRegistry.resolveOrFail(token);
  }

  hasProvider(token: Token<unknown>): boolean {
    return this._container.has(token);
  }

  get logger(): ILogger | undefined {
    if (!this._logger && this._container.has(LOGGER_SERVICE_TOKEN)) {
      try {
        const loggerService = this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
        this._logger = loggerService.logger;
        this._events.setLogger(this._logger);
      } catch { /* logger optional */ }
    }
    return this._logger;
  }

  get netron(): Netron | undefined {
    if (this._container.has(NETRON_TOKEN)) {
      try {
        return this._container.resolve(NETRON_TOKEN) as Netron;
      } catch { /* netron optional */ }
    }
    return undefined;
  }

  // ─── Health ──────────────────────────────────────────────────────────

  async checkHealth(moduleName: string): Promise<IHealthStatus> {
    return this._health.checkModule(moduleName);
  }

  async health(): Promise<IHealthStatus> {
    return this._health.aggregate();
  }

  // ─── Shutdown system ─────────────────────────────────────────────────

  registerShutdownTask(
    taskOrName: IShutdownTask | string,
    handler?: () => void | Promise<void>,
    priority?: number,
    isCritical?: boolean,
  ): string {
    return this._shutdown.registerTask(taskOrName, handler, priority, isCritical);
  }

  unregisterShutdownTask(taskId: string): void {
    this._shutdown.unregisterTask(taskId);
  }

  registerCleanup(handler: () => Promise<void> | void): void {
    this._shutdown.registerCleanup(handler);
  }

  /** @deprecated Use `registerCleanup`. Retained for compatibility. */
  registerCleanupHandler(handler: () => Promise<void> | void): void {
    this._shutdown.registerCleanup(handler);
  }

  async shutdown(reason: ShutdownReason, details?: { signal?: string; error?: Error; reason?: unknown; promise?: Promise<unknown> }): Promise<void> {
    this._lifecycle.markShuttingDown();
    try {
      await this._shutdown.shutdown(reason, details);
      if (reason !== ShutdownReason.Manual) {
        this._process.exit(0, { emit: (e, d) => this._events.emit(e, d) });
      }
    } catch (error) {
      // Force-exit safety net (separate from the controller's own).
      setTimeout(() => {
        this._logger?.fatal('Force killing process after timeout');
        this._process.exit(1, { emit: (e, d) => this._events.emit(e, d) });
      }, 5000);
      throw error;
    }
  }

  forceShutdown(code: number = 1): void {
    this._logger?.fatal(`Force shutdown with code ${code}`);
    this._process.exit(code, { emit: (e, d) => this._events.emit(e, d) });
  }

  getProcessMetrics(): IProcessMetrics {
    const uptime =
      this._lifecycle.uptime > 0
        ? Math.max(1, this._lifecycle.uptime)
        : Math.max(1, process.uptime() * 1000);
    return {
      uptime,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      pid: process.pid,
      ppid: process.ppid,
      platform: process.platform,
      nodeVersion: process.version,
      state: this._lifecycle.lifecycleState,
      shutdownTasksCount: this._shutdown.taskCount,
      cleanupHandlersCount: this._shutdown.cleanupCount,
    };
  }

  // ─── Core-module bootstrap ───────────────────────────────────────────

  private async initializeCoreModules(): Promise<void> {
    // Logger first — every subsequent core-init step uses it.
    if (!this._container.has(LOGGER_SERVICE_TOKEN) && !this._container.has(LOGGER_OPTIONS_TOKEN)) {
      const loggerConfig = (this.__configStore.rawGet('logger') ?? this.__configStore.rawGet('logging') ?? {}) as Record<string, unknown>;
      const loggerOptions = {
        ...loggerConfig,
        level: (loggerConfig['level'] as string | undefined) ?? (this.__configStore.rawGet('debug') ? 'debug' : 'info'),
        prettyPrint:
          (loggerConfig['prettyPrint'] as boolean | undefined) ??
          this.__configStore.rawGet('environment') === 'development',
        name: this.__configStore.rawGet('name') || 'titan-app',
      };
      const loggerModuleConfig = LoggerModule.forRoot(loggerOptions as Parameters<typeof LoggerModule.forRoot>[0]);
      this.__moduleRegistry.registerCoreDynamic(loggerModuleConfig as IDynamicModule);
    }

    if (!this._logger && this._container.has(LOGGER_SERVICE_TOKEN)) {
      try {
        const loggerService = (await this._container.resolveAsync(LOGGER_SERVICE_TOKEN)) as ILoggerModule;
        this._logger = loggerService.logger;
        this._events.setLogger(this._logger);
        this._logger.info({ module: 'Application' }, 'Logger module initialized');
      } catch { /* logger optional */ }
    }

    if (!this._container.has(CONFIG_SERVICE_TOKEN) && !this._container.has(CONFIG_OPTIONS_TOKEN)) {
      const configOptions = {
        sources: [
          { type: 'object' as const, data: this.__configStore.raw as Record<string, unknown> },
          { type: 'env' as const },
        ],
      };
      const configModuleConfig = ConfigModule.forRoot(configOptions);
      this.__moduleRegistry.registerCoreDynamic(configModuleConfig as IDynamicModule);
    }

    // ConfigService.onInit() — manually invoked because ConfigModule
    // registers ConfigService as `useValue`, and the container skips
    // lifecycle hooks for those.
    if (this._container.has(CONFIG_SERVICE_TOKEN)) {
      try {
        this._logger?.debug({ module: 'Application' }, 'Attempting to resolve ConfigService...');
        const configService = (await this._container.resolveAsync(CONFIG_SERVICE_TOKEN)) as {
          onInit?: () => Promise<void> | void;
        };
        if (configService?.onInit) {
          await configService.onInit();
          this._logger?.debug({ module: 'Application' }, 'ConfigService initialized');
        }
      } catch (error) {
        this._logger?.warn({ module: 'Application', error }, 'Failed to initialize ConfigService');
      }
    }

    if (!this._container.has(NETRON_TOKEN)) {
      const netronConfig = (this.__configStore.rawGet('netron') ?? {}) as NetronOptions;
      const netronOptions: NetronOptions = {
        ...netronConfig,
        id: netronConfig.id || `${this._name}-netron`,
      };
      if (this._logger) {
        const netron = new Netron(this._logger, netronOptions);
        this._container.register(NETRON_TOKEN, { useValue: netron });
        this._logger.debug({ module: 'Application' }, 'Netron service registered as singleton instance');
      }
    }
  }

  // ─── Backward-compat private-field shims ─────────────────────────────
  //
  // Several test suites and a handful of older internal call sites poke
  // at fields that the legacy monolithic Application exposed as private
  // members (`_config`, `_modules`, `_state`, `_isStarted`, `setState`,
  // `_disableProcessExit`). The T#33 refactor moved those fields into
  // dedicated collaborators, but breaking the contract on a refactor
  // would cascade into churn elsewhere. The accessors below preserve
  // the EXACT shape callers reached for — read AND write — by routing
  // through the collaborator surface. All marked `@internal` and not
  // documented as public.

  /** @internal — proxy to `__configStore.raw`. */
  private get _config(): Readonly<IApplicationConfig> {
    return this.__configStore.raw;
  }

  /** @internal — proxy to `__moduleRegistry`'s underlying Map. */
  private get _modules(): Map<Token<IModule>, IModule> {
    return this.__moduleRegistry.rawMap();
  }

  /** @internal — proxy to `_lifecycle.state`. */
  private get _state(): ApplicationState {
    return this._lifecycle.state;
  }
  private set _state(value: ApplicationState) {
    this._lifecycle.forceState(value);
  }

  /** @internal — proxy to `_lifecycle.isStarted`. */
  private get _isStarted(): boolean {
    return this._lifecycle.isStarted;
  }
  private set _isStarted(value: boolean) {
    // Force-set the underlying state to match. Legacy code used this
    // pair (`_state` + `_isStarted`) as two independently writable
    // signals; we collapse onto the single state-machine axis.
    if (value) this._lifecycle.forceState(ApplicationState.Started);
    else if (this._lifecycle.state === ApplicationState.Started) {
      this._lifecycle.forceState(ApplicationState.Stopped);
    }
  }

  /** @internal — legacy private method; forwards to `_lifecycle.forceState`. */
  private setState(state: ApplicationState): void {
    this._lifecycle.forceState(state);
  }

  /**
   * @internal — legacy `disableProcessExit` flag that gates the actual
   * `process.exit` call. The ProcessHost collaborator owns the live
   * value; this shim proxies for callers that toggle it on the
   * Application instance directly.
   */
  private get _disableProcessExit(): boolean {
    return (this._process as unknown as { disableProcessExit: boolean }).disableProcessExit;
  }
  private set _disableProcessExit(value: boolean) {
    (this._process as unknown as { disableProcessExit: boolean }).disableProcessExit = value;
  }

  // ─── Internal helpers ────────────────────────────────────────────────

  /**
   * Flush logger output through the logger service if it exposes a
   * `flush()` method. Used by the default `flush-logs` shutdown task.
   */
  private async flushLoggerService(): Promise<void> {
    if (!this._container.has(LOGGER_SERVICE_TOKEN)) return;
    try {
      const loggerService = this._container.resolve(LOGGER_SERVICE_TOKEN) as ILoggerModule;
      if (loggerService && typeof loggerService.flush === 'function') {
        await loggerService.flush();
      }
    } catch (error) {
      this._logger?.warn({ error }, 'Failed to flush logger');
    }
  }

  /**
   * Type-guard for the `IDynamicModule` shape — exposed for any user
   * code that branches on input shape. Mirrors the legacy private
   * helper, surfaced because some test fixtures historically reached
   * into it via `as any`.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private isDynamicModule(obj: unknown): obj is IDynamicModule {
    return isDynamicModuleInternal(obj);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Race `promise` against a timeout. Resolves with `promise`'s value when
 * it settles first; rejects with `timeoutError` if the timer fires. Used
 * by start/stop hook running and module-stop bounded waits.
 */
function withTimeout<T>(promise: Promise<T>, timeout: number, timeoutError: Error): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(timeoutError), timeout)),
  ]);
}

/**
 * Create a new Titan application without starting it. Thin sugar over
 * `new Application()` for callers that prefer functional construction.
 *
 * @stable
 * @since 0.1.0
 */
export function createApp(options?: IApplicationOptions): Application {
  return new Application(options);
}

/**
 * Create and start an application. Helper for the common 2-line
 * "make + start" pattern.
 *
 * @stable
 * @since 0.1.0
 */
export async function startApp(options?: IApplicationOptions): Promise<Application> {
  const app = createApp(options);
  await app.start();
  return app;
}

// Re-export the public type re-exports the legacy file expressed.
export type { ProcessSignal };
