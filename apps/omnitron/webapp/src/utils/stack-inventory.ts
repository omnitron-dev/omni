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
