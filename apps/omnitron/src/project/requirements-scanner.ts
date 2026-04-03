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

import fs from 'node:fs';
import path from 'node:path';
import type { IEcosystemAppEntry, OmnitronAppConfig } from '../config/types.js';
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

// =============================================================================
// Helpers
// =============================================================================

/**
 * Resolve config/default.json path from a bootstrap file path.
 * e.g., apps/main/src/bootstrap.ts → apps/main/config/default.json
 */
function resolveAppConfigPath(bootstrapPath: string): string {
  const srcDir = path.dirname(bootstrapPath);
  const appRoot = path.resolve(srcDir, '..');
  return path.join(appRoot, 'config', 'default.json');
}

/**
 * Read the `omnitron` section from an app's config/default.json.
 * Returns null if the file doesn't exist or has no `omnitron` key.
 */
async function readOmnitronConfig(configPath: string): Promise<OmnitronAppConfig | null> {
  try {
    const content = await fs.promises.readFile(configPath, 'utf-8');
    const json = JSON.parse(content);
    return json.omnitron ?? null;
  } catch {
    return null;
  }
}

// =============================================================================
// Scanner
// =============================================================================

/**
 * Scan all app configs and extract infrastructure requirements.
 * This is a static analysis — no apps are started.
 *
 * Primary: reads `omnitron` section from each app's config/default.json.
 * Fallback: imports bootstrap file and reads `definition.requires` (deprecated).
 */
export async function scanRequirements(
  apps: IEcosystemAppEntry[],
  cwd: string
): Promise<ProjectRequirements> {
  const result: ProjectRequirements = {
    databases: [],
    redis: { appCount: 0, allocations: [] },
    buckets: [],
    needsAuth: false,
    titanModules: new Set(),
    byApp: new Map(),
  };

  for (const entry of apps) {
    if (entry.enabled === false) continue;
    if (!entry.bootstrap) continue;

    const bootstrapPath = `${cwd}/${entry.bootstrap}`;
    const configPath = resolveAppConfigPath(bootstrapPath);
    let omnitronConfig = await readOmnitronConfig(configPath);

    // Fallback: read from bootstrap requires (deprecated)
    if (!omnitronConfig) {
      try {
        const definition = await loadBootstrapConfig(bootstrapPath, { devMode: true });
        const requires = definition.requires;
        if (requires) {
          console.warn(
            `[omnitron] DEPRECATED: App "${entry.name}" uses bootstrap requires instead of config/default.json omnitron section. ` +
            `Add an "omnitron" section to ${configPath} and remove requires from defineSystem().`
          );

          // Convert legacy IAppRequirements → OmnitronAppConfig
          omnitronConfig = {};
          if (requires.postgres) {
            omnitronConfig.database = requires.postgres.pool
              ? { pool: requires.postgres.pool }
              : true;
          }
          if (requires.redis) {
            omnitronConfig.redis = requires.redis.prefix
              ? { prefix: requires.redis.prefix }
              : true;
          }
          if (requires.s3) {
            omnitronConfig.s3 = true;
          }
          if (requires.discovery || requires.notifications) {
            omnitronConfig.services = {};
            if (requires.discovery) omnitronConfig.services.discovery = true;
            if (requires.notifications) omnitronConfig.services.notifications = true;
          }
        }
      } catch {
        // Bootstrap failed to load — skip this app
        continue;
      }
    }

    if (!omnitronConfig) continue;

    result.byApp.set(entry.name, omnitronConfig);

    // PostgreSQL
    if (omnitronConfig.database) {
      const dbConfig = typeof omnitronConfig.database === 'object' ? omnitronConfig.database : {};
      result.databases.push({
        app: entry.name,
        database: entry.name, // database name = app name
        pool: dbConfig.pool,
      });
    }

    // Redis (no manual DB allocation — ConfigResolver handles that)
    if (omnitronConfig.redis) {
      const redisConfig = typeof omnitronConfig.redis === 'object' ? omnitronConfig.redis : {};
      result.redis.allocations.push({
        app: entry.name,
        prefix: redisConfig.prefix,
      });
    }

    // S3
    if (omnitronConfig.s3) {
      const s3Config = typeof omnitronConfig.s3 === 'object' ? omnitronConfig.s3 : {};
      result.buckets.push({
        app: entry.name,
        bucket: s3Config.bucket ?? entry.name, // bucket name = explicit or app name
      });
    }

    // Auth — check bootstrap definition for JWT config
    try {
      const definition = await loadBootstrapConfig(bootstrapPath, { devMode: true });
      if (definition.auth?.jwt?.enabled) {
        result.needsAuth = true;
      }
    } catch {
      // Ignore — auth detection is best-effort
    }

    // Titan service modules
    if (omnitronConfig.services?.discovery) result.titanModules.add('discovery');
    if (omnitronConfig.services?.notifications) result.titanModules.add('notifications');
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
      databases[db.database] = db.pool ? { pool: db.pool } : {};
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
