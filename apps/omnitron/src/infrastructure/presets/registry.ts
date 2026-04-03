/**
 * Preset Registry — Maps preset names to IServicePreset implementations.
 *
 * Ships with built-in presets for common infrastructure.
 * Projects can register custom presets for specialized services.
 */

import type { IServicePreset, IPresetServiceConfig } from './types.js';
import type { IServiceRequirement, IDockerServiceConfig } from '../types.js';

export class PresetRegistry {
  private readonly presets = new Map<string, IServicePreset>();

  register(preset: IServicePreset): void {
    this.presets.set(preset.name, preset);
  }

  get(name: string): IServicePreset | undefined {
    return this.presets.get(name);
  }

  has(name: string): boolean {
    return this.presets.has(name);
  }

  list(): string[] {
    return [...this.presets.keys()];
  }

  /**
   * Expand a preset shorthand into a full IServiceRequirement.
   * Merges: preset defaults ← user overrides.
   */
  expand(serviceName: string, config: IPresetServiceConfig): IServiceRequirement {
    const preset = this.presets.get(config.preset);
    if (!preset) {
      throw new Error(
        `Unknown service preset '${config.preset}' for service '${serviceName}'. ` +
        `Available presets: ${this.list().join(', ')}`
      );
    }

    // Merge secrets: preset defaults ← user overrides
    const mergedSecrets: Record<string, string> = { ...preset.defaultSecrets };
    if (config.secrets) {
      for (const [k, v] of Object.entries(config.secrets)) {
        mergedSecrets[k] = typeof v === 'string' ? v : v.secret;
      }
    }

    // Merge ports
    const mergedPorts = { ...preset.defaultPorts, ...config.ports };

    // Build Docker config: inject resolved secrets into environment
    const dockerEnv: Record<string, string> = { ...preset.defaultDocker.environment };
    // For postgres: POSTGRES_USER, POSTGRES_PASSWORD
    // For minio: MINIO_ROOT_USER, MINIO_ROOT_PASSWORD
    // These are preset-specific, already in defaultDocker.environment or set here
    if (preset.name === 'postgres') {
      dockerEnv['POSTGRES_USER'] = mergedSecrets['user'] ?? 'postgres';
      dockerEnv['POSTGRES_PASSWORD'] = mergedSecrets['password'] ?? 'postgres';
    } else if (preset.name === 'minio') {
      dockerEnv['MINIO_ROOT_USER'] = mergedSecrets['accessKey'] ?? 'minioadmin';
      dockerEnv['MINIO_ROOT_PASSWORD'] = mergedSecrets['secretKey'] ?? 'minioadmin';
    }
    if (config.docker?.environment) {
      Object.assign(dockerEnv, config.docker.environment);
    }

    // Merge Docker config
    const docker: IDockerServiceConfig = {
      image: config.image ?? preset.defaultImage,
      ...preset.defaultDocker,
      ...config.docker,
      environment: dockerEnv,
    };

    // Build health check — customize user secret (e.g., pg_isready -U <user>)
    let healthCheck = preset.defaultHealthCheck;
    if (preset.name === 'postgres' && mergedSecrets['user']) {
      healthCheck = { ...healthCheck, target: `pg_isready -U ${mergedSecrets['user']}` };
    }
    if (preset.name === 'redis' && mergedSecrets['password']) {
      healthCheck = { ...healthCheck, type: 'command', target: `redis-cli -a ${mergedSecrets['password']} ping` };
    }

    const result: IServiceRequirement = {
      type: preset.type,
      ports: mergedPorts,
      env: preset.generateEnvTemplates?.(config.config ?? {}) ?? {},
      healthCheck,
      secrets: mergedSecrets,
      docker,
      _preset: config.preset,
    };
    if (config.bareMetal) result.bareMetal = config.bareMetal;
    if (config.config) result._presetConfig = config.config;
    return result;
  }
}
