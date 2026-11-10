/**
 * A release as a deployment takes it: read, and checked, before anything
 * moves.
 *
 * The manifest says what the release is; the files beside it are what would
 * be shipped. They are compared here, by size and sha256, on the master —
 * the node compares them again when they arrive (`release/delivered.ts`), and
 * the two checks answer different questions: this one, whether the release on
 * this disk is still the one that was built; that one, whether the transfer
 * delivered it.
 */

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { OMNITRON_HOME } from '../config/defaults.js';
import type { ReleaseManifest } from './manifest.js';
import { MAX_RELEASE_MANIFEST_BYTES, isReadableReleaseManifest, validateReleaseOrigins } from './origin.js';
import { assertReleaseRepositoryIdentities } from './repository-identity.js';

const exec = promisify(execFile);

export interface LoadedRelease {
  readonly id: string;
  readonly root: string;
  readonly manifest: ReleaseManifest;
  /** Digest of the exact manifest bytes admitted with these artifacts. */
  readonly manifestSha256: string;
  /** Each artifact's tarball on this machine, checked against the manifest. */
  readonly files: ReadonlyArray<{ app: string; version: string; path: string; sha256: string; bytes: number; inputs: string }>;
  /** The static bundle's directory, when the release carries one. */
  readonly staticsDir: string | null;
}

export function releasesRoot(): string {
  return path.join(OMNITRON_HOME, 'releases');
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** A release id names a directory; it may not name one anywhere else. */
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertReleaseId(id: string): void {
  if (!RELEASE_ID.test(id) || id.includes('..')) throw new Error(`'${id}' is not a release id`);
}

export class MissingReleaseError extends Error {}

export async function loadRelease(id: string, root: string = releasesRoot()): Promise<LoadedRelease> {
  assertReleaseId(id);
  const dir = path.join(root, id);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const Failure = fs.existsSync(dir) ? Error : MissingReleaseError;
    throw new Failure(`No release '${id}' on this machine — ${manifestPath} does not exist. \`ls ${root}\` lists what was built.`);
  }
  if (fs.realpathSync(manifestPath) !== path.join(fs.realpathSync(root), id, 'manifest.json') ||
      !fs.lstatSync(manifestPath).isFile()) throw Error('Release manifest must be a physical file in its store');
  if (fs.statSync(manifestPath).size > MAX_RELEASE_MANIFEST_BYTES) throw Error('Release manifest exceeds 8 MiB');
  const manifestBytes = fs.readFileSync(manifestPath);
  if (manifestBytes.length > MAX_RELEASE_MANIFEST_BYTES) throw Error('Release manifest exceeds 8 MiB');
  let manifest: unknown;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
  catch { throw Error('Release manifest is not valid JSON'); }
  assertReleaseRepositoryIdentities(manifest);
  if (!isReadableReleaseManifest(manifest)) throw Error('Invalid or duplicate release artifact or manifest fields');
  const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  if (manifest.id !== id) throw new Error(`${manifestPath} names release '${manifest.id}', not '${id}'`);
  validateReleaseOrigins(manifest);

  const files: Array<LoadedRelease['files'][number]> = [];
  const seen = new Set<string>();
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length > 256) throw Error('Invalid release artifact inventory');
  for (const a of manifest.artifacts) {
    if (!a || typeof a.app !== 'string' || !RELEASE_ID.test(a.app) || a.app.includes('..') ||
      typeof a.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(a.version) || a.version.includes('..') ||
      seen.has(a.app) || !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || !/^[a-f0-9]{64}$/.test(a.sha256))
      throw Error('Invalid or duplicate release artifact');
    seen.add(a.app);
    const file = path.join(dir, 'artifacts', `${a.app}-${a.version}.tar.gz`);
    if (!fs.existsSync(file)) throw new Error(`Release ${id} names ${a.app}@${a.version}, and ${file} is not there`);
    // Size first: it tells a truncated copy from a different file, which a
    // checksum mismatch alone does not.
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || fs.realpathSync(file) !== path.join(fs.realpathSync(root), id, 'artifacts', path.basename(file)))
      throw Error('Release artifact must be a physical file in its store');
    const bytes = stat.size;
    if (bytes !== a.bytes) {
      throw new Error(`Release ${id}: ${a.app}'s tarball is ${bytes} bytes, and the manifest recorded ${a.bytes}`);
    }
    const sum = await sha256Of(file);
    if (sum !== a.sha256) {
      throw new Error(`Release ${id}: ${a.app}'s tarball hashes to ${sum.slice(0, 12)}…, and the manifest recorded ${a.sha256.slice(0, 12) || '(nothing)'}…`);
    }
    files.push({ app: a.app, version: a.version, path: file, sha256: sum, bytes, inputs: a.inputs ?? sum });
  }

  const staticsDir = manifest.statics ? path.join(dir, 'statics') : null;
  if (staticsDir && !fs.existsSync(staticsDir)) {
    throw new Error(`Release ${id} records a static bundle for ${manifest.statics!.stack}, and ${staticsDir} is not there`);
  }
  return { id, root: dir, manifest, manifestSha256, files, staticsDir };
}

/**
 * Is this directory's tracked content exactly `commit`, with nothing
 * untracked beside it? Ignored files — machine-local state such as a
 * generated dev secret — are not the commit's business and are not counted.
 */
export async function treeEqualsCommit(
  dir: string,
  commit: string,
  /** Only these paths (relative to `dir`); the whole tree when absent. */
  paths?: readonly string[],
): Promise<{ equal: true } | { equal: false; files: string[] }> {
  if (paths && paths.length === 0) return { equal: true };
  const repository = (await exec('git', ['rev-parse', '--show-toplevel'], { cwd: dir })).stdout.trimEnd();
  const selected = paths?.map(file => {
    const relative = path.relative(repository, path.resolve(dir, file));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error('A compared deployment input is outside the source repository');
    return relative || '.';
  });
  const run = async (args: string[]) =>
    (await exec('git', ['--literal-pathspecs', ...args], { cwd: repository, maxBuffer: 16 * 1024 * 1024 })).stdout.split('\0').filter(Boolean);
  const scope = selected ? ['--', ...selected] : ['--'];
  const changed = await run(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', commit, ...scope]);
  const untracked = await run(['ls-files', '--others', '--exclude-standard', '-z', ...scope]);
  const files = [...changed, ...untracked.map((f) => `${f} (untracked)`)];
  return files.length === 0 ? { equal: true } : { equal: false, files };
}
