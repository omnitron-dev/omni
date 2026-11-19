import { readSystemSnapshot, type SystemSnapshot } from '../shared/dto/system-info.js';
import { maxFlowNodes, type FlowDefinition } from '../shared/dto/flows.js';

export interface FlowMesh {
  identity(nodeId: string): string;
  snapshot(nodeId: string): Promise<SystemSnapshot>;
}

export function meshSourceIds(definition: FlowDefinition): string[] {
  if (!Array.isArray(definition?.nodes) || definition.nodes.length > maxFlowNodes)
    throw Error('Invalid flow node list');
  return [
    ...new Set(
      definition.nodes.filter((node) => node?.type === 'mesh.disk@1').map((node) => String(node.config['nodeId']))
    ),
  ].sort();
}

/** Only the named volume on the reviewed, authenticated peer can supply these numbers. */
export async function readMeshDisk(mesh: FlowMesh | undefined, nodeId: string, mount: string, pin?: string) {
  if (!mesh || !pin || mesh.identity(nodeId) !== pin) throw Error('The reviewed mesh node is unavailable or changed');
  const snapshot = await mesh.snapshot(nodeId);
  if (mesh.identity(nodeId) !== pin) throw Error('The mesh node changed while reading its disk');
  if (readSystemSnapshot(snapshot).timing !== 'current' || Object.hasOwn(snapshot.unanswered ?? {}, 'disks'))
    throw Error('The mesh node has no current disk observation');
  const matches = snapshot.disks.filter((disk) => disk.mount === mount);
  if (matches.length !== 1) throw Error('The selected mount is missing or ambiguous on the mesh node');
  const { available: freeBytes, size: totalBytes } = matches[0]!;
  if (
    !Number.isSafeInteger(freeBytes) ||
    !Number.isSafeInteger(totalBytes) ||
    freeBytes < 0 ||
    totalBytes <= 0 ||
    freeBytes > totalBytes
  )
    throw Error('Invalid capacity reported by the mesh node');
  return { nodeId, nodeIdentity: pin, mount, freeBytes, totalBytes, observedAt: snapshot.timestamp };
}
