import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { extract, list } from 'tar';

import type { IEcosystemAppEntry } from '../config/types.js';
import { applicationBootstrapRuntime } from '../orchestrator/application-runtime.js';
import { CLOSURE_FILE } from './application-closure.js';
import type { LoadedRelease } from './load.js';
import { assertOwnerExecutable } from './owner-executable.js';
import type { ReleaseLaunch } from './manifest.js';
import { sha256File } from './portable-archive.js';
import { RELEASE_RECEIPT, releaseTreeDigest } from './runtime-provenance.js';
import { releaseOptionsForEnv, targetRuntime, type TargetRuntime } from './target-runtime.js';

export class LocalReleaseNotPreparedError extends Error {}

const digest = (s: string) => /^[a-f0-9]{64}$/.test(s);
const componentPath = (s: string) => s.length <= 4096 && !s.includes('\\') && !s.includes(':') &&
  !s.includes('\0') && s.split('/').every(part => part && part !== '.' && part !== '..');
const inside = (root: string, name: string) => name.startsWith(root + path.sep);
const absent = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

async function member(root: string, relative: string): Promise<string> {
  if (!componentPath(relative) || !/\.[cm]?js$/.test(relative)) throw Error('Expected a package-relative compiled JavaScript entry: ' + relative);
  const file = path.join(root, relative);
  if (file !== await fs.realpath(file) || !(await fs.lstat(file)).isFile()) throw Error('Release entry must be a physical file: ' + relative);
  return file;
}

/** Preserve the existing remote bootstrap convention. Classic programs must actually publish their entry. */
export async function describeReleaseLaunch(staged: string, entry: IEcosystemAppEntry, relativeScript?: string): Promise<ReleaseLaunch | undefined> {
  const file = entry.releaseEntry ?? (entry.bootstrap ? 'dist/bootstrap.js' : relativeScript);
  if (!file || (!entry.releaseEntry && !entry.bootstrap && (!componentPath(file) || !/\.[cm]?js$/.test(file)))) return undefined;
  const root = await fs.realpath(staged);
  try { await member(root, file); }
  catch (error) {
    if (!entry.releaseEntry && !entry.bootstrap && absent(error)) return undefined;
    throw error;
  }
  return { mode: entry.bootstrap ? 'bootstrap' : 'script', file, closureSha256: await sha256File(path.join(root, CLOSURE_FILE)) };
}

/** A fresh directory, no special files, hardlinks, path aliases or writes through a symlink. */
async function extractFrozenArchive(archive: string, directory: string): Promise<void> {
  let invalid: string | undefined, bytes = 0;
  const names = new Map<string, string>();
  await list({ file: archive, strict: true, onReadEntry(entry) {
    if (invalid) return;
    const name = entry.path.replace(/\/$/, ''), key = name.normalize('NFC').toLowerCase();
    if (!componentPath(name) || names.has(key) || [RELEASE_RECEIPT, '.artifact-sha256'].includes(key) ||
      !['File', 'Directory', 'SymbolicLink'].includes(entry.type) || names.size >= 200_000 ||
      !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 268_435_456 || (bytes += entry.size) > 2_147_483_648) {
      invalid = 'Invalid release archive member: ' + name; return;
    }
    names.set(key, entry.type);
    if (entry.type === 'SymbolicLink') {
      const link = entry.linkpath ?? '', resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), link));
      if (!link || /[\\:\0]/.test(link) || path.posix.isAbsolute(link) || resolved === '..' || resolved.startsWith('../'))
        invalid = 'Release archive link leaves its root: ' + name;
    }
  } });
  if (invalid) throw Error(invalid);
  // Entries may occur in any order. A link to an in-tree directory is fine, writing through that link is not.
  for (const name of names.keys()) {
    for (let p = path.posix.dirname(name); p !== '.'; p = path.posix.dirname(p)) {
      if (names.get(p) !== 'Directory') throw Error('Invalid release archive parent: ' + p);
    }
  }
  await extract({ file: archive, cwd: directory, strict: true, preserveOwner: false, noChmod: false });
}

async function privateDirectory(parent: string, name: string): Promise<string> {
  const dir = path.join(parent, name);
  try { await fs.mkdir(dir, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await assertDirectory(dir);
  return dir;
}

async function assertDirectory(dir: string) {
  const s = await fs.lstat(dir);
  if (!s.isDirectory() || await fs.realpath(dir) !== dir || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid()))
    throw Error('Local installation requires a private physical directory: ' + dir);
}

async function verify(root: string, launch: ReleaseLaunch, entry: IEcosystemAppEntry, runtime: TargetRuntime): Promise<string> {
  await assertDirectory(root);
  const file = await member(root, launch.file);
  const handle = await fs.open(path.join(root, CLOSURE_FILE), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let raw: Buffer;
  try {
    const s = await handle.stat();
    if (!s.isFile() || s.size > 2_000_000) throw Error('Invalid frozen closure record');
    raw = await handle.readFile();
  } finally { await handle.close(); }
  if (createHash('sha256').update(raw).digest('hex') !== launch.closureSha256) throw Error('Local closure differs from the admitted manifest');
  const c = JSON.parse(raw.toString('utf8'));
  if (c.protocol !== 1 || !digest(c.payloadSha256) || Object.entries(runtime).some(([k,v]) => c.runtime?.[k] !== v) ||
    c.nodeOptions !== releaseOptionsForEnv(entry.env)) throw Error('Local release closure, execution target or Node options differ from the build');
  // No remote delivery receipt may be injected into this new local path.
  for (const name of [RELEASE_RECEIPT, '.artifact-sha256']) {
    if (await fs.lstat(path.join(root, name)).then(() => true, error => { if (absent(error)) return false; throw error; }))
      throw Error('Unexpected operational metadata in local release: ' + name);
  }
  if (await releaseTreeDigest(root, true, false, [CLOSURE_FILE]) !== c.payloadSha256) throw Error('Local release files differ from the admitted payload');
  if (launch.mode === 'bootstrap') {
    // Boot via the same adapter resolution as the supervisor, without a fallback to its SDK.
    const adapter = await fs.realpath(createRequire(file).resolve('@omnitron-dev/omnitron'));
    if (!inside(root, adapter) || !inside(root, await fs.realpath(applicationBootstrapRuntime(file, adapter))))
      throw Error('Local release must supply its own aligned Omnitron adapter');
  }
  return file;
}

/** Selection is stored by the caller. This only materializes verified immutable inputs;
 * it never installs packages, mutates an owner, or rewrites a developer checkout. */
export async function inspectLocalReleaseInstallation(release: LoadedRelease, stack: string, entries: readonly IEcosystemAppEntry[], options: { prepare?: boolean; ownerPid?: number } = {}): Promise<IEcosystemAppEntry[]> {
  if (!digest(release.manifestSha256)) throw Error('Invalid local release manifest digest');
  const selected = entries.map(entry => {
    const unique = release.manifest.artifacts.filter(a => a.app === entry.name), files = release.files.filter(f => f.app === entry.name);
    const launch = unique[0]?.launch, artifact = files[0];
    if (unique.length !== 1 || !launch || files.length !== 1 || !artifact || !digest(artifact.sha256) ||
        artifact.sha256 !== unique[0]!.sha256 || !digest(launch.closureSha256) || !!entry.bootstrap === !!entry.script ||
        launch.mode !== (entry.bootstrap ? 'bootstrap' : 'script'))
      throw Error('No unique verified local launch for ' + stack + '/' + entry.name + '; rebuild with a packaged entry');
    if (typeof launch.file !== 'string' || !componentPath(launch.file) || !/\.[cm]?js$/.test(launch.file))
      throw Error('Expected a package-relative compiled JavaScript entry');
    return { launch, artifact, entry };
  });
  if (!options.ownerPid) throw Error('An authenticated local execution owner PID is required');
  const runtime = await targetRuntime(), result: IEcosystemAppEntry[] = [];
  await assertOwnerExecutable(options.ownerPid, runtime.executableSha256);
  const builtFor = release.manifest.builtWith?.target;
  if (!builtFor || Object.entries(runtime).some(([k,v]) => builtFor[k as keyof TargetRuntime] !== v))
    throw Error('The local execution owner does not match the recorded release target');
  const releases = await fs.realpath(path.dirname(release.root));
  const store = path.join(releases, '.installed'), group = path.join(store, release.manifestSha256);
  if (options.prepare) { await privateDirectory(releases, '.installed'); await privateDirectory(store, release.manifestSha256); }
  else {
    try { await assertDirectory(store); await assertDirectory(group); }
    catch (error) { if (!absent(error)) throw error; throw new LocalReleaseNotPreparedError('Local release has not been prepared: ' + release.id); }
  }
  for (const { launch, artifact, entry } of selected) {
    const root = path.join(group, artifact.sha256);
    try { await fs.lstat(root); }
    catch (error) {
      if (!absent(error)) throw error;
      if (!options.prepare) throw new LocalReleaseNotPreparedError('Local release has not been prepared: ' + stack + '/' + entry.name);
      const tmp = await fs.mkdtemp(path.join(group, '.install-'));
      try {
        const copied = path.join(tmp, 'archive'), contents = await privateDirectory(tmp, 'payload');
        await fs.copyFile(artifact.path, copied, constants.COPYFILE_FICLONE);
        if ((await fs.stat(copied)).size !== artifact.bytes || await sha256File(copied) !== artifact.sha256) throw Error('Local release archive changed before installation');
        await extractFrozenArchive(copied, contents);
        await verify(contents, launch, entry, runtime);
        try { await fs.rename(contents, root); }
        catch (race) { if (!['EEXIST','ENOTEMPTY'].includes((race as NodeJS.ErrnoException).code ?? '')) throw race; }
      } finally { await fs.rm(tmp, { recursive: true, force: true }); }
    }
    const executable = await verify(root, launch, entry, runtime);
    result.push({ ...entry, [launch.mode]: executable, releaseRoot: root, watch: false });
  }
  return result;
}
