import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readBuildStamp, type BuildStamp } from '../shared/build-stamp.js';
import { verifyRuntimeArtifact } from '../shared/runtime-artifact.js';
import { readExecutionCapabilities, type ExecutionCapabilities } from './execution-capabilities.js';
import type { IDaemonConfig } from '../config/types.js';
import { compareMigrationChecksumMetadata, type MigrationChecksumChange } from '../database/migration-registry-compatibility.js';

const execute = promisify(execFile);
export interface BackendArtifact {
  directory: string; entry: string; entryHash: string; build: BuildStamp;
  runtimeRoot: string; runtimeHash: string; execPath: string;
  schemaExpansionProtocol?: number;
  executionRequirements?: ExecutionCapabilities;
}

export type BackendSchemaScope = 'all' | 'node';

/** An enrolled worker also reads the controller's PostgreSQL authority ledger. */
export function backendSchemaScope(config: Pick<IDaemonConfig, 'role' | 'cluster'>): BackendSchemaScope {
  return config.role === 'slave' && (config.cluster === undefined || config.cluster?.enabled === false) ? 'node' : 'all';
}

async function readBackendMigrations(directory: string, scope: BackendSchemaScope) {
  const hash = createHash('sha256');
  const files = new Map<string, { hash: string; content: string }>(), directories: string[] = [];
  const walk = async (root: string, prefix: string): Promise<void> => {
    if (!(await fs.lstat(root)).isDirectory()) throw new Error('Database migration directories must not be symlinks');
    directories.push(prefix);
    hash.update(JSON.stringify(['directory', prefix]));
    for (const item of (await fs.readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(prefix, item.name);
      if (item.isDirectory()) await walk(path.join(root, item.name), relative);
      else if (item.isFile() && item.name.endsWith('.js')) {
        const content = await fs.readFile(path.join(root, item.name));
        const digest = createHash('sha256').update(content).digest('hex');
        files.set(relative, { hash: digest, content: content.toString('utf8') });
        hash.update(JSON.stringify([relative, digest]));
      } else if (item.isSymbolicLink()) throw new Error('Database migration files must not be symlinks');
    }
  };
  if (scope === 'all') await walk(path.join(directory, 'database', 'migrations'), 'master');
  const local = path.join(directory, 'database', 'slave-migrations');
  if (scope === 'node') {
    if (!(await fs.lstat(path.join(local, 'index.js'))).isFile()) throw new Error('A regular worker migration registry is required');
  } else {
    try { await fs.lstat(local); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { digest: hash.digest('hex'), files, directories }; throw error; }
  }
  await walk(local, 'node');
  return { digest: hash.digest('hex'), files, directories };
}

export async function backendMigrationDigest(directory: string, scope: BackendSchemaScope = 'all'): Promise<string> {
  return (await readBackendMigrations(directory, scope)).digest;
}

export type BackendMigrationCompatibility = { kind: 'identical' } | {
  kind: 'checksum-metadata'; changes: Array<MigrationChecksumChange & { registry: string }>;
};

export async function assertBackendMigrationsCompatible(current: string, next: string, scope: BackendSchemaScope): Promise<BackendMigrationCompatibility> {
  const [before, after] = await Promise.all([readBackendMigrations(current, scope), readBackendMigrations(next, scope)]);
  if (before.digest === after.digest) return { kind: 'identical' };
  try {
    if (JSON.stringify(before.directories) !== JSON.stringify(after.directories) || before.files.size !== after.files.size) {
      throw new Error('Migration files or directories changed');
    }
    const changes: Array<MigrationChecksumChange & { registry: string }> = [];
    for (const [file, source] of before.files) {
      const target = after.files.get(file);
      if (!target) throw new Error(`Migration file was removed: ${file}`);
      if (source.hash === target.hash) continue;
      const registry = file === 'master/index.js' ? 'OMNITRON_MIGRATIONS' : file === 'node/index.js' ? 'SLAVE_MIGRATIONS' : null;
      if (!registry) throw new Error(`Migration body changed: ${file}`);
      const metadata = compareMigrationChecksumMetadata(source.content, target.content, registry);
      for (const change of metadata) {
        if (!before.files.has(path.join(path.dirname(file), `${change.name}.js`))) throw new Error('Migration body is missing');
        changes.push({ ...change, registry });
      }
    }
    if (!changes.length) throw new Error('No compatible checksum metadata change found');
    return { kind: 'checksum-metadata', changes };
  } catch (cause) {
    throw new Error(`This update changes database migrations (${scope}). Prepare a separate compatible database transition before replacing the backend.`, { cause });
  }
}

/** Validate an already-built local artifact; never build, install dependencies or migrate here. */
export async function checkBackendCandidate(directory: string, currentEntry?: string, expectedRuntimeHash?: string): Promise<BackendArtifact> {
  directory = await fs.realpath(directory);
  const runtimeRoot = path.resolve(directory, '../../..');
  if (directory !== path.join(runtimeRoot, 'packages/0/dist')) {
    throw new Error('Backend replacement requires an isolated runtime from scripts/freeze-backend.mjs; pass its packages/0/dist directory');
  }
  const runtime = await verifyRuntimeArtifact(runtimeRoot, expectedRuntimeHash);
  const execPath = path.join(runtimeRoot, 'node');
  const entry = path.join(directory, 'daemon', 'daemon-entry.js');
  const stat = await fs.lstat(entry);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) throw new Error('Backend entry must be a regular file owned by this user and not writable by other users');
  const build = readBuildStamp(directory);
  if (!build || build.dirty) throw new Error('Backend activation requires a stamped build from a clean commit');
  const entryHash = createHash('sha256').update(await fs.readFile(entry)).digest('hex');
  const checked = await execute(execPath, [entry, '--check-backend'], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const answer = JSON.parse(checked.stdout.trim()) as { protocol?: number; schemaExpansionProtocol?: number; build?: BuildStamp; executionRequirements?: unknown };
  const executionRequirements = readExecutionCapabilities(answer.executionRequirements);
  if (answer.protocol !== 1 || answer.build?.commit !== build.commit || answer.build.dirty) throw new Error('Candidate execution protocol or build identity does not match');
  if (currentEntry) {
    const currentDist = path.dirname(path.dirname(await fs.realpath(currentEntry)));
    await assertBackendMigrationsCompatible(currentDist, directory, 'all');
  }
  return { directory, entry, entryHash, build, runtimeRoot, runtimeHash: runtime.sha256, execPath, executionRequirements,
    ...(answer.schemaExpansionProtocol === 1 ? { schemaExpansionProtocol: 1 } : {}) };
}

export async function verifyBackendEntry(artifact: BackendArtifact): Promise<void> {
  await verifyRuntimeArtifact(artifact.runtimeRoot, artifact.runtimeHash);
  const hash = createHash('sha256').update(await fs.readFile(artifact.entry)).digest('hex');
  if (hash !== artifact.entryHash) throw new Error('Backend entry changed after validation; activation is refused');
}
