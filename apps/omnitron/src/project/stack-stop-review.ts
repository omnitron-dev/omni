import type { StackStopReview } from '../shared/dto/project.js';
import type { StackExecutionScope } from '../shared/dto/stack-execution.js';
import { stackDefinitionFingerprint, type NodeStackStopInventory } from './node-stack-stop.js';

export type StopReviewTarget = { node: string; inventory: NodeStackStopInventory } | { node: string; reason: string };

/** Bind a human review to the same generations, definition and resources used by execution.
 * Node-issued nonces and their deadlines belong to execution and change on a fresh preparation. */
export function stackStopReview(scope: StackExecutionScope, targets: StopReviewTarget[]): StackStopReview {
  const evidence: unknown[] = [];
  const observations = targets.map(target => {
    if ('reason' in target) return target;
    const { inventory, node } = target;
    const { execution, containers, audience } = inventory;
    evidence.push([node, inventory.project, inventory.stack, inventory.applications, inventory.definition,
      audience ? [audience.clusterId, audience.nodeId] : null,
      execution ? [execution.project, execution.stack, execution.phase, execution.revision, execution.apps.map(a => [a.name, a.generation])] : null,
      containers.map(c => [c.id, c.name])]);
    return { node, ...(execution && { runtime: { project: execution.project, stack: execution.stack } }),
      applications: execution?.apps.map(app => app.name) ?? [], containers: containers.map(container => container.name) };
  });
  const digest = targets.length && evidence.length === targets.length
    ? stackDefinitionFingerprint(['omnitron/stack.stop.review/v1', scope.project, scope.stack, evidence]) : null;
  return { ...scope, checkedAt: new Date().toISOString(), digest, targets: observations };
}
