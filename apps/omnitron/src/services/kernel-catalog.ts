import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { list } from 'tar';
import { OMNITRON_HOME } from '../config/defaults.js';
import { sha256File, writePortableArchive } from '../release/portable-archive.js';
import { readBuildStamp } from '../shared/build-stamp.js';
import type { KernelCatalogEntry } from '../shared/dto/kernel-catalog.js';
import { readRuntimeManifest, runtimeArtifactDigest, runtimeDigestRecord, type RuntimeArtifact } from '../shared/runtime-artifact.js';

type Variant = Pick<KernelCatalogEntry, 'platform' | 'arch' | 'nodeVersion'>;
const sha256 = /^[0-9a-f]{64}$/;
const slot = /^[a-f0-9]{40}-linux-[a-z0-9]{1,16}-v\d+\.\d+\.\d+$/;
const catalogDir = (home: string) => path.join(home, 'kernel-catalog');
export const MAX_KERNEL_ARCHIVE_BYTES = 2 * 1024 ** 3;

function variantKey(commit: string, variant: Variant) {
  const key = [commit, variant.platform, variant.arch, variant.nodeVersion].join('-');
  if (!slot.test(key)) throw Error('A managed catalog build requires a full source commit and an exact Linux architecture and Node version');
  return key;
}

async function privateEntry(filename: string, directory: boolean) {
  const stat = await fs.lstat(filename);
  if ((directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
      stat.uid !== process.getuid?.() || (stat.mode & 0o077) || await fs.realpath(filename) !== filename) {
    throw Error('Unsafe kernel catalog entry: ' + path.basename(filename));
  }
  return stat;
}

async function readEntry(root: string, key: string) {
  if (!slot.test(key)) throw Error('Invalid kernel catalog key');
  const dir = path.join(root, key);
  await privateEntry(dir, true);
  const receipt = path.join(dir, 'build.json');
  if ((await privateEntry(receipt, false)).size > 4096) throw Error('Oversized kernel catalog receipt');
  const entry: KernelCatalogEntry = JSON.parse(await fs.readFile(receipt, 'utf8'));
  if (variantKey(entry.commit, entry) !== key || !sha256.test(entry.artifact) || !sha256.test(entry.archive) ||
      !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > MAX_KERNEL_ARCHIVE_BYTES) throw Error('Invalid kernel catalog receipt');
  const archive = path.join(dir, 'runtime.tgz');
  if ((await privateEntry(archive, false)).size !== entry.bytes) throw Error('Kernel archive size differs from its receipt');
  return { entry, archive };
}

/** Reads only published receipts. Unfinished imports stay private to their publisher. */
export async function listKernelBuilds(home = OMNITRON_HOME): Promise<KernelCatalogEntry[]> {
  const root = catalogDir(home);
  try { await privateEntry(root, true); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const keys = (await fs.readdir(root)).filter(key => !key.startsWith('.import-')).sort();
  if (keys.length > 1024) throw Error('Kernel catalog exceeds 1024 builds. Archive superseded builds before continuing.');
  const builds: KernelCatalogEntry[] = [];
  for (const key of keys) builds.push((await readEntry(root, key)).entry);
  return builds;
}

/** The daemon can distribute published variants, but no RPC imports a controller path. */
export async function resolveKernelBuild(commit: string, variant: Variant, home = OMNITRON_HOME) {
  const key = variantKey(commit, variant);
  try {
    const root = catalogDir(home);
    await privateEntry(root, true);
    const found = await readEntry(root, key);
    if (await sha256File(found.archive) !== found.entry.archive) throw Error('Published kernel archive failed SHA-256 verification');
    return found;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error('Missing controller build for ' + key, { cause: error });
    throw error;
  }
}

async function sync(filename: string) {
  const handle = await fs.open(filename, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

// Verify the bytes selected by tar itself. A workspace modified while being
// packed must not occupy an immutable catalog slot with an unusable archive.
async function verifyPackedBuild(archive: string, manifest: RuntimeArtifact) {
  const digest = createHash('sha256');
  let packedManifest = '', supported = true;
  await list({ file: archive, strict: true, onReadEntry(entry) {
    if (entry.path === 'RUNTIME.json') {
      if (entry.type !== 'File' || entry.size > 16384) { supported = false; return; }
      entry.on('data', (chunk: Buffer) => { packedManifest += chunk.toString('utf8'); });
    } else if (entry.type === 'File') {
      digest.update(runtimeDigestRecord(entry.path, { mode: entry.mode ?? 0 }));
      entry.on('data', (chunk: Buffer) => digest.update(chunk));
      entry.on('end', () => digest.update('\0'));
    } else if (entry.type === 'SymbolicLink') {
      digest.update(runtimeDigestRecord(entry.path, { link: entry.linkpath ?? '' }));
    } else if (entry.type !== 'Directory') supported = false;
  } });
  const metadata: RuntimeArtifact = JSON.parse(packedManifest);
  if (!supported || digest.digest('hex') !== manifest.sha256 || metadata.sha256 !== manifest.sha256 ||
      metadata.platform !== manifest.platform || metadata.arch !== manifest.arch || metadata.nodeVersion !== manifest.nodeVersion ||
      metadata.packages !== manifest.packages || metadata.protocol !== manifest.protocol) throw Error('Packed runtime differs from the sealed build');
}

/** Called locally by the daemon account or its release pipeline, including for foreign CPU/Node targets. */
export async function importKernelBuild(directory: string, home = OMNITRON_HOME): Promise<KernelCatalogEntry> {
  const manifest = await readRuntimeManifest(directory);
  const stamp = readBuildStamp(path.join(directory, 'packages/0/dist'));
  if (!stamp || stamp.dirty) throw Error('The candidate must carry a clean Omnitron build stamp');
  const key = variantKey(stamp.commit, manifest);
  if (await runtimeArtifactDigest(directory) !== manifest.sha256) throw Error('The candidate changed after it was sealed');
  const root = catalogDir(home);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await privateEntry(root, true);
  const final = path.join(root, key);
  const existing = async () => {
    const found = await resolveKernelBuild(stamp.commit, manifest, home);
    if (found.entry.artifact !== manifest.sha256) throw Error('Another artifact already occupies this immutable build variant');
    return found.entry;
  };
  if (await fs.lstat(final).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) return existing();
  const temporary = await fs.mkdtemp(path.join(root, '.import-'));
  try {
    const archive = path.join(temporary, 'runtime.tgz');
    await writePortableArchive(directory, archive, { preserveExecutableBits: true });
    await fs.chmod(archive, 0o600);
    const bytes = (await fs.stat(archive)).size;
    if (bytes <= 0 || bytes > MAX_KERNEL_ARCHIVE_BYTES) throw Error('Kernel archive exceeds the 2 GiB distribution limit');
    await verifyPackedBuild(archive, manifest);
    const entry: KernelCatalogEntry = { commit: stamp.commit, platform: manifest.platform, arch: manifest.arch, nodeVersion: manifest.nodeVersion,
      artifact: manifest.sha256, archive: await sha256File(archive), bytes };
    const receipt = path.join(temporary, 'build.json');
    await fs.writeFile(receipt, JSON.stringify(entry) + '\n', { flag: 'wx', mode: 0o600 });
    await sync(archive); await sync(receipt); await sync(temporary);
    try { await fs.rename(temporary, final); }
    catch (error) {
      if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      return existing();
    }
    await sync(root);
    return entry;
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
