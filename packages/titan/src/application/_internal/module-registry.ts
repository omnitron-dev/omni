/**
 * Internal collaborator — module registry.
 *
 * Owns the `Map<Token<IModule>, IModule>` (call it the "module set"),
 * the class-level dedup `WeakSet`, and the topological-sort algorithm
 * used by start/stop. The four entry points correspond to the public
 * Application APIs:
 *
 *   1. `register(moduleInput)` — full async path with `forRoot`, dynamic
 *      module objects, factory functions, `@Module` metadata, and
 *      provider/import recursion. The one consumers usually reach.
 *   2. `use(module|token)` — synchronous path used by the simple API.
 *      Skips async work; only handles instances or already-resolved
 *      tokens. Replicates the legacy `use()` semantics including its
 *      synchronous `@Module` metadata processing.
 *   3. `replace(nameOrToken, module)` — pre-start replacement of a
 *      module. Used by tests and config-driven swaps.
 *   4. `registerCoreDynamic(dynamicConfig)` — the special-case used by
 *      Logger/Config core registration. Registers tuple providers
 *      directly without the full `loadModuleAsync` pipeline.
 *
 * Why a dedicated collaborator? The legacy `Application.registerModule`
 * was 200 lines of nested ifs and the metadata-extraction logic was
 * duplicated three times across `registerModule`/`use`/internal helpers.
 * Centralising the metadata pipeline and the input-shape resolution
 * (`resolveInput`) means a future change to the shape contract touches
 * one file.
 *
 * Single responsibility: own the module set + topo-sort + the
 * input-shape-resolution algorithm. Doesn't know about lifecycle, the
 * event bus, or shutdown.
 *
 * @internal
 */

import 'reflect-metadata';
import {
  Container,
  createToken,
  type Constructor,
  type InjectionToken,
  type Provider,
  type ProviderDefinition,
  type Token,
} from '../../nexus/index.js';
import { Errors } from '../../errors/index.js';
import {
  ApplicationEvent,
  ApplicationState,
  type ConfigObject,
  type IDynamicModule,
  type IModule,
  type ModuleConstructor,
  type ModuleInput,
} from '../../types.js';
import { LOGGER_SERVICE_TOKEN } from '../../modules/logger/index.js';
import type { ILogger } from '../../modules/logger/index.js';

/**
 * Resolved module-input shape — the canonical form `register()` works
 * from after running `resolveInput()`. Holds both the instance and the
 * dynamic-module metadata we want to merge in (if any).
 */
interface ResolvedInput {
  instance: IModule;
  dynamicModule: IDynamicModule | null;
  /** The class reference used for class-level dedup, or null when input is a bare instance. */
  classRef: ModuleConstructor | null;
  /** Original input — kept so we can read decorator metadata off it post-resolve. */
  source: ModuleInput;
}

export interface ModuleRegistryDeps {
  container: Container;
  emit: (event: ApplicationEvent, data?: unknown) => void;
  getModuleConfig: (name: string) => unknown;
  getLogger: () => ILogger | undefined;
  getAppState: () => ApplicationState;
}

export class ModuleRegistry {
  private readonly modules = new Map<Token<IModule>, IModule>();
  private readonly processedClasses = new WeakSet<object>();
  private readonly deps: ModuleRegistryDeps;

  constructor(deps: ModuleRegistryDeps) {
    this.deps = deps;
  }

  // ─── Reads ───────────────────────────────────────────────────────────

  get size(): number {
    return this.modules.size;
  }

  get tokens(): IterableIterator<Token<IModule>> {
    return this.modules.keys();
  }

  values(): IterableIterator<IModule> {
    return this.modules.values();
  }

  /**
   * Iterate `[token, module]` pairs in REGISTRATION order. Used by
   * start when no sort has yet been performed.
   */
  entries(): IterableIterator<[Token<IModule>, IModule]> {
    return this.modules.entries();
  }

  /**
   * Snapshot of `name → IModule`. The legacy `app.modules` getter
   * exposed this view, so we preserve the public contract.
   */
  byName(): Map<string, IModule> {
    const result = new Map<string, IModule>();
    for (const module of this.modules.values()) result.set(module.name, module);
    return result;
  }

  has(token: Token<unknown>): boolean {
    return this.modules.has(token as Token<IModule>) || this.deps.container.has(token);
  }

  /**
   * Direct access to the underlying `Map`. Intentionally exposed for
   * the legacy backward-compat `Application._modules` shim — several
   * tests reach in and call `.clear()` to reset state between runs.
   * Not part of the public API; callers should treat this as
   * read-only unless they are running inside a test.
   *
   * @internal
   */
  rawMap(): Map<Token<IModule>, IModule> {
    return this.modules;
  }

  hasByName(name: string): boolean {
    for (const module of this.modules.values()) {
      if (module.name === name) return true;
    }
    return false;
  }

  /**
   * Snapshot of registered modules in start-order when the app is
   * running (uses the topo sort) and in registration order otherwise.
   * On a circular-dependency exception during sort we fall back to
   * registration order — read calls should never throw.
   */
  list(): IModule[] {
    const state = this.deps.getAppState();
    if (state === ApplicationState.Started || state === ApplicationState.Starting) {
      try {
        return this.sorted().map(([, module]) => module);
      } catch {
        return Array.from(this.modules.values());
      }
    }
    return Array.from(this.modules.values());
  }

  /**
   * Look up a module by name OR token. The token path also tries the
   * container as a fallback so consumers can resolve modules registered
   * directly with `register(token, useValue)`. On token miss we throw
   * `Errors.notFound('Module', ...)` matching the legacy behaviour.
   */
  get<T extends IModule = IModule>(nameOrToken: string | Token<T>): T {
    if (typeof nameOrToken === 'string') {
      for (const module of this.modules.values()) {
        if (module.name === nameOrToken) return module as T;
      }
      throw Errors.notFound('Module', nameOrToken);
    }
    const token = nameOrToken;
    if (this.modules.has(token as unknown as Token<IModule>)) {
      return this.modules.get(token as unknown as Token<IModule>) as T;
    }
    try {
      const resolved = this.deps.container.resolve(token);
      if (resolved) {
        this.modules.set(token as unknown as Token<IModule>, resolved as unknown as IModule);
        return resolved as T;
      }
    } catch {
      // fallthrough to notFound
    }
    throw Errors.notFound('Module', token.name);
  }

  /**
   * Module-or-fallback-to-container lookup. Used by `app.get(token)`.
   * Differs from `get()` because the fallback returns ANY container
   * registration, not just modules. The translation of
   * "AsyncResolutionError → user-readable bad-request error" stays here
   * because the legacy `Application.get()` was the place tests asserted
   * that wording against.
   */
  resolveOrFail<T>(token: Token<T>): T {
    const moduleToken = token as unknown as Token<IModule>;
    if (this.modules.has(moduleToken)) {
      return this.modules.get(moduleToken) as unknown as T;
    }
    try {
      const resolved = this.deps.container.resolve(token);
      if (resolved && typeof resolved === 'object' && 'name' in resolved) {
        this.modules.set(moduleToken, resolved as IModule);
      }
      return resolved;
    } catch (error) {
      const e = error as { message?: string; name?: string };
      if (e?.message?.includes('registered as async') || e?.name === 'AsyncResolutionError') {
        const tokenName = token.name || token.id.description || 'Unknown';
        throw Errors.badRequest(
          `Cannot resolve '${tokenName}' synchronously because it has async dependencies. ` +
            `Use 'await app.resolveAsync(${tokenName})' instead.`,
        );
      }
      const tokenName = token.name || token.id.description || 'Unknown';
      throw Errors.notFound('Module', tokenName);
    }
  }

  // ─── Mutations ───────────────────────────────────────────────────────

  /**
   * Full async registration path. Order of operations is load-bearing —
   * keep the comments to spare the next reader the legacy archaeology.
   */
  async register(moduleInput: ModuleInput): Promise<IModule> {
    // 1. Class-level dedup. We extract the class reference uniformly
    //    across all input shapes (bare class, `forRoot()` result,
    //    raw dynamic-module object). When the same class has been
    //    processed before, return the existing instance without
    //    re-registering providers — that was the bug T#26 fixed.
    const classRef = extractClassRef(moduleInput);
    if (classRef && this.processedClasses.has(classRef)) {
      for (const module of this.modules.values()) {
        if (module.constructor === classRef || module.name === classRef.name) return module;
      }
    }

    // 2. Reduce the input to a `{instance, dynamicModule}` pair.
    const resolved = await this.resolveInput(moduleInput);

    // 3. Capture decorator metadata BEFORE we possibly spread-clone the
    //    instance below. `Reflect.getMetadata` on a spread-clone returns
    //    undefined (the spread loses the original class on the prototype
    //    chain — verified with a focused test). Reading once here, from
    //    the genuine constructor and the original input, ensures both
    //    naming and dynamic-module construction see the same view even
    //    after we replace `instance` with a renamed clone.
    const metadata = readModuleMetadata(resolved.instance.constructor)
      ?? readModuleMetadata(resolved.source as object);

    // 4. Naming and metadata. Modules without a name fall back through:
    //    decorator metadata → class name on the dynamic module → bare
    //    class name → constructor name. Anything still missing falls
    //    back to 'UnnamedModule' so the token below is non-empty.
    let instance = resolved.instance;
    if (!instance.name) {
      const named = nameFromMetadata(metadata, resolved);
      instance = { ...instance, name: named };
      resolved.instance = instance;
    }

    // 5. Pull `providers`/`imports`/`exports` from EITHER decorator
    //    metadata OR the instance itself if no dynamic module is set
    //    yet. This is the path that handles the `@Module(...)` class
    //    decorator pattern. We pass `metadata` (captured pre-spread)
    //    instead of re-reading off `instance` so the rename above
    //    doesn't lose the link.
    if (!resolved.dynamicModule && metadata) {
      resolved.dynamicModule = buildDynamicFromMetadata(metadata, resolved.source);
    }
    if (!resolved.dynamicModule) {
      const fromInstance = dynamicModuleFromInstance(instance, resolved.source);
      if (fromInstance) resolved.dynamicModule = fromInstance;
    }

    // 5. Register in container + modules map.
    const token = createToken<IModule>(instance.name);
    if (!this.deps.container.has(token)) {
      this.deps.container.register(token, { useValue: instance });
    }
    this.modules.set(token, instance);

    // 6. Wire providers + imports if a dynamic module is attached.
    if (resolved.dynamicModule) {
      await this.processDynamic(resolved.dynamicModule, instance);
    }

    // 7. Per-module config hand-off.
    const moduleConfig = this.deps.getModuleConfig(instance.name);
    if (instance.configure && moduleConfig !== undefined) {
      instance.configure(moduleConfig);
    }

    this.deps.emit(ApplicationEvent.ModuleRegistered, { module: instance.name });

    if (resolved.classRef) this.processedClasses.add(resolved.classRef);
    return instance;
  }

  /**
   * Synchronous register path used by `app.use()`. Restricted to module
   * INSTANCES or already-registered TOKENS (token path resolves via the
   * container synchronously). The legacy implementation processed
   * `@Module` metadata synchronously here — repeated below verbatim so
   * the tests that depend on that order keep passing.
   */
  use<T extends IModule>(input: T | Token<T>): void {
    // Token path: resolve from container and store. Idempotent on
    // already-registered tokens.
    if (typeof input === 'object' && input !== null && 'symbol' in input && 'id' in input) {
      const token = input as Token<T>;
      if (this.modules.has(token as unknown as Token<IModule>)) return;
      const moduleInstance = this.deps.container.resolve(token) as unknown as IModule;
      this.modules.set(token as unknown as Token<IModule>, moduleInstance);
      return;
    }

    const moduleInstance = input as IModule;
    // Instance path: reference-dedup against existing modules.
    for (const existing of this.modules.values()) {
      if (existing === moduleInstance) return;
    }
    const token = createToken<IModule>(moduleInstance.name);
    this.modules.set(token, moduleInstance);

    // Process `@Module` metadata synchronously — providers/exports only.
    const metadata = readModuleMetadata(moduleInstance.constructor) ?? readModuleMetadata(moduleInstance as object);
    if (metadata) {
      const providers = (metadata as { providers?: SyncProvider[] }).providers;
      if (providers) {
        for (const provider of providers) this.registerSyncProvider(provider);
      }
      const exports = (metadata as { exports?: Array<InjectionToken<unknown> | string> }).exports;
      if (exports) {
        for (const exportToken of exports) this.registerSyncExport(exportToken, providers);
      }
    }

    // Per-module config hand-off.
    if (moduleInstance.configure) {
      const moduleConfig = this.deps.getModuleConfig(moduleInstance.name);
      if (moduleConfig !== undefined) moduleInstance.configure(moduleConfig);
    }

    this.deps.emit(ApplicationEvent.ModuleRegistered, { module: moduleInstance.name });
  }

  /**
   * Replace an existing module pre-start. Throws if the application is
   * past `Created`/`Stopped` — replacement at runtime would race with
   * in-flight resolutions. The legacy semantics: if `nameOrToken` is a
   * string and no existing module matches, create a fresh token and
   * register against it (i.e. degrade to "add module under this name").
   */
  replace<T extends IModule>(
    nameOrToken: string | Token<T>,
    module: T,
    state: ApplicationState,
    isStarted: boolean,
  ): void {
    if (isStarted || state === ApplicationState.Started || state === ApplicationState.Starting) {
      throw Errors.conflict('Cannot replace modules after application has started');
    }
    let token: Token<T> | undefined;
    if (typeof nameOrToken === 'string') {
      for (const [tok, mod] of this.modules) {
        if (mod.name === nameOrToken) { token = tok as Token<T>; break; }
      }
      if (!token) token = createToken<T>(nameOrToken);
    } else {
      token = nameOrToken;
    }

    if (this.modules.has(token as unknown as Token<IModule>)) {
      this.modules.delete(token as unknown as Token<IModule>);
    }
    this.deps.container.register(token, { useValue: module }, { override: true });
    this.modules.set(token as unknown as Token<IModule>, module as unknown as IModule);
  }

  /**
   * Runtime dynamic registration. Used after `start()` has settled —
   * the legacy implementation gated this on `state === Started` and
   * the test suite enforces that semantics.
   */
  async registerDynamic(module: IModule): Promise<void> {
    if (this.deps.getAppState() !== ApplicationState.Started) {
      throw Errors.conflict('Application must be running to register dynamic modules');
    }

    if (module.dependencies) {
      for (const dep of module.dependencies) {
        if (typeof dep === 'string') {
          if (!this.hasByName(dep)) {
            throw Errors.notFound('Module dependency', `${module.name} requires ${dep}`);
          }
        } else if (dep && typeof dep === 'object' && 'id' in dep) {
          if (!this.has(dep as Token<unknown>)) {
            throw Errors.notFound('Module dependency', `${module.name} requires ${dep.toString()}`);
          }
        }
      }
    }

    await this.register(module);
    if (module.onStart) {
      // The legacy implementation called `onStart` passing the
      // application instance. We can't reach back into Application
      // from here without circular dependency, so the orchestrator
      // performs that call itself after this returns.
    }
  }

  /**
   * Direct registration path used by the core-module bootstrap (Logger,
   * Config). Tuple providers `[token, def]` are registered straight on
   * the container — no `loadModuleAsync` recursion. This is the only
   * path that does NOT participate in dedup or metadata processing.
   */
  registerCoreDynamic(moduleConfig: IDynamicModule): void {
    const { module: ModuleClass, providers = [], exports = [] } = moduleConfig;
    const logger = this.deps.getLogger();

    for (const provider of providers) {
      if (Array.isArray(provider) && provider.length === 2) {
        const [token, providerDef] = provider;
        try {
          this.deps.container.register(token, providerDef);
          logger?.debug(
            { tokenName: tokenLabel(token) },
            'Provider registered',
          );
        } catch (error) {
          logger?.error({ tokenName: tokenLabel(token), error }, 'Failed to register provider');
          throw error;
        }
      }
    }

    if (ModuleClass && exports.length > 0) {
      logger?.debug({
        module: ModuleClass.name,
        providers: providers.length,
        exports: exports.map((t) => tokenLabel(t)),
      }, 'Dynamic module registered');
    }
  }

  /**
   * Topological sort over module dependencies. Returns
   * `[token, module]` pairs in dependency order.
   *
   * Special case: `LoggerModule` is excluded from the OUTPUT (it's
   * started ahead of every other module by the core-init step). It IS
   * visited recursively so that modules declaring `dependencies:
   * ['logger']` see the recursive visit complete before they're added
   * to the output — preserving correct relative ordering.
   *
   * Cycles throw `Errors.conflict` with the offending module's name.
   */
  sorted(): Array<[Token<IModule>, IModule]> {
    const sorted: Array<[Token<IModule>, IModule]> = [];
    const visited = new Set<Token<IModule>>();
    const visiting = new Set<Token<IModule>>();
    const logger = this.deps.getLogger();

    const visit = (token: Token<IModule>): void => {
      if (visited.has(token)) return;
      if (visiting.has(token)) {
        const name = token.name || token.id.description || 'Unknown';
        throw Errors.conflict(`Circular dependency detected in module: ${name}`);
      }
      visiting.add(token);

      const module = this.modules.get(token);
      if (module && module.dependencies) {
        for (const dep of module.dependencies) {
          let depToken: Token<IModule> | undefined;

          if (typeof dep === 'string') {
            for (const [t, m] of this.modules.entries()) {
              if (m.name === dep) { depToken = t; break; }
            }
            if (!depToken) {
              logger?.warn(`Module ${module.name} dependency '${dep}' not found - continuing without it`);
              continue;
            }
          } else if (dep && typeof dep === 'object' && 'id' in dep) {
            depToken = dep as Token<IModule>;
            if (!this.modules.has(depToken)) {
              const depName = depToken.name;
              for (const [t, m] of this.modules.entries()) {
                if (m.name === depName) { depToken = t; break; }
              }
              if (!this.modules.has(depToken)) {
                logger?.warn(`Module ${module.name} dependency '${depName}' not found - continuing without it`);
                continue;
              }
            }
          } else {
            // Non-token, non-string deps (constructor refs, symbols)
            // skip silently — mirrors legacy behaviour.
            continue;
          }

          if (depToken && this.modules.has(depToken)) visit(depToken);
        }
      }

      visiting.delete(token);
      visited.add(token);

      if (module && token.id !== LOGGER_SERVICE_TOKEN.id) {
        sorted.push([token, module]);
      }
    };

    for (const token of this.modules.keys()) visit(token);
    return sorted;
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  /**
   * Coerce any `ModuleInput` shape into the canonical `{instance,
   * dynamicModule, classRef}` triple. Splitting this out makes the
   * top-level `register()` flow read like a recipe.
   */
  private async resolveInput(input: ModuleInput): Promise<ResolvedInput> {
    let instance: IModule;
    let dynamicModule: IDynamicModule | null = null;
    let classRef: ModuleConstructor | null = null;

    if (typeof input === 'function') {
      // Either a class constructor or a factory function. The legacy
      // discriminant: `.prototype.constructor === input` for a class.
      const fn = input as unknown as { prototype?: { constructor?: unknown } };
      if (fn.prototype && fn.prototype.constructor === input) {
        const ModuleClass = input as ModuleConstructor;
        classRef = ModuleClass;
        const withForRoot = ModuleClass as ModuleConstructor & {
          forRoot?: () => IDynamicModule | Promise<IDynamicModule>;
        };
        if (withForRoot.forRoot && typeof withForRoot.forRoot === 'function') {
          const result = withForRoot.forRoot();
          dynamicModule = result instanceof Promise ? await result : result;
        }
        instance = new ModuleClass();
      } else {
        const factory = input as () => IModule | Promise<IModule> | IDynamicModule | Promise<IDynamicModule>;
        const result = await factory();
        if (isDynamicModule(result)) {
          dynamicModule = result;
          const ModuleClass = dynamicModule.module;
          if (typeof ModuleClass === 'function' && ModuleClass.prototype) {
            instance = new (ModuleClass as ModuleConstructor)();
            classRef = ModuleClass as ModuleConstructor;
          } else {
            instance = ModuleClass as unknown as IModule;
          }
        } else {
          instance = result as IModule;
        }
      }
    } else if (isDynamicModule(input)) {
      dynamicModule = input;
      const ModuleClass = dynamicModule.module;
      if (typeof ModuleClass === 'function' && ModuleClass.prototype) {
        instance = new (ModuleClass as ModuleConstructor)();
        classRef = ModuleClass as ModuleConstructor;
      } else {
        instance = ModuleClass as unknown as IModule;
      }
    } else {
      instance = input as IModule;
    }

    if (!instance) {
      throw Errors.internal('Failed to create module instance from provided input');
    }
    return { instance, dynamicModule, classRef, source: input };
  }

  /**
   * Apply a dynamic module's providers + imports to the container.
   * Imports recurse through the full `register()` pipeline (with dedup,
   * metadata, etc.). Providers are filtered: repository providers are
   * skipped because the database module registers them with async
   * factories of its own.
   */
  private async processDynamic(dynamicModule: IDynamicModule, instance: IModule): Promise<void> {
    if (dynamicModule.imports) {
      for (const imported of dynamicModule.imports) {
        await this.register(imported);
      }
    }

    const filtered: Provider<unknown>[] = [];
    if (dynamicModule.providers) {
      for (const provider of dynamicModule.providers) {
        if (Array.isArray(provider)) {
          const [token, def, options] = provider as [
            InjectionToken<unknown>,
            ProviderDefinition<unknown>,
            Record<string, unknown>?,
          ];
          filtered.push({ provide: token, ...(def as object), ...(options || {}) } as unknown as Provider<unknown>);
        } else if (typeof provider === 'function') {
          const isRepository = Reflect.getMetadata('database:is-repository', provider);
          if (isRepository) continue;
          filtered.push(provider);
        } else {
          filtered.push(provider);
        }
      }
    }

    const containerModule: IModule = {
      name: instance.name,
      providers: filtered,
      exports: (dynamicModule.exports || []) as InjectionToken<unknown>[],
      global: dynamicModule.global || false,
    };
    await this.deps.container.loadModuleAsync(containerModule);

    if (dynamicModule.global && dynamicModule.exports) {
      type WithGlobalExports = IModule & { __globalExports?: typeof dynamicModule.exports };
      (instance as WithGlobalExports).__globalExports = dynamicModule.exports;
    }
  }

  private registerSyncProvider(provider: SyncProvider): void {
    if (typeof provider === 'function') {
      this.deps.container.register(provider, { useClass: provider });
    } else if (typeof provider === 'object' && 'provide' in provider) {
      const { provide, ...rest } = provider;
      this.deps.container.register(provide, rest as ProviderDefinition<unknown>);
    }
  }

  private registerSyncExport(
    exportToken: InjectionToken<unknown> | string,
    providers: SyncProvider[] | undefined,
  ): void {
    if (typeof exportToken === 'string') {
      const provider = providers?.find(
        (p) =>
          (typeof p === 'function' && p.name === exportToken) ||
          (typeof p === 'object' && p.provide === exportToken),
      );
      if (provider && !this.deps.container.has(exportToken)) {
        if (typeof provider === 'function') {
          this.deps.container.register(provider, { useClass: provider });
        } else if (typeof provider === 'object' && 'provide' in provider) {
          const { provide, ...rest } = provider;
          this.deps.container.register(provide, rest as ProviderDefinition<unknown>);
        }
      }
    } else if (!this.deps.container.has(exportToken) && typeof exportToken === 'function') {
      this.deps.container.register(exportToken, { useClass: exportToken as Constructor<unknown> });
    }
  }
}

// ─── Free helpers (testable in isolation) ──────────────────────────────

type SyncProvider =
  | Constructor<unknown>
  | (Provider<unknown> & { provide: InjectionToken<unknown> });

/**
 * Type-guard for the `IDynamicModule` shape: `{ module: function, ... }`.
 * Exported for the orchestrator's `isDynamicModule` public method.
 */
export function isDynamicModule(obj: unknown): obj is IDynamicModule {
  if (!obj || typeof obj !== 'object' || !('module' in obj)) return false;
  const withModule = obj as { module: unknown };
  return typeof withModule.module === 'function';
}

/**
 * Read the `@Module` decorator metadata from a class or instance.
 * Tries the canonical key first, then a legacy fallback (some
 * subprojects emit metadata under different keys). Returns `undefined`
 * if no recognised key is present.
 */
function readModuleMetadata(target: object | undefined): unknown {
  if (!target) return undefined;
  return (
    Reflect.getMetadata('module', target) ??
    Reflect.getMetadata('nexus:module', target) ??
    Reflect.getMetadata('module:metadata', target) ??
    (target as { __titanModuleMetadata?: unknown }).__titanModuleMetadata
  );
}

function extractClassRef(input: ModuleInput): ModuleConstructor | null {
  if (typeof input === 'function') return input as ModuleConstructor;
  if (isDynamicModule(input) && typeof input.module === 'function') {
    return input.module as ModuleConstructor;
  }
  return null;
}

function nameFromMetadata(metadata: unknown, resolved: ResolvedInput): string {
  if (metadata && typeof (metadata as { name?: unknown }).name === 'string') {
    return (metadata as { name: string }).name;
  }
  if (resolved.dynamicModule?.module?.name) return resolved.dynamicModule.module.name;
  if (typeof resolved.source === 'function') {
    return (resolved.source as { name?: string }).name || 'UnnamedModule';
  }
  if (resolved.instance.constructor?.name) return resolved.instance.constructor.name;
  return 'UnnamedModule';
}

function buildDynamicFromMetadata(metadata: unknown, source: ModuleInput): IDynamicModule {
  const typed = metadata as {
    providers?: Provider<unknown>[];
    imports?: IModule[];
    exports?: InjectionToken<unknown>[];
  };
  return {
    module: source as ModuleConstructor,
    providers: typed.providers || [],
    imports: typed.imports || [],
    exports: typed.exports || [],
  };
}

function dynamicModuleFromInstance(
  instance: IModule,
  source: ModuleInput,
): IDynamicModule | null {
  const probe = instance as IModule & {
    providers?: Provider<unknown>[];
    imports?: IModule[];
    exports?: InjectionToken<unknown>[];
  };
  if (probe.providers || probe.imports || probe.exports) {
    return {
      module: source as ModuleConstructor,
      providers: probe.providers || [],
      imports: probe.imports || [],
      exports: probe.exports || [],
    };
  }
  return null;
}

function tokenLabel(token: unknown): string {
  if (typeof token === 'function' && 'name' in (token as { name?: string })) {
    return (token as { name?: string }).name ?? String(token);
  }
  return String(token);
}

/** Re-export so the orchestrator's anonymous-root path can stamp a name. */
export const ROOT_CONTEXT_NAME = 'RootContext';

/**
 * Build the synthetic root module the orchestrator uses when callers
 * pass providers directly via `Application.create({ providers })`. It
 * exists so providers participate in the modules-map invariants
 * (lookup-by-name, has, etc.) without inventing a new path.
 */
export function makeRootContextModule(providers: Array<[InjectionToken<unknown>, Provider<unknown>]>): IModule {
  return {
    name: ROOT_CONTEXT_NAME,
    providers,
    onRegister: () => undefined,
    onStart: () => undefined,
    onStop: () => undefined,
  } as unknown as IModule & { providers: typeof providers };
}

/** Re-export for any caller that needs to satisfy `IModule` casts safely. */
export type { ConfigObject };
