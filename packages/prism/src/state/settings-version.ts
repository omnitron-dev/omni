/**
 * Settings Version Management
 *
 * Utilities for managing versioned settings with safe migrations.
 * Enables breaking changes to settings structure while preserving user data.
 *
 * @module @omnitron/prism/state
 */

import { createJSONStorage, type PersistOptions, type StateStorage } from 'zustand/middleware';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Migration function signature.
 * Transforms settings from one version to the next.
 */
export type MigrationFn<TPrev = unknown, TNext = unknown> = (prevState: TPrev) => TNext;

/**
 * Version-specific migration configuration.
 */
export interface VersionMigration<TPrev = unknown, TNext = unknown> {
  /** Target version number */
  version: number;
  /** Migration function */
  migrate: MigrationFn<TPrev, TNext>;
}

/**
 * Versioned settings configuration.
 */
export interface VersionedSettingsConfig<TState> {
  /** Current version number (increment when structure changes) */
  version: number;
  /** Storage key prefix */
  name: string;
  /** Ordered list of migrations (version -> next version) */
  migrations: VersionMigration[];
  /** Validation function (optional) */
  validate?: (state: unknown) => state is TState;
  /** Called when migration fails */
  onMigrationError?: (error: unknown, fromVersion: number, toVersion: number) => void;
  /** Called when stored data is corrupt/invalid */
  onCorruptData?: (error: unknown, rawData: unknown) => void;
  /** Default state (used when migration fails or data is corrupt) */
  defaultState: TState;
}

/**
 * Persisted settings with version metadata.
 */
export interface VersionedPersistedState<TState> {
  state: TState;
  version: number;
}

// =============================================================================
// MIGRATION ENGINE
// =============================================================================

/**
 * Run migrations from one version to another.
 *
 * @param state - Current state
 * @param fromVersion - Starting version
 * @param toVersion - Target version
 * @param migrations - Available migrations
 * @returns Migrated state or null if migration failed
 */
export function runMigrations<TState>(
  state: unknown,
  fromVersion: number,
  toVersion: number,
  migrations: VersionMigration[]
): TState | null {
  if (fromVersion >= toVersion) {
    return state as TState;
  }

  // Sort migrations by version
  const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);

  let currentState = state;
  let currentVersion = fromVersion;

  // Apply each migration in sequence
  for (const migration of sortedMigrations) {
    if (migration.version > fromVersion && migration.version <= toVersion) {
      try {
        currentState = migration.migrate(currentState);
        currentVersion = migration.version;
      } catch (error) {
        console.error(`[SettingsVersion] Migration to v${migration.version} failed:`, error);
        return null;
      }
    }
  }

  if (currentVersion !== toVersion) {
    console.warn(`[SettingsVersion] Migration incomplete: reached v${currentVersion}, expected v${toVersion}`);
  }

  return currentState as TState;
}

// =============================================================================
// VERSIONED STORAGE
// =============================================================================

/**
 * Create a versioned storage adapter for Zustand persist.
 *
 * This adapter handles:
 * - Version tracking in stored data
 * - Automatic migrations when version changes
 * - Safe fallback to defaults on corrupt data
 *
 * @example
 * ```tsx
 * interface AppSettings {
 *   theme: 'light' | 'dark';
 *   language: string;
 *   notifications: { email: boolean; push: boolean };
 * }
 *
 * const versionedStorage = createVersionedStorage<AppSettings>({
 *   version: 3,
 *   name: 'app-settings',
 *   defaultState: {
 *     theme: 'light',
 *     language: 'en',
 *     notifications: { email: true, push: true },
 *   },
 *   migrations: [
 *     {
 *       version: 2,
 *       migrate: (prev: { theme: string }) => ({
 *         ...prev,
 *         language: 'en', // Added in v2
 *       }),
 *     },
 *     {
 *       version: 3,
 *       migrate: (prev: { theme: string; language: string }) => ({
 *         ...prev,
 *         notifications: { email: true, push: true }, // Added in v3
 *       }),
 *     },
 *   ],
 * });
 *
 * // Use with createPrismStore
 * const useSettings = createPrismStore<AppSettings>(
 *   (set) => ({
 *     ...versionedStorage.defaultState,
 *     setTheme: (theme) => set({ theme }),
 *   }),
 *   {
 *     name: 'settings',
 *     persist: {
 *       storage: versionedStorage.storage,
 *       version: versionedStorage.version,
 *       migrate: versionedStorage.migrate,
 *     },
 *   }
 * );
 * ```
 */
export function createVersionedStorage<TState>(config: VersionedSettingsConfig<TState>): {
  storage: StateStorage;
  version: number;
  migrate: (persistedState: unknown, version: number) => TState;
  defaultState: TState;
} {
  const { version, name, migrations, validate, onMigrationError, onCorruptData, defaultState } = config;

  const storageKey = `prism-settings-${name}`;

  /**
   * Custom storage adapter that handles versioned data.
   */
  const storage: StateStorage = {
    getItem(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw;
      } catch (error) {
        console.error('[SettingsVersion] Storage read error:', error);
        return null;
      }
    },

    setItem(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        console.error('[SettingsVersion] Storage write error:', error);
      }
    },

    removeItem(key) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.error('[SettingsVersion] Storage remove error:', error);
      }
    },
  };

  /**
   * Migration function for Zustand persist.
   */
  function migrate(persistedState: unknown, persistedVersion: number): TState {
    // No migration needed if versions match
    if (persistedVersion === version) {
      // Optionally validate
      if (validate && !validate(persistedState)) {
        console.warn('[SettingsVersion] Stored state failed validation, using defaults');
        onCorruptData?.(new Error('Validation failed'), persistedState);
        return defaultState;
      }
      return persistedState as TState;
    }

    // Run migrations
    const migrated = runMigrations<TState>(persistedState, persistedVersion, version, migrations);

    if (migrated === null) {
      // Migration failed
      onMigrationError?.(new Error('Migration failed'), persistedVersion, version);
      console.warn('[SettingsVersion] Migration failed, using defaults');
      return defaultState;
    }

    // Validate migrated state
    if (validate && !validate(migrated)) {
      onCorruptData?.(new Error('Post-migration validation failed'), migrated);
      console.warn('[SettingsVersion] Migrated state failed validation, using defaults');
      return defaultState;
    }

    console.log(`[SettingsVersion] Migrated from v${persistedVersion} to v${version}`);
    return migrated;
  }

  return {
    storage,
    version,
    migrate,
    defaultState,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create persist options for versioned settings.
 * Convenience function that returns properly typed PersistOptions.
 *
 * @example
 * ```tsx
 * const persistOptions = createVersionedPersistOptions<MySettings>({
 *   version: 2,
 *   name: 'my-settings',
 *   defaultState: { /* ... *\/ },
 *   migrations: [{ version: 2, migrate: (prev) => ({ ...prev, newField: 'default' }) }],
 * });
 *
 * const useStore = createPrismStore(initializer, {
 *   name: 'my-settings',
 *   persist: persistOptions,
 * });
 * ```
 */
export function createVersionedPersistOptions<TState>(
  config: VersionedSettingsConfig<TState>
): Partial<PersistOptions<TState>> {
  const versioned = createVersionedStorage(config);

  return {
    name: `prism-settings-${config.name}`,
    // Use createJSONStorage to properly wrap the StateStorage for Zustand persist
    storage: createJSONStorage(() => versioned.storage),
    version: versioned.version,
    migrate: versioned.migrate as (persistedState: unknown, version: number) => TState | Promise<TState>,
  };
}

/**
 * Check if settings need migration.
 *
 * @param name - Settings name
 * @param currentVersion - Current app settings version
 * @returns Object with migration status
 */
export function checkSettingsVersion(
  name: string,
  currentVersion: number
): {
  needsMigration: boolean;
  storedVersion: number | null;
  currentVersion: number;
} {
  const storageKey = `prism-settings-${name}`;

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return {
        needsMigration: false,
        storedVersion: null,
        currentVersion,
      };
    }

    const parsed = JSON.parse(raw);
    const storedVersion = parsed?.version ?? 0;

    return {
      needsMigration: storedVersion !== currentVersion,
      storedVersion,
      currentVersion,
    };
  } catch {
    return {
      needsMigration: true,
      storedVersion: null,
      currentVersion,
    };
  }
}

/**
 * Clear stored settings (useful for testing or reset).
 */
export function clearSettings(name: string): void {
  const storageKey = `prism-settings-${name}`;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Export settings to JSON.
 */
export function exportSettings<TState>(name: string, currentVersion: number): VersionedPersistedState<TState> | null {
  const storageKey = `prism-settings-${name}`;

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return {
      state: parsed.state,
      version: parsed.version ?? currentVersion,
    };
  } catch {
    return null;
  }
}

/**
 * Import settings from JSON.
 * Will trigger migration if version differs.
 */
export function importSettings<TState>(name: string, data: VersionedPersistedState<TState>): void {
  const storageKey = `prism-settings-${name}`;

  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (error) {
    console.error('[SettingsVersion] Import failed:', error);
  }
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Create a type guard for settings validation.
 *
 * @example
 * ```tsx
 * const isValidSettings = createSettingsValidator<MySettings>({
 *   requiredKeys: ['theme', 'language'],
 *   typeChecks: {
 *     theme: (v) => v === 'light' || v === 'dark',
 *     language: (v) => typeof v === 'string',
 *   },
 * });
 * ```
 */
export function createSettingsValidator<TState extends Record<string, unknown>>(config: {
  requiredKeys?: (keyof TState)[];
  typeChecks?: Partial<{ [K in keyof TState]: (value: unknown) => boolean }>;
}): (state: unknown) => state is TState {
  return (state: unknown): state is TState => {
    if (typeof state !== 'object' || state === null) {
      return false;
    }

    const record = state as Record<string, unknown>;

    // Check required keys
    if (config.requiredKeys) {
      for (const key of config.requiredKeys) {
        if (!(key in record)) {
          return false;
        }
      }
    }

    // Run type checks
    if (config.typeChecks) {
      for (const [key, check] of Object.entries(config.typeChecks)) {
        if (key in record && check && !check(record[key])) {
          return false;
        }
      }
    }

    return true;
  };
}

// =============================================================================
// MIGRATION HELPERS
// =============================================================================

/**
 * Creates a simple migration from one version to the next.
 *
 * @example
 * ```typescript
 * const v2Migration = createMigration(2, (state) => ({
 *   ...state,
 *   navLayout: 'vertical',
 * }));
 * ```
 */
export function createMigration<TPrev = unknown, TNext = unknown>(
  version: number,
  migrate: MigrationFn<TPrev, TNext>
): VersionMigration<TPrev, TNext> {
  return { version, migrate };
}

/**
 * Creates a migration that renames a field.
 *
 * @example
 * ```typescript
 * const renameMigration = createRenameMigration(3, 'theme', 'mode', 'light');
 * ```
 */
export function createRenameMigration<TNext>(
  version: number,
  oldKey: string,
  newKey: string,
  defaultValue: unknown
): VersionMigration {
  return {
    version,
    migrate: (state) => {
      const prev = state as Record<string, unknown>;
      const result = { ...prev } as Record<string, unknown>;

      // Get value from old key or use default
      const value = oldKey in prev ? prev[oldKey] : defaultValue;

      // Remove old key and add new key
      delete result[oldKey];
      result[newKey] = value;

      return result as TNext;
    },
  };
}

/**
 * Creates a migration that adds a new field with a default value.
 *
 * @example
 * ```typescript
 * const addFieldMigration = createAddFieldMigration(4, 'stretch', false);
 * ```
 */
export function createAddFieldMigration<TNext>(version: number, key: string, defaultValue: unknown): VersionMigration {
  return {
    version,
    migrate: (state) =>
      ({
        ...(state as object),
        [key]: defaultValue,
      }) as TNext,
  };
}

/**
 * Creates a migration that removes a field.
 *
 * @example
 * ```typescript
 * const removeFieldMigration = createRemoveFieldMigration(5, 'legacyOption');
 * ```
 */
export function createRemoveFieldMigration<TNext>(version: number, key: string): VersionMigration {
  return {
    version,
    migrate: (state) => {
      const result = { ...(state as object) } as Record<string, unknown>;
      delete result[key];
      return result as TNext;
    },
  };
}

/**
 * Creates a migration that transforms a field's value.
 *
 * @example
 * ```typescript
 * const transformMigration = createTransformMigration(
 *   6,
 *   'fontSize',
 *   (value) => typeof value === 'string' ? parseInt(value, 10) : value,
 *   16
 * );
 * ```
 */
export function createTransformMigration<TNext>(
  version: number,
  key: string,
  transform: (value: unknown) => unknown,
  defaultValue: unknown
): VersionMigration {
  return {
    version,
    migrate: (state) => {
      const prev = state as Record<string, unknown>;
      const oldValue = key in prev ? prev[key] : undefined;
      const newValue = oldValue !== undefined ? transform(oldValue) : defaultValue;

      return {
        ...prev,
        [key]: newValue,
      } as TNext;
    },
  };
}

/**
 * Validates that migrations are in correct sequential order.
 *
 * @throws If migrations have duplicate versions
 */
export function validateMigrations(migrations: VersionMigration[]): void {
  const versions = migrations.map((m) => m.version).sort((a, b) => a - b);

  // Check for duplicates
  const uniqueVersions = new Set(versions);
  if (uniqueVersions.size !== versions.length) {
    throw new Error('[SettingsVersion] Duplicate migration versions detected');
  }

  // Check that versions are positive integers
  for (const version of versions) {
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`[SettingsVersion] Invalid migration version: ${version}. Must be a positive integer.`);
    }
  }
}

/**
 * Gets migration info for debugging.
 */
export function getMigrationInfo(migrations: VersionMigration[]): Array<{ version: number }> {
  return migrations.map((m) => ({ version: m.version })).sort((a, b) => a.version - b.version);
}
