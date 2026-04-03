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
  const base: IRestartPolicy = {
    enabled: true,
    maxRestarts: config.supervision.maxRestarts,
    window: config.supervision.window,
    delay: config.supervision.backoff.initial ?? 1000,
    backoff: config.supervision.backoff as IBackoffOptions,
  };

  if (entry.restartPolicy) {
    const result: IRestartPolicy = { ...base };
    if (entry.restartPolicy.enabled != null) result.enabled = entry.restartPolicy.enabled;
    if (entry.restartPolicy.maxRestarts != null) result.maxRestarts = entry.restartPolicy.maxRestarts;
    if (entry.restartPolicy.window != null) result.window = entry.restartPolicy.window;
    if (entry.restartPolicy.delay != null) result.delay = entry.restartPolicy.delay;
    if (entry.restartPolicy.backoff) {
      result.backoff = { ...base.backoff, ...entry.restartPolicy.backoff };
    }
    return result;
  }

  return base;
}
