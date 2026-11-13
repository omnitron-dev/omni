import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DomainError } from '@omnitron-dev/titan/errors';
import { readBuildStamp, type BuildStamp } from '../shared/build-stamp.js';
import { verifyRuntimeArtifact } from '../shared/runtime-artifact.js';
import { readExecutionCapabilities, type ExecutionCapabilities } from './execution-capabilities.js';
import type { IDaemonConfig } from '../config/types.js';
import { compareMigrationChecksumMetadata, type MigrationChecksumChange } from '../database/migration-registry-compatibility.js';
import type { BackendBootRecord } from './backend-handoff-types.js';
import type { BackendRecoveryRecord } from './backend-recovery-journal.js';
import { backendInfrastructureDigest, backendInfrastructureInput, type ColdInfrastructurePreview } from './backend-infrastructure-preflight.js';

const execute = promisify(execFile);
const PREFLIGHT_TIMEOUT_MS = 30_000;

/** Diagnostic only: admission still requires the child's successful protocol response. */
export interface BackendPreflightProgress {
  event: 'omnitron.backend.preflight';
  protocol: 1;
  pid: number;
  phase: 'loading-runtime' | 'runtime-loaded';
  elapsedMs: number;
}

export interface BackendPreflightFailure {
  runtimeHash: string;
  elapsedMs: number;
  timeoutMs: number;
  phase: BackendPreflightProgress['phase'] | 'not-reported';
  pid: number | null;
  childElapsedMs: number | null;
  exitCode: string | number | null;
  signal: string | null;
  stderr: string;
}

type BackendPreflightCode = 'BACKEND_PREFLIGHT_TIMEOUT' | 'BACKEND_PREFLIGHT_PROCESS_FAILED' | 'BACKEND_PREFLIGHT_RESPONSE_INVALID';

export class BackendPreflightError extends DomainError {
  declare readonly details: BackendPreflightFailure & { domainCode: BackendPreflightCode };

  constructor(
    domainCode: BackendPreflightCode,
    details: BackendPreflightFailure,
    cause: unknown,
  ) {
    const reason = domainCode === 'BACKEND_PREFLIGHT_TIMEOUT' ? 'timed out' :
      domainCode === 'BACKEND_PREFLIGHT_PROCESS_FAILED' ? 'failed' : 'returned an invalid protocol response';
    const message = `Backend preflight ${reason} after ${details.elapsedMs}ms (limit ${details.timeoutMs}ms; ` +
      `phase ${details.phase}; runtime ${details.runtimeHash}; pid ${details.pid ?? 'not-started'}; ` +
      `exit ${details.exitCode ?? 'none'}; signal ${details.signal ?? 'none'}).` +
      (cause instanceof Error ? ` ${cause.message.slice(0, 512)}` : '');
    super({ domainCode, httpStatus: domainCode === 'BACKEND_PREFLIGHT_TIMEOUT' ? 504 : 500, message, details, cause });
    this.name = 'BackendPreflightError';
  }
}

function preflightProgress(stderr: string, pid: number | undefined): BackendPreflightProgress | undefined {
  if (pid === undefined) return undefined;
  let latest: BackendPreflightProgress | undefined;
  for (const line of stderr.split('\n')) {
    if (Buffer.byteLength(line) > 512) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { continue; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const event = raw as Record<string, unknown>;
    if (Object.keys(event).length !== 5 || event['event'] !== 'omnitron.backend.preflight' || event['protocol'] !== 1 ||
        event['pid'] !== pid || (event['phase'] !== 'loading-runtime' && event['phase'] !== 'runtime-loaded') ||
        !Number.isSafeInteger(event['elapsedMs']) || (event['elapsedMs'] as number) < 0) continue;
    latest = event as unknown as BackendPreflightProgress;
  }
  return latest;
}

function preflightFailure(runtimeHash: string, started: number, pid: number | undefined,
  stderr: string, exitCode: string | number | null, signal: string | null): BackendPreflightFailure {
  const progress = preflightProgress(stderr, pid);
  return { runtimeHash, elapsedMs: Math.round(performance.now() - started), timeoutMs: PREFLIGHT_TIMEOUT_MS,
    phase: progress?.phase ?? 'not-reported', pid: pid ?? null, childElapsedMs: progress?.elapsedMs ?? null,
    exitCode, signal, stderr: Buffer.from(stderr).subarray(0, 4093).toString('utf8') };
}

export interface BackendArtifact {
  directory: string; entry: string; entryHash: string; build: BuildStamp;
  runtimeRoot: string; runtimeHash: string; execPath: string;
  schemaExpansionProtocol?: number;
  infrastructureAdoptionProtocol?: 1;
  coldInfrastructureProtocol?: 1;
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
  const artifact = { directory, entry, entryHash, build, runtimeRoot, runtimeHash: runtime.sha256, execPath };
  const answer = await runBackendPreflight(artifact);
  if (currentEntry) {
    const currentDist = path.dirname(path.dirname(await fs.realpath(currentEntry)));
    await assertBackendMigrationsCompatible(currentDist, directory, 'all');
  }
  return { ...artifact, executionRequirements: readExecutionCapabilities(answer.executionRequirements),
    ...(answer.coldInfrastructureProtocol === 1 ? { coldInfrastructureProtocol: 1 } : {}),
    ...(answer.schemaExpansionProtocol === 1 ? { schemaExpansionProtocol: 1 } : {}),
    ...(answer.infrastructureAdoptionProtocol === 1 ? { infrastructureAdoptionProtocol: 1 } : {}) };
}

/** The candidate must affirm the exact read-only projection; an older generic check is insufficient. */
export async function checkBackendAdoption(artifact: BackendArtifact, record: BackendBootRecord | BackendRecoveryRecord): Promise<void> {
  if (artifact.infrastructureAdoptionProtocol !== 1) throw new DomainError({
    domainCode: 'BACKEND_INFRASTRUCTURE_PREFLIGHT_UNSUPPORTED', httpStatus: 409,
    message: 'The candidate does not support infrastructure adoption preflight protocol 1. This check does not drain or retire a backend. Select a capable target before starting an upgrade.',
    details: { runtimeHash: artifact.runtimeHash, requiredProtocol: 1 },
  });
  const input = backendInfrastructureInput(record.state);
  await runBackendPreflight(artifact, { input, cwd: record.cwd, environment: record.environment });
}

export async function previewBackendColdStart(artifact: BackendArtifact, record: BackendBootRecord | BackendRecoveryRecord): Promise<ColdInfrastructurePreview> {
  const input = backendInfrastructureInput(record.state);
  const checked = await runBackendPreflight(artifact, { input, cwd: record.cwd, environment: record.environment, cold: true });
  return checked.coldInfrastructure!;
}

interface BackendPreflightResponse {
  protocol?: number; schemaExpansionProtocol?: number; infrastructureAdoptionProtocol?: number;
  coldInfrastructureProtocol?: number; coldInfrastructure?: ColdInfrastructurePreview;
  infrastructureAdoption?: { protocol?: number; digest?: string };
  build?: BuildStamp; executionRequirements?: unknown;
}

async function runBackendPreflight(artifact: Pick<BackendArtifact, 'entry' | 'execPath' | 'build' | 'runtimeHash'>,
  adoption?: { input: string; cwd: string; environment: Record<string, string>; cold?: boolean }): Promise<BackendPreflightResponse> {
  const started = performance.now();
  const pending = execute(artifact.execPath, [artifact.entry, '--check-backend', ...(adoption ? [adoption.cold ? '--preview-cold-start' : '--adopt-infrastructure'] : [])], {
    timeout: PREFLIGHT_TIMEOUT_MS, maxBuffer: 1024 * 1024,
    ...(adoption && { cwd: adoption.cwd, env: adoption.environment }),
  });
  let inputFailure: Error | undefined;
  if (adoption) {
    pending.child.stdin!.on('error', error => { inputFailure = error; });
    pending.child.stdin!.end(adoption.input);
  }
  let checked: Awaited<typeof pending>;
  try { checked = await pending; }
  catch (cause) {
    const failure = cause as { stderr?: unknown; code?: unknown; signal?: unknown; killed?: unknown } | null;
    const details = preflightFailure(artifact.runtimeHash, started, pending.child.pid,
      typeof failure?.stderr === 'string' ? failure.stderr : '',
      typeof failure?.code === 'string' || typeof failure?.code === 'number' ? failure.code : null,
      typeof failure?.signal === 'string' ? failure.signal : null);
    const timeout = failure?.killed === true && failure.code === null && failure.signal === 'SIGTERM' &&
      details.elapsedMs >= PREFLIGHT_TIMEOUT_MS;
    throw new BackendPreflightError(timeout ? 'BACKEND_PREFLIGHT_TIMEOUT' : 'BACKEND_PREFLIGHT_PROCESS_FAILED', details, cause);
  }
  let answer: BackendPreflightResponse;
  try {
    if (inputFailure) throw inputFailure;
    answer = JSON.parse(checked.stdout.trim()) as typeof answer;
    readExecutionCapabilities(answer.executionRequirements);
    if (answer.protocol !== 1 || answer.build?.commit !== artifact.build.commit || answer.build.dirty) throw new Error('Candidate execution protocol or build identity does not match');
    if (adoption?.cold && (answer.coldInfrastructureProtocol !== 1 || answer.coldInfrastructure?.protocol !== 1 ||
        !Array.isArray(answer.coldInfrastructure.containers) || answer.coldInfrastructure.digest !== backendInfrastructureDigest(adoption.input)))
      throw new Error('Candidate did not confirm the cold infrastructure preview');
    if (adoption && !adoption.cold && (answer.infrastructureAdoptionProtocol !== 1 || answer.infrastructureAdoption?.protocol !== 1 ||
        answer.infrastructureAdoption.digest !== backendInfrastructureDigest(adoption.input)))
      throw new Error('Candidate did not confirm the exact infrastructure adoption snapshot');
  } catch (cause) {
    throw new BackendPreflightError('BACKEND_PREFLIGHT_RESPONSE_INVALID',
      preflightFailure(artifact.runtimeHash, started, pending.child.pid, checked.stderr, 0, null), cause);
  }
  return answer;
}

export async function verifyBackendEntry(artifact: BackendArtifact): Promise<void> {
  await verifyRuntimeArtifact(artifact.runtimeRoot, artifact.runtimeHash);
  const hash = createHash('sha256').update(await fs.readFile(artifact.entry)).digest('hex');
  if (hash !== artifact.entryHash) throw new Error('Backend entry changed after validation; activation is refused');
}
