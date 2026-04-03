/**
 * Config Normalizer — Converts InfrastructureConfig into flat services map.
 *
 * Output: Record<string, IServiceRequirement> — the canonical form
 * that all downstream code (resolver, provisioner, config-resolver) uses.
 */

import type { InfrastructureConfig, IServiceRequirement } from './types.js';
import type { IPresetServiceConfig } from './presets/types.js';
import type { PresetRegistry } from './presets/registry.js';

/** Helper: build IPresetServiceConfig without undefined values (strict TS) */
function presetConfig(base: Record<string, unknown>): IPresetServiceConfig {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined) result[k] = v;
  }
  return result as unknown as IPresetServiceConfig;
}

/**
 * Normalize any InfrastructureConfig into a flat services map.
 */
export function normalizeInfraConfig(
  raw: InfrastructureConfig,
  registry: PresetRegistry,
): Record<string, IServiceRequirement> {
  const services: Record<string, IServiceRequirement> = {};

  // 1. Legacy sugar → preset expansion
  if (raw.postgres) {
    services['postgres'] = registry.expand('postgres', presetConfig({
      preset: 'postgres',
      image: raw.postgres.image,
      ports: raw.postgres.port ? { main: raw.postgres.port } : undefined,
      secrets: {
        user: raw.postgres.user ?? 'postgres',
        password: typeof raw.postgres.password === 'string' ? raw.postgres.password : 'postgres',
      },
      config: { databases: raw.postgres.databases, pgConfig: raw.postgres.config },
      resources: raw.postgres.resources,
    }));
  }

  if (raw.redis) {
    const pass = typeof raw.redis.password === 'string' ? raw.redis.password : undefined;
    services['redis'] = registry.expand('redis', presetConfig({
      preset: 'redis',
      image: raw.redis.image,
      ports: raw.redis.port ? { main: raw.redis.port } : undefined,
      ...(pass ? { secrets: { password: pass } } : {}),
      config: { redisConfig: raw.redis.config, databases: raw.redis.databases },
      resources: raw.redis.resources,
    }));
  }

  if (raw.minio) {
    const ports = raw.minio.ports
      ? { api: raw.minio.ports.api ?? 9000, console: raw.minio.ports.console ?? 9001 }
      : undefined;
    services['minio'] = registry.expand('minio', presetConfig({
      preset: 'minio',
      image: raw.minio.image,
      ports,
      secrets: {
        accessKey: raw.minio.accessKey ?? 'minioadmin',
        secretKey: typeof raw.minio.secretKey === 'string' ? raw.minio.secretKey : 'minioadmin',
      },
      config: { buckets: raw.minio.buckets },
      resources: raw.minio.resources,
    }));
  }

  if (raw.gateway) {
    services['gateway'] = registry.expand('gateway', presetConfig({
      preset: 'openresty',
      image: raw.gateway.image,
      ports: raw.gateway.port ? { http: raw.gateway.port } : undefined,
      config: { configDir: raw.gateway.configDir },
      resources: raw.gateway.resources,
    }));
  }

  // 2. Unified services map — preset shorthand or full requirement
  if (raw.services) {
    for (const [name, def] of Object.entries(raw.services)) {
      if ('preset' in def) {
        services[name] = registry.expand(name, def as IPresetServiceConfig);
      } else {
        services[name] = def as IServiceRequirement;
      }
    }
  }

  return services;
}
