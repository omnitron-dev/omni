import type { PreparedRemoteReleaseSource, StackStopProgress } from '../shared/dto/project.js';
import type { StackExecutionScope } from '../shared/dto/stack-execution.js';
import { stackDefinitionFingerprint, type NodeStackStopInventory } from './node-stack-stop.js';
import { stackNodeKey } from './stack-placement.js';

export interface PlacementEndpoint { nodeId: string; host: string; port: number; pin: string }
export interface RemotePlacementSource extends PlacementEndpoint {
  release: string; prepared: string; manifestSha256: string;
}
export interface RemotePlacement {
  registration: string;
  origin: PlacementEndpoint;
  originCommit: string | null;
  from: PlacementEndpoint;
  sourceStop: StackStopProgress;
  activated: boolean;
  selected: RemotePlacementSource | null;
  receipt: PlacementReceipt;
}
export interface PlacementRequest extends StackExecutionScope {
  fromNodeId: string;
  destination: { release: string; prepared: string } | { registered: true };
}
export interface PlacementReceipt extends StackExecutionScope {
  digest: string; generation: number; fromNodeId: string; toNodeId: string; stopId: string; release: string | null;
}
const digest = /^[a-f0-9]{64}$/;
const name = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
function endpoint(value: PlacementEndpoint): boolean {
  return !!value && typeof value.nodeId === 'string' && name.test(value.nodeId) && typeof value.host === 'string' && !!value.host && !/[\s/\\\0]/.test(value.host) &&
    Number.isInteger(value.port) && value.port > 0 && value.port <= 65535 && digest.test(value.pin);
}
export function validateRemotePlacement(value: RemotePlacement, scope: StackExecutionScope): void {
  if (!value || !value.receipt || !digest.test(value.registration) || !endpoint(value.origin) || !endpoint(value.from) ||
      (value.originCommit !== null && (typeof value.originCommit !== 'string' || !/^[0-9a-f]{40}$/.test(value.originCommit))) || typeof value.activated !== 'boolean' ||
      !value.sourceStop || value.sourceStop.id !== value.receipt.stopId || value.from.nodeId !== value.receipt.fromNodeId ||
      (value.selected !== null && (!endpoint(value.selected) || typeof value.selected.release !== 'string' || !name.test(value.selected.release) ||
        !digest.test(value.selected.prepared) || !digest.test(value.selected.manifestSha256))) ||
      !digest.test(value.receipt.digest) || value.receipt.project !== scope.project || value.receipt.stack !== scope.stack ||
      !Number.isSafeInteger(value.receipt.generation) || value.receipt.generation < 1 || !name.test(value.receipt.fromNodeId) ||
      value.receipt.toNodeId !== (value.selected ?? value.origin).nodeId || typeof value.receipt.stopId !== 'string' || !value.receipt.stopId ||
      value.receipt.release !== (value.selected?.release ?? null)) throw Error('Corrupt remote stack placement');
}
export function remotePlacementReview(scope: StackExecutionScope, generation: number, registration: string, originCommit: string | null, from: PlacementEndpoint,
  to: PlacementEndpoint, prepared: PreparedRemoteReleaseSource | null, stop: StackStopProgress | null, observed: NodeStackStopInventory): PlacementReceipt {
  const { acknowledgement, execution, confirmed } = confirmStoppedPlacement(scope, from, stop, observed);
  const contents = [scope.project, scope.stack, generation, registration, originCommit, from, to, prepared, confirmed.id, confirmed.completedAt,
    acknowledgement.operationId, observed.definition, execution.project, execution.stack, execution.revision, execution.apps.map(app => [app.name, app.generation])];
  return { project: scope.project, stack: scope.stack, generation: generation + 1, fromNodeId: from.nodeId, toNodeId: to.nodeId,
    stopId: confirmed.id, release: prepared?.release ?? null, digest: stackDefinitionFingerprint(['omnitron/remote-placement/v1', contents]) };
}

export function confirmStoppedPlacement(scope: StackExecutionScope, from: PlacementEndpoint, stop: StackStopProgress | null, observed: NodeStackStopInventory) {
  const acknowledgement = stop?.nodes[0];
  if (!stop || stop.phase !== 'stopped' || !stop.intentCommitted || stop.keepInfrastructure || stop.supersededAt ||
      !stop.completedAt || stop.nodes.length !== 1 || acknowledgement?.outcome !== 'stopped' || !acknowledgement.operationId ||
      !acknowledgement.observedAt || !acknowledgement.execution || !acknowledgement.definition ||
      acknowledgement.node !== stackNodeKey(from.host, from.port) || (acknowledgement.nodeId && acknowledgement.nodeId !== from.nodeId))
    throw Error('A completed full stop with the source execution revision and released infrastructure is required');
  const execution = observed.execution;
  if (!execution || execution.phase !== 'stopped' || !Number.isSafeInteger(execution.revision) || execution.revision < 0 ||
      observed.protocol !== 1 || observed.project !== scope.project || observed.stack !== scope.stack || !observed.applications ||
      observed.keepInfrastructure || observed.containers.length || observed.definition !== acknowledgement.definition ||
      execution.project !== acknowledgement.execution.project || execution.stack !== acknowledgement.execution.stack ||
      execution.revision !== acknowledgement.execution.revision)
    throw Error('The pinned source no longer confirms the stopped execution generation and empty container inventory');
  return { acknowledgement, execution, confirmed: stop };
}
