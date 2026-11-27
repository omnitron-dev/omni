import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import type { LoadedRelease } from '../release/load.js';
import { isReleaseId } from '../release/load.js';
import { targetRuntime } from '../release/target-runtime.js';
import { stableJson } from '../shared/canonical-json.js';
import type { Pipeline, PipelineDef, PipelineRun, PipelineStep } from '../shared/dto/pipelines.js';
import type { SSHTarget } from '../execution/execution.service.js';
import type { INode } from '../shared/dto/nodes.js';
import type { NodeManagerService } from './node-manager.service.js';
import { validateRunId } from './pipeline-admission.js';

export interface RecoveryQualificationRelease {
  id: string;
  manifestSha256: string;
  commit: string;
  tree: string;
  artifacts: Record<string, string>;
  staticsIndexSha256: string | null;
}

export interface RecoveryQualificationExpected {
  project: string;
  stack: string;
  nodeId: string;
  incumbent: RecoveryQualificationRelease;
  candidate: RecoveryQualificationRelease;
  recovery: RecoveryQualificationRelease;
  addedMigrations: string[];
  probe: { commit: string; sha256: string; image: string; recordSets: string[] };
}

type Nodes = Pick<NodeManagerService, 'getNode' | 'nodeToSshTarget'>;
const sha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const oid = (v: unknown): v is string => typeof v === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v);
const label = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(v);
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const exec = promisify(execFile);
const program = new URL('../../data/operations/recovery-qualification.py', import.meta.url);
export const recoveryProbePath = 'scripts/rehearse-post-write.py';
export const recoveryPolicyPath = '.omnitron/recovery-qualification.json';
const phases = ['full/baseline', 'full/candidate-write', 'full/recovery-read', 'full/recovery-write', 'full/recovery-replay',
  'full/recovery-restart', 'partial/baseline', 'partial/candidate-partial', 'partial/recovery-complete', 'partial/recovery-repeat'];

function requireProof(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error('Recovery qualification: ' + message);
}

function recordSets(values: unknown): values is string[] {
  return Array.isArray(values) && values.length > 0 && values.length <= 32 && values.every(label) &&
    new Set(values).size === values.length;
}

function physicalPath(name: string) {
  return typeof name === 'string' && name.length <= 1024 && !/[\\:]/.test(name) &&
    !Array.from(name).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
    name.split('/').every(p => p && p !== '.' && p !== '..');
}

async function git(root: string, ...args: string[]): Promise<Buffer> {
  return (await exec('git', ['--no-replace-objects', ...args], { cwd: root, encoding: 'buffer', maxBuffer: 256 * 1024 })).stdout;
}

/** All data here comes from a registered project's actual Git object store. */
export async function readRecoveryQualificationProbe(root: string, candidateCommit: string, probeCommit: string) {
  requireProof(oid(candidateCommit) && oid(probeCommit), 'full candidate and probe commits required');
  for (const commit of new Set([candidateCommit, probeCommit])) requireProof((await git(root, 'cat-file', '-t', commit)).toString().trim() === 'commit',
    'probe and candidate must identify commit objects');
  await git(root, 'merge-base', '--is-ancestor', candidateCommit, probeCommit);
  const changes = await git(root, 'diff-tree', '--no-commit-id', '--no-renames', '-r', '--name-only', '-z', candidateCommit, probeCommit);
  requireProof(changes.toString().split('\0').filter(Boolean).every(name => [recoveryProbePath, recoveryPolicyPath].includes(name)),
    'the probe revision changes other project files');
  const blob = async (file: string) => {
    const listing = (await git(root, 'ls-tree', '--full-tree', '-z', probeCommit, '--', file)).toString();
    const row = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)\0$/.exec(listing);
    requireProof(row && row[3] === file, 'reviewed regular Git file is missing: ' + file);
    return git(root, 'cat-file', 'blob', row[2]!);
  };
  const [policyBytes, probe] = await Promise.all([blob(recoveryPolicyPath), blob(recoveryProbePath)]);
  const policy = JSON.parse(policyBytes.toString()) as Record<string, unknown>;
  requireProof(policy && isDeepStrictEqual(Object.keys(policy).sort(), ['image', 'protocol', 'recordSets']) && policy['protocol'] === 1 &&
    typeof policy['image'] === 'string' && /^sha256:[a-f0-9]{64}$/.test(policy['image']) && recordSets(policy['recordSets']) && probe.length,
    'invalid committed QA image or record coverage');
  return { commit: probeCommit, sha256: hash(probe), image: policy['image'], recordSets: policy['recordSets'] };
}

/** The content index can be staged alongside the release's individual static files. */
export async function readRecoveryStaticIndex(root: string) {
  requireProof((await lstat(root)).isDirectory() && await realpath(root) === path.resolve(root), 'static directory must be physical');
  const index: Record<string, { bytes: number; sha256: string }> = Object.create(null);
  let count = 0, bytes = 0;
  const visit = async (relative: string) => {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      requireProof(physicalPath(name), 'invalid static path');
      const file = path.join(root, name);
      requireProof(await realpath(file) === file, 'symbolic link in static tree');
      if (entry.isDirectory()) { await visit(name); continue; }
      requireProof(entry.isFile() && ++count <= 32768, 'invalid static member');
      const fh = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
      try {
        const stat = await fh.stat();
        requireProof(stat.isFile() && stat.size <= 128 * 1024 ** 2 && bytes + stat.size <= 8 * 1024 ** 3,
          'static member exceeds the rehearsal budget');
        const sum = createHash('sha256');
        let read = 0;
        for await (const chunk of fh.createReadStream({ autoClose: false })) {
          read += chunk.length;
          requireProof(read <= stat.size, 'static member changed during inspection');
          sum.update(chunk);
        }
        requireProof(read === stat.size, 'static member changed during inspection');
        bytes += read;
        index[name] = { bytes: read, sha256: sum.digest('hex') };
      } finally { await fh.close(); }
    }
  };
  await visit('');
  return { index, files: count, bytes };
}

export async function readRecoveryQualificationRelease(release: LoadedRelease, sourceRoot: string): Promise<RecoveryQualificationRelease> {
  const { id, manifest, manifestSha256 } = release;
  requireProof(id === manifest.id && oid(manifest.project.commit) && sha(manifestSha256), 'invalid loaded release');
  const tree = (await git(sourceRoot, 'rev-parse', '--verify', manifest.project.commit + '^{tree}')).toString().trim();
  requireProof(oid(tree), 'release Git tree unavailable');
  const artifacts = Object.fromEntries(release.files.map(f => [f.app, f.sha256]));
  let staticsIndexSha256 = null;
  if (manifest.statics || release.staticsDir) {
    requireProof(manifest.statics && release.staticsDir, 'missing release statics');
    const { index, bytes, files } = await readRecoveryStaticIndex(release.staticsDir);
    requireProof(bytes === manifest.statics.bytes && files === manifest.statics.files, 'static index differs from the manifest');
    staticsIndexSha256 = hash(stableJson(index));
  }
  return { id, manifestSha256, commit: manifest.project.commit, tree, artifacts, staticsIndexSha256 };
}

export function validateRecoveryQualification(spec: RecoveryQualificationExpected) {
  requireProof(label(spec.project) && label(spec.stack) && label(spec.nodeId) && spec.nodeId !== 'local', 'invalid production scope');
  requireProof(Array.isArray(spec.addedMigrations) && spec.addedMigrations.length >= 2 && spec.addedMigrations.length <= 64 &&
    spec.addedMigrations.every(physicalPath) && new Set(spec.addedMigrations).size === spec.addedMigrations.length,
    'exact ordered migration additions required');
  requireProof(oid(spec.probe.commit) && sha(spec.probe.sha256) && /^sha256:[a-f0-9]{64}$/.test(spec.probe.image) &&
    recordSets(spec.probe.recordSets), 'invalid immutable probe');
  const releases = [spec.incumbent, spec.candidate, spec.recovery];
  for (const release of releases) {
    requireProof(isReleaseId(release.id) && sha(release.manifestSha256) && oid(release.commit) && oid(release.tree) &&
      (release.staticsIndexSha256 === null || sha(release.staticsIndexSha256)) &&
      Object.keys(release.artifacts).length > 0 && Object.keys(release.artifacts).length <= 256 &&
      Object.entries(release.artifacts).every(([app, sum]) => label(app) && sha(sum)), 'invalid release closure');
  }
  requireProof(new Set(releases.map(r => r.id)).size === 3 && new Set(releases.map(r => r.manifestSha256)).size === 3,
    'three distinct releases required');
  requireProof(!isDeepStrictEqual(spec.candidate.artifacts, spec.recovery.artifacts), 'the return release contains identical application closures');
}

function endpoint(node: INode, ssh: SSHTarget) {
  requireProof(!node.isLocal && ssh.host === node.host && ssh.username === node.sshUser && ssh.port === node.sshPort &&
    typeof ssh.expectedHostFingerprint === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(ssh.expectedHostFingerprint),
    'registered and pinned remote SSH endpoint required');
  return { nodeId: node.id, host: node.host, port: node.sshPort, user: node.sshUser,
    createdAt: node.createdAt, fingerprint: ssh.expectedHostFingerprint };
}

const qaIdentity = 'OMNITRON_RECOVERY_QA_ENDPOINT';
export function requireRecoveryQaEndpoint(step: PipelineStep, node: INode, ssh: SSHTarget) {
  if (step.env?.[qaIdentity]) requireProof(hash(stableJson(endpoint(node, ssh))) === step.env[qaIdentity],
    'the execution adapter resolved a different QA endpoint');
}

export async function recoveryQualificationDefinition(spec: RecoveryQualificationExpected, qaNodeId: string, nodes: Nodes): Promise<PipelineDef> {
  validateRecoveryQualification(spec);
  requireProof(label(qaNodeId) && qaNodeId !== 'local' && qaNodeId !== spec.nodeId, 'separate enrolled QA node required');
  const pins = await Promise.all([spec.nodeId, qaNodeId].map(async id => {
    const node = nodes.getNode(id);
    requireProof(node && node.id === id, 'registered node unavailable: ' + id);
    return endpoint(node, await nodes.nodeToSshTarget(node));
  }));
  const [source, qa] = pins as [typeof pins[number], typeof pins[number]];
  requireProof(source.host !== qa.host && source.fingerprint !== qa.fingerprint, 'QA shares the production endpoint or host key');
  const worker = (await readFile(program)).toString('base64');
  const inputs = Buffer.from(stableJson(spec)).toString('base64');
  const runtime = Buffer.from('(' + targetRuntime.toString() + ')().then(x=>console.log(JSON.stringify(x)))').toString('base64');
  return { name: 'recovery-qualification-' + hash(stableJson(spec)), description: 'Verify post-write application recovery on isolated synthetic state.',
    triggers: [{ type: 'manual', config: {} }], steps: [{ name: 'qualify-recovery', kind: 'shell', nodeId: qaNodeId, retries: 0, timeout: 1_800_000,
      env: { [qaIdentity]: hash(stableJson(qa)), OMNITRON_RECOVERY_LIVE_ENDPOINT: hash(stableJson(source)) },
      run: "/usr/bin/python3 -I -B -c 'import base64,sys;exec(base64.b64decode(sys.argv.pop(1),validate=True))' " + [worker, runtime, inputs].join(' ') }] };
}

/** Rebuild the installed worker and compare to the graph in the durable admission, not the current pipeline. */
export async function inspectRecoveryQualification(runId: string, spec: RecoveryQualificationExpected, definition: Pipeline, run: PipelineRun, nodes: Nodes) {
  validateRunId(runId);
  const step = definition.steps[0];
  requireProof(step?.nodeId, 'missing QA placement');
  const canonical = await recoveryQualificationDefinition(spec, step.nodeId, nodes);
  const saved = run.steps[0];
  requireProof(isDeepStrictEqual(canonical, { name: definition.name, description: definition.description, triggers: definition.triggers, steps: definition.steps }) &&
    run.id === runId && run.status === 'success' && run.startedBy && run.completedAt && run.review?.definitionRevision === definition.revision &&
    !run.review.parameterNames.length && run.pipelineId === definition.id && run.steps.length === 1 &&
    saved && saved.kind === 'shell' && saved.sourceHash === hash(JSON.stringify(step)) && saved.attempts === 1 &&
    saved.name === step.name && saved.nodeId === step.nodeId && saved.status === 'success' && saved.exitCode === 0 &&
    !saved.error && !saved.stderr && saved.outputTruncated === false && saved.output && Buffer.byteLength(saved.output) <= 4096,
    'a complete approved run of the installed QA worker on the registered receiver is required');
  const result = JSON.parse(saved.output) as { protocol?: number; challenge?: string; inputs?: string; phases?: {phase: string; sha256: string}[] };
  requireProof(result.protocol === 1 && typeof result.challenge === 'string' && /^[a-f0-9]{48}$/.test(result.challenge) &&
    result.inputs === hash(stableJson(spec)) && Array.isArray(result.phases) && result.phases.length === phases.length &&
    result.phases.every((entry, i) => entry.phase === phases[i] && sha(entry.sha256)), 'incomplete native qualification receipt');
  return hash(stableJson({ runId, definition: definition.revision, review: run.review.digest, result }));
}
