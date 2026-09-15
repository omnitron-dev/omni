/**
 * Preset Registry — Maps preset names to IServicePreset implementations.
 *
 * Ships with built-in presets for common infrastructure.
 * Projects can register custom presets for specialized services.
 */

import type { IServicePreset, IPresetServiceConfig } from './types.js';
import type { IServiceRequirement, IDockerServiceConfig } from '../types.js';
import { renderTorrc, authorizedClientFiles, type TorHiddenService } from './torrc.js';

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
    } else if (preset.name === 'tor') {
      // The finished torrc, rendered here.
      //
      // It used to travel as a JSON list that a `jq` loop inside the
      // container turned into torrc stanzas. That put the one file which
      // decides whether a service is anonymous behind a shell script nobody
      // could read without starting a container and nothing could test — and
      // a hardening line dropped by a quoting mistake looks exactly like one
      // that was never written.
      const torCfg = (config.config ?? {}) as {
        hiddenServices?: TorHiddenService[];
        extraTorrc?: string[];
      };
      const services = Array.isArray(torCfg.hiddenServices) ? torCfg.hiddenServices : [];
      dockerEnv['OMNITRON_TORRC'] = renderTorrc({ services, extra: torCfg.extraTorrc });

      // Client-authorization keys go to files tor reads out of each service
      // directory, not into the torrc. A key that never reaches
      // `authorized_clients/` is a restriction that silently does not exist.
      const authFiles = authorizedClientFiles(services);
      if (authFiles.length > 0) {
        dockerEnv['OMNITRON_TOR_CLIENT_AUTH_JSON'] = JSON.stringify(authFiles);
      }
    }
    if (config.docker?.environment) {
      Object.assign(dockerEnv, config.docker.environment);
    }

    // Merge Docker config. The command comes from the preset's own builder
    // when it has one, so the `config` block actually reaches the container;
    // an explicit `docker.command` still wins, because a caller who spelled
    // out the command means it.
    const built = preset.buildCommand?.(config.config ?? {});
    const docker: IDockerServiceConfig = {
      image: config.image ?? preset.defaultImage,
      ...preset.defaultDocker,
      ...(built ? { command: built } : {}),
      ...config.docker,
      environment: dockerEnv,
    };

    // Build health check — customize user secret (e.g., pg_isready -U <user>)
    let healthCheck = preset.defaultHealthCheck;
    if (preset.name === 'postgres' && mergedSecrets['user']) {
      // Parametrise the user, keep the check. This used to replace the whole
      // target with `pg_isready -U <user>` — the exact check the preset
      // spends a paragraph explaining is not good enough, because it returns
      // 0 the moment the postmaster accepts connections, while WAL replay or
      // extension creation may still be running. So configuring a user
      // silently downgraded the health check to the one the preset warns
      // against, and only for the deployments that configure a user.
      const user = mergedSecrets['user'];
      healthCheck = {
        ...healthCheck,
        type: 'command',
        target: `sh -c "psql -U ${user} -d postgres -h /var/run/postgresql -tAc \\"SELECT 1\\" | grep -q 1"`,
      };
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
