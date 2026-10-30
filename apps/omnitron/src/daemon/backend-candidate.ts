import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readBuildStamp, type BuildStamp } from '../shared/build-stamp.js';
import { verifyRuntimeArtifact } from '../shared/runtime-artifact.js';

const execute = promisify(execFile);
export interface BackendArtifact {
  directory: string; entry: string; entryHash: string; build: BuildStamp;
  runtimeRoot: string; runtimeHash: string; execPath: string;
}

async function migrationDigest(directory: string): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (root: string, prefix = ''): Promise<void> => {
    for (const item of (await fs.readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(prefix, item.name);
      if (item.isDirectory()) await walk(path.join(root, item.name), relative);
      else if (item.isFile() && item.name.endsWith('.js')) {
        hash.update(relative); hash.update(await fs.readFile(path.join(root, item.name)));
      } else if (item.isSymbolicLink()) throw new Error('Database migration files must not be symlinks');
    }
  };
  await walk(path.join(directory, 'database', 'migrations'));
  return hash.digest('hex');
}

/** Validate an already-built local artifact; never build, install dependencies or migrate here. */
export async function checkBackendCandidate(directory: string, currentEntry?: string): Promise<BackendArtifact> {
  directory = await fs.realpath(directory);
  const runtimeRoot = path.resolve(directory, '../../..');
  if (directory !== path.join(runtimeRoot, 'packages/0/dist')) {
    throw new Error('Backend replacement requires an isolated runtime from scripts/freeze-backend.mjs; pass its packages/0/dist directory');
  }
  const runtime = await verifyRuntimeArtifact(runtimeRoot);
  const execPath = path.join(runtimeRoot, 'node');
  const entry = path.join(directory, 'daemon', 'daemon-entry.js');
  const stat = await fs.lstat(entry);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) throw new Error('Backend entry must be a regular file owned by this user and not writable by other users');
  const build = readBuildStamp(directory);
  if (!build || build.dirty) throw new Error('Backend activation requires a stamped build from a clean commit');
  const entryHash = createHash('sha256').update(await fs.readFile(entry)).digest('hex');
  const checked = await execute(execPath, [entry, '--check-backend'], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const answer = JSON.parse(checked.stdout.trim()) as { protocol?: number; build?: BuildStamp };
  if (answer.protocol !== 1 || answer.build?.commit !== build.commit || answer.build.dirty) throw new Error('Candidate execution protocol or build identity does not match');
  if (currentEntry) {
    const currentDist = path.dirname(path.dirname(await fs.realpath(currentEntry)));
    const [current, next] = await Promise.all([migrationDigest(currentDist), migrationDigest(directory)]);
    if (current !== next) throw new Error('This update changes database migrations. Prepare a separate compatible database transition before a hot backend replacement.');
  }
  return { directory, entry, entryHash, build, runtimeRoot, runtimeHash: runtime.sha256, execPath };
}

export async function verifyBackendEntry(artifact: BackendArtifact): Promise<void> {
  await verifyRuntimeArtifact(artifact.runtimeRoot, artifact.runtimeHash);
  const hash = createHash('sha256').update(await fs.readFile(artifact.entry)).digest('hex');
  if (hash !== artifact.entryHash) throw new Error('Backend entry changed after validation; activation is refused');
}
