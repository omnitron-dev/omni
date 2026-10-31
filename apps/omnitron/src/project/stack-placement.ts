import type { IEcosystemAppEntry, IStackConfig, IStackNode } from '../config/types.js';
import { resolveStartupOrder } from '../orchestrator/dependency-resolver.js';

export function stackNodeKey(host: string, port = 9700): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/** Preserve existing cluster exclusions; explicit placement always takes precedence. */
export function nodeApplicationNames(
  stack: Pick<IStackConfig, 'type'>,
  node: IStackNode,
  applications: readonly string[]
): readonly string[] {
  if (node.apps !== undefined) return node.apps;
  if (stack.type === 'cluster' && (node.role === 'database' || node.role === 'cache')) return [];
  return applications;
}

export interface NodeApplicationPlacement {
  node: IStackNode;
  apps: IEcosystemAppEntry[];
}

/** The planner and executor use the same placement rules, before building or contacting a node. */
export function resolveNodePlacements(
  stack: IStackConfig,
  apps: readonly IEcosystemAppEntry[]
): NodeApplicationPlacement[] {
  const nodes = stack.nodes ?? [];
  if (new Set(apps.map((app) => app.name)).size !== apps.length) throw new Error('Duplicate application definitions');
  resolveStartupOrder([...apps]);
  if (stack.type === 'local') return [];
  if (!nodes.length) throw new Error('A remote topology requires at least one node');
  const names = new Set(apps.map((app) => app.name));
  const seen = new Set<string>();
  const placed = new Set<string>();
  const result = nodes.map((node) => {
    const key = stackNodeKey(node.host, node.port);
    if (!node.host || /[\s/\\\0]/.test(node.host)) throw new Error('Node host must be a hostname or IP address');
    if (node.port !== undefined && (!Number.isInteger(node.port) || node.port < 1 || node.port > 65535))
      throw new Error(`Invalid daemon port on ${key}`);
    if (seen.has(key)) throw new Error(`Node ${key} is listed more than once`);
    seen.add(key);
    const selected = nodeApplicationNames(stack, node, [...names]);
    if (new Set(selected).size !== selected.length) throw new Error(`Duplicate application placement on ${key}`);
    for (const name of selected) {
      if (!names.has(name)) throw new Error(`Application '${name}' on ${key} is not enabled in this stack`);
      placed.add(name);
    }
    const entries = apps.filter((app) => selected.includes(app.name));
    for (const app of entries)
      for (const dependency of app.dependsOn ?? []) {
        if (!selected.includes(dependency))
          throw new Error(
            `${app.name} on ${key} requires local startup dependency '${dependency}'. Place them together; remote readiness requires an explicit service binding, not a discarded dependsOn.`
          );
      }
    resolveStartupOrder(entries);
    return { node, apps: entries };
  });
  const missing = [...names].filter((name) => !placed.has(name));
  if (missing.length) throw new Error(`Applications have no node placement: ${missing.join(', ')}`);
  return result;
}
