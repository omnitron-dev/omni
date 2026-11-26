import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { directoryOf, readWorkspace } from '../services/bundle-builder.js';
import type { VendoredPackage } from './layout.js';
import { normalizePackedWorkspace, sha256File } from './portable-archive.js';
import { inspectFrameworkArchive, verifiedFramework } from './registry-framework.js';
import { checkoutFrameworkSource, defaultFrameworkSource, type FrameworkStep } from './framework-source.js';
import { parseFrameworkSource, type FrameworkSource } from '../shared/framework-source.js';
import type { ReleaseSource } from './manifest.js';
import { targetRuntime } from './target-runtime.js';

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
  /** Private to the build process. A project can supply archive bytes, never an accepted proof. */
  readonly accepted?: Set<string>;
  readonly onReuse?: () => void;
  readonly signal?: AbortSignal;
}

async function reproductionKey(source: string, identity: ReleaseSource, tree: string, packages: readonly VendoredPackage[],
  env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<string | undefined> {
  const tools: string[][] = [];
  const searchPath = (env['PATH'] ?? '').split(path.delimiter);
  for (const name of ['pnpm', 'git']) {
    const command = await firstExecutable(searchPath, name);
    if (!command) return undefined;
    try {
      const version = await exec(command, ['--version'], { cwd: source, env, signal, timeout: 15_000 });
      tools.push([name, command, await sha256File(command), version.stdout.trim()]);
    } catch {
      signal?.throwIfAborted();
      return undefined;
    }
  }
  const variables = Object.keys(env).filter(key => key !== 'TMPDIR').sort().map(key => [key, env[key]]);
  const inventory = packages.map(p => [p.name, p.version, p.integrity]).sort((a, b) => a[0]!.localeCompare(b[0]!));
  return createHash('sha256').update(JSON.stringify([identity.repo, identity.ref, identity.commit, tree,
    await targetRuntime(), tools, variables, inventory])).digest('hex');
}

async function firstExecutable(directories: string[], name: string): Promise<string | undefined> {
  for (const directory of directories) {
    if (!path.isAbsolute(directory)) return undefined;
    const candidate = path.join(directory, name);
    try {
      await fs.access(candidate, fs.constants.X_OK);
      if ((await fs.stat(candidate)).isFile()) return await fs.realpath(candidate);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  return undefined;
}

/** Rebuild before the application install or any of its gates can execute. */
export async function reproduceVendoredFramework(packages: readonly VendoredPackage[], options: Reproduction) {
  const { projectDir, projectCommit, scratch, run, signal } = options;
  const commit = requireFrameworkCommit(options.frameworkCommit);
  for (const pkg of packages) await verifyCommittedArchive(projectDir, projectCommit, pkg, signal);

  const source = path.join(scratch, 'upstream');
  await fs.mkdir(scratch, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...options.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', TZ: 'UTC', CI: '1', TURBO_TELEMETRY_DISABLED: '1' };
  delete env['TURBO_TOKEN'];
  delete env['TURBO_TEAM'];
  const identity = await checkoutFrameworkSource(source, { source: options.frameworkSource, commit, sourceBase: options.sourceBase,
    env, run, ...(signal && { signal }) });
  const [head, tree, epoch] = (await git(source, ['show', '-s', '--format=%H %T %ct', 'HEAD'], signal)).stdout.trim().split(' ');
  if (head !== commit || !tree || !SHA.test(tree) || !epoch) throw Error('The upstream checkout differs from the requested commit');
  const buildEnv = { ...env, SOURCE_DATE_EPOCH: epoch, TURBO_FORCE: 'true', TURBO_CONCURRENCY: '3' };
  const proof = options.accepted && await reproductionKey(source, identity, tree, packages, buildEnv, signal);
  if (proof && options.accepted?.has(proof)) {
    const verified = new Map<string, Awaited<ReturnType<typeof inspectFrameworkArchive>>>();
    for (const pkg of packages) {
      const bytes = await verifyCommittedArchive(projectDir, projectCommit, pkg, signal);
      verified.set(pkg.name, await inspectFrameworkArchive(pkg, Readable.from(bytes), signal, commit));
    }
    options.onReuse?.();
    return verifiedFramework({ ...identity, reproduced: { tree, packages } }, verified);
  }
  await run('pnpm', ['install', '--frozen-lockfile'], source, buildEnv);
  // The selected source owns its complete build contract, including auxiliary
  // declaration passes. Reimplementing only its Turbo "build" task changes SDK bytes.
  await run('pnpm', ['run', 'build'], source, buildEnv);
  const result = await verifyReproducedFramework(packages, source, identity, scratch, run, buildEnv, signal);
  if (proof && options.accepted && proof === await reproductionKey(source, identity, tree, packages, buildEnv, signal)) {
    if (options.accepted.size >= 64) options.accepted.delete(options.accepted.values().next().value!);
    options.accepted.add(proof);
  }
  return result;
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
