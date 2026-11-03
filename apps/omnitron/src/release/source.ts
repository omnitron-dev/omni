import fs from 'node:fs/promises';
import path from 'node:path';
import { ExecutionEngine } from '@xec-sh/core';
import { assertRepositoryIdentity } from './repository-identity.js';
import { isFrameworkRef } from '../shared/framework-source.js';
import type { ReleaseSource } from './manifest.js';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_HEADS = 4096;
const TIMEOUT = 10_000;

export function networkRepository(repository: string): boolean {
  if (/^(?:\/|\.\.?\/|~\/|[A-Za-z]:[\\/])/.test(repository)) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(repository)) return new URL(repository).protocol !== 'file:';
  return repository.includes(':') && (!repository.includes('/') || repository.indexOf(':') < repository.indexOf('/'));
}

function environment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // The checkout and its actual objects supply identity, not an inherited Git worktree,
  // replacement graph or a partial-clone fetch performed while inspecting ancestry.
  for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE']) delete env[key];
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'false', SSH_ASKPASS: 'false', GCM_INTERACTIVE: 'Never',
    SSH_ASKPASS_REQUIRE: 'never', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' };
}

async function git(checkout: string, args: string[], signal: AbortSignal, stdin = ''): Promise<string> {
  const engine = new ExecutionEngine({ defaultTimeout: 0, adapters: { local: { killSignal: 'SIGKILL' } } });
  try {
    const result = await engine.execute({ command: 'git', args: ['--no-replace-objects', '-c', 'http.lowSpeedLimit=1', '-c', 'http.lowSpeedTime=5', ...args],
      cwd: checkout, env: Object.fromEntries(Object.entries(environment()).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      signal, stdin, shell: false, adapter: 'local', nothrow: true, maxBuffer: 1024 * 1024 });
    if (result.exitCode !== 0) throw Error('Git source verification failed');
    return result.stdout.replace(/\r?\n$/, '');
  } finally { await engine.dispose(); }
}

/** Current origin advertisement is evidence; cached tracking refs and another
 * remote are not. This probe never fetches objects or writes refs. Unknown ancestry,
 * bounded-out reads and unavailable transport remain unknown instead of becoming false. */
async function advertisedCommit(checkout: string, repository: string, commit: string,
  options: { ref?: string; signal?: AbortSignal } = {}): Promise<boolean | null> {
  assertRepositoryIdentity(repository);
  if (!SHA.test(commit) || options.ref !== undefined && !isFrameworkRef(options.ref)) return null;
  const deadline = AbortSignal.timeout(TIMEOUT);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const ref = options.ref ?? null;
  try {
    const tag = ref?.startsWith('refs/tags/') === true;
    const transport = repository.replace(/^git\+(?=(?:https?|ssh):\/\/)/, '');
    const output = await git(checkout, ['ls-remote', '--quiet', '--', transport,
      ...(ref ? [ref, ...(tag ? [ref + '^{}'] : [])] : ['refs/heads/*', 'refs/tags/*'])], signal);
    const heads = new Set<string>();
    const advertised = new Map<string, string>();
    for (const line of output ? output.split('\n') : []) {
      const match = /^([a-f0-9]{40}|[a-f0-9]{64})\t(refs\/(?:heads|tags)\/[^\s]+)$/.exec(line);
      if (!match) return null;
      const actual = match[2]!;
      if (ref && actual !== ref && (!tag || actual !== ref + '^{}') || advertised.has(actual)) return null;
      advertised.set(actual, match[1]!);
    }
    for (const [name, sha] of advertised) {
      if (name.endsWith('^{}')) {
        if (!name.startsWith('refs/tags/') || !advertised.has(name.slice(0, -3))) return null;
      } else heads.add(advertised.get(name + '^{}') ?? sha);
    }
    if (heads.has(commit)) return true;
    if (heads.size > MAX_HEADS) return null;
    if (tag) return false; // An explicit release tag selects its exact peeled commit.
    if (heads.size === 0) return false;
    // An exact advertised object does not require local history. An ancestry proof
    // does: old graft files must never turn an unrelated commit into a parent.
    const grafts = await git(checkout, ['rev-parse', '--git-path', 'info/grafts'], signal);
    const graft = await fs.stat(path.resolve(checkout, grafts)).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return null;
    });
    if (graft && (!graft.isFile() || graft.size > 0)) return null;
    let unknown = (await git(checkout, ['rev-parse', '--is-shallow-repository'], signal)) !== 'false';
    const objects = await git(checkout, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], signal, [...heads].join('\n') + '\n');
    const known: string[] = [];
    const rows = objects.split('\n');
    if (rows.length !== heads.size) return null;
    for (const row of rows) {
      const [sha, type] = row.split(' ');
      if (!sha || !heads.has(sha)) return null;
      if (type === 'commit') known.push(sha); else unknown = true;
    }
    if (known.length && await git(checkout, ['rev-list', '--max-count=1', '--ancestry-path', ...known, '--not', commit], signal)) return true;
    return unknown ? null : false;
  } catch { options.signal?.throwIfAborted(); return null; }
}

/** Publication is a network-origin observation, independent of explicit local-source trust. */
export async function sourcePublication(checkout: string, repository: string, commit: string,
  options: { ref?: string; signal?: AbortSignal } = {}): Promise<boolean | null> {
  assertRepositoryIdentity(repository);
  if (!networkRepository(repository)) return repository === '(no origin)' ? null : false;
  const deadline = AbortSignal.timeout(TIMEOUT);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  try {
    // Git may deliberately route a logical network URL to an offline mirror. Expanded
    // credential-bearing transport URLs stay private and are never recorded or logged.
    const transport = repository.replace(/^git\+(?=(?:https?|ssh):\/\/)/, '');
    const effective = await git(checkout, ['ls-remote', '--get-url', '--', transport], signal);
    if (!networkRepository(effective)) return false;
    return await advertisedCommit(checkout, repository, commit, { ...options, signal });
  } catch { options.signal?.throwIfAborted(); return null; }
}

/** An explicitly selected ref is a build constraint, including in offline/local repositories. */
export async function sourceRefContains(checkout: string, repository: string, commit: string, ref: string,
  signal?: AbortSignal): Promise<boolean | null> {
  if (!isFrameworkRef(ref)) throw Error('Framework ref must be a full refs/heads/ or refs/tags/ name');
  return advertisedCommit(checkout, repository, commit, { ref, ...(signal && { signal }) });
}

/** Credential-free recorded identity and an independently checked publication fact. */
export async function readReleaseSource(checkout: string, commit: string): Promise<ReleaseSource> {
  const repo = await git(checkout, ['config', '--get-all', 'remote.origin.url'], AbortSignal.timeout(TIMEOUT))
    .then(value => value.split('\n')[0]!).catch(() => '(no origin)');
  assertRepositoryIdentity(repo);
  return { repo, commit, onRemote: await sourcePublication(checkout, repo, commit) };
}
