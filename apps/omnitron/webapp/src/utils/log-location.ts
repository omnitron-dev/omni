import { qualifiedAppHandle } from './app-address';
import { quoteShellArgument as quote } from './shell-command';
import type { AppNodeData } from '../components/topology/topology-store';
import type { IStackInfo } from '@omnitron-dev/omnitron/dto/services';

/** Older workers report project/deployed/app. Only a unique stack allocation on the selected registry node identifies it. */
export function legacyLogTargets(
  project: string, selectedStack: string | null, stacks: readonly IStackInfo[],
  nodes: readonly { id: string; host: string; daemonPort: number }[], nodeId: string,
) {
  const available = new Set<string>();
  let observed = false;
  if (!selectedStack) return { available, observed };
  const node = nodes.find(item => item.id === nodeId);
  const uniqueNode = node && nodes.filter(item => item.host === node.host && item.daemonPort === node.daemonPort).length === 1 ? node : undefined;
  const owners = new Map<string, Set<string>>();
  for (const stack of stacks) {
    if (stack.type === 'local') continue;
    const prefix = (stack.runtimeScope?.project ?? project) + '/deployed/';
    const placements = stack.placements;
    const handles = placements?.length
      ? placements.flatMap(p => p.apps.flatMap(app => app.process?.name?.startsWith(prefix)
        ? [{ handle: app.process.name, host: p.host, port: p.port }] : []))
      : stack.apps.flatMap(app => app.handleKey.startsWith(prefix) && stack.nodes.length === 1
        ? [{ handle: app.handleKey, host: stack.nodes[0]!.host, port: stack.nodes[0]!.port }] : []);
    if (stack.name === selectedStack && (handles.length || stack.apps.some(app => app.handleKey.startsWith(prefix)))) observed = true;
    for (const item of handles) {
      if (uniqueNode?.host !== item.host || uniqueNode?.daemonPort !== item.port) continue;
      const matching = owners.get(item.handle) ?? new Set<string>();
      matching.add(stack.name);
      owners.set(item.handle, matching);
    }
  }
  for (const [handle, matching] of owners) {
    if (matching.size === 1 && matching.has(selectedStack)) available.add(handle);
  }
  return { available, observed };
}

export type TopologyLogTarget = { app: string; nodeId?: string };

/** A graph placement identifies a worker endpoint. Logs are stored under its registry ID. */
export function topologyLogTarget(app: AppNodeData | null, inventory?: {
  project: string; nodes: { id: string; host: string; daemonPort: number }[]; stacks: IStackInfo[];
} | null): TopologyLogTarget | null {
  if (!app) return null;
  if (!app.remote) return { app: app.name };
  if (!qualifiedAppHandle(app.name) || !app.project || app.project !== inventory?.project || !app.logEndpoint) return null;
  const { host, port } = app.logEndpoint;
  const matches = inventory.nodes.filter(node => node.host === host && node.daemonPort === port);
  if (matches.length !== 1) return null;
  const nodeId = matches[0]!.id;
  if (app.name.split('/')[1] === 'deployed' &&
      !legacyLogTargets(app.project, app.stack, inventory.stacks, inventory.nodes, nodeId).available.has(app.name)) return null;
  return { app: app.name, nodeId };
}

/** Preserve the exact application handle and registry node across Console navigation. */
export function logHref(app: string, node?: string): string {
  const params = new URLSearchParams({ app });
  if (node) params.set('node', node);
  return `/logs?${params}`;
}

/** POSIX shell quoting: application names are data, never executable syntax. */
export function logCommand(app: string, node?: string): string {
  return `omnitron logs ${quote(app)}${node ? ` --node ${quote(node)}` : ''} -n 100`;
}
