import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInstalledDependency } from './package-resolution.js';
import { fileURLToPath } from 'node:url';
import { targetRuntime, releaseNodeOptions, assertReleaseLoaderEnvironment, type TargetRuntime } from './target-runtime.js';
import { shellEscape } from '../shared/shell-escape.js';
import { readInstalledReleaseReceipt, writeInstalledReleaseReceipt, validOrigin, type ReleaseArtifactOrigin, type InstalledReleaseReceipt } from './installed-origin.js';
export { validOrigin } from './installed-origin.js';
export type { ReleaseArtifactOrigin } from './installed-origin.js';
import type { IEcosystemAppEntry, RuntimeReleaseEvidence } from '../config/types.js';

export const RELEASE_RECEIPT = '.omnitron-release.json';

/** Self-contained so exactly this implementation also seals the remote candidate. */
export async function releaseTreeDigest(directory: string, portable = false, skipDependencies = false, excludedRootEntries: readonly string[] = [],
  inspectWorkspaceBinding?: (link: string, target: string) => Promise<boolean | undefined>, publisher: 'service' | 'administrator' = 'service'): Promise<string> {
  const io = await import('node:fs/promises');
  const paths = await import('node:path');
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256'), seen = new Map<string, string>();
  const ownerUid = publisher === 'administrator' ? 0 : process.getuid?.();
  const owner = ownerUid === undefined ? undefined : BigInt(ownerUid);
  const chunkSize = 64 * 1024, windowSize = 12;
  type Stats = import('node:fs').BigIntStats;
  type Handle = import('node:fs/promises').FileHandle;
  const handles = new Set<Handle>();
  const close = async (handle: Handle) => { if (handles.delete(handle)) await handle.close(); };
  let root: string, entriesRead = 0, fileCount = 0, totalBytes = 0;

  let lastProgress = performance.now();
  const hardDeadline = lastProgress + 10 * 60_000, idleLimit = 60_000;
  let failure: Error | undefined;
  const check = (progress = false) => {
    const now = performance.now();
    if (now >= hardDeadline) failure ??= new Error('Release tree verification deadline exceeded');
    if (now - lastProgress >= idleLimit) failure ??= new Error('Release tree verification stalled without progress');
    if (failure) throw failure;
    if (progress) lastProgress = now;
  };
  const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode &&
    a.uid === b.uid && a.gid === b.gid && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
  const checkOwner = (stat: Stats) => {
    if (owner !== undefined && stat.uid !== owner) throw new Error('Release tree belongs to another user');
    if (!stat.isSymbolicLink() && (stat.mode & 0o022n) !== 0n) throw new Error('Release tree is writable by another user');
  };
  const changed = () => new Error('Release tree changed during verification');
  const read = async (file: string, fd: Handle, before: Stats, stream: boolean) => {
    const size = Number(before.size), buffer = Buffer.allocUnsafe(Math.min(size, chunkSize));
    for (let offset = 0; offset < size;) {
      check();
      const length = Math.min(buffer.length, size - offset);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await fd.read(buffer, filled, length - filled, null);
        if (!bytesRead) throw changed();
        check(true);
        filled += bytesRead;
      }
      if (stream) digest.update(buffer.subarray(0, length));
      offset += length;
    }
    // The descriptor still pins the inode. The final pathname stat verifies both
    // its identity and its complete metadata against the opened file.
    if (!sameFile(before, await io.lstat(file, { bigint: true }))) throw changed();
    check(true);
    return buffer;
  };
  const regular = async (file: string, label: string, previous?: Promise<void>, expected?: Stats) => {
    check();
    const reference = seen.get(file);
    if (reference !== undefined) {
      const current = expected ?? await io.lstat(file, { bigint: true });
      checkOwner(current);
      if (!current.isFile()) throw changed();
      await previous;
      check(true);
      digest.update(`reference\0${label}\0${reference}\0`);
      return;
    }
    const fd = await io.open(file, io.constants.O_RDONLY | io.constants.O_NOFOLLOW | io.constants.O_NONBLOCK);
    handles.add(fd);
    try {
      check();
      const before = await fd.stat({ bigint: true });
      check();
      if (!before.isFile() || expected && !sameFile(expected, before)) throw changed();
      checkOwner(before);
      if (++fileCount > 200_000 || (totalBytes += Number(before.size)) > 2_147_483_648 || before.size > 268_435_456n)
        throw new Error('Release tree exceeds verification capacity');
      const contents = before.size <= BigInt(chunkSize) ? await read(file, fd, before, false) : undefined;
      if (contents) await close(fd);
      // Adjacent regular files can be read ahead, but only their predecessor can
      // release this position in the canonical byte stream.
      await previous;
      check();
      seen.set(file, label);
      digest.update(`file\0${label}\0${portable ? (before.mode & 0o111n ? 0o111n : 0n) : before.mode & 0o111n}\0`);
      if (contents) digest.update(contents);
      else await read(file, fd, before, true);
      digest.update('\0');
    } finally { await close(fd); }
  };
  const walk = async (absolute: string, label: string): Promise<void> => {
    check();
    const before = await io.lstat(absolute, { bigint: true });
    check();
    checkOwner(before);
    if (before.isSymbolicLink()) {
      const target = await io.realpath(absolute);
      check();
      const binding = portable && inspectWorkspaceBinding ? await inspectWorkspaceBinding(absolute, target) : undefined;
      check();
      if (portable && target !== root && !target.startsWith(root + paths.sep) && !binding)
        throw Error('Release payload links outside its packed boundary: ' + label);
      if (binding === false)
        throw Error('Release payload has an unverified dependency binding at its packed boundary: ' + label);
      if (binding) {
        // Only a working-tree graph can claim a package and fingerprint its contents separately.
        // Archive callers never supply such a graph. Their payload remains self-contained.
        digest.update(`workspace-package\0${label}\0${await io.readlink(absolute)}\0${target}\0`);
      } else {
        if (!portable) digest.update(`link\0${label}\0${await io.readlink(absolute)}\0${target}\0`);
        await walk(target, portable ? label : `resolved:${target}`);
      }
      check();
      const after = await io.lstat(absolute, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.ctimeNs !== after.ctimeNs ||
          binding && await io.realpath(absolute) !== target)
        throw new Error('Release dependency binding changed during verification');
    } else if (before.isFile()) {
      await regular(absolute, label, undefined, before);
    } else if (seen.has(absolute)) {
      digest.update(`reference\0${label}\0${seen.get(absolute)}\0`);
    } else if (before.isDirectory()) {
      seen.set(absolute, label);
      digest.update(`directory\0${label}\0`);
      const entries: import('node:fs').Dirent[] = [];
      for await (const entry of await io.opendir(absolute, { bufferSize: 256 })) {
        check(true);
        if (++entriesRead > 400_000) throw new Error('Release tree exceeds verification capacity');
        if (absolute === root && (skipDependencies && entry.name === 'node_modules' || excludedRootEntries.includes(entry.name) ||
            entry.name === '.omnitron-release.json' || entry.name === '.artifact-sha256')) continue;
        entries.push(entry);
      }
      entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      const pending: Promise<void>[] = [];
      try {
        for (const entry of entries) {
          const file = paths.join(absolute, entry.name), child = label + '/' + entry.name;
          if (entry.isFile()) {
            if (pending.length === windowSize) await pending.shift();
            const next = regular(file, child, pending.at(-1));
            // A later read can fail before its slot reaches the front.
            void next.catch(() => {});
            pending.push(next);
          } else {
            await Promise.all(pending);
            pending.length = 0;
            await walk(file, child);
          }
        }
        await Promise.all(pending);
      } catch (error) { await Promise.allSettled(pending); throw error; }
      if (!sameFile(before, await io.lstat(absolute, { bigint: true }))) throw changed();
    } else throw new Error('Unsupported file in release tree');
    check(true);
  };

  // One timer for the entire tree also catches an outstanding filesystem call
  // that never settles. Only observed entries and bytes read advance the clock.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    const tick = () => {
      try {
        check();
        const next = Math.min(hardDeadline, lastProgress + idleLimit) - performance.now();
        timer = setTimeout(tick, Math.max(1, Math.ceil(next)));
      } catch (error) { reject(error); }
    };
    tick();
  });
  const verify = async () => {
    root = await io.realpath(directory);
    await walk(root, '.');
    return digest.digest('hex');
  };
  try { return await Promise.race([verify(), timeout]); }
  finally {
    clearTimeout(timer);
    if (failure) for (const handle of handles) void close(handle).catch(() => {});
  }
}

/** Compare package bytes and resolution edges, independent of installation paths. */
export async function frameworkDependencyGraph(application: string, selected?: Readonly<Record<string, string>>) {
  const io = await import('node:fs/promises');
  const paths = await import('node:path');
  const { createHash } = await import('node:crypto');
  const graph: Array<{ name: string; version: string; content: string; dependencies: Record<string, number | null> }> = [];
  const known = new Map<string, number>();
  const deadline = performance.now() + 10 * 60_000;
  const visit = async (directory: string): Promise<number> => {
    const root = await io.realpath(directory);
    const old = known.get(root); if (old !== undefined) return old;
    if (performance.now() > deadline || graph.length >= 4096) throw new Error('Framework dependency graph exceeds verification capacity');
    const meta = JSON.parse(await io.readFile(paths.join(root, 'package.json'), 'utf8'));
    if (typeof meta.name !== 'string' || typeof meta.version !== 'string') throw new Error('Invalid framework dependency package');
    const id = graph.length; known.set(root, id);
    const item = { name: meta.name as string, version: meta.version as string, content: await releaseTreeDigest(root, true, true), dependencies: Object.create(null) as Record<string, number | null> };
    graph.push(item);
    for (const name of Object.keys({ ...meta.dependencies, ...meta.optionalDependencies, ...meta.peerDependencies }).sort()) {
      const target = await resolveInstalledDependency(root, name, selected !== undefined);
      if (target) item.dependencies[name] = await visit(target);
      else if (name in (meta.optionalDependencies ?? {}) || meta.peerDependenciesMeta?.[name]?.optional) item.dependencies[name] = null;
      else throw new Error('Missing framework dependency: ' + meta.name + ' → ' + name);
    }
    return id;
  };
  const scope = paths.join(application, 'node_modules', '@omnitron-dev');
  const roots: Record<string, number> = {};
  const pathsByName = selected ?? Object.fromEntries((await io.readdir(scope)).filter(name => !name.startsWith('.')).map(name => [name, paths.join(scope, name)]));
  for (const name of Object.keys(pathsByName).sort()) roots[name] = await visit(pathsByName[name]!);
  const sha256 = createHash('sha256').update(JSON.stringify({ roots, graph })).digest('hex');
  return { roots, graph, directories: [...known.keys()], sha256 };
}

export async function frameworkDependencyDigest(application: string, selected?: Readonly<Record<string, string>>): Promise<string> {
  return (await frameworkDependencyGraph(application, selected)).sha256;
}

// Both commands execute the same verifier on the target using only its Node executable.
export function frameworkGraphCommandSource(): string {
  return 'const resolveInstalledDependency=' + resolveInstalledDependency.toString() +
    ';const releaseTreeDigest=' + releaseTreeDigest.toString() + ';const frameworkDependencyGraph=' + frameworkDependencyGraph.toString() + ';';
}

export function frameworkDigestCommand(application: string): string {
  return `node --input-type=module -e ${shellEscape(`${frameworkGraphCommandSource()}const inspect=${frameworkDependencyDigest.toString()};console.log(await inspect(${JSON.stringify(application)}));`)}`;
}

/** Dependency installers may add locks, but must not silently rewrite the shipped payload. */
export function artifactPayloadDigestCommand(application: string, archiveName: string): string {
  const excluded = [archiveName, 'package-lock.json', 'npm-shrinkwrap.json'];
  return `node --input-type=module -e ${shellEscape(`const inspect=${releaseTreeDigest.toString()};console.log(await inspect(${JSON.stringify(application)},true,true,${JSON.stringify(excluded)}));`)}`;
}

/** Called only after checked delivery and dependency installation in a new directory. */
export function sealReleaseArtifactCommand(directory: string, origin: ReleaseArtifactOrigin, installedFrameworkCommit: string, frameworkContentUnchanged: boolean, artifactPayloadUnchanged: boolean,
  launch?: { nodeOptions: string; executable: string; ownerPackage: string }): string {
  if (!validOrigin(origin) || !path.isAbsolute(directory) || !/^[a-f0-9]{40}$/.test(installedFrameworkCommit))
    throw new Error('Invalid release origin');
  if (launch && (!path.isAbsolute(launch.executable) || !path.isAbsolute(launch.ownerPackage) ||
    releaseNodeOptions(launch.nodeOptions) !== launch.nodeOptions || !frameworkContentUnchanged || !artifactPayloadUnchanged ||
    installedFrameworkCommit !== origin.frameworkCommit)) throw new Error('A verified release requires unchanged application SDK and payload');
  const source = `import fs from 'node:fs/promises';
const root=await fs.realpath(${JSON.stringify(directory)}), origin=${JSON.stringify(origin)};
const treeSha256=await (${releaseTreeDigest.toString()})(root);
const launch=${launch ? `{version:2,nodeOptions:${JSON.stringify(launch.nodeOptions)},ownerPackage:await fs.realpath(${JSON.stringify(launch.ownerPackage)}),target:await (${targetRuntime.toString()})()}` : '{version:1}'};
await (${writeInstalledReleaseReceipt.toString()})(root,{...launch,root,origin,treeSha256,installedFrameworkCommit:${JSON.stringify(installedFrameworkCommit)},frameworkContentUnchanged:${JSON.stringify(frameworkContentUnchanged)},artifactPayloadUnchanged:${JSON.stringify(artifactPayloadUnchanged)}});`;
  return `env -u NODE_OPTIONS -u NODE_PATH ${launch ? shellEscape(launch.executable) : 'node'} --input-type=module -e ${shellEscape(source)}`;
}

/** The old input marker is only a performance hint. Reuse also requires this
 * exact installed receipt, unchanged bytes and the current execution binding. */
export function installedReleaseCheckCommand(directory: string, origin: ReleaseArtifactOrigin, owner: { root: string; executable: string; commit: string }, nodeOptions: string): string {
  if (!validOrigin(origin) || ![directory, owner.executable, owner.root].every(p => path.isAbsolute(p))) throw Error('Invalid release verification input');
  const source = `import fs from 'node:fs/promises';import {isDeepStrictEqual} from 'node:util';try {
const root=await fs.realpath(${JSON.stringify(directory)}),file=root+'/${RELEASE_RECEIPT}',stat=await fs.lstat(file);
if(!stat.isFile()||stat.size>16384||(stat.mode&63)!==0||(process.getuid&&stat.uid!==process.getuid()))throw Error();
const r=JSON.parse(await fs.readFile(file,'utf8')), expected=${JSON.stringify(origin)};
if(r.version!==2||r.root!==root||r.nodeOptions!==${JSON.stringify(releaseNodeOptions(nodeOptions))}||r.ownerPackage!==await fs.realpath(${JSON.stringify(owner.root)})||
r.installedFrameworkCommit!==expected.frameworkCommit||r.frameworkContentUnchanged!==true||r.artifactPayloadUnchanged!==true||
!isDeepStrictEqual(r.origin,expected))throw Error();
const target=await (${targetRuntime.toString()})();if(Object.keys(target).some(key=>target[key]!==r.target?.[key]))throw Error();
if(await (${releaseTreeDigest.toString()})(root)!==r.treeSha256)throw Error();console.log('verified');
}catch{console.log('stale')}`;
  return `env -u NODE_OPTIONS -u NODE_PATH ${shellEscape(owner.executable)} --input-type=module -e ${shellEscape(source)}`;
}

/** A fresh launch may verify a receipt; a surviving legacy process may not. */
export async function verifyLaunchRelease(entry: IEcosystemAppEntry, launchId: string, executionPaths: readonly string[] = []): Promise<RuntimeReleaseEvidence> {
  const unavailable = (reason: string): RuntimeReleaseEvidence => ({ state: 'unreported', reason });
  try {
    // Repeat the canonical ambient-loader check on recovery too. Closure-owned
    // library paths are added by the launcher only after this admission.
    assertReleaseLoaderEnvironment(process.env);
    assertReleaseLoaderEnvironment(entry.env);
  } catch (error) { return unavailable(String(error)); }
  const effective = (key: string): unknown => entry.env && Object.hasOwn(entry.env, key) ? entry.env[key] : process.env[key];
  if (effective('NODE_PATH')) return unavailable('Additional Node module paths are outside the release boundary.');
  if (!entry.releaseRoot || !path.isAbsolute(entry.releaseRoot)) return unavailable('No installed release boundary was recorded for this launch.');
  const root = await fs.realpath(entry.releaseRoot).catch(() => null);
  if (!root) return unavailable('The launch directory could not be read.');
  let receipt: InstalledReleaseReceipt;
  try {
    receipt = await readInstalledReleaseReceipt(root);
    if (receipt.version === 1) {
      if (effective('NODE_OPTIONS')) return unavailable('Node runtime options are outside this legacy receipt.');
    } else {
      let options: string;
      try { options = releaseNodeOptions(effective('NODE_OPTIONS')); }
      catch { return unavailable('This launch uses Node options not permitted for a verified release.'); }
      if (receipt.nodeOptions !== options) return unavailable('The Node resource settings differ from the settings sealed at build time.');
      const ownerPackage = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
      if (receipt.ownerPackage !== ownerPackage)
        return { state: 'modified', releaseId: receipt.origin.releaseId, reason: 'This launch uses a different execution owner than the verified delivery.' };
      const target = await targetRuntime();
      if (Object.keys(target).some(k => target[k as keyof TargetRuntime] !== receipt.target?.[k as keyof TargetRuntime]))
        return { state: 'modified', releaseId: receipt.origin.releaseId, reason: 'The execution runtime differs from the target verified at delivery.' };
    }
    const executable = entry.bootstrap ?? entry.script;
    if (executable && /\.(?:[cm]?ts|tsx)$/.test(executable))
      return unavailable('This launch compiles source files; the installed release receipt does not identify the generated executable.');
    if (!executable || !(await fs.realpath(path.resolve(entry.cwd ?? root, executable))).startsWith(root + path.sep) ||
      entry.name.split('/').at(-1) !== receipt.origin.app)
      return unavailable('The installed release receipt does not match this application entry point.');
    for (const executablePath of executionPaths) {
      if (!path.isAbsolute(executablePath) || /\.(?:[cm]?ts|tsx)$/.test(executablePath) ||
        !(await fs.realpath(executablePath)).startsWith(root + path.sep))
        return unavailable('A launch module is outside the verified precompiled release boundary.');
    }
  } catch {
    return unavailable('No readable release receipt was recorded for this launch; deployment history cannot establish its identity.');
  }
  const releaseId = receipt.origin.releaseId;
  if (receipt.artifactPayloadUnchanged !== true)
    return { state: 'modified', releaseId, reason: 'The application payload changed while dependencies were installed.' };
  try {
    if (await releaseTreeDigest(root) !== receipt.treeSha256)
      return { state: 'modified', releaseId, reason: 'Installed application files or resolved dependencies changed after delivery.' };
  } catch {
    return { state: 'modified', releaseId, reason: 'The installed application tree could not be verified at launch.' };
  }
  if (receipt.installedFrameworkCommit !== receipt.origin.frameworkCommit || receipt.frameworkContentUnchanged !== true)
    return { state: 'modified', releaseId, reason: 'The installed framework differs from the framework recorded by this release.' };
  return { state: 'confirmed', releaseId, manifestSha256: receipt.origin.manifestSha256,
    ...(receipt.version === 2 && receipt.origin.runtimeOrigin && { consumer: { ...receipt.origin.runtimeOrigin.consumer } }),
    artifactSha256: receipt.origin.artifactSha256, treeSha256: receipt.treeSha256, observedAt: new Date().toISOString(), launchId, basis: 'verified-launch' };
}
