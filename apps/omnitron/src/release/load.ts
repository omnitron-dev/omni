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

const exec = promisify(execFile);

export interface LoadedRelease {
  readonly id: string;
  readonly root: string;
  readonly manifest: ReleaseManifest;
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

export async function loadRelease(id: string, root: string = releasesRoot()): Promise<LoadedRelease> {
  if (!RELEASE_ID.test(id) || id.includes('..')) throw new Error(`'${id}' is not a release id`);
  const dir = path.join(root, id);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No release '${id}' on this machine — ${manifestPath} does not exist. \`ls ${root}\` lists what was built.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ReleaseManifest;
  if (manifest.id !== id) throw new Error(`${manifestPath} names release '${manifest.id}', not '${id}'`);

  const files: Array<LoadedRelease['files'][number]> = [];
  for (const a of manifest.artifacts) {
    const file = path.join(dir, 'artifacts', `${a.app}-${a.version}.tar.gz`);
    if (!fs.existsSync(file)) throw new Error(`Release ${id} names ${a.app}@${a.version}, and ${file} is not there`);
    // Size first: it tells a truncated copy from a different file, which a
    // checksum mismatch alone does not.
    const bytes = fs.statSync(file).size;
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
  return { id, root: dir, manifest, files, staticsDir };
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
  const run = async (args: string[]) =>
    (await exec('git', args, { cwd: dir, maxBuffer: 16 * 1024 * 1024 })).stdout.split('\n').filter(Boolean);
  const scope = paths ? ['--', ...paths] : ['--'];
  const changed = await run(['diff', '--name-only', commit, ...scope]);
  const untracked = await run(['ls-files', '--others', '--exclude-standard', ...(paths ? ['--', ...paths] : [])]);
  const files = [...changed, ...untracked.map((f) => `${f} (untracked)`)];
  return files.length === 0 ? { equal: true } : { equal: false, files };
}
