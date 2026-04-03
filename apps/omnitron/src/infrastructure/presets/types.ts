/**
 * Service Preset Types — Technology-agnostic infrastructure abstraction
 *
 * A preset encapsulates all technology-specific knowledge (Docker image, ports,
 * health checks, post-provision commands) behind a named factory. Omnitron ships
 * built-in presets for common stacks (postgres, mysql, redis, minio, caddy, etc.)
 * and projects can register custom presets.
 *
 * This enables:
 *   { preset: 'mysql', config: { databases: { users: {} } } }
 * instead of hardcoding MySQL-specific logic in the resolver.
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type {
  IServiceHealthCheck,
  IDockerServiceConfig,
  IBareMetalServiceConfig,
  ResourceLimits,
  SecretRef,
} from '../types.js';

// =============================================================================
// Service Preset
// =============================================================================

/**
 * A service preset — factory that produces IServiceRequirement from minimal config.
 * Carries all technology-specific knowledge: image, ports, health check, post-provision.
 */
export interface IServicePreset {
  /** Unique preset name (e.g., 'postgres', 'mysql', 'redis', 'valkey', 'minio', 'caddy') */
  name: string;

  /** Service category */
  type: 'database' | 'cache' | 'daemon' | 'gateway' | 'storage' | 'sidecar' | 'tool';

  /** Default Docker image */
  defaultImage: string;

  /** Default port map (e.g., { main: 5432 } or { api: 9000, console: 9001 }) */
  defaultPorts: Record<string, number>;

  /** Default health check configuration */
  defaultHealthCheck: IServiceHealthCheck;

  /** Default Docker service config (volumes, command, environment, etc.) */
  defaultDocker: Partial<IDockerServiceConfig>;

  /** Default credentials (e.g., { user: 'postgres', password: 'postgres' }) */
  defaultSecrets: Record<string, string>;

  /**
   * Post-provision hook — runs after the container is healthy.
   * Used for setup like CREATE DATABASE, creating S3 buckets, etc.
   */
  postProvision?: (ctx: IPostProvisionContext) => Promise<void>;

  /**
   * Generate app-facing environment variable templates from user config.
   * E.g., postgres preset generates DATABASE_URL from host/port/user/database.
   * Templates can use ${host}, ${port:name}, ${secret:name} syntax.
   */
  generateEnvTemplates?: (userConfig: Record<string, unknown>) => Record<string, string>;
}

// =============================================================================
// Post-Provision Context
// =============================================================================

/** Context passed to preset postProvision hooks */
export interface IPostProvisionContext {
  /** Running container name (for docker exec) */
  containerName: string;
  /** User-provided config (databases, buckets, etc.) */
  userConfig: Record<string, unknown>;
  /** Resolved secrets (credentials, after secret resolution) */
  secrets: Record<string, string>;
  /** Execute a command inside the running container */
  execInContainer: (command: string[]) => Promise<string>;
  /** Logger for diagnostics */
  logger: ILogger;
}

// =============================================================================
// Preset Service Config (user-facing shorthand)
// =============================================================================

/**
 * User-facing config that references a preset with optional overrides.
 * This is what users write in omnitron.config.ts:
 *
 * ```typescript
 * services: {
 *   db: { preset: 'mysql', config: { databases: { users: {} } } },
 *   cache: { preset: 'redis', image: 'valkey/valkey:8' },
 * }
 * ```
 */
export interface IPresetServiceConfig {
  /** Preset name (e.g., 'postgres', 'mysql', 'redis', 'caddy') */
  preset: string;

  /** Override default Docker image */
  image?: string;

  /** Override default ports */
  ports?: Record<string, number>;

  /** Override default credentials */
  secrets?: Record<string, string | SecretRef>;

  /** Preset-specific config (databases, buckets, caddyfile, etc.) */
  config?: Record<string, unknown>;

  /** Override Docker service config */
  docker?: Partial<IDockerServiceConfig>;

  /** Bare-metal deployment config */
  bareMetal?: Partial<IBareMetalServiceConfig>;

  /** Resource limits */
  resources?: ResourceLimits;
}
