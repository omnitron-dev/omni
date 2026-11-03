/**
 * defineEcosystem() — Apply defaults to project configuration
 */

import type { IEcosystemConfig } from './types.js';
import { DEFAULT_ECOSYSTEM } from './defaults.js';
import { validateReadiness } from '../health/contracts.js';
import { assertReleaseArtifactReference } from '../release/origin.js';

export function defineEcosystem(config: Partial<IEcosystemConfig> & Pick<IEcosystemConfig, 'apps'>): IEcosystemConfig {
  for (const app of config.apps) {
    if (app.releaseFrom !== undefined) {
      assertReleaseArtifactReference(app.releaseFrom);
      if (app.bootstrap || app.script || app.releaseEntry || app.releaseRoot || (app.watch !== undefined && app.watch !== false))
        throw Error('An imported application cannot override its release entry, boundary or watcher: ' + app.name);
    }
    if (app.readiness !== undefined) {
      validateReadiness(app.readiness, app.bootstrap ? 'bootstrap' : app.script ? 'script' : undefined);
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
