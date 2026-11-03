import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ReleaseArtifact, ReleaseArtifactReference, ReleaseManifest } from './manifest.js';
import { validOrigin, type ReleaseArtifactOrigin } from './installed-origin.js';
import { assertReleaseRepositoryIdentities, isSafeRepositoryIdentity } from './repository-identity.js';

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const sha256 = (value: unknown): value is string => typeof value === 'string' && SHA.test(value);
const commit = (value: unknown): value is string => typeof value === 'string' && COMMIT.test(value);
/** The outer manifest includes JSON-escaped producer evidence, bounded separately below. */
export const MAX_RELEASE_MANIFEST_BYTES = 8_388_608;
const MAX_BYTES = 4_194_304, MAX_IMPORTS = 64, MAX_DEPTH = 8;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length <= 256 && ID.test(value) && !value.includes('..');
const relative = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096 &&
  !/[\\:\0]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const outcomes = ['passed', 'failed', 'not-run', 'timed-out', 'killed'];

/** Safe to display as recorded evidence. Empty checksums and zero-byte artifacts stay
 * readable so admission can explain their refusal; readability never grants admission. */
export function isReadableReleaseManifest(value: unknown): value is ReleaseManifest {
  if (!object(value) || !identifier(value['id']) || !object(value['project']) || !object(value['omni']) ||
      [value['project'], value['omni']].some(source => !isSafeRepositoryIdentity(source['repo']) || typeof source['commit'] !== 'string' ||
        (source['onRemote'] !== undefined && source['onRemote'] !== null && typeof source['onRemote'] !== 'boolean')) ||
      !Array.isArray(value['artifacts']) || value['artifacts'].length > 256 || !Array.isArray(value['gates']) || value['gates'].length > 256 ||
      !object(value['builtWith']) || typeof value['builtWith']['omnitron'] !== 'string' || !Array.isArray(value['builtWith']['packages']) ||
      value['builtWith']['packages'].some(pkg => !object(pkg) || typeof pkg['name'] !== 'string' || typeof pkg['distBuiltAt'] !== 'string') ||
      (value['builtAt'] !== undefined && typeof value['builtAt'] !== 'string') || (value['builtBy'] !== undefined && typeof value['builtBy'] !== 'string')) return false;
  const apps = new Set<string>(), gates = new Set<string>();
  for (const artifact of value['artifacts']) {
    if (!object(artifact) || !identifier(artifact['app']) || apps.has(artifact['app']) || typeof artifact['version'] !== 'string' ||
        typeof artifact['sha256'] !== 'string' || !Number.isSafeInteger(artifact['bytes']) || (artifact['bytes'] as number) < 0) return false;
    apps.add(artifact['app']);
  }
  for (const gate of value['gates']) {
    if (!object(gate) || typeof gate['name'] !== 'string' || !gate['name'] || gates.has(gate['name']) || !outcomes.includes(gate['status'] as string) ||
        ['detail', 'output'].some(key => gate[key] !== undefined && typeof gate[key] !== 'string') ||
        ['durationMs', 'checks'].some(key => gate[key] !== undefined && (typeof gate[key] !== 'number' || !Number.isFinite(gate[key]) || gate[key] < 0))) return false;
    gates.add(gate['name']);
  }
  if (value['artifactFailures'] !== undefined && (!Array.isArray(value['artifactFailures']) || value['artifactFailures'].some(failure =>
    !object(failure) || typeof failure['app'] !== 'string' || typeof failure['error'] !== 'string'))) return false;
  if (value['statics'] !== undefined && (!object(value['statics']) || typeof value['statics']['stack'] !== 'string' || typeof value['statics']['dir'] !== 'string' ||
      !Number.isSafeInteger(value['statics']['files']) || !Number.isSafeInteger(value['statics']['bytes']))) return false;
  const machine = value['machine'];
  if (machine != null && (!object(machine) || typeof machine['cpus'] !== 'number' ||
      ['loadAtGateStart', 'loadAtGateEnd'].some(key => !Array.isArray(machine[key]) || machine[key].length !== 3 ||
        machine[key].some((number: unknown) => typeof number !== 'number' || !Number.isFinite(number))))) return false;
  return true;
}

export function assertReleaseArtifactReference(value: unknown): asserts value is ReleaseArtifactReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected an exact release artifact reference');
  const ref = value as Partial<ReleaseArtifactReference>;
  if (!identifier(ref.release) || !identifier(ref.app) || !sha256(ref.manifestSha256) ||
      Object.keys(ref).some(key => !['release', 'app', 'manifestSha256'].includes(key)))
    throw Error('Expected a release id, application name and full manifest SHA-256');
}

export interface ArtifactReleaseContext {
  /** The actual producer of these bytes, never the consumer's source or SDK. */
  readonly manifest: ReleaseManifest;
  readonly artifact: ReleaseArtifact;
  /** Ordered from the direct dependency to the original producer. */
  readonly chain: readonly ReleaseArtifactReference[];
}

/** Validate all embedded evidence once per operation. Exact JSON bytes are retained, not
 * reserialized approximations. Bounds apply to the whole graph, including unused records. */
function evidence(root: ReleaseManifest): Map<ReleaseManifest, Map<string, ReleaseManifest>> {
  const result = new Map<ReleaseManifest, Map<string, ReleaseManifest>>();
  const parsed = new Map<string, { raw: string; manifest: ReleaseManifest }>();
  let total = 0;
  const visit = (manifest: ReleaseManifest, depth: number, ancestors: ReadonlySet<string>): void => {
    assertReleaseRepositoryIdentities(manifest);
    if (depth > MAX_DEPTH) throw Error('Imported release chain exceeds eight levels');
    if (result.has(manifest)) return;
    const imports = manifest.imports ?? [];
    if (!Array.isArray(imports) || imports.length > MAX_IMPORTS) throw Error('Invalid imported release inventory');
    const sources = new Map<string, ReleaseManifest>();
    result.set(manifest, sources);
    for (const record of imports) {
      if (!record || !sha256(record.sha256) || typeof record.manifestJson !== 'string' ||
          Buffer.byteLength(record.manifestJson) > MAX_BYTES || sources.has(record.sha256)) throw Error('Invalid or duplicate imported release manifest');
      if (ancestors.has(record.sha256)) throw Error('Cyclic imported release manifests');
      let source = parsed.get(record.sha256);
      if (source) {
        if (source.raw !== record.manifestJson) throw Error('Imported release digest identifies conflicting bytes');
      } else {
        total += Buffer.byteLength(record.manifestJson);
        if (total > MAX_BYTES || parsed.size >= MAX_IMPORTS) throw Error('Imported release evidence exceeds its size limit');
        if (createHash('sha256').update(record.manifestJson).digest('hex') !== record.sha256)
          throw Error('Imported release manifest does not match its pinned digest');
        let value: unknown;
        try { value = JSON.parse(record.manifestJson); }
        catch { throw Error('Imported release manifest is not valid JSON'); }
        assertReleaseRepositoryIdentities(value);
        if (!isReadableReleaseManifest(value) || !commit(value.project.commit) || !value.project.repo ||
            !commit(value.omni.commit) || !value.omni.repo)
          throw Error('Imported release manifest lacks a complete producer identity');
        source = { raw: record.manifestJson, manifest: value };
        parsed.set(record.sha256, source);
      }
      sources.set(record.sha256, source.manifest);
      visit(source.manifest, depth + 1, new Set([...ancestors, record.sha256]));
    }
  };
  visit(root, 0, new Set());
  return result;
}

function oneArtifact(manifest: ReleaseManifest, app: string): ReleaseArtifact {
  const found = manifest.artifacts.filter(value => value?.app === app);
  if (found.length !== 1) throw Error('No unique release artifact for ' + manifest.id + '/' + app);
  return found[0]!;
}

function payload(artifact: ReleaseArtifact): Omit<ReleaseArtifact, 'app' | 'origin'> {
  const { app: _app, origin: _origin, ...record } = artifact;
  return record;
}

/** An import is an independently portable application, not a claim inferred from a legacy tar. */
export function assertImportableArtifact(manifest: ReleaseManifest, artifact: ReleaseArtifact): void {
  const launch = artifact.launch, source = artifact.packageSource, target = manifest.builtWith?.target;
  if (!object(launch) || !object(source) || !object(target)) throw Error('Imported application needs a recorded package source, frozen entry and execution target: ' + artifact.app);
  if (!['bootstrap', 'script'].includes(launch.mode) || !relative(launch.file) || !/\.[cm]?js$/.test(launch.file) || !sha256(launch.closureSha256) ||
      (source.directory !== '.' && !relative(source.directory)) || !commit(source.manifestBlob) ||
      !object(source.migrations) ||
      Object.entries(source.migrations).some(([file, sha]) => !relative(file) || !sha256(sha)) ||
      !['platform', 'arch', 'node', 'abi'].every(key => typeof target[key as keyof typeof target] === 'string' && target[key as keyof typeof target]) ||
      !sha256(target.executableSha256) || (target.libc !== null && typeof target.libc !== 'string'))
    throw Error('Imported application has malformed source, launch or execution target: ' + artifact.app);
}

function context(
  manifest: ReleaseManifest, app: string, records: ReturnType<typeof evidence>, chain: ReleaseArtifactReference[] = [],
): ArtifactReleaseContext {
  const artifact = oneArtifact(manifest, app);
  if (!artifact.origin) return { manifest, artifact, chain };
  assertReleaseArtifactReference(artifact.origin);
  const source = records.get(manifest)?.get(artifact.origin.manifestSha256);
  if (!source || source.id !== artifact.origin.release) throw Error('Missing pinned producer manifest for ' + app);
  const original = oneArtifact(source, artifact.origin.app);
  if (!isDeepStrictEqual(payload(artifact), payload(original))) throw Error('Imported artifact metadata differs from its producer: ' + app);
  if (chain.length >= MAX_DEPTH) throw Error('Imported release chain exceeds eight levels');
  const result = context(source, original.app, records, [...chain, artifact.origin]);
  assertImportableArtifact(result.manifest, result.artifact);
  return result;
}

/** Shared by build, admission, receipts and diagnostics. No application JavaScript executes. */
export function artifactReleaseContext(manifest: ReleaseManifest, app: string): ArtifactReleaseContext {
  return context(manifest, app, evidence(manifest));
}

/** Every origin must resolve, including artifacts outside the currently selected stack. */
export function artifactReleaseContexts(manifest: ReleaseManifest): ReadonlyArray<ArtifactReleaseContext & { readonly app: string }> {
  const records = evidence(manifest);
  for (const source of records.keys()) {
    if (source === manifest) continue;
    for (const artifact of source.artifacts) context(source, artifact.app, records);
  }
  return manifest.artifacts.map(artifact => ({ app: artifact.app, ...context(manifest, artifact.app, records) }));
}

/** One receipt mapping for local installation and remote delivery. Imported bytes
 * always retain the original producer; only the launch alias belongs to the consumer. */
export function releaseArtifactOrigins(manifest: ReleaseManifest, manifestSha256: string):
  ReadonlyArray<ArtifactReleaseContext & { readonly app: string; readonly origin: ReleaseArtifactOrigin }> {
  if (!sha256(manifestSha256)) throw Error('Invalid release manifest digest');
  return artifactReleaseContexts(manifest).map(source => {
    const launch = source.artifact.launch;
    const origin: ReleaseArtifactOrigin = {
      releaseId: source.manifest.id,
      manifestSha256: source.chain.at(-1)?.manifestSha256 ?? manifestSha256,
      artifactSha256: source.artifact.sha256,
      artifactBytes: source.artifact.bytes,
      app: source.app,
      frameworkCommit: source.manifest.omni.commit,
      ...(launch && { runtimeOrigin: {
        projectCommit: source.manifest.project.commit,
        producerApp: source.artifact.app,
        consumer: { releaseId: manifest.id, manifestSha256, app: source.app },
        entry: { relativeFile: launch.file, mode: launch.mode },
      } }),
    };
    if (!validOrigin(origin)) throw Error('Invalid installed artifact origin for ' + source.app);
    return { ...source, origin };
  });
}

export function validateReleaseOrigins(manifest: ReleaseManifest): void {
  artifactReleaseContexts(manifest);
}

/** Dependencies are independent releases: consumer gates never stand in for producer gates. */
export function importedReleaseRefusal(manifest: ReleaseManifest, apps: readonly string[], requireOnRemote = false): string | null {
  const records = evidence(manifest), checked = new Set<ReleaseManifest>();
  const visit = (source: ReleaseManifest, app: string): string | null => {
    const artifact = oneArtifact(source, app);
    if (!artifact.origin) return null;
    context(source, app, records);
    const producer = records.get(source)!.get(artifact.origin.manifestSha256)!;
    if (!checked.has(producer)) {
      checked.add(producer);
      if (!producer.gates.length) return 'imported release ' + producer.id + ' recorded no gates';
      const failed = producer.gates.find(gate => gate.status !== 'passed');
      if (failed) return `imported release ${producer.id}: gate '${failed.name}' ${failed.status}`;
      if (requireOnRemote && (producer.project.onRemote !== true || producer.omni.onRemote !== true))
        return 'imported release ' + producer.id + ' has a source commit on no remote branch';
    }
    return visit(producer, artifact.origin.app);
  };
  for (const app of apps) {
    if (!manifest.artifacts.some(artifact => artifact.app === app)) continue;
    const refusal = visit(manifest, app);
    if (refusal) return refusal;
  }
  return null;
}
