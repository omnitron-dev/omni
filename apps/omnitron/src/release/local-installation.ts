import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { IEcosystemAppEntry } from '../config/types.js';
import { assertApplicationInstances } from '../config/define-ecosystem.js';
import { validateReadiness } from '../health/contracts.js';
import { CLOSURE_FILE } from './application-closure.js';
import { assertFrozenDirectory as assertDirectory, frozenMember as member, extractFrozenArchive, verifyFrozenApplication, verifyFrozenPayload } from './frozen-installation.js';
import type { LoadedRelease } from './load.js';
import { assertOwnerExecutable } from './owner-executable.js';
import type { ReleaseLaunch } from './manifest.js';
import { releaseArtifactOrigins, assertImportableArtifact } from './origin.js';
import { sha256File } from './portable-archive.js';
import { RELEASE_RECEIPT, releaseTreeDigest } from './runtime-provenance.js';
import { readInstalledReleaseReceipt, writeInstalledReleaseReceipt, type ReleaseArtifactOrigin } from './installed-origin.js';
import { assertReleaseTarget, releaseOptionsForEnv, targetRuntime, type TargetRuntime } from './target-runtime.js';

export class LocalReleaseNotPreparedError extends Error {}

const digest = (s: string) => /^[a-f0-9]{64}$/.test(s);
const componentPath = (s: string) => s.length <= 4096 && !s.includes('\\') && !s.includes(':') &&
  !s.includes('\0') && s.split('/').every(part => part && part !== '.' && part !== '..');
const absent = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

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

async function privateDirectory(parent: string, name: string): Promise<string> {
  const dir = path.join(parent, name);
  try { await fs.mkdir(dir, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await assertDirectory(dir);
  return dir;
}

async function verify(root: string, launch: ReleaseLaunch, entry: IEcosystemAppEntry, runtime: TargetRuntime, installed?: { origin: ReleaseArtifactOrigin; ownerPackage: string }): Promise<string> {
  const file = await verifyFrozenApplication(root, launch, runtime, releaseOptionsForEnv(entry.env));
  // Archives cannot inject operational evidence. A prepared installation must match its exact admitted origin.
  if (installed) {
    const receipt = await readInstalledReleaseReceipt(root);
    if (receipt.version !== 2 || !isDeepStrictEqual(receipt.origin, installed.origin) ||
        receipt.ownerPackage !== installed.ownerPackage || receipt.nodeOptions !== releaseOptionsForEnv(entry.env) ||
        !isDeepStrictEqual(receipt.target, runtime) || receipt.artifactPayloadUnchanged !== true ||
        receipt.frameworkContentUnchanged !== true || receipt.installedFrameworkCommit !== installed.origin.frameworkCommit ||
        receipt.treeSha256 !== await releaseTreeDigest(root)) throw Error('Local installed origin changed');
  }
  for (const name of installed ? ['.artifact-sha256'] : [RELEASE_RECEIPT, '.artifact-sha256']) {
    if (await fs.lstat(path.join(root, name)).then(() => true, error => { if (absent(error)) return false; throw error; }))
      throw Error('Unexpected operational metadata in local release: ' + name);
  }
  return file;
}

/** Selection is stored by the caller. This only materializes verified immutable inputs;
 * it never installs packages, mutates an owner, or rewrites a developer checkout. */
export async function inspectLocalReleaseInstallation(release: LoadedRelease, stack: string, entries: readonly IEcosystemAppEntry[], options: { prepare?: boolean; ownerPid?: number; ownerPackage?: string; runtime?: TargetRuntime; requiredFiles?: Readonly<Record<string, readonly string[]>> } = {}): Promise<IEcosystemAppEntry[]> {
  for (const entry of entries) assertApplicationInstances(entry);
  if (!digest(release.manifestSha256)) throw Error('Invalid local release manifest digest');
  const runtime = options.runtime ?? await targetRuntime();
  const sources = new Map(releaseArtifactOrigins(release.manifest, release.manifestSha256).map(source => [source.app, source]));
  const selected = entries.map(entry => {
    const unique = release.manifest.artifacts.filter(a => a.app === entry.name), files = release.files.filter(f => f.app === entry.name);
    const launch = unique[0]?.launch, artifact = files[0];
    const source = sources.get(entry.name);
    if (!source) throw Error('No verified release artifact for ' + entry.name);
    if (Boolean(unique[0]?.origin) !== Boolean(entry.releaseFrom))
      throw Error('Configured application source differs from the selected release for ' + entry.name);
    if (entry.releaseFrom && (unique[0]?.origin?.release !== entry.releaseFrom.release ||
        unique[0]?.origin?.manifestSha256 !== entry.releaseFrom.manifestSha256 || unique[0]?.origin?.app !== entry.releaseFrom.app))
      throw Error('The selected release does not carry the configured producer for ' + entry.name);
    if (unique.length !== 1 || !launch || files.length !== 1 || !artifact || !digest(artifact.sha256) ||
        artifact.sha256 !== unique[0]!.sha256 || !digest(launch.closureSha256) ||
        (entry.releaseFrom ? !!entry.bootstrap || !!entry.script : !!entry.bootstrap === !!entry.script ||
          launch.mode !== (entry.bootstrap ? 'bootstrap' : 'script')))
      throw Error('No unique verified local launch for ' + stack + '/' + entry.name + '; rebuild with a packaged entry');
    if (typeof launch.file !== 'string' || !componentPath(launch.file) || !/\.[cm]?js$/.test(launch.file))
      throw Error('Expected a package-relative compiled JavaScript entry');
    if (entry.readiness !== undefined) validateReadiness(entry.readiness, launch.mode);
    const builtFor = source.manifest.builtWith?.target;
    try { assertReleaseTarget(builtFor, runtime); }
    catch (error) { throw Error('The local execution owner does not match the recorded release target for ' + entry.name, { cause: error }); }
    const origin = source.origin;
    return { launch, artifact, entry, origin };
  });
  if (!options.ownerPid) throw Error('An authenticated local execution owner PID is required');
  if (!options.ownerPackage || !path.isAbsolute(options.ownerPackage) || await fs.realpath(options.ownerPackage) !== options.ownerPackage)
    throw Error('Verified runtime origin requires a proven physical execution-owner package');
  const ownerPackage = options.ownerPackage;
  const result: IEcosystemAppEntry[] = [];
  await assertOwnerExecutable(options.ownerPid, runtime.executableSha256);
  const releases = await fs.realpath(path.dirname(release.root));
  const store = path.join(releases, '.installed'), group = path.join(store, release.manifestSha256);
  if (options.prepare) { await privateDirectory(releases, '.installed'); await privateDirectory(store, release.manifestSha256); }
  else {
    try { await assertDirectory(store); await assertDirectory(group); }
    catch (error) { if (!absent(error)) throw error; throw new LocalReleaseNotPreparedError('Local release has not been prepared: ' + release.id, { cause: error }); }
  }
  for (const { launch, artifact, entry, origin } of selected) {
    const binding = createHash('sha256').update(JSON.stringify({ origin, ownerPackage, nodeOptions: releaseOptionsForEnv(entry.env) })).digest('hex');
    const root = path.join(group, artifact.sha256 + '-' + binding);
    const exists = await fs.lstat(root).then(() => true, error => { if (!absent(error)) throw error; return false; });
    if (!exists) {
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
    if (options.prepare && !await fs.lstat(path.join(root, RELEASE_RECEIPT)).then(() => true, error => {
      if (absent(error)) return false; throw error;
    })) {
      try {
        await verify(root, launch, entry, runtime);
        const receipt = { version: 2 as const, root, origin, ownerPackage, target: runtime,
          nodeOptions: releaseOptionsForEnv(entry.env), treeSha256: await releaseTreeDigest(root),
          installedFrameworkCommit: origin.frameworkCommit, frameworkContentUnchanged: true, artifactPayloadUnchanged: true };
        try { await writeInstalledReleaseReceipt(root, receipt); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      } catch (error) {
        // Publication may race either payload verification or the seal's tree
        // digest. It changes the directory metadata even though the receipt is
        // excluded from the digest. Retry once, only against a complete receipt;
        // exact origin, runtime and both payload digests are still verified.
        if (!await fs.lstat(path.join(root, RELEASE_RECEIPT)).then(() => true, e => {
          if (absent(e)) return false; throw e;
        })) throw error;
        await verify(root, launch, entry, runtime, { origin, ownerPackage });
      }
    }
    const executable = await verify(root, launch, entry, runtime, { origin, ownerPackage });
    for (const relative of options.requiredFiles?.[entry.name] ?? []) {
      try { await member(root, relative); }
      catch { throw Error(`Requested release file is unavailable or is not a physical compiled member: ${entry.name}/${relative}`); }
    }
    const { releaseFrom: _releaseFrom, ...runtimeEntry } = entry;
    result.push({ ...runtimeEntry, ...(entry.releaseFrom ? { cwd: entry.cwd ?? root } : {}),
      [launch.mode]: executable, releaseRoot: root, watch: false });
  }
  return result;
}

/** Materialize a payload without inventing a process or an execution-owner binding.
 * Uses the existing release store and origin receipt; the payload's own target is
 * checked against its closure, not asserted to be this host's execution runtime. */
export async function inspectLocalReleasePayloads(release: LoadedRelease, entries: readonly IEcosystemAppEntry[], prepare = false): Promise<Map<string, string>> {
  if (!digest(release.manifestSha256)) throw Error('Invalid local release manifest digest');
  const sources = new Map(releaseArtifactOrigins(release.manifest, release.manifestSha256).map(source => [source.app, source]));
  const selected = entries.map(entry => {
    const source = sources.get(entry.name), artifacts = release.manifest.artifacts.filter(a => a.app === entry.name), files = release.files.filter(f => f.app === entry.name);
    const artifact = artifacts[0], file = files[0];
    if (!source || artifacts.length !== 1 || files.length !== 1 || !artifact || !file || !digest(file.sha256) || file.sha256 !== artifact.sha256 || file.bytes !== artifact.bytes)
      throw Error('No unique verified local payload for ' + entry.name);
    if (!isDeepStrictEqual(artifact.origin, entry.releaseFrom)) throw Error('Configured payload source differs from the selected release for ' + entry.name);
    assertImportableArtifact(source.manifest, source.artifact);
    const closureSha256 = source.artifact.closureSha256 ?? source.artifact.launch?.closureSha256;
    if (!closureSha256 || !digest(closureSha256)) throw Error('Payload lacks an admitted closure: ' + entry.name);
    return { source, file, closureSha256 };
  });
  const roots = new Map<string, string>();
  if (!selected.length) return roots;
  const releases = await fs.realpath(path.dirname(release.root)), store = path.join(releases, '.installed'), group = path.join(store, release.manifestSha256);
  if (prepare) { await privateDirectory(releases, '.installed'); await privateDirectory(store, release.manifestSha256); }
  else {
    try { await assertDirectory(store); await assertDirectory(group); }
    catch (error) { if (!absent(error)) throw error; throw new LocalReleaseNotPreparedError('Local payload has not been prepared: ' + release.id, { cause: error }); }
  }
  for (const { source, file, closureSha256 } of selected) {
    const { origin } = source;
    const binding = createHash('sha256').update(JSON.stringify({ origin, use: 'artifact-volume' })).digest('hex');
    const root = path.join(group, file.sha256 + '-' + binding);
    const verifyPayload = () => verifyFrozenPayload(root, closureSha256, source.manifest.builtWith.target!);
    const exists = await fs.lstat(root).then(() => true, error => { if (absent(error)) return false; throw error; });
    if (!exists) {
      if (!prepare) throw new LocalReleaseNotPreparedError('Local payload has not been prepared: ' + source.app);
      const tmp = await fs.mkdtemp(path.join(group, '.install-'));
      try {
        const copied = path.join(tmp, 'archive'), payload = await privateDirectory(tmp, 'payload');
        await fs.copyFile(file.path, copied, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
        if ((await fs.stat(copied)).size !== file.bytes || await sha256File(copied) !== file.sha256) throw Error('Local release archive changed before installation');
        await extractFrozenArchive(copied, payload);
        await verifyFrozenPayload(payload, closureSha256, source.manifest.builtWith.target!);
        try { await fs.rename(payload, root); }
        catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
      } finally { await fs.rm(tmp, { recursive: true, force: true }); }
    }
    if (prepare && !await fs.lstat(path.join(root, RELEASE_RECEIPT)).then(() => true, error => { if (absent(error)) return false; throw error; })) {
      await verifyPayload();
      const receipt = { version: 1 as const, root, origin, treeSha256: await releaseTreeDigest(root),
        installedFrameworkCommit: origin.frameworkCommit, frameworkContentUnchanged: true, artifactPayloadUnchanged: true };
      try { await writeInstalledReleaseReceipt(root, receipt); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    await verifyPayload();
    const receipt = await readInstalledReleaseReceipt(root);
    if (receipt.version !== 1 || !isDeepStrictEqual(receipt.origin, origin) || receipt.treeSha256 !== await releaseTreeDigest(root) ||
        receipt.installedFrameworkCommit !== origin.frameworkCommit || receipt.frameworkContentUnchanged !== true || receipt.artifactPayloadUnchanged !== true)
      throw Error('Local installed payload origin changed');
    if (await fs.lstat(path.join(root, '.artifact-sha256')).then(() => true, error => { if (absent(error)) return false; throw error; }))
      throw Error('Unexpected operational metadata in local release');
    roots.set(source.app, root);
  }
  return roots;
}
