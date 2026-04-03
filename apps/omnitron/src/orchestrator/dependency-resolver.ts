/**
 * Dependency Resolver — Topological sort for app startup order
 */

import type { IEcosystemAppEntry } from '../config/types.js';

/**
 * Returns apps grouped by dependency level.
 * Each batch can be started in parallel; batches must be started sequentially.
 */
export function resolveStartupOrder(apps: IEcosystemAppEntry[]): IEcosystemAppEntry[][] {
  const byName = new Map(apps.map((a) => [a.name, a]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  // Initialize all nodes first so adj/inDegree exist for dependencies
  for (const app of apps) {
    inDegree.set(app.name, 0);
    adj.set(app.name, []);
  }

  for (const app of apps) {
    for (const dep of app.dependsOn ?? []) {
      if (!byName.has(dep)) {
        throw new Error(`App '${app.name}' depends on unknown app '${dep}'`);
      }
      adj.get(dep)!.push(app.name);
      inDegree.set(app.name, (inDegree.get(app.name) ?? 0) + 1);
    }
  }

  const batches: IEcosystemAppEntry[][] = [];
  let queue = apps.filter((a) => (inDegree.get(a.name) ?? 0) === 0);
  let remaining = apps.length;

  while (queue.length > 0) {
    batches.push(queue);
    remaining -= queue.length;

    const next: IEcosystemAppEntry[] = [];
    for (const app of queue) {
      for (const dependent of adj.get(app.name) ?? []) {
        const deg = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, deg);
        if (deg === 0) {
          next.push(byName.get(dependent)!);
        }
      }
    }
    queue = next;
  }

  if (remaining > 0) {
    const cycled = apps.filter((a) => (inDegree.get(a.name) ?? 0) > 0).map((a) => a.name);
    throw new Error(`Circular dependency detected among: ${cycled.join(', ')}`);
  }

  return batches;
}

/**
 * Returns reverse dependency order for shutdown.
 */
export function resolveShutdownOrder(apps: IEcosystemAppEntry[]): IEcosystemAppEntry[][] {
  return resolveStartupOrder(apps).reverse();
}
