import type { MigrationConfig, Migration } from './index.js';

/** Resolve declarative inputs before opening a migration connection. Factories
 * load definitions only; connect() remains the explicit database boundary.
 * This self-contained function also runs in the isolated stack config adapter. */
export async function prepareMigrationConfiguration<DB>(config: MigrationConfig<DB>): Promise<MigrationConfig<DB> & { migrations: Migration<DB>[] }> {
  if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.connect !== 'function')
    throw new Error('Migration configuration must provide connect()');
  if (config.name !== undefined && (typeof config.name !== 'string' || !config.name.trim()))
    throw new Error('Migration configuration name must be a nonempty string');
  if (config.options !== undefined && (!config.options || typeof config.options !== 'object' || Array.isArray(config.options)))
    throw new Error('Migration configuration options must be an object');
  const migrations = typeof config.migrations === 'function' ? await config.migrations() : config.migrations;
  if (!Array.isArray(migrations)) throw new Error('Migration configuration must provide a migration array');
  return { ...config, migrations };
}
