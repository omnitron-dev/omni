/**
 * defineEcosystem() — Apply defaults to project configuration
 */

import type { IEcosystemConfig } from './types.js';
import { DEFAULT_ECOSYSTEM } from './defaults.js';
import { validateReadiness } from '../health/contracts.js';

export function defineEcosystem(config: Partial<IEcosystemConfig> & Pick<IEcosystemConfig, 'apps'>): IEcosystemConfig {
  for (const app of config.apps) {
    if (app.readiness !== undefined) {
      validateReadiness(app.readiness);
      if (app.bootstrap && app.readiness.probes.some(probe => probe.type === 'heartbeat')) {
        throw new Error('readiness_invalid: bootstrap applications publish domain health through hooks.onHealthCheck; heartbeat files are for classic scripts.');
      }
    }
  }
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
      // Named, or it is dropped: this block is rebuilt field by field.
      ...(config.monitoring?.alertSink && { alertSink: config.monitoring.alertSink }),
    },
    logging: { ...DEFAULT_ECOSYSTEM.logging, ...config.logging },
  };
}
