/**
 * defineEcosystem() — Apply defaults to project configuration
 */

import type { IEcosystemConfig } from './types.js';
import { DEFAULT_ECOSYSTEM } from './defaults.js';

export function defineEcosystem(config: Partial<IEcosystemConfig> & Pick<IEcosystemConfig, 'apps'>): IEcosystemConfig {
  return {
    ...DEFAULT_ECOSYSTEM,
    ...config,
    supervision: {
      ...DEFAULT_ECOSYSTEM.supervision,
      ...config.supervision,
      backoff: { ...DEFAULT_ECOSYSTEM.supervision.backoff, ...config.supervision?.backoff },
    },
    monitoring: {
      healthCheck: { ...DEFAULT_ECOSYSTEM.monitoring.healthCheck, ...config.monitoring?.healthCheck },
      metrics: { ...DEFAULT_ECOSYSTEM.monitoring.metrics, ...config.monitoring?.metrics },
    },
    logging: { ...DEFAULT_ECOSYSTEM.logging, ...config.logging },
  };
}
