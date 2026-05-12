/**
 * Internal collaborator — application configuration store.
 *
 * Owns BOTH the "merged" configuration (`_config` in the legacy class:
 * app metadata + user config + injected defaults) AND the "user-provided"
 * configuration (`_userConfig`: just what the caller passed in). The
 * split exists because `getConfig()` must hide app-metadata keys the user
 * never asked for, while module-config lookups (`this._config[moduleName]`)
 * need the merged view.
 *
 * Why a dedicated collaborator? The legacy class kept TWO copies of the
 * deep-merge routine — one as a private method, one re-defined inline
 * inside `configure()`. Folding them here eliminates the divergence risk
 * and makes the merging contract testable in isolation.
 *
 * Single responsibility: store and merge configuration. Doesn't know
 * about modules or events — `configure()` returns the list of module
 * keys that changed so the orchestrator can fan out the reconfigure
 * callbacks itself.
 *
 * @internal
 */

import {
  type ConfigObject,
  type ConfigValue,
  type IApplicationConfig,
} from '../../types.js';

/**
 * Keys the merged config carries that are NOT user-provided
 * configuration — they're application options the orchestrator stashes
 * in `_config` for internal lookup. `getConfig()` strips them on the
 * way out so the user sees only what they passed in.
 */
const INTERNAL_CONFIG_KEYS = new Set<string>([
  'disableCoreModules',
  'disableGracefulShutdown',
  'disableProcessExit',
]);

/**
 * App metadata keys mirrored into the merged config for module-config
 * lookups. `getConfig()` only includes them if the user explicitly
 * supplied a value — otherwise the keys are hidden so user-facing
 * config diffs stay clean.
 */
const APP_METADATA_KEYS = ['name', 'version', 'debug', 'environment'] as const;

export class ConfigStore {
  private _config: IApplicationConfig;
  private _userConfig: ConfigObject;

  constructor(seed: {
    name: string;
    version: string;
    debug: boolean;
    environment: string;
    userConfig: ConfigObject;
    logging?: unknown;
    disableCoreModules?: boolean;
    disableGracefulShutdown?: boolean;
    disableProcessExit?: boolean;
  }) {
    // Clone user-supplied config so external mutations don't leak in.
    this._userConfig = { ...seed.userConfig };

    this._config = {
      name: seed.name,
      version: seed.version,
      debug: seed.debug,
      environment: seed.environment,
      ...this._userConfig,
    };

    if (seed.disableCoreModules !== undefined) {
      this._config['disableCoreModules'] = seed.disableCoreModules;
    }
    if (seed.disableGracefulShutdown !== undefined) {
      this._config['disableGracefulShutdown'] = seed.disableGracefulShutdown;
    }
    if (seed.disableProcessExit !== undefined) {
      this._config['disableProcessExit'] = seed.disableProcessExit;
    }
    if (seed.logging && !this._config.logging) {
      this._config.logging = seed.logging as IApplicationConfig['logging'];
    }
  }

  // ─── Reads ───────────────────────────────────────────────────────────

  /**
   * Lookup a single key. The legacy semantics: user-provided values
   * shadow internal defaults, so we check `_userConfig` first and fall
   * back to the merged `_config` only when the key is absent.
   */
  get<K extends keyof IApplicationConfig>(key: K): IApplicationConfig[K] {
    return this._userConfig[key as string] !== undefined
      ? (this._userConfig[key as string] as IApplicationConfig[K])
      : this._config[key];
  }

  /**
   * Direct read against the merged config (NOT a copy). Used by
   * collaborators that need module-config lookup
   * (e.g. `_config[moduleName]`) without paying the clone cost.
   */
  rawGet(key: string): ConfigValue {
    return this._config[key] as ConfigValue;
  }

  /**
   * Public "what the user asked for" view. Strips internal options
   * (`disableCoreModules`, …) AND app-metadata keys the user didn't
   * explicitly supply. Used by `app.getConfig()` / `app.config()`.
   */
  toUserView(): IApplicationConfig {
    const result: IApplicationConfig = { ...this._config };
    for (const key of APP_METADATA_KEYS) {
      if (this._userConfig[key] === undefined) delete result[key];
    }
    for (const key of INTERNAL_CONFIG_KEYS) delete result[key];
    return result;
  }

  /**
   * Read-only access to the merged config. Used by the orchestrator
   * during start to seed core-module options (logger config, etc.).
   */
  get raw(): Readonly<IApplicationConfig> {
    return this._config;
  }

  // ─── Mutations ───────────────────────────────────────────────────────

  /**
   * Deep-merge `options` into both the merged config AND the user view.
   * Returns the list of TOP-LEVEL keys touched so the orchestrator can
   * push `configure()` callbacks at modules whose section changed.
   *
   * Keeping `_config` and `_userConfig` in sync was the source of a
   * subtle legacy bug where `configure()` wrote both but `setConfig()`
   * only wrote `_config`, so a subsequent `getConfig()` lost the value.
   * Both paths now route through this method (or `setNested` below),
   * preventing that divergence.
   */
  merge(options: ConfigObject): string[] {
    const touched: string[] = [];

    for (const key of Object.keys(options)) {
      this._config[key] = deepMerge(this._config[key], options[key]) as ConfigValue;
      this._userConfig[key] = deepMerge(this._userConfig[key], options[key]) as ConfigValue;
      touched.push(key);
    }

    return touched;
  }

  /**
   * Replace a single value (top-level or dotted nested path). Mirrors
   * `merge` semantics: both `_config` and `_userConfig` are updated so
   * `getConfig()` reflects the change.
   *
   * The legacy `setConfig()` wrote `_config` only. That divergence was
   * silent — readers using `config(key)` would still see the new value
   * (since `_userConfig` is checked first and is undefined), but readers
   * using `getConfig()` lost the value because the key didn't appear in
   * `_userConfig`. Writing to both keeps the surface consistent.
   */
  setNested(key: string, value: ConfigValue): void {
    setDotted(this._config as unknown as ConfigObject, key, value);
    setDotted(this._userConfig, key, value);
  }
}

// ─── Local helpers ─────────────────────────────────────────────────────

/**
 * Recursive object merge with array/primitive replacement semantics.
 *
 *  - If `source` isn't a plain object → return `source` (replace).
 *  - If `source` is an array → return `source` (replace, not concat).
 *  - If both `target` and `source` are objects → key-wise recurse.
 *
 * Identical to the legacy in-line `deepMerge` but with a single
 * canonical definition that both `merge` and any future helper can use.
 */
function deepMerge(target: unknown, source: unknown): unknown {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    // Source is an object but target isn't — clone source.
    return { ...(source as ConfigObject) };
  }
  const result: ConfigObject = { ...(target as ConfigObject) };
  for (const key of Object.keys(source as ConfigObject)) {
    result[key] = deepMerge(result[key], (source as ConfigObject)[key]) as ConfigValue;
  }
  return result;
}

/**
 * Walk `path.split('.')` to set the leaf value. Intermediate non-object
 * containers are replaced with fresh empty objects, matching the
 * legacy implementation's lenient behaviour: callers can write into a
 * key that previously held a primitive without an error.
 */
function setDotted(obj: ConfigObject, path: string, value: ConfigValue): void {
  const parts = path.split('.');
  let current: ConfigObject = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {} as ConfigValue;
    }
    current = current[part] as ConfigObject;
  }
  const leaf = parts[parts.length - 1];
  if (leaf) current[leaf] = value;
}
