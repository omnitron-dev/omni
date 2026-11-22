import path from 'node:path';
import type { ArtifactInfo } from '../project/artifact-builder.js';
import { assertResidentApplicationRuntime, type ApplicationRuntime } from '../services/host-upgrade.js';
import { shellEscape } from '../shared/shell-escape.js';
import { validOrigin, type ReleaseArtifactOrigin } from './installed-origin.js';
import type { releaseArtifactOrigins } from './origin.js';
import type { readReleaseManifest } from './store.js';
import { assertReleaseTarget } from './target-runtime.js';

type CheckedArtifact = Pick<ArtifactInfo, 'app' | 'version' | 'size' | 'tarballSha256' | 'release'>;
type Allocation = { artifact: CheckedArtifact; directory: string };
type Member = { version: string; origin: ReleaseArtifactOrigin; directory?: string };
type Request = { project?: string; members: Member[] };
type Readers = { readReleaseManifest: typeof readReleaseManifest; releaseArtifactOrigins: typeof releaseArtifactOrigins; maxManifestBytes: number };
type Stats = import('node:fs').BigIntStats;
type Archive = { app: string; file: string; bytes: number; sha256: string };
type Candidate = Archive & { sourceStat: Stats; destination: string; checkDestination(): Promise<void> };
type Verification = {
  physicalFile(file: string): Promise<Stats>;
  sameFile(before: Stats, after: Stats): boolean;
  manifest(): Promise<void>;
  readFlags: number;
};
const artifactRoot = '/opt/omnitron/artifacts';

/** Runs as the receiving service account. The installed SDK supplies its ordinary reader and imported-origin mapping. */
async function inspectArchives(request: Request, store: string, destinations: string, readers: Readers, publish?: typeof stageArchives) {
  const fs = await import('node:fs/promises');
  const { constants } = await import('node:fs');
  const paths = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { isDeepStrictEqual } = await import('node:util');
  const uid = process.getuid?.();
  if (!uid || process.geteuid?.() !== uid) throw Error('Canonical archive transport requires the bound non-root service account');
  const segment = (name: string, version = false) => typeof name === 'string' && name.length <= 255 &&
    (version ? /^[A-Za-z0-9][A-Za-z0-9._+-]*$/ : /^[A-Za-z0-9][A-Za-z0-9._-]*$/).test(name) && !name.includes('..');
  const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.ctimeNs === b.ctimeNs && a.size === b.size;
  async function directory(file: string, privateLeaf = false) {
    const stat = await fs.lstat(file, { bigint: true });
    if (!stat.isDirectory() || await fs.realpath(file) !== file || (stat.mode & (privateLeaf ? 0o077n : 0o022n)) ||
        (stat.uid !== BigInt(uid!) && (privateLeaf || stat.uid !== 0n)))
      throw Error('Canonical archive transport requires a trusted physical directory: ' + file);
    return stat;
  }
  async function physicalFile(file: string) {
    const stat = await fs.lstat(file, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || (stat.mode & 0o022n) || stat.uid !== BigInt(uid!) || await fs.realpath(file) !== file)
      throw Error('Expected a physical service-owned release file: ' + file);
    return stat;
  }
  const stage = request.project !== undefined;
  if (!request.members.length || request.members.length > 256 || (stage && (!segment(request.project!) || !publish)))
    throw Error('Invalid canonical archive request');
  const first = request.members[0]!.origin.runtimeOrigin?.consumer;
  if (!first || !segment(first.releaseId) || !/^[0-9a-f]{64}$/.test(first.manifestSha256)) throw Error('Expected an admitted consumer release');
  const root = paths.join(store, first.releaseId), archiveDir = paths.join(root, 'artifacts');
  try { await directory(store); await directory(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw Error('Canonical release has not been delivered to this service account: ' + first.releaseId, { cause: error });
    throw error;
  }
  await directory(archiveDir);
  const manifestFile = paths.join(root, 'manifest.json');
  const manifestStat = await physicalFile(manifestFile);
  const handle = await fs.open(manifestFile, readFlags);
  let raw: Buffer;
  try {
    if (!sameFile(manifestStat, await handle.stat({ bigint: true })) || manifestStat.size > BigInt(readers.maxManifestBytes))
      throw Error('Unsafe canonical release manifest');
    raw = Buffer.alloc(Number(manifestStat.size));
    for (let offset = 0; offset < raw.length;) {
      const { bytesRead } = await handle.read(raw, offset, raw.length - offset, offset);
      if (!bytesRead) throw Error('Canonical release manifest changed');
      offset += bytesRead;
    }
    if (!sameFile(manifestStat, await handle.stat({ bigint: true }))) throw Error('Canonical release manifest changed');
  } finally { await handle.close(); }
  if (createHash('sha256').update(raw).digest('hex') !== first.manifestSha256) throw Error('Canonical release manifest digest differs');
  const manifest = readers.readReleaseManifest(first.releaseId, store);
  if (!manifest || !isDeepStrictEqual(manifest, JSON.parse(raw.toString('utf8'))) || !sameFile(manifestStat, await physicalFile(manifestFile)))
    throw Error('Canonical release metadata changed or was refused');
  const origins = new Map(readers.releaseArtifactOrigins(manifest, first.manifestSha256).map(entry => [entry.app, entry.origin]));
  const seen = new Set<string>(), files: Archive[] = [], candidates: Candidate[] = [];
  const verifyManifest = async () => {
    if (!sameFile(manifestStat, await physicalFile(manifestFile))) throw Error('Canonical release manifest changed');
  };
  for (const { version, origin, directory: target } of request.members) {
    const app = origin.app;
    if (!segment(app) || !segment(version, true) || seen.has(app) || !isDeepStrictEqual(origin, origins.get(app)) ||
        manifest.artifacts.find(a => a.app === app)?.version !== version)
      throw Error('Requested archive differs from the admitted consumer and producer origin');
    seen.add(app);
    const name = app + '-' + version + '.tar.gz', source = paths.join(archiveDir, name);
    const before = await physicalFile(source);
    if (before.size !== BigInt(origin.artifactBytes)) throw Error('Canonical release archive size differs');
    const archive = { app, file: source, bytes: origin.artifactBytes, sha256: origin.artifactSha256 };
    files.push(archive);
    if (stage) {
      const parent = paths.join(destinations, request.project!, app);
      if (!target || paths.dirname(target) !== parent || !segment(paths.basename(target), true) || target !== paths.resolve(target))
        throw Error('Canonical archive destination is outside the admitted application');
      const chain: { dir: string; stat: Stats }[] = [];
      for (const dir of [destinations, paths.dirname(parent), parent, target])
        chain.push({ dir, stat: await directory(dir, dir === target) });
      if ((await fs.readdir(target)).length) throw Error('Canonical archive destination must be fresh');
      candidates.push({ ...archive, sourceStat: before, destination: target, async checkDestination() {
        for (const { dir, stat } of chain) {
          const now = await directory(dir, dir === target);
          if (now.dev !== stat.dev || now.ino !== stat.ino) throw Error('Canonical archive destination changed');
        }
      } });
    } else if (target !== undefined) throw Error('Read-only canonical archive check cannot specify a destination');
  }
  await verifyManifest();
  if (!stage) return { state: 'present', files };
  return { state: 'staged', files: await publish!(candidates, { physicalFile, sameFile, readFlags, manifest: verifyManifest }) };
}

async function stageArchives(candidates: Candidate[], { physicalFile, sameFile, readFlags, manifest }: Verification): Promise<Archive[]> {
  const fs = await import('node:fs/promises'), paths = await import('node:path');
  const { createHash, randomUUID } = await import('node:crypto');
  async function removeOwn(file: string, identity: Stats) {
    const stat = await fs.lstat(file, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (stat?.dev === identity.dev && stat.ino === identity.ino) await fs.unlink(file);
  }
  const files = [], published: { file: string; identity: Stats }[] = [];
  try {
    for (const { app, file: source, sourceStat: before, destination: target, checkDestination, bytes, sha256 } of candidates) {
      await checkDestination();
      const file = paths.join(target, paths.basename(source));
      const temp = paths.join(target, '.transport-' + randomUUID());
      const input = await fs.open(source, readFlags);
      try {
        if (!sameFile(before, await input.stat({ bigint: true }))) throw Error('Canonical release archive changed before copying');
        const output = await fs.open(temp, 'wx', 0o600);
        const created = await output.stat({ bigint: true });
        try {
          const copiedHash = createHash('sha256');
          let copied = 0;
          for await (const bytesRead of input.createReadStream({ autoClose: false })) {
            copied += bytesRead.length;
            if (copied > bytes) throw Error('Canonical release archive grew while copying');
            copiedHash.update(bytesRead);
            await output.writeFile(bytesRead);
          }
          if (copied !== bytes || !sameFile(before, await physicalFile(source)))
            throw Error('Canonical release changed while copying');
          if (copiedHash.digest('hex') !== sha256) throw Error('Canonical release archive digest differs');
          await output.sync();
          await checkDestination();
          await manifest();
          const own = await output.stat({ bigint: true }), entries = await fs.readdir(target);
          if (entries.length !== 1 || entries[0] !== paths.basename(temp) || !sameFile(own, await physicalFile(temp)) ||
              !sameFile(before, await physicalFile(source)))
            throw Error('Canonical archive or reserved destination changed before publication');
          await fs.link(temp, file);
          published.push({ file, identity: own });
        } finally {
          await output.close();
          await removeOwn(temp, created);
        }
        await checkDestination();
        const final = await physicalFile(file);
        const identity = published[published.length - 1]!.identity;
        if (final.dev !== identity.dev || final.ino !== identity.ino || final.size !== BigInt(bytes))
          throw Error('Published canonical archive identity differs');
        const delivered = await fs.open(file, readFlags);
        try {
          if (!sameFile(final, await delivered.stat({ bigint: true }))) throw Error('Published canonical archive changed');
          const hash = createHash('sha256');
          let read = 0;
          for await (const part of delivered.createReadStream({ autoClose: false })) {
            read += part.length;
            if (read > bytes) throw Error('Published canonical archive grew during verification');
            hash.update(part);
          }
          if (read !== bytes || hash.digest('hex') !== sha256 || !sameFile(final, await physicalFile(file)) || !sameFile(before, await physicalFile(source)))
            throw Error('Published canonical archive digest or identity differs');
        } finally { await delivered.close(); }
      } finally { await input.close(); }
      files.push({ app, file, bytes, sha256 });
    }
    await manifest();
  } catch (error) {
    for (const { file, identity } of published) await removeOwn(file, identity);
    throw error;
  }
  return files;
}

export function receiveCanonicalArchives(request: Request, store: string, destinations: string, readers: Readers) {
  return inspectArchives(request, store, destinations, readers, stageArchives);
}

function archiveMember(artifact: CheckedArtifact, directory?: string): Member {
  const origin = artifact.release;
  if (!validOrigin(origin) || !origin.runtimeOrigin || origin.app !== artifact.app || origin.artifactBytes !== artifact.size ||
      origin.artifactSha256 !== artifact.tarballSha256) throw Error('Canonical archive transport requires the checked application origin');
  return { version: artifact.version, origin, ...(directory !== undefined && { directory }) };
}

function command(request: Request, owner: ApplicationRuntime, controlPackage: string): string {
  assertResidentApplicationRuntime(owner);
  assertReleaseTarget(owner.target, owner.target);
  if (![controlPackage, owner.root, owner.executable].every(file => path.isAbsolute(file) && path.resolve(file) === file && !file.includes('\0')))
    throw Error('Archive delivery requires physical installed runtime paths');
  const program = `import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
const x=JSON.parse(process.argv[1]),uid=process.getuid?.();
if(!uid||uid!==process.geteuid?.()||process.execPath!==x.executable)throw Error('Expected the bound non-root owner executable');
for(const file of [x.executable,x.ownerPackage,x.controlPackage])if(await fs.realpath(file)!==file)throw Error('Expected a physical installed runtime');
if(process.platform==='linux'){const proc='/proc/'+x.pid;const [processOwner,live,me]=await Promise.all([fs.stat(proc),fs.stat(proc+'/exe',{bigint:true}),fs.stat(x.executable,{bigint:true})]);
if(processOwner.uid!==uid||live.dev!==me.dev||live.ino!==me.ino)throw Error('Resident execution owner image differs');}
const sdk=name=>import(pathToFileURL(path.join(x.controlPackage,'dist/release',name+'.js')).href);
await (await sdk('owner-executable')).assertOwnerExecutable(x.pid,x.image);
const [{releasesRoot},{readReleaseManifest},{releaseArtifactOrigins,MAX_RELEASE_MANIFEST_BYTES}]=await Promise.all([sdk('load'),sdk('store'),sdk('origin')]);
console.log(JSON.stringify(await (${inspectArchives.toString()})(x.request,releasesRoot(),${JSON.stringify(artifactRoot)},{readReleaseManifest,releaseArtifactOrigins,maxManifestBytes:MAX_RELEASE_MANIFEST_BYTES},${request.project === undefined ? 'undefined' : stageArchives.toString()})));`;
  return 'env -u NODE_OPTIONS -u NODE_PATH ' + shellEscape(owner.executable) + ' --input-type=module -e ' + shellEscape(program) + ' ' +
    shellEscape(JSON.stringify({ executable: owner.executable, ownerPackage: owner.root, controlPackage, pid: owner.execution!.pid, image: owner.target!.executableSha256, request }));
}

/** Verify the manifest, full origin mapping and archive metadata before the source stack is stopped. */
export function checkCanonicalArchivesCommand(artifacts: readonly CheckedArtifact[], owner: ApplicationRuntime, controlPackage: string): string {
  return command({ members: artifacts.map(artifact => archiveMember(artifact)) }, owner, controlPackage);
}

/** Copy into already reserved application directories. The ordinary installer seals them afterwards. */
export function stageCanonicalArchivesCommand(project: string, allocations: readonly Allocation[], owner: ApplicationRuntime, controlPackage: string): string {
  return command({ project, members: allocations.map(({ artifact, directory }) => archiveMember(artifact, directory)) }, owner, controlPackage);
}
