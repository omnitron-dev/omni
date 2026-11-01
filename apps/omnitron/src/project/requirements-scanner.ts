/**
 * Requirements Scanner — Extracts infrastructure requirements from app config files
 *
 * Reads the `omnitron` section from each app's config/default.json.
 * From this declarative config, omnitron determines:
 * 1. Which infrastructure services to provision (PostgreSQL, Redis, MinIO)
 * 2. How to configure each (databases, S3 buckets)
 * 3. What config to inject into the app at startup
 *
 * Redis DB index allocation is NOT done here — it's handled by ConfigResolver.
 *
 * Falls back to bootstrap `requires` for backward compatibility during migration.
 */

import path from 'node:path';
import type { IAppDefinition, IEcosystemAppEntry, OmnitronAppConfig } from '../config/types.js';
import { readDeclaredConfig, withDeclaredConfig } from './declared-config.js';
import { loadBootstrapConfig } from '../orchestrator/bootstrap-loader.js';

// =============================================================================
// Types
// =============================================================================

/** Aggregated infrastructure requirements for the entire project */
export interface ProjectRequirements {
  /** All PostgreSQL databases needed */
  databases: Array<{
    app: string;
    database: string;
    pool?: { min?: number; max?: number } | undefined;
    extensions?: string[] | undefined;
  }>;

  /** Redis requirements aggregated across apps */
  redis: {
    /** Number of apps needing Redis */
    appCount: number;
    allocations: Array<{
      app: string;
      prefix?: string | undefined;
    }>;
  };

  /** S3/MinIO buckets needed */
  buckets: Array<{
    app: string;
    bucket: string;
  }>;

  /** Whether any app requires JWT auth (→ shared secret needed) */
  needsAuth: boolean;

  /** Titan modules used across all apps (for dependency inference) */
  titanModules: Set<string>;

  /** Per-app requirements (for detailed config generation) */
  byApp: Map<string, OmnitronAppConfig>;
}

/** Explicit discovery imports trusted bootstraps. Read-only diagnosis uses saved definitions instead. */
export async function scanRequirements(apps: IEcosystemAppEntry[], cwd: string): Promise<ProjectRequirements> {
  const definitions = new Map<string, IAppDefinition>();
  for (const entry of apps) {
    if (entry.enabled === false || !entry.bootstrap) continue;
    const bootstrap = path.resolve(cwd, entry.bootstrap);
    const declared = readDeclaredConfig(bootstrap);
    if (declared.malformed) throw new Error(`Application configuration is unreadable: ${entry.name}`);
    const definition = await loadBootstrapConfig(bootstrap, { devMode: true, freshModuleGraph: true });
    definitions.set(entry.name, withDeclaredConfig(definition, declared));
  }
  return requirementsFromDefinitions(definitions);
}

/** One interpretation of requirements for diagnosis, provisioning and explicit discovery. */
export function requirementsFromDefinitions(definitions: ReadonlyMap<string, IAppDefinition>): ProjectRequirements {
  const result: ProjectRequirements = {
    databases: [], redis: { appCount: 0, allocations: [] }, buckets: [], needsAuth: false,
    titanModules: new Set(), byApp: new Map(),
  };
  for (const [app, definition] of definitions) {
    const legacy = definition.requires;
    const config: OmnitronAppConfig | undefined = definition.omnitronConfig ?? (legacy ? {
      ...(legacy.postgres && { database: legacy.postgres.pool ? { pool: legacy.postgres.pool } : true }),
      ...(legacy.redis && { redis: legacy.redis.prefix ? { prefix: legacy.redis.prefix } : true }),
      ...(legacy.s3 && { s3: true }),
      services: { ...(legacy.discovery && { discovery: true }), ...(legacy.notifications && { notifications: true }) },
    } : undefined);
    if (definition.auth?.jwt?.enabled) result.needsAuth = true;
    if (!config) continue;
    result.byApp.set(app, config);
    if (config.database) {
      const db = typeof config.database === 'object' ? config.database : {};
      result.databases.push({ app, database: app, pool: db.pool, extensions: db.extensions });
    }
    if (config.redis) {
      const redis = typeof config.redis === 'object' ? config.redis : {};
      result.redis.allocations.push({ app, prefix: redis.prefix });
    }
    if (config.s3) result.buckets.push({ app, bucket: typeof config.s3 === 'object' ? config.s3.bucket ?? app : app });
    if (config.services?.discovery) result.titanModules.add('discovery');
    if (config.services?.notifications) result.titanModules.add('notifications');
  }
  result.redis.appCount = result.redis.allocations.length;
  return result;
}

/**
 * Build InfrastructureConfig from scanned app requirements.
 * This is the "omnitron figures it out automatically" path:
 * apps declare what they need (database, redis, s3) and omnitron provisions it.
 */
export function buildInfraFromRequirements(
  reqs: ProjectRequirements,
): import('../infrastructure/types.js').InfrastructureConfig {
  const infra: import('../infrastructure/types.js').InfrastructureConfig = {};

  // PostgreSQL — needed if any app requires a database
  if (reqs.databases.length > 0) {
    const databases: Record<string, Record<string, unknown>> = {};
    for (const db of reqs.databases) {
      databases[db.database] = {
        ...(db.pool ? { pool: db.pool } : {}),
        ...(db.extensions?.length ? { extensions: db.extensions } : {}),
      };
    }
    infra.postgres = {
      databases,
    };
  }

  // Redis — needed if any app uses it (sessions, cache, messaging, etc.)
  if (reqs.redis.appCount > 0) {
    infra.redis = {};
  }

  // MinIO/S3 — needed if any app has storage buckets
  if (reqs.buckets.length > 0) {
    infra.minio = {
      buckets: reqs.buckets.map((b) => b.bucket),
    };
  }

  return infra;
}

/**
 * Pretty-print requirements for CLI display.
 */
export function formatRequirements(reqs: ProjectRequirements): string {
  const lines: string[] = [];

  lines.push('Infrastructure Requirements:');
  lines.push('');

  if (reqs.databases.length > 0) {
    lines.push(`  PostgreSQL: ${reqs.databases.length} database(s)`);
    for (const db of reqs.databases) {
      lines.push(`    - ${db.database} (${db.app})`);
    }
  }

  if (reqs.redis.allocations.length > 0) {
    lines.push(`  Redis: ${reqs.redis.appCount} app(s)`);
    for (const alloc of reqs.redis.allocations) {
      const suffix = alloc.prefix ? ` [prefix: ${alloc.prefix}]` : '';
      lines.push(`    - ${alloc.app}${suffix}`);
    }
  }

  if (reqs.buckets.length > 0) {
    lines.push(`  S3/MinIO: ${reqs.buckets.length} bucket(s)`);
    for (const b of reqs.buckets) {
      lines.push(`    - ${b.bucket} (${b.app})`);
    }
  }

  if (reqs.needsAuth) {
    lines.push(`  Auth: JWT shared secret required`);
  }

  if (reqs.titanModules.size > 0) {
    lines.push(`  Titan modules: ${[...reqs.titanModules].join(', ')}`);
  }

  return lines.join('\n');
}
