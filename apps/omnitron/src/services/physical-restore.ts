import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { fullStopArgs, registeredPinArgs } from '../../data/operations/controller-inspection.js';
import type { ExecutionService } from '../execution/execution.service.js';
import type { InspectPhysicalRestore, PhysicalRestoreEvidence } from '../shared/dto/physical-restore.js';
import type { Pipeline, PipelineRun } from '../shared/dto/pipelines.js';
import type { NodeManagerService } from './node-manager.service.js';
import { canonicalHash, checkedPhysicalRestore, object, requireFact } from './physical-restore-graph.js';
import { shellEscape } from '../shared/shell-escape.js';
import type { MigrationRehearsalPlan, MigrationRehearsalReceipt, MigrationRehearsalResult, RehearsalCopyPlan, RehearsalCopyReceipt } from '../shared/dto/first-write.js';
import { checkRehearsalCopy, rehearsalRoles } from '../project/first-write-inspection.js';
import { checkMigrationRehearsal } from '../project/rehearse-migrations.js';

type Nodes = Pick<NodeManagerService, 'getNode' | 'nodeToSshTarget'>;
type Execution = Pick<ExecutionService, 'execute' | 'ssh'>;
const program = new URL('../../data/operations/physical-restore.py', import.meta.url);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function physicalEndpoints(checked: ReturnType<typeof checkedPhysicalRestore>, startedAt: string, nodes: Nodes, execution: Execution, signal: AbortSignal) {
  const resolve = async (side: 'source' | 'receiver') => {
    const pin = checked[side], node = nodes.getNode(pin.nodeId);
    requireFact(node && !node.isLocal && node.host === pin.host && Date.parse(node.createdAt) <= Date.parse(startedAt),
      'Physical restore node registration changed since the reviewed run');
    const ssh = await nodes.nodeToSshTarget(node);
    requireFact(ssh.host === pin.host && ssh.expectedHostFingerprint === pin.fingerprint && ssh.port === node.sshPort &&
      ssh.username === node.sshUser, 'Physical restore SSH endpoint or host key differs');
    return { ssh, identity: { ...pin, sshPort: node.sshPort, daemonPort: node.daemonPort, registeredAt: node.createdAt } };
  };
  const fence = async () => {
    const confirm = async (args: string[], expected: Record<string, string>) => {
      const result = await execution.execute({ adapter: 'local', command: 'omnitron', args: ['--json', ...args],
        shell: false, timeout: 40_000, signal, nothrow: true });
      const message = 'Current registered SSH keys or the exact full source stop could not be confirmed';
      requireFact(result.exitCode === 0 && Buffer.byteLength(result.stdout) <= 4096, message);
      const reply = object(JSON.parse(result.stdout));
      requireFact(reply['ok'] === true && isDeepStrictEqual(reply['data'], expected), message);
    };
    for (const { nodeId, fingerprint } of [checked.source, checked.receiver]) {
      await confirm(registeredPinArgs(nodeId, fingerprint), { nodeId, fingerprint });
    }
    await confirm(fullStopArgs(checked.scope, checked.stop), { ...checked.scope, operation: checked.stop });
  };
  return { resolve, fence };
}

export async function inspectPhysicalRestore(request: InspectPhysicalRestore, definition: Pipeline, run: PipelineRun,
  nodes: Nodes, execution: Execution, signal: AbortSignal): Promise<PhysicalRestoreEvidence> {
  const checked = checkedPhysicalRestore(request, definition, run);
  const script = await readFile(program, 'utf8');
  const { resolve, fence } = physicalEndpoints(checked, run.startedAt, nodes, execution, signal);
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

// The installed backend chooses both programs. No executable, credential, pathname or shell arrives from the caller.
const copyEntry = `import json,sys
wire=json.load(sys.stdin)
observer={"__name__":"physical_observer"}; worker={"__name__":"private_rehearsal"}
exec(compile(wire["observer"],"physical-restore.py","exec"),observer)
exec(compile(wire["worker"],"rehearsal-copy.py","exec"),worker)
try:
    def visit(*args): return worker["prepare_working_pair"](wire["plan"],*args,previous_receipt=wire["previous"])
    print(json.dumps(observer["inspect"]("receiver",wire["probe"],visit)))
except Exception as error:
    if isinstance(error,worker["RehearsalRefusal"]): print(str(error),file=sys.stderr)
    sys.exit(1)`;

function checkedRehearsalGraph(plan: RehearsalCopyPlan, definition: Pipeline, run: PipelineRun) {
  const { project, stack, verifyRunId } = plan;
  const checked = checkedPhysicalRestore({ project, stack, verifyRunId }, definition, run);
  const { digest: review, ...facts } = plan;
  const reviewedVolumes = rehearsalRoles.map(tag => checked.rows.find(row => row.tag === tag));
  requireFact(review === canonicalHash(facts) && plan.seed === checked.seed && plan.sourceStop === checked.stop &&
    isDeepStrictEqual(reviewedVolumes, plan.volumes.map(({ sourceGeneration, receiverGeneration, ...row }) =>
      digest(sourceGeneration) && digest(receiverGeneration) ? row : null)) && plan.logicalBytes === plan.volumes.reduce((sum, row) => sum + row.bytes, 0),
    'Private rehearsal differs from the original verified graph');
  return checked;
}

export async function preparePhysicalRehearsal(plan: RehearsalCopyPlan, previous: RehearsalCopyReceipt | undefined, definition: Pipeline, run: PipelineRun,
  nodes: Nodes, execution: Execution, signal: AbortSignal): Promise<RehearsalCopyReceipt> {
  const checked = checkedRehearsalGraph(plan, definition, run);
  const { resolve, fence } = physicalEndpoints(checked, run.startedAt, nodes, execution, signal);
  if (previous) checkRehearsalCopy(plan, previous);
  const [observer, worker] = await Promise.all([readFile(program, 'utf8'), readFile(new URL('../../data/operations/rehearsal-copy.py', import.meta.url), 'utf8')]);
  await fence();
  const target = await resolve('receiver');
  requireFact(isDeepStrictEqual(plan.receiver, target.identity), 'The physical rehearsal recipient changed');
  const result = await execution.ssh(target.ssh, '/usr/bin/python3 -I -c ' + shellEscape(copyEntry), {
    stdin: JSON.stringify({ observer, worker, probe: checked.probe, plan, previous: previous ?? null }), signal, timeout: 86_400_000,
  });
  if (result.exitCode !== 0) {
    const diagnostic = /^[A-Za-z .]{1,120}$/.test(result.stderr.trim()) ? ' ' + result.stderr.trim() : '';
    throw Error('Private rehearsal was not confirmed. Retry the same reviewed operation.' + diagnostic);
  }
  requireFact(Buffer.byteLength(result.stdout) <= 4096, 'Oversized rehearsal receipt');
  const receipt = JSON.parse(result.stdout) as RehearsalCopyReceipt;
  checkRehearsalCopy(plan, receipt);
  requireFact(!previous || isDeepStrictEqual(previous, receipt), 'The previously confirmed private rehearsal roots or generations changed');
  await fence();
  const current = await resolve('receiver');
  requireFact(isDeepStrictEqual(target.identity, current.identity) && target.ssh.username === current.ssh.username, 'The rehearsal enrollment changed');
  return receipt;
}

export async function runPhysicalMigrationTrial(plan: MigrationRehearsalPlan, archive: string, readOnly: boolean, runtime: () => Promise<number>,
  definition: Pipeline, run: PipelineRun, nodes: Nodes, execution: Execution & Pick<ExecutionService, 'uploadFile'>, signal: AbortSignal): Promise<MigrationRehearsalResult> {
  const checked = checkedRehearsalGraph(plan.copy, definition, run);
  const { resolve, fence } = physicalEndpoints(checked, run.startedAt, nodes, execution, signal);
  const { digest: review, ...facts } = plan;
  requireFact(review === canonicalHash(facts) && digest(plan.archiveSha256), 'Invalid private migration review');
  checkRehearsalCopy(plan.copy, plan.receipt);
  await fence();
  const target = await resolve('receiver');
  requireFact(isDeepStrictEqual(plan.copy.receiver, target.identity), 'The migration rehearsal receiver changed');
  const read = (name: string) => readFile(new URL('../../data/operations/' + name, import.meta.url), 'utf8');
  const [observer, copy, entry, sandbox] = await Promise.all([readFile(program, 'utf8'), read('rehearsal-copy.py'),
    read('rehearsal-migrate.py'), read('rehearsal-sandbox.py')]);
  const call = async (phase: 'status' | 'reserve' | 'run', nodePid?: number) => {
    const result = await execution.ssh(target.ssh, '/usr/bin/python3 -I -c ' + shellEscape(entry), {
      stdin: JSON.stringify({ observer, copy, sandbox, probe: checked.probe, phase, plan, nodePid }), signal, timeout: 86_400_000,
    });
    requireFact(result.exitCode === 0 && Buffer.byteLength(result.stdout) < 3 * 1024 * 1024,
      'Private migration response was not confirmed. Inspect the same operation ID.');
    return object(JSON.parse(result.stdout));
  };
  let reply = await call(readOnly ? 'status' : 'reserve');
  if (!readOnly && reply['state'] === 'staging') {
    const pid = await runtime();
    signal.throwIfAborted();
    const destination = '/var/lib/omnitron-release-rehearsals/' + plan.copy.operationId + '/candidate-' + plan.archiveSha256 + '.tar.gz';
    await execution.uploadFile(target.ssh, archive, destination);
    signal.throwIfAborted();
    await fence();
    reply = await call('run', pid);
  }
  requireFact(reply['review'] === plan.digest, 'The receiver returned a different migration review');
  await fence();
  const current = await resolve('receiver');
  requireFact(isDeepStrictEqual(target.identity, current.identity) && target.ssh.username === current.ssh.username, 'The rehearsal receiver was re-enrolled');
  const base = { plan, writeAdmission: 'withheld' as const };
  if (reply['state'] === 'verified') {
    const receipt = reply['receipt'] as MigrationRehearsalReceipt;
    checkMigrationRehearsal(plan, receipt);
    return { ...base, state: 'verified', receipt };
  }
  if (readOnly && ['available','staging'].includes(String(reply['state']))) return { ...base, state: 'awaiting-confirmation' };
  if (reply['state'] === 'unconfirmed' || reply['state'] === 'refused') {
    requireFact(typeof reply['reason'] === 'string' && /^[A-Z_]{1,80}$/.test(reply['reason']), 'Invalid private trial diagnostic');
    return { ...base, state: reply['state'], reason: reply['reason'] };
  }
  throw Error('Unknown native private migration outcome');
}
