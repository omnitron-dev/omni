import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInstalledDependency } from './package-resolution.js';
import { fileURLToPath } from 'node:url';
import { targetRuntime, releaseNodeOptions, type TargetRuntime } from './target-runtime.js';
import { shellEscape } from '../shared/shell-escape.js';
import { readInstalledReleaseReceipt, writeInstalledReleaseReceipt, validOrigin, type ReleaseArtifactOrigin, type InstalledReleaseReceipt } from './installed-origin.js';
export { validOrigin } from './installed-origin.js';
export type { ReleaseArtifactOrigin } from './installed-origin.js';
import type { IEcosystemAppEntry, RuntimeReleaseEvidence } from '../config/types.js';

export const RELEASE_RECEIPT = '.omnitron-release.json';

/** Self-contained so exactly this implementation also seals the remote candidate. */
export async function releaseTreeDigest(directory: string, portable = false, skipDependencies = false, excludedRootEntries: readonly string[] = []): Promise<string> {
  const io = await import('node:fs/promises');
  const paths = await import('node:path');
  const { createHash } = await import('node:crypto');
  const root = await io.realpath(directory), digest = createHash('sha256');
  const seen = new Map<string, string>();
  let files = 0, bytes = 0;
  const deadline = Date.now() + 60_000;
  const walk = async (absolute: string, label: string): Promise<void> => {
    if (Date.now() > deadline) throw new Error('Release tree verification deadline exceeded');
    const before = await io.lstat(absolute, { bigint: true });
    if (process.getuid && before.uid !== BigInt(process.getuid())) throw new Error('Release tree belongs to another user');
    if (before.isSymbolicLink()) {
      const target = await io.realpath(absolute);
      if (portable && target !== root && !target.startsWith(root + paths.sep)) throw Error('Release payload links outside its packed boundary');
      if (!portable) digest.update(`link\0${label}\0${await io.readlink(absolute)}\0${target}\0`);
      // Follow dependency links, including an externally bound framework, once.
      await walk(target, portable ? label : `resolved:${target}`);
      const after = await io.lstat(absolute, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.ctimeNs !== after.ctimeNs)
        throw new Error('Release dependency binding changed during verification');
      return;
    }
    if ((before.mode & 0o022n) !== 0n) throw new Error('Release tree is writable by another user');
    if (seen.has(absolute)) { digest.update(`reference\0${label}\0${seen.get(absolute)}\0`); return; }
    seen.set(absolute, label);
    if (before.isDirectory()) {
      digest.update(`directory\0${label}\0`);
      for (const name of (await io.readdir(absolute)).sort()) {
        if (skipDependencies && absolute === root && name === 'node_modules') continue;
        if (absolute === root && excludedRootEntries.includes(name)) continue;
        // Operational receipts are written after deployment; they are not code.
        if (absolute === root && ['.omnitron-release.json', '.artifact-sha256'].includes(name)) continue;
        await walk(paths.join(absolute, name), `${label}/${name}`);
      }
    } else if (before.isFile()) {
      if (++files > 200_000 || (bytes += Number(before.size)) > 2_147_483_648 || before.size > 268_435_456n)
        throw new Error('Release tree exceeds verification capacity');
      digest.update(`file\0${label}\0${portable ? (before.mode & 0o111n ? 0o111n : 0n) : before.mode & 0o111n}\0`);
      digest.update(await io.readFile(absolute)); digest.update('\0');
    } else throw new Error('Unsupported file in release tree');
    const after = await io.lstat(absolute, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw new Error('Release tree changed during verification');
  };
  await walk(root, '.');
  return digest.digest('hex');
}

/** Compare package bytes and resolution edges, independent of installation paths. */
export async function frameworkDependencyGraph(application: string, selected?: Readonly<Record<string, string>>) {
  const io = await import('node:fs/promises');
  const paths = await import('node:path');
  const { createHash } = await import('node:crypto');
  const graph: Array<{ name: string; version: string; content: string; dependencies: Record<string, number | null> }> = [];
  const known = new Map<string, number>();
  const deadline = Date.now() + 60_000;
  const visit = async (directory: string): Promise<number> => {
    const root = await io.realpath(directory);
    const old = known.get(root); if (old !== undefined) return old;
    if (Date.now() > deadline || graph.length >= 4096) throw new Error('Framework dependency graph exceeds verification capacity');
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
    installedFrameworkCommit !== origin.frameworkCommit)) throw new Error('A verified release requires an unchanged payload and owner');
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
if(r.version!==2||r.root!==root||r.nodeOptions!==${JSON.stringify(releaseNodeOptions(nodeOptions))}||r.ownerPackage!==await fs.realpath(${JSON.stringify(owner.root)})||r.installedFrameworkCommit!==${JSON.stringify(owner.commit)}||
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
    artifactSha256: receipt.origin.artifactSha256, treeSha256: receipt.treeSha256, observedAt: new Date().toISOString(), launchId, basis: 'verified-launch' };
}
