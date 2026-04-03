/**
 * PostgreSQL Service Preset
 *
 * Provisions PostgreSQL via Docker (or externally in prod).
 * postProvision hook creates databases declared in config.
 */

import type { IServicePreset, IPostProvisionContext } from './types.js';

export const postgresPreset: IServicePreset = {
  name: 'postgres',
  type: 'database',
  defaultImage: 'postgres:17-alpine',
  defaultPorts: { main: 5432 },
  defaultSecrets: { user: 'postgres', password: 'postgres' },

  defaultHealthCheck: {
    type: 'command',
    target: 'pg_isready -U postgres',
    interval: '5s',
    timeout: '5s',
    retries: 5,
  },

  defaultDocker: {
    command: [
      'postgres',
      '-c', 'max_connections=200',
      '-c', 'shared_buffers=256MB',
      '-c', 'log_statement=none',
      '-c', 'log_min_duration_statement=1000',
      // Safety: kill leaked connections from crashed/restarted processes
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
    const databases = ctx.userConfig['databases'] as Record<string, unknown> | undefined;
    if (!databases) return;

    const user = ctx.secrets['user'] ?? 'postgres';
    const maxRetries = 5;
    const retryDelay = 2000;

    for (const dbName of Object.keys(databases)) {
      let created = false;
      for (let attempt = 0; attempt < maxRetries && !created; attempt++) {
        try {
          const result = await ctx.execInContainer([
            'psql', '-U', user, '-tAc',
            `SELECT 1 FROM pg_database WHERE datname='${dbName}'`,
          ]);
          if (!result.trim()) {
            await ctx.execInContainer([
              'psql', '-U', user, '-c', `CREATE DATABASE "${dbName}"`,
            ]);
            ctx.logger.info({ database: dbName }, 'Created PostgreSQL database');
          }
          created = true;
        } catch (err) {
          if (attempt < maxRetries - 1) {
            ctx.logger.debug({ database: dbName, attempt: attempt + 1 }, 'Postgres not ready — retrying');
            await new Promise((r) => setTimeout(r, retryDelay));
          } else {
            ctx.logger.warn({ database: dbName, error: (err as Error).message }, 'Failed to create database');
          }
        }
      }
    }
  },

  generateEnvTemplates(_userConfig: Record<string, unknown>): Record<string, string> {
    return {
      DATABASE_URL: 'postgres://${secret:user}:${secret:password}@${host}:${port:main}/${database}',
    };
  },
};
