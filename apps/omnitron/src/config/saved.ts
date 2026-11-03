/** Persisted instance policy. Importing configuration must never load the daemon or CLI startup. */
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DEFAULT_DAEMON_CONFIG, OMNITRON_HOME } from './defaults.js';
import type { DaemonRole, IDaemonConfig } from './types.js';

/** Resolve explicit host policy before default config merging loses its absence. */
export function effectiveBindHost(saved: { role?: string; host?: string } | null): string {
  if (saved?.host) return saved.host;
  if (saved?.role === 'slave') return '0.0.0.0';
  return DEFAULT_DAEMON_CONFIG.host;
}

export interface SavedDaemonConfig {
  cluster?: IDaemonConfig['cluster'];
  executionHost?: IDaemonConfig['executionHost'];
  role: DaemonRole;
  master?: { host: string; port: number };
  initialized: boolean;
  initializedAt: string;
  /** Whether to auto-start webapp (Console UI) with daemon. Set via `omnitron up --webapp`. */
  webapp?: boolean;
  /**
   * Daemon auth settings. `jwtSecret` is generated once and persisted so the
   * console's JWT sessions survive daemon restarts (see ensurePersistedJwtSecret).
   */
  auth?: { jwtSecret: string };
  /**
   * Shared transport admission and proxy trust for HTTP and WebSocket. Persisted because the daemon boots from THIS file, not from the
   * project's ecosystem config — anything set only there is invisible to a
   * running daemon.
   */
  requestRateLimit?: IDaemonConfig['requestRateLimit'];
  httpRateLimit?: IDaemonConfig['httpRateLimit'];
  /** Administrator file exports for this daemon, including an explicit disabled policy. */
  files?: IDaemonConfig['files'];
  /** Exact-name HTTP readiness for immutable application releases. */
  applicationReadiness?: IDaemonConfig['applicationReadiness'];

  /**
   * Transport bind address and the address slaves dial to reach a master.
   *
   * Here for the same reason `httpRateLimit` is: this file is what the daemon
   * boots from. `IDaemonConfig` documents `host` at length — "set `0.0.0.0`
   * to accept connections from other hosts" — and until these fields existed
   * there was nowhere to set it that the daemon would read. A provisioned
   * slave wrote `daemon: { host: '0.0.0.0', … }` into an `omnitron.config.ts`
   * whose schema has no `daemon` key, and booted on loopback.
   */
  host?: string;
  port?: number;
  httpPort?: number;
  advertiseHost?: string;
}

const DAEMON_CONFIG_PATH = path.join(OMNITRON_HOME, 'config.json');

export function readSavedDaemonConfig(configPath = DAEMON_CONFIG_PATH): SavedDaemonConfig | null {
  try {
    const config: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('Expected a daemon configuration object');
    return config as SavedDaemonConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `Cannot read daemon configuration ${configPath}; refusing to replace its access policy with defaults`,
      { cause: error }
    );
  }
}

/** One persisted-settings boundary for foreground and detached daemon startup. */
export function savedDaemonOverrides(saved: SavedDaemonConfig | null): Partial<IDaemonConfig> {
  if (!saved) return {};
  return {
    role: saved.role,
    ...(saved.cluster !== undefined ? { cluster: saved.cluster } : {}),
    ...(saved.master ? { master: saved.master } : {}),
    ...(saved.requestRateLimit ? { requestRateLimit: saved.requestRateLimit } : {}),
    ...(saved.httpRateLimit ? { httpRateLimit: saved.httpRateLimit } : {}),
    ...(saved.files !== undefined ? { files: saved.files } : {}),
    ...(saved.applicationReadiness !== undefined ? { applicationReadiness: saved.applicationReadiness } : {}),
    ...(saved.executionHost !== undefined ? { executionHost: saved.executionHost } : {}),
    host: effectiveBindHost(saved),
    ...(saved.port ? { port: saved.port } : {}),
    ...(saved.httpPort ? { httpPort: saved.httpPort } : {}),
    ...(saved.advertiseHost ? { advertiseHost: saved.advertiseHost } : {}),
  };
}

export function writeSavedDaemonConfig(config: SavedDaemonConfig): void {
  fs.mkdirSync(OMNITRON_HOME, { recursive: true });
  // 0600 — the file now carries the JWT signing secret, so keep it owner-only.
  fs.writeFileSync(DAEMON_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(DAEMON_CONFIG_PATH, 0o600); // tighten perms even if the file pre-existed world-readable
  } catch {
    /* best-effort on platforms without chmod semantics */
  }
}

/**
 * Read the daemon's persisted JWT signing secret, generating and storing a
 * random 32-byte one on first use.
 *
 * Without this the secret falls back to a hardcoded dev constant (or, in
 * production, the daemon refuses to boot). Persisting a per-install secret
 * keeps console sessions (rows in `omnitron_sessions`) valid across daemon
 * restarts — otherwise every `/netron/invoke` 401s after a restart and the
 * operator is silently logged out.
 */
export function ensurePersistedJwtSecret(): string {
  const existing = readSavedDaemonConfig();
  if (existing?.auth?.jwtSecret) return existing.auth.jwtSecret;
  const jwtSecret = randomBytes(32).toString('hex');
  const base: SavedDaemonConfig = existing ?? {
    role: 'master',
    initialized: true,
    initializedAt: new Date().toISOString(),
  };
  writeSavedDaemonConfig({ ...base, auth: { ...existing?.auth, jwtSecret } });
  return jwtSecret;
}
