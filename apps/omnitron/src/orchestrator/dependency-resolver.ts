/**
 * Dependency Resolver — Topological sort for app startup order
 */

import { dependencyBatches, DependencyGraphError } from '@omnitron-dev/titan/utils';
import type { IEcosystemAppEntry } from '../config/types.js';

/**
 * Returns apps grouped by dependency level.
 * Each batch can be started in parallel; batches must be started sequentially.
 */
export function resolveStartupOrder(apps: IEcosystemAppEntry[]): IEcosystemAppEntry[][] {
  try {
    return dependencyBatches(apps, { name: (app) => app.name, dependencies: (app) => app.dependsOn ?? [] });
  } catch (error) {
    if (error instanceof DependencyGraphError && error.code === 'missing-dependency')
      throw new Error(`App '${error.nodes[0]}' depends on unknown app '${error.dependency}'`, { cause: error });
    throw error;
  }
}

/**
 * Returns reverse dependency order for shutdown.
 */
export function resolveShutdownOrder(apps: IEcosystemAppEntry[]): IEcosystemAppEntry[][] {
  return resolveStartupOrder(apps).reverse();
}
