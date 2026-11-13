import type { IProjectAppStatus, IStackInfo } from '@omnitron-dev/omnitron/dto/services';

/** The selected slice of an observed inventory. Keep the full inventory for the stack picker. */
export function stacksInScope(stacks: IStackInfo[], selected: string | null) {
  return selected === null ? stacks : stacks.filter(stack => stack.name === selected);
}

/** Count configured deployments, including stopped and unobserved stacks. */
export function stackCounts(stacks: readonly IStackInfo[]) {
  return {
    runningStacks: stacks.filter(stack => stack.status === 'running').length,
    totalStacks: stacks.length,
    unknownStacks: stacks.filter(stack => stack.status === 'unknown').length,
  };
}

/** Use the same observation for the stack inventory and its application counts. */
export function stackApps(stacks: readonly IStackInfo[]): IProjectAppStatus[] {
  return stacks.flatMap(stack => stack.apps.map(app => ({ ...app, stack: stack.name, stackType: stack.type })));
}

/** A node may host several stacks. Count each declared daemon endpoint once. */
export function stackNodes(stacks: readonly IStackInfo[]) {
  const endpoints = new Map<string, { name: string; connected: boolean | null }>();
  for (const stack of stacks) {
    if (!Array.isArray(stack.nodes)) return null;
    for (const node of stack.nodes) {
      const key = JSON.stringify([node.host, node.port]);
      const known = endpoints.get(key);
      if (!known) endpoints.set(key, { name: node.label || `${node.host}:${node.port}`, connected: node.connected });
      else if (known.connected !== node.connected) known.connected = null;
    }
  }
  return [...endpoints.values()];
}
