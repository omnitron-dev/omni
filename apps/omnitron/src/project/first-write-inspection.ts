import { isDeepStrictEqual } from 'node:util';
import type { ReleaseRecipient } from '../release/remote-source.js';
import type { FirstWriteInspection, InspectFirstWrite } from '../shared/dto/first-write.js';
import type { PhysicalRestoreEvidence } from '../shared/dto/physical-restore.js';
import type { IStackInfo, StackStopProgress } from '../shared/dto/project.js';
import { stackExecutionKey } from '../shared/dto/stack-execution.js';
import type { NodeStackStopInventory } from './node-stack-stop.js';
import { confirmStoppedPlacement, type RemotePlacementSource } from './remote-placement.js';
import { confirmsRelease } from './remote-release-deployment.js';
import { stackNodeKey } from './stack-placement.js';

/** The supported physical observer never acquires any of these data-plane authorities. */
export const missingFirstWriteAuthorities: FirstWriteInspection['missing'] = [
  { authority: 'writer-fence', reason: 'The controller lacks a data-owner fence covering all SQL and object-store writers, scheduled jobs, external credentials and in-flight uploads.' },
  { authority: 'pre-write-return', reason: 'A rehearsal receipt must confirm a return to the previous application, routes and consistent data under the same fence.' },
  { authority: 'candidate-rehearsal', reason: 'A trusted runner must confirm the exact candidate migrations and application handlers against an isolated copy.' },
  { authority: 'write-decision', reason: 'The controller lacks a durable decision for the generation that the data owners and write route will admit.' },
  { authority: 'post-write-recovery', reason: 'A recovery receipt must show that returning will preserve the writes the candidate accepts after opening access.' },
];

export async function inspectFirstWriteOwner(request: InspectFirstWrite, selected: RemotePlacementSource,
  expected: Map<string, string>, read: (stoppedReleaseFor?: string) => Promise<NodeStackStopInventory>,
  running: () => Promise<IStackInfo>, lastStop: () => StackStopProgress | null): Promise<FirstWriteInspection['owner']> {
  const initial = await read(), runtime = initial.execution;
  if (!runtime || !['running', 'stopped'].includes(runtime.phase) || !Number.isSafeInteger(runtime.revision) || runtime.revision < 0 ||
      !/^[a-f0-9]{64}$/.test(initial.definition) || !expected.size)
    throw Error('The selected owner has no stable application generation for the review');
  const prefix = stackExecutionKey(runtime) + '/';
  const names = [...expected.keys()].map(name => prefix + name).sort();
  if (!isDeepStrictEqual(runtime.apps.map(app => app.name).sort(), names) ||
      runtime.apps.some(app => typeof app.generation !== 'string' || !app.generation))
    throw Error('The selected owner differs from the application set in the immutable release');
  let stop: FirstWriteInspection['owner']['stop'];
  if (runtime.phase === 'stopped') {
    const record = lastStop();
    const { acknowledgement, confirmed } = confirmStoppedPlacement(request, selected, record, initial);
    const reopened = await read(acknowledgement.operationId), evidence = reopened.stoppedRelease;
    confirmStoppedPlacement(request, selected, lastStop(), reopened);
    if (!isDeepStrictEqual(record, lastStop()) || !isDeepStrictEqual(reopened.execution, runtime) ||
        evidence?.operationId !== acknowledgement.operationId || evidence?.observedAt !== acknowledgement.observedAt ||
        evidence?.release !== selected.release || evidence.manifestSha256 !== selected.manifestSha256 ||
        !isDeepStrictEqual(evidence.apps.map(({ name, generation }) => ({ name, generation })), runtime.apps) ||
        evidence.apps.some(app => app.artifactSha256 !== expected.get(app.name.slice(prefix.length))))
      throw Error('The retained launch closures differ from the selected release at the recorded full stop');
    stop = { id: confirmed.id, nodeOperationId: acknowledgement.operationId!, observedAt: acknowledgement.observedAt! };
  } else {
    const info = await running(), peers = info.placements ?? [], peer = peers[0];
    if (!confirmsRelease(info, { id: selected.release, manifestSha256: selected.manifestSha256 }) ||
        peers.length !== 1 || peer?.nodeKey !== stackNodeKey(selected.host, selected.port) || !peer.appsObserved ||
        peer.apps.length !== names.length || runtime.apps.some(app => {
          const launched = peer.apps.find(member => member.expected && member.process?.name === app.name)?.process;
          return !launched || launched.generation !== app.generation || launched.release?.state !== 'confirmed' ||
            launched.release.artifactSha256 !== expected.get(app.name.slice(prefix.length));
        })) throw Error('The live process owner has not confirmed every selected artifact and launch generation');
    if (!isDeepStrictEqual(initial, await read())) throw Error('The selected execution generation changed during the live inspection');
  }
  return { nodeId: selected.nodeId, definition: initial.definition, project: runtime.project, stack: runtime.stack,
    revision: runtime.revision, phase: stop ? 'stopped' : 'running', containers: initial.containers, ...(stop && { stop }),
    apps: runtime.apps.map(({ name, generation }) => ({ name, generation, artifactSha256: expected.get(name.slice(prefix.length))! })) };
}

export function confirmFirstWriteCopy(request: InspectFirstWrite, owner: FirstWriteInspection['owner'], proof: PhysicalRestoreEvidence,
  resolve: (nodeId: string) => ReleaseRecipient): string[] {
  if (!owner.stop || proof.protocol !== 1 || proof.kind !== 'physical-service-data' || proof.project !== request.project ||
      proof.stack !== request.stack || proof.verifyRunId !== request.verifyRunId || proof.sourceStop !== owner.stop.id ||
      proof.source.nodeId !== owner.nodeId || proof.source.nodeId === proof.receiver.nodeId || !/^[a-f0-9]{64}$/.test(proof.proofDigest))
    throw Error('The physical verification does not belong to this selected source, stack and full stop');
  return [proof.source, proof.receiver].map(pin => {
    const node = resolve(pin.nodeId);
    if (node.host !== pin.host || node.port !== pin.daemonPort || node.fingerprint !== pin.fingerprint ||
        !node.registeredAt || node.registeredAt !== pin.registeredAt || node.sshPort !== pin.sshPort || !/^[a-f0-9]{64}$/.test(node.pin))
      throw Error('The physical restore endpoint differs from the current approved fleet registration');
    return node.pin;
  });
}
