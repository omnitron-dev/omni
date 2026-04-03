/**
 * Built-in Service Presets
 *
 * Registers all presets that ship with Omnitron.
 * Projects can extend the registry with custom presets.
 */

export { PresetRegistry } from './registry.js';
export type { IServicePreset, IPresetServiceConfig, IPostProvisionContext } from './types.js';

import { PresetRegistry } from './registry.js';
import { postgresPreset } from './postgres.js';
import { redisPreset } from './redis.js';
import { minioPreset } from './minio.js';
import { gatewayOpenrestyPreset } from './gateway-openresty.js';

/**
 * Create a PresetRegistry populated with all built-in presets.
 */
export function createDefaultRegistry(): PresetRegistry {
  const registry = new PresetRegistry();

  registry.register(postgresPreset);
  registry.register(redisPreset);
  registry.register(minioPreset);
  registry.register(gatewayOpenrestyPreset);

  return registry;
}
