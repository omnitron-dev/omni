/**
 * Restart Policy — Maps ecosystem config to PM IRestartPolicy
 */

import type { IRestartPolicy, IBackoffOptions } from '@omnitron-dev/titan-pm';
import type { IEcosystemConfig, IEcosystemAppEntry } from '../config/types.js';

/**
 * Build a PM-compatible restart policy for a given app entry.
 * Per-app overrides take precedence over ecosystem defaults.
 */
export function buildRestartPolicy(entry: IEcosystemAppEntry, config: IEcosystemConfig): IRestartPolicy {
  // Consumers calculate delays from backoff.initial. Normalize the legacy
  // per-app delay alias here so it reaches classic and supervisor launches.
  const initial = entry.restartPolicy?.backoff?.initial ?? entry.restartPolicy?.delay ??
    config.supervision.backoff.initial ?? 1000;
  const base: IRestartPolicy = {
    enabled: true,
    maxRestarts: config.supervision.maxRestarts,
    window: config.supervision.window,
    delay: initial,
    backoff: { ...config.supervision.backoff, initial } as IBackoffOptions,
  };

  if (entry.restartPolicy) {
    const result: IRestartPolicy = { ...base };
    if (entry.restartPolicy.enabled != null) result.enabled = entry.restartPolicy.enabled;
    if (entry.restartPolicy.maxRestarts != null) result.maxRestarts = entry.restartPolicy.maxRestarts;
    if (entry.restartPolicy.window != null) result.window = entry.restartPolicy.window;
    if (entry.restartPolicy.backoff) {
      result.backoff = { ...base.backoff, ...entry.restartPolicy.backoff, initial };
    }
    return result;
  }

  return base;
}
