import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { directoryOf, readWorkspace } from '../services/bundle-builder.js';
import type { VendoredPackage } from './layout.js';
import { normalizePackedWorkspace } from './portable-archive.js';
import { inspectFrameworkArchive, verifiedFramework } from './registry-framework.js';
import { checkoutFrameworkSource, defaultFrameworkSource, type FrameworkStep } from './framework-source.js';
import { parseFrameworkSource, type FrameworkSource } from '../shared/framework-source.js';
import type { ReleaseSource } from './manifest.js';

const exec = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;
const ARCHIVE_LIMIT = 64 * 1024 * 1024;

export function requireFrameworkCommit(value: string | undefined): string {
  if (!value || !SHA.test(value)) throw Error('Vendored framework archives require --omni-commit with the full upstream Git commit to reproduce');
  return value;
}

function git(directory: string, args: string[], signal?: AbortSignal) {
  return exec('git', ['--no-replace-objects', '--literal-pathspecs', ...args], { cwd: directory, signal });
}

/** Check the Git blob, not a mutable file beside the worktree or metadata supplied by a consumer. */
export async function verifyCommittedArchive(projectDir: string, projectCommit: string, pkg: VendoredPackage, signal?: AbortSignal) {
  const { stdout } = await git(projectDir, ['ls-tree', '-z', projectCommit, '--', pkg.file], signal);
  const entry = /^(100644|100755) blob ([0-9a-f]{40,64})\t([^\0]+)\0$/.exec(stdout);
  if (!entry || entry[3] !== pkg.file) throw Error('Framework archive is not a committed regular file: ' + pkg.file);
  const object = entry[2]!;
  const size = Number((await git(projectDir, ['cat-file', '-s', object], signal)).stdout.trim());
  if (!Number.isSafeInteger(size) || size <= 0 || size > ARCHIVE_LIMIT) throw Error('Invalid framework archive size: ' + pkg.file);
  const blob = await exec('git', ['--no-replace-objects', 'cat-file', 'blob', object], { cwd: projectDir, encoding: 'buffer', maxBuffer: ARCHIVE_LIMIT, signal });
  if ('sha512-' + createHash('sha512').update(blob.stdout).digest('base64') !== pkg.integrity)
    throw Error('Committed framework archive differs from its lockfile SHA-512: ' + pkg.file);
  return blob.stdout;
}

export async function vendoredFrameworkSource(packages: readonly VendoredPackage[], options: {
  projectDir: string; projectCommit: string; frameworkCommit: string; frameworkSource?: FrameworkSource; signal?: AbortSignal;
}): Promise<FrameworkSource> {
  if (options.frameworkSource !== undefined) return parseFrameworkSource(options.frameworkSource);
  const core = packages.find(pkg => pkg.name === '@omnitron-dev/omnitron');
  if (!core) throw Error('The lockfile lacks a verifiable Omnitron archive');
  const bytes = await verifyCommittedArchive(options.projectDir, options.projectCommit, core, options.signal);
  const metadata = await inspectFrameworkArchive(core, Readable.from(bytes), options.signal, requireFrameworkCommit(options.frameworkCommit));
  return defaultFrameworkSource(metadata.repository);
}

interface Reproduction {
  readonly projectDir: string;
  readonly projectCommit: string;
  readonly frameworkCommit: string;
  readonly frameworkSource: FrameworkSource;
  readonly sourceBase: string;
  readonly scratch: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: FrameworkStep;
  readonly signal?: AbortSignal;
}

/** Rebuild before the application install or any of its gates can execute. */
export async function reproduceVendoredFramework(packages: readonly VendoredPackage[], options: Reproduction) {
  const { projectDir, projectCommit, scratch, run, signal } = options;
  const commit = requireFrameworkCommit(options.frameworkCommit);
  for (const pkg of packages) await verifyCommittedArchive(projectDir, projectCommit, pkg, signal);

  const source = path.join(scratch, 'upstream');
  await fs.mkdir(scratch, { recursive: true });
  const env = { ...options.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', TZ: 'UTC', CI: '1', TURBO_TELEMETRY_DISABLED: '1' };
  const identity = await checkoutFrameworkSource(source, { source: options.frameworkSource, commit, sourceBase: options.sourceBase,
    env, run, ...(signal && { signal }) });
  const epoch = (await git(source, ['show', '-s', '--format=%ct', 'HEAD'], signal)).stdout.trim();
  const buildEnv = { ...env, SOURCE_DATE_EPOCH: epoch };
  await run('pnpm', ['install', '--frozen-lockfile'], source, buildEnv);
  await run('pnpm', ['exec', 'turbo', 'run', 'build', '--force', '--concurrency=3'], source, buildEnv);
  return verifyReproducedFramework(packages, source, identity, scratch, run, buildEnv, signal);
}

/** Only the byte-identical result of packing a clean build is used to verify installed and staged files. */
async function verifyReproducedFramework(packages: readonly VendoredPackage[], source: string, identity: ReleaseSource, scratch: string, run: FrameworkStep, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  const commit = identity.commit;
  const workspace = readWorkspace(source);
  const verified = new Map<string, Awaited<ReturnType<typeof inspectFrameworkArchive>>>();
  const { stdout } = await git(source, ['show', '-s', '--format=%H %T', 'HEAD'], signal);
  const [head, tree] = stdout.trim().split(' ');
  if (head !== commit || !tree || !SHA.test(tree)) throw Error('The rebuilt framework checkout differs from the requested commit');
  const archive = path.join(scratch, 'workspace.tgz');
  for (const pkg of packages) {
    const manifest = workspace.get(pkg.name);
    if (!manifest || manifest.version !== pkg.version) throw Error('No matching workspace package at the framework commit: ' + pkg.name);
    await run('pnpm', ['pack', '--out', archive], directoryOf(manifest), env);
    await normalizePackedWorkspace(archive);
    try {
      verified.set(pkg.name, await inspectFrameworkArchive(pkg, createReadStream(archive), signal, commit));
    } finally { await fs.rm(archive, { force: true }); }
  }
  if ((await git(source, ['rev-parse', 'HEAD'], signal)).stdout.trim() !== commit ||
      (await git(source, ['status', '--porcelain'], signal)).stdout.trim())
    throw Error('The framework checkout changed during the build or pack');
  return verifiedFramework({ ...identity, reproduced: { tree, packages } }, verified);
}
