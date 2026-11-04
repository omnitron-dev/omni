/** Read verified artifact files without installing or evaluating an application. */
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CLOSURE_FILE } from './application-closure.js';
import { assertFrozenDirectory, assertFrozenLaunch, extractFrozenArchive, verifyFrozenApplication } from './frozen-installation.js';
import { loadRelease } from './load.js';
import type { ReleaseArtifact, ReleaseArtifactReference, ReleaseManifest } from './manifest.js';
import { artifactReleaseContext } from './origin.js';
import { sha256File } from './portable-archive.js';
import { releaseNodeOptions, type TargetRuntime } from './target-runtime.js';

export interface InspectedReleaseFile {
  /** Package-relative physical regular member; never a temporary filesystem path. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  /** Exact bytes, not an import, evaluation or interpretation of declarations. */
  readonly contents?: Buffer;
}

export interface ReleaseArtifactInspection {
  readonly manifest: ReleaseManifest;
  readonly manifestSha256: string;
  /** Consumer name and artifact metadata as recorded in the selected manifest. */
  readonly artifact: ReleaseArtifact;
  readonly producer: {
    readonly manifest: ReleaseManifest;
    readonly manifestSha256: string;
    readonly app: string;
    readonly chain: readonly ReleaseArtifactReference[];
  };
  readonly closure: {
    readonly sha256: string;
    readonly payloadSha256: string;
    /** The producer's declared target, checked against its closure, not this host. */
    readonly target: TargetRuntime;
    readonly nodeOptions: string;
  };
  /** Launch first, then requested files in request order, each member once. */
  readonly files: readonly InspectedReleaseFile[];
}

export interface InspectReleaseFileRequest {
  readonly path: string;
  /** Explicit opt-in: at most 4 MiB/file and 16 MiB total. Default is streaming hash/size only. */
  readonly includeContents?: boolean;
}

export interface InspectReleaseArtifactOptions {
  readonly releasesRoot?: string;
  /** At most 64 distinct regular members of any type, in addition to the launch entry. */
  readonly files?: readonly InspectReleaseFileRequest[];
}

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function recordedTarget(value: TargetRuntime | undefined): TargetRuntime {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['platform', 'arch', 'node', 'abi'].every(key => {
        const text = value[key as keyof TargetRuntime];
        return typeof text === 'string' && text.length > 0 && text.length <= 256;
      }) || typeof value.executableSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.executableSha256) ||
      (value.libc !== null && (typeof value.libc !== 'string' || !value.libc || value.libc.length > 256)))
    throw Error('Artifact inspection requires a complete recorded execution target');
  return { platform: value.platform, arch: value.arch, node: value.node, abi: value.abi,
    executableSha256: value.executableSha256, libc: value.libc };
}

/** Private extracted input only. Bound actual reads as well as the initial stat. */
async function readPhysical(file: string, limit: number): Promise<Buffer> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) throw Error('Inspected release file exceeds its byte limit or is not physical');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (BigInt(length) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw Error('Inspected release file changed while reading');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

/** Selection does not follow in-tree aliases, even though dependencies may use them. */
async function physicalMember(root: string, relative: string): Promise<string> {
  if (!relative || relative.length > 4096 || /[\\:\0]/.test(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..'))
    throw Error('Expected a package-relative physical release file: ' + relative);
  const file = path.join(root, relative);
  if (file !== await fs.realpath(file) || !(await fs.lstat(file)).isFile())
    throw Error('Requested release member must be a physical regular file: ' + relative);
  return file;
}

async function inspectPhysical(file: string, includeContents: boolean, limit: number): Promise<Omit<InspectedReleaseFile, 'path'>> {
  if (includeContents) {
    const contents = await readPhysical(file, limit);
    return { sha256: hash(contents), bytes: contents.length, contents };
  }
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw Error('Requested release member is not a physical regular file');
    const digest = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (BigInt(bytes) > before.size) throw Error('Inspected release file changed while reading');
      digest.update(chunk);
    }
    const after = await handle.stat({ bigint: true });
    if (BigInt(bytes) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw Error('Inspected release file changed while reading');
    return { sha256: digest.digest('hex'), bytes };
  } finally { await handle.close(); }
}

/**
 * Diagnostic integrity evidence, not deployment admission or execution authorization.
 * Uses the same origin, extractor and closure checks as installation. The manifest's
 * producer target may differ from this host. No owner, package install, operational
 * receipt or application code execution is involved. Temporary copies are removed
 * on success and failure; only evidence and explicitly requested bounded bytes leave this scope.
 */
export async function inspectReleaseArtifact(
  releaseId: string, app: string, options: InspectReleaseArtifactOptions = {},
): Promise<ReleaseArtifactInspection> {
  const input = options.files ?? [];
  if (!Array.isArray(input) || input.length > 64) throw Error('Expected at most 64 distinct release file requests');
  // Snapshot primitives before the first await; callers retain ownership of their arrays/objects.
  const requested = input.map(file => {
    if (!file || typeof file !== 'object') throw Error('Expected a release file request');
    const { path: relative, includeContents } = file;
    if (typeof relative !== 'string' || (includeContents !== undefined && typeof includeContents !== 'boolean'))
      throw Error('Expected a release path and optional boolean includeContents');
    return { path: relative, includeContents: includeContents === true };
  });
  if (new Set(requested.map(file => file.path)).size !== requested.length)
    throw Error('Expected at most 64 distinct release file requests');
  // loadRelease validates all embedded origins and every archive SHA/size before selection.
  const release = await loadRelease(releaseId, options.releasesRoot);
  const artifact = release.manifest.artifacts.find(value => value.app === app);
  const archive = release.files.find(value => value.app === app);
  if (!artifact || !archive) throw Error('No release artifact for ' + releaseId + '/' + app);
  const producer = artifactReleaseContext(release.manifest, app);
  const launch = producer.artifact.launch;
  assertFrozenLaunch(launch);
  const target = recordedTarget(producer.manifest.builtWith.target);
  const temporary = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'omnitron-artifact-inspection-'));
  try {
    await assertFrozenDirectory(temporary);
    const copied = path.join(temporary, 'archive.tar.gz'), payload = path.join(temporary, 'payload');
    await fs.mkdir(payload, { mode: 0o700 });
    await fs.copyFile(archive.path, copied, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
    if ((await fs.lstat(copied)).size !== archive.bytes || await sha256File(copied) !== archive.sha256)
      throw Error('Release archive changed before inspection');
    await extractFrozenArchive(copied, payload);
    const raw = await readPhysical(path.join(payload, CLOSURE_FILE), 2_000_000);
    if (hash(raw) !== launch.closureSha256) throw Error('Frozen closure differs from the admitted manifest');
    const closure: unknown = JSON.parse(raw.toString('utf8'));
    if (!closure || typeof closure !== 'object' || Array.isArray(closure) ||
        !('nodeOptions' in closure) || typeof closure.nodeOptions !== 'string') throw Error('Invalid frozen closure Node options');
    if (!('protocol' in closure) || closure.protocol !== 1) throw Error('Unsupported frozen closure protocol');
    if (!('payloadSha256' in closure) || typeof closure.payloadSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(closure.payloadSha256))
      throw Error('Invalid frozen closure payload digest');
    const nodeOptions = releaseNodeOptions(closure.nodeOptions);
    await verifyFrozenApplication(payload, launch, target, nodeOptions);
    const files: InspectedReleaseFile[] = [];
    let total = 0;
    const selected = [{ path: launch.file, includeContents: requested.find(file => file.path === launch.file)?.includeContents ?? false },
      ...requested.filter(file => file.path !== launch.file)];
    for (const request of selected) {
      const file = await physicalMember(payload, request.path);
      const evidence = await inspectPhysical(file, request.includeContents === true, Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total));
      total += evidence.contents?.length ?? 0;
      files.push({ path: request.path, ...evidence });
    }
    // Detect any change during requested reads, including private dependency bytes.
    await verifyFrozenApplication(payload, launch, target, nodeOptions);
    return { manifest: release.manifest, manifestSha256: release.manifestSha256, artifact,
      producer: { manifest: producer.manifest,
        manifestSha256: producer.chain.at(-1)?.manifestSha256 ?? release.manifestSha256,
        app: producer.artifact.app, chain: producer.chain },
      closure: { sha256: launch.closureSha256, payloadSha256: closure.payloadSha256, target, nodeOptions }, files };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
