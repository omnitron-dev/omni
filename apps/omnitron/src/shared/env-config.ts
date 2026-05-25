/**
 * OmnitronEnvConfig — Typed, validated, single source of truth for
 * environment-driven configuration.
 *
 * Pre-this-module 23 distinct `process.env['…']` reads were scattered
 * across daemon-entry, daemon-client, config-resolver, the kb /
 * migrate / secret commands, and various services. Each site had
 * its own default ad-hoc; correcting a default required hunting
 * grep results. Tests couldn't override env cleanly because the
 * reads ran at module-init time. T-6 in the audit.
 *
 * Resolution policy:
 *   1. snapshot `process.env` on first access (loadOnce caches)
 *   2. typed getter per known key returns `string | undefined`
 *      unless a non-null default is declared
 *   3. boolean / number / json helpers coerce + validate
 *
 * Override hook for tests:
 *   `setEnvOverride({ HOME: '/tmp/test' })` patches the snapshot for
 *   the remainder of the process. Real env stays untouched.
 *
 * Why not Titan's ConfigModule? Daemon code paths run at module-load
 * time (daemon-entry, config-resolver) — before any DI container
 * exists. A sync, dep-free module-level helper avoids the
 * chicken-and-egg loop. Services that DO have DI can still inject
 * `OmnitronEnvConfigService` to access the same typed surface.
 */

import os from 'node:os';

// ---------------------------------------------------------------------------
// Schema — every env key omnitron consumes, plus its typed default.
// ---------------------------------------------------------------------------

export interface OmnitronEnvShape {
  /** Operator home dir. Falls back to os.homedir() then USERPROFILE. */
  HOME: string;
  USERPROFILE?: string;

  /** Active node environment — `production` triggers stricter validation. */
  NODE_ENV: 'development' | 'production' | 'test';

  /** Omnitron project root (CLI flag `--root`, env override). */
  OMNITRON_ROOT?: string;

  /** Output format for CLI commands — 'json' enables machine-readable mode. */
  OMNITRON_OUTPUT?: 'json' | 'human';

  /** Override the daemon Unix socket path. */
  OMNITRON_SOCKET?: string;

  /** Override the daemon's working directory (used by daemon-entry). */
  OMNITRON_CWD?: string;

  /** When '1', skip infrastructure provisioning on daemon boot. */
  OMNITRON_NO_INFRA: boolean;

  /** When '1', disable file-watcher-driven restarts. */
  OMNITRON_NO_WATCH: boolean;

  /** Override the omnitron-pg connection string used by migrate.ts. */
  OMNITRON_DATABASE_URL?: string;

  /** Master daemon stamps slave processes with these. Read-only in code. */
  OMNITRON_PROJECT?: string;
  OMNITRON_STACK?: string;
  OMNITRON_STACK_TYPE?: string;
  OMNITRON_MANAGED?: string;
  OMNITRON_APP_NAME?: string;

  /** Postgres / Redis credentials — surfaced for infra defaults. */
  POSTGRES_USER?: string;
  POSTGRES_PASSWORD?: string;
  REDIS_PASSWORD?: string;
}

// ---------------------------------------------------------------------------
// Loader — snapshots + coerces.
// ---------------------------------------------------------------------------

let cached: OmnitronEnvShape | null = null;
let override: Partial<OmnitronEnvShape> | null = null;

/**
 * Read + coerce the env once. Subsequent calls return the cached
 * snapshot. Tests can call `resetEnvCache()` between cases.
 */
export function getEnv(): OmnitronEnvShape {
  if (cached) {
    return override ? { ...cached, ...override } : cached;
  }
  const raw = process.env;
  cached = {
    HOME: raw['HOME'] || os.homedir() || raw['USERPROFILE'] || '/tmp',
    ...(raw['USERPROFILE'] !== undefined && { USERPROFILE: raw['USERPROFILE'] }),
    NODE_ENV: ((raw['NODE_ENV'] as OmnitronEnvShape['NODE_ENV']) ?? 'development'),
    ...(raw['OMNITRON_ROOT'] !== undefined && { OMNITRON_ROOT: raw['OMNITRON_ROOT'] }),
    ...(raw['OMNITRON_OUTPUT'] !== undefined && { OMNITRON_OUTPUT: raw['OMNITRON_OUTPUT'] as 'json' | 'human' }),
    ...(raw['OMNITRON_SOCKET'] !== undefined && { OMNITRON_SOCKET: raw['OMNITRON_SOCKET'] }),
    ...(raw['OMNITRON_CWD'] !== undefined && { OMNITRON_CWD: raw['OMNITRON_CWD'] }),
    OMNITRON_NO_INFRA: raw['OMNITRON_NO_INFRA'] === '1',
    OMNITRON_NO_WATCH: raw['OMNITRON_NO_WATCH'] === '1',
    ...(raw['OMNITRON_DATABASE_URL'] !== undefined && { OMNITRON_DATABASE_URL: raw['OMNITRON_DATABASE_URL'] }),
    ...(raw['OMNITRON_PROJECT'] !== undefined && { OMNITRON_PROJECT: raw['OMNITRON_PROJECT'] }),
    ...(raw['OMNITRON_STACK'] !== undefined && { OMNITRON_STACK: raw['OMNITRON_STACK'] }),
    ...(raw['OMNITRON_STACK_TYPE'] !== undefined && { OMNITRON_STACK_TYPE: raw['OMNITRON_STACK_TYPE'] }),
    ...(raw['OMNITRON_MANAGED'] !== undefined && { OMNITRON_MANAGED: raw['OMNITRON_MANAGED'] }),
    ...(raw['OMNITRON_APP_NAME'] !== undefined && { OMNITRON_APP_NAME: raw['OMNITRON_APP_NAME'] }),
    ...(raw['POSTGRES_USER'] !== undefined && { POSTGRES_USER: raw['POSTGRES_USER'] }),
    ...(raw['POSTGRES_PASSWORD'] !== undefined && { POSTGRES_PASSWORD: raw['POSTGRES_PASSWORD'] }),
    ...(raw['REDIS_PASSWORD'] !== undefined && { REDIS_PASSWORD: raw['REDIS_PASSWORD'] }),
  };
  return cached;
}

/** Patch the cached snapshot for the rest of the process. */
export function setEnvOverride(patch: Partial<OmnitronEnvShape>): void {
  override = { ...(override ?? {}), ...patch };
}

/** Drop the cache + override. Use between tests. */
export function resetEnvCache(): void {
  cached = null;
  override = null;
}

// ---------------------------------------------------------------------------
// Convenience helpers — narrow accessors for the common cases.
// ---------------------------------------------------------------------------

/** Home directory — never undefined, always resolves to *something*. */
export function homeDir(): string {
  return getEnv().HOME;
}

/** True iff `NODE_ENV === 'production'`. */
export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

/** True iff CLI is in machine-readable mode (`--json` / `OMNITRON_OUTPUT=json`). */
export function isJsonOutput(): boolean {
  return getEnv().OMNITRON_OUTPUT === 'json';
}
