import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { ExecutionService } from '../execution/execution.service.js';
import type { InspectPhysicalRestore, PhysicalRestoreEvidence } from '../shared/dto/physical-restore.js';
import type { Pipeline, PipelineRun } from '../shared/dto/pipelines.js';
import type { NodeManagerService } from './node-manager.service.js';
import { canonicalHash, checkedPhysicalRestore, object, requireFact } from './physical-restore-graph.js';

type Nodes = Pick<NodeManagerService, 'getNode' | 'nodeToSshTarget'>;
type Execution = Pick<ExecutionService, 'exec' | 'ssh'>;
const program = new URL('../../data/operations/physical-restore.py', import.meta.url);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export async function inspectPhysicalRestore(request: InspectPhysicalRestore, definition: Pipeline, run: PipelineRun,
  nodes: Nodes, execution: Execution, signal: AbortSignal): Promise<PhysicalRestoreEvidence> {
  const checked = checkedPhysicalRestore(request, definition, run);
  const script = await readFile(program, 'utf8');
  const resolve = async (side: 'source' | 'receiver') => {
    const pin = checked[side], node = nodes.getNode(pin.nodeId);
    requireFact(node && !node.isLocal && node.host === pin.host && Date.parse(node.createdAt) <= Date.parse(run.startedAt),
      'Physical restore node registration changed since the reviewed run');
    const ssh = await nodes.nodeToSshTarget(node);
    requireFact(ssh.host === pin.host && ssh.expectedHostFingerprint === pin.fingerprint && ssh.port === node.sshPort &&
      ssh.username === node.sshUser, 'Physical restore SSH endpoint or host key differs');
    return { ssh, identity: { ...pin, sshPort: node.sshPort, daemonPort: node.daemonPort, registeredAt: node.createdAt } };
  };
  const fence = async () => {
    for (const command of [checked.pinsCommand, checked.stopCommand]) {
      const result = await execution.exec(command, { timeout: 90_000, signal });
      requireFact(result.exitCode === 0, 'Current registered SSH keys or the exact full source stop could not be confirmed');
    }
  };
  const observedFrom = new Date().toISOString();
  await fence();
  const [source, receiver] = await Promise.all([resolve('source'), resolve('receiver')]);
  const argument = Buffer.from(JSON.stringify(checked.probe)).toString('base64');
  const observe = async (side: 'source' | 'receiver', target: typeof source) => {
    // Only the shipped observer is executed. The reviewed graph's shell is never sent to an endpoint here.
    const result = await execution.ssh(target.ssh, '/usr/bin/python3 -I - ' + side + ' ' + argument,
      { stdin: script, timeout: 86_400_000, signal });
    requireFact(result.exitCode === 0 && Buffer.byteLength(result.stdout) <= 32 * 1024,
      'Current ' + side + ' physical verification failed');
    const reply = object(JSON.parse(result.stdout)), controls = object(reply['controls']), generation = object(reply['generation']);
    requireFact(reply['trees'] === checked.treeHash &&
      digest(controls['postgres']) && digest(controls['nominatim']) && digest(controls['minio']) &&
      isDeepStrictEqual(Object.keys(generation).sort(), checked.rows.map(r => r.tag).sort()) && Object.values(generation).every(digest),
      'Physical journal, controls or volume generations differ');
    return { controls: { postgres: controls['postgres'], nominatim: controls['nominatim'], minio: controls['minio'] },
      generation: generation as Record<string, string> };
  };
  const readings = await Promise.allSettled([observe('source', source), observe('receiver', receiver)]);
  const [donor, target] = readings.map(reading => {
    if (reading.status === 'rejected') throw reading.reason;
    return reading.value;
  }) as [Awaited<ReturnType<typeof observe>>, Awaited<ReturnType<typeof observe>>];
  requireFact(isDeepStrictEqual(donor.controls, target.controls), 'Source and receiver PostgreSQL control or MinIO format fingerprints differ');
  await fence();
  const current = await Promise.all([resolve('source'), resolve('receiver')]);
  requireFact(isDeepStrictEqual(current.map(n => n.identity), [source.identity, receiver.identity]) &&
    current[0]!.ssh.username === source.ssh.username && current[1]!.ssh.username === receiver.ssh.username, 'Physical endpoint registration changed during inspection');
  const facts = { protocol: 1 as const, kind: 'physical-service-data' as const, ...request, seed: checked.seed, sourceStop: checked.stop,
    source: source.identity, receiver: receiver.identity, reviewDigest: checked.reviewDigest, definitionRevision: checked.definitionRevision,
    runCompletedAt: checked.runCompletedAt, volumes: checked.rows.map(row => ({ ...row, sourceGeneration: donor.generation[row.tag]!, receiverGeneration: target.generation[row.tag]! })),
    postgres: { postgres: { systemIdentifier: checked.clusters.postgres, controlSha256: target.controls.postgres },
      nominatim: { systemIdentifier: checked.clusters.nominatim, controlSha256: target.controls.nominatim } },
    minio: { formatSha256: target.controls.minio } };
  return { ...facts, observedFrom, verifiedAt: new Date().toISOString(), proofDigest: canonicalHash(facts) };
}
