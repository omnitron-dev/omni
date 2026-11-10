/**
 * PostgreSQL Service Preset
 *
 * Provisions PostgreSQL via Docker (or externally in prod).
 * postProvision hook creates databases declared in config.
 */

import { escapeIdentifier, escapeLiteral } from 'pg';
import { describeError } from '@omnitron-dev/titan/diagnostics';
import type { IServicePreset, IPostProvisionContext } from './types.js';

export const postgresPreset: IServicePreset = {
  name: 'postgres',
  type: 'database',
  defaultImage: 'postgres:17-alpine',
  defaultPorts: { main: 5432 },
  defaultSecrets: { user: 'postgres', password: 'postgres' },

  defaultHealthCheck: {
    // pg_isready returns 0 the moment the postmaster accepts connections
    // — but the moment isn't quite app-ready: WAL replay or extension
    // creation can still be running. Use a real `SELECT 1` against
    // postgres user (always exists) so we don't mark healthy until the
    // executor is functional. Higher retry count covers slow boots
    // (volume create + WAL replay can take 15s+).
    type: 'command',
    target: 'psql -U "$POSTGRES_USER" -d postgres -h /var/run/postgresql -tAc "SELECT 1" | grep -qx 1',
    interval: '3s',
    timeout: '5s',
    retries: 30,
  },

  buildCommand(userConfig: Record<string, unknown>): string[] {
    const cfg = (userConfig['config'] ?? {}) as {
      maxConnections?: number;
      sharedBuffers?: string;
      effectiveCacheSize?: string;
      workMem?: string;
      maintenanceWorkMem?: string;
      logMinDurationStatement?: number;
    };

    const command = ['postgres'];
    const set = (key: string, value: string | number | undefined): void => {
      if (value === undefined || value === null || value === '') return;
      command.push('-c', `${key}=${value}`);
    };

    set('max_connections', cfg.maxConnections ?? 200);
    set('shared_buffers', cfg.sharedBuffers ?? '256MB');
    // Optional with no default: unset means "let postgres decide", which is
    // a better answer than a number picked without knowing the machine.
    set('effective_cache_size', cfg.effectiveCacheSize);
    set('work_mem', cfg.workMem);
    set('maintenance_work_mem', cfg.maintenanceWorkMem);
    set('log_statement', 'none');
    // -1 disables slow-query logging, and is a value an operator may mean —
    // so `?? 1000` rather than a truthiness test, which would treat 0 and -1
    // as absent and silently restore the default.
    set('log_min_duration_statement', cfg.logMinDurationStatement ?? 1000);
    // Safety: kill leaked connections from crashed/restarted processes.
    // Not configurable — these protect the daemon from its own clients.
    set('idle_in_transaction_session_timeout', 60000);
    set('tcp_keepalives_idle', 60);
    set('tcp_keepalives_interval', 10);
    set('tcp_keepalives_count', 3);

    return command;
  },

  defaultDocker: {
    // Mirrors `buildCommand({})`. Kept because `defaultDocker` is the
    // fallback for any path that does not run the builder.
    command: [
      'postgres',
      '-c', 'max_connections=200',
      '-c', 'shared_buffers=256MB',
      '-c', 'log_statement=none',
      '-c', 'log_min_duration_statement=1000',
      '-c', 'idle_in_transaction_session_timeout=60000',
      '-c', 'tcp_keepalives_idle=60',
      '-c', 'tcp_keepalives_interval=10',
      '-c', 'tcp_keepalives_count=3',
    ],
    environment: {},
    volumes: {
      data: { target: '/var/lib/postgresql/data', source: '' },
    },
    shmSize: '256m',
  },

  async postProvision(ctx: IPostProvisionContext): Promise<void> {
    const databases = ctx.userConfig['databases'] as
      | Record<string, { extensions?: string[] } | undefined>
      | undefined;
    if (databases === undefined) return;

    const user = ctx.secrets['user'] ?? 'postgres';
    if (typeof databases !== 'object' || databases === null || Array.isArray(databases)) throw new Error('PostgreSQL databases must be a declaration map');
    const failures: Error[] = [];
    const maxRetries = 5;
    const retryDelay = 2000;

    for (const [dbName, dbConfig] of Object.entries(databases)) {
      if (!dbName || dbName.includes('\0') || Buffer.byteLength(dbName) > 63) {
        failures.push(new Error('Invalid PostgreSQL database name')); continue;
      }
      let created = false;
      for (let attempt = 0; attempt < maxRetries && !created; attempt++) {
        try {
          const result = await ctx.execInContainer([
            'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', 'postgres', '-tAc',
            `SELECT 1 FROM pg_database WHERE datname=${escapeLiteral(dbName)}`,
          ]);
          if (!result.trim()) {
            await ctx.execInContainer([
              'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', 'postgres', '-c', `CREATE DATABASE ${escapeIdentifier(dbName)}`,
            ]);
            ctx.logger.info({ database: dbName }, 'Created PostgreSQL database');
          }
          created = true;
        } catch (err) {
          if (attempt < maxRetries - 1) {
            ctx.logger.debug({ database: dbName, attempt: attempt + 1 }, 'Postgres not ready — retrying');
            await new Promise((r) => setTimeout(r, retryDelay));
          } else {
            failures.push(new Error(`Database '${dbName}' could not be prepared: ${describeError(err)}`));
          }
        }
      }

      if (created) {
        try { await createExtensions(ctx, user, dbName, dbConfig?.extensions ?? []); }
        catch (error) { failures.push(new Error(describeError(error))); }
      }
    }
    if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
  },

  generateEnvTemplates(_userConfig: Record<string, unknown>): Record<string, string> {
    return {
      DATABASE_URL: 'postgres://${secret:user}:${secret:password}@${host}:${port:main}/${database}',
    };
  },
};

/** Complete independent declarations, then refuse readiness if any required extension failed. */
async function createExtensions(
  ctx: IPostProvisionContext,
  user: string,
  dbName: string,
  extensions: string[],
): Promise<void> {
  if (!Array.isArray(extensions) || extensions.some(ext => typeof ext !== 'string'))
    throw new Error(`Database '${dbName}' extensions must be a list of names`);
  const failures: Error[] = [];
  for (const ext of new Set(extensions)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(ext)) {
      failures.push(new Error(`Invalid extension identifier for database '${dbName}'`)); continue;
    }
    try {
      await ctx.execInContainer([
        'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', dbName, '-c', `CREATE EXTENSION IF NOT EXISTS ${escapeIdentifier(ext)}`,
      ]);
      ctx.logger.info({ database: dbName, extension: ext }, 'Ensured PostgreSQL extension');
    } catch (error) {
      failures.push(new Error(`Database '${dbName}' requires extension '${ext}'; ensure the image ships it: ${describeError(error)}`));
    }
  }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
}
