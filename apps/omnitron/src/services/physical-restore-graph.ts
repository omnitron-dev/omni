import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import type { InspectPhysicalRestore } from '../shared/dto/physical-restore.js';
import type { Pipeline, PipelineRun } from '../shared/dto/pipelines.js';
import { stableJson } from '../shared/canonical-json.js';
import { validateRunId } from './pipeline-admission.js';

export const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export function canonicalHash(value: unknown): string {
  return sha256(stableJson(value));
}

const hex = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const label = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(s);
const decimal = (s: unknown): s is string => typeof s === 'string' && /^[1-9][0-9]{0,24}$/.test(s);
export function requireFact(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
export function object(value: unknown): Record<string, unknown> {
  requireFact(value && typeof value === 'object' && !Array.isArray(value), 'Invalid physical restore evidence object');
  return value as Record<string, unknown>;
}

// These are protocol versions of the installed Xec exporter, including quoting and executable.
// Changing a worker or a fence requires qualifying that version. The exporter regression builds a real graph.
const programs = {
  pins: 'e8076bd9cc6247571eb469779fb0fd5a8a8fed09e7456a9d855f1948d2d30316',
  stop: '218c241c4e719cf1176c84cd693af320fa878fb9e084d30ee1d1aaec3c24b23e',
  namespaces: '6d5ae2aa13e3e419eb019d395756001d23b53cf75b7c51374ba5ce0dd5559e6a',
  loaders: ['5045fc13a8cb18a1ecd3ec9f8e977d8230e0cb24f3235917cfc0ab612e9fadcd',
    'c10cdec1cb73b89ed4a656d1908ffa0d0de5ebfb58f1b43c8ac6ca97f1eeaaba'],
  adoptSource: '91a0a4d9375c6a5f64a066723956ff7f8f4b0203f337c7f5de8e34cddc5ba9a8',
  apparmor: '98161643bea449e376757d1b3e61d7c01f98538d7e5328595640e32c9677594f',
};
const roles = ['postgres-data', 'nominatim-data', 'nominatim-flatnode', 'nominatim-merged', 'redis-data', 'minio-data'];
const extraRole = /^(postgres|nominatim)-(wal|tblspc-[1-9][0-9]*)$/;

function decoded(encoded: string, compressed: boolean): Buffer {
  requireFact(encoded.length <= 32 * 1024, 'Oversize physical restore argument');
  const bytes = Buffer.from(encoded, 'base64');
  requireFact(bytes.toString('base64') === encoded, 'Invalid physical restore argument encoding');
  return compressed ? gunzipSync(bytes, { maxOutputLength: 128 * 1024 }) : bytes;
}
function qualifiedAdoptionWorker(code: Buffer): boolean {
  // Node/zlib versions use different deflate streams for identical embedded Python modules.
  let modules = 0;
  const source = code.toString('utf8');
  const normalized = source.replace(/(['"])(H4sI[A-Za-z0-9+/]*={0,2})\1/g, (_match, quote: string, packed: string) => {
    modules++;
    return quote + 'sha256:' + sha256(decoded(packed, true)) + quote;
  });
  return Buffer.from(source).equals(code) && modules === 2 && sha256(normalized) === programs.adoptSource;
}
function gate(command: string, expectedProgram: string, compressed = false): unknown {
  const match = / ([A-Za-z0-9+/]+=*)$/.exec(command);
  requireFact(match && match.index + match[0].length === command.length && sha256(command.slice(0, match.index)) === expectedProgram, 'Unrecognized physical restore fence');
  return JSON.parse(decoded(match[1]!, compressed).toString('utf8'));
}

export function physicalRestoreRequest(input: InspectPhysicalRestore): void {
  requireFact(isDeepStrictEqual(Object.keys(object(input)).sort(), ['project','stack','verifyRunId']) &&
    label(input.project) && label(input.stack), 'A registered project, stack and native verify run ID are required');
  validateRunId(input.verifyRunId);
}

export function checkedPhysicalRestore(request: InspectPhysicalRestore, definition: Pipeline, run: PipelineRun) {
  physicalRestoreRequest(request);
  requireFact(run.id === request.verifyRunId && run.status === 'success' && run.startedBy && run.completedAt && run.review &&
    run.pipelineId === definition.id && run.review.definitionRevision === definition.revision && !run.review.parameterNames.length &&
    definition.description === 'Restore sealed service data into fresh, unattached rootless Docker volumes.' &&
    isDeepStrictEqual(definition.triggers, [{ type: 'manual', config: {} }]) && definition.steps.length === 5 && run.steps.length === 5,
    'A completed and approved native adoption verification is required');
  const names = ['registered-pins', 'confirm-stop', 'namespace-evidence', 'verify', 'recheck-stop'];
  const commands = definition.steps.map((step, i) => {
    const known = run.steps[i]!;
    const { run: command, ...config } = step;
    const expected = { name: names[i], timeout: i === 3 ? 86_400_000 : 90_000,
      ...(i > 0 && { retries: 0, dependsOn: [names[i - 1]] }), ...(i === 3 && { nodeId: step.nodeId }) };
    requireFact(isDeepStrictEqual(config, expected) && typeof command === 'string' && Buffer.byteLength(command) <= 22 * 1024 &&
      known.name === step.name && known.status === 'success' && known.exitCode === 0 && known.nodeId === (step.nodeId ?? 'local') && known.kind === 'shell' &&
      known.sourceHash === sha256(JSON.stringify(step)), 'Physical restore steps, placement or execution differ from the verified graph');
    return command;
  });
  const receiver = commands[3]!;
  const m = / '([a-f0-9]{64})' '([A-Za-z0-9+/]+=*)' 'verify' '([A-Za-z0-9+/]+=*)'$/.exec(receiver);
  requireFact(m && m.index + m[0].length === receiver.length && programs.loaders.includes(sha256(receiver.slice(0, m.index))),
    'Unqualified physical restore verification worker');
  const worker = decoded(m[2]!, true), adoptWorker = sha256(worker);
  requireFact(adoptWorker === m[1] && qualifiedAdoptionWorker(worker), 'Unqualified physical restore verification worker');
  const payload: unknown = JSON.parse(decoded(m[3]!, true).toString('utf8'));
  requireFact(Array.isArray(payload) && payload.length === 6, 'Invalid reviewed adoption payload');
  const [rawSeed, rawBinding, rawCold, rawSealed, seedWorker, profile] = payload as unknown[];
  const seed = object(rawSeed), binding = object(rawBinding), cold = object(rawCold), sealed = object(rawSealed);
  const seedId = seed['id'], stop = cold['stop'];
  requireFact(typeof seedId === 'string' && typeof stop === 'string', 'Missing seed or source stop');
  validateRunId(seedId); validateRunId(stop);
  const scope = { project: request.project, stack: request.stack, sourceNode: seed['sourceNode'], sourceIp: seed['sourceIp'] };
  const endpoint = (side: 'source' | 'receiver') => {
    const nodeId = seed[side + 'Node'], host = seed[side + 'Ip'], fingerprint = seed[side + 'Fingerprint'];
    requireFact(label(nodeId) && nodeId !== 'local' && typeof host === 'string' &&
      typeof fingerprint === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint), 'Invalid enrolled physical endpoint');
    return { nodeId, host, fingerprint };
  };
  const source = endpoint('source'), target = endpoint('receiver');
  requireFact(seed['project'] === request.project && seed['stack'] === request.stack && source.nodeId !== target.nodeId &&
    source.host !== target.host && source.fingerprint !== target.fingerprint && definition.steps[3]!.nodeId === target.nodeId &&
    definition.name === 'service-data-adopt-' + seedId + '-verify' && hex(seedWorker) &&
    (profile === null || profile === programs.apparmor), 'Physical restore scope, worker, or receiver differs');
  const pins = { sourceNode: source.nodeId, receiverNode: target.nodeId, sourceFingerprint: source.fingerprint, receiverFingerprint: target.fingerprint };
  const namespace = gate(commands[2]!, programs.namespaces, true);
  requireFact(isDeepStrictEqual(gate(commands[0]!, programs.pins), pins) && isDeepStrictEqual(gate(commands[1]!, programs.stop), [scope,stop]) &&
    commands[1] === commands[4] && Array.isArray(namespace) && namespace.length === 3 && isDeepStrictEqual(namespace[0], binding) &&
    isDeepStrictEqual(namespace[1], { sourceNode: source.nodeId, receiverNode: target.nodeId }) && object(namespace[2])['helper'] === seedWorker,
    'Registered pins, namespaces or stop differ from the reviewed pair');
  const boot = object(namespace[2]), bootSteps = object(boot['steps']);
  requireFact(typeof boot['id'] === 'string' && hex(boot['review']) && typeof binding['evidence'] === 'string' && hex(binding['review']),
    'Missing reviewed bootstrap or namespace identity');
  validateRunId(boot['id']); validateRunId(binding['evidence']);
  const count = Object.keys(bootSteps).length - 1;
  requireFact(count > 0 && count <= 24 && hex(bootSteps['bootstrap-receiver']) &&
    Array.from({ length: count }, (_, i) => hex(bootSteps['helper-part-' + (i + 1)])).every(Boolean), 'Incomplete reviewed receiver bootstrap');
  const spec = canonicalHash(seed);
  requireFact(binding['schema'] === 1 && binding['seed'] === seedId && binding['spec'] === spec && cold['id'] === seedId && cold['spec'] === spec &&
    !Object.hasOwn(binding, 'fileScope') && !Object.hasOwn(cold, 'fileScope') && !Object.hasOwn(sealed, 'fileScope') && sealed['sealed'] === true &&
    sealed['id'] === seedId && sealed['spec'] === spec && sealed['stop'] === stop && sealed['sha256'] === cold['sha256'] &&
    sealed['stage'] === seed['stageParent'] + '/service-data-' + seedId && cold['sha256'] === canonicalHash(cold['trees']),
    'An exact sealed cold receipt including PostgreSQL data is required');
  const trees = object(cold['trees']), volumes = object(binding['volumes']);
  requireFact(Array.isArray(seed['volumes']) && seed['volumes'].length >= roles.length && seed['volumes'].length <= 72, 'Incomplete physical volume set');
  const rows = seed['volumes'].map((item: unknown) => {
    const row = object(item), tag = row['tag'], volume = row['volume'];
    requireFact(typeof tag === 'string' && (roles.includes(tag) || extraRole.test(tag)) && label(volume) && volumes[tag] === volume &&
      decimal(row['device']) && decimal(row['inode']), 'Invalid physical volume identity');
    const tree = object(trees[tag]), files = tree['files'], bytes = tree['bytes'], hash = tree['sha256'];
    requireFact(typeof files === 'number' && Number.isSafeInteger(files) && files >= 0 && typeof bytes === 'number' &&
      Number.isSafeInteger(bytes) && bytes >= 0 && hex(hash), 'Invalid physical tree fingerprint');
    return { tag, volume, source: { device: row['device'], inode: row['inode'] }, files, bytes, sha256: hash };
  });
  const tags = rows.map(r => r.tag).sort();
  requireFact(roles.every(role => tags.includes(role)) && new Set(tags).size === rows.length && new Set(rows.map(r => r.volume)).size === rows.length &&
    isDeepStrictEqual(tags, Object.keys(trees).sort()) && isDeepStrictEqual(tags, Object.keys(volumes).sort()), 'Physical role sets differ');
  const observations = run.steps[3]!;
  requireFact(observations.outputTruncated === false && typeof observations.output === 'string', 'Exact receiver verify output is unavailable');
  const result = object(JSON.parse(observations.output));
  const { volumes: resultVolumes, restored, ...journal } = result;
  const parts = object(journal['identities']), metadata = object(journal['metadata']), clusters = object(seed['clusters']);
  requireFact(restored === true && isDeepStrictEqual(resultVolumes, volumes) && journal['verified'] === true && journal['seed'] === seedId &&
    journal['stop'] === stop && journal['sha256'] === cold['sha256'] && journal['binding'] === canonicalHash(binding) &&
    journal['validatorProfileSha256'] === profile && isDeepStrictEqual(journal['clusters'], clusters) &&
    decimal(clusters['postgres']) && decimal(clusters['nominatim']) && clusters['postgres'] !== clusters['nominatim'] &&
    isDeepStrictEqual(Object.keys(parts).sort(), tags) && isDeepStrictEqual(Object.keys(metadata).sort(), tags), 'Native verification receipt differs from its reviewed inputs');
  const restoredRows = rows.map(row => {
    const pin = parts[row.tag], hash = metadata[row.tag];
    requireFact(Array.isArray(pin) && pin.length === 2 && decimal(pin[0]) && decimal(pin[1]) && hex(hash), 'Invalid reserved volume or metadata identity');
    return { ...row, receiver: { device: pin[0], inode: pin[1] }, metadataSha256: hash };
  });
  return { seed: seedId, stop, source, treeHash: cold['sha256'], receiver: target, rows: restoredRows, clusters: { postgres: clusters['postgres'], nominatim: clusters['nominatim'] },
    reviewDigest: run.review.digest, definitionRevision: definition.revision, runCompletedAt: run.completedAt,
    pinsCommand: commands[0]!, stopCommand: commands[1]!, probe: { seed: seedId, spec, binding: canonicalHash(binding), cold: canonicalHash(cold),
      sealed: canonicalHash(sealed), journal: canonicalHash(journal), seedWorker, adoptWorker } };
}
