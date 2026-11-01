import fs from 'node:fs/promises';
import path from 'node:path';
import { shellEscape } from '../shared/shell-escape.js';
import type { IEcosystemAppEntry, RuntimeReleaseEvidence } from '../config/types.js';

export const RELEASE_RECEIPT = '.omnitron-release.json';

export interface ReleaseArtifactOrigin {
  releaseId: string;
  manifestSha256: string;
  artifactSha256: string;
  artifactBytes: number;
  app: string;
  frameworkCommit: string;
}

interface InstalledReleaseReceipt {
  version: 1;
  origin: ReleaseArtifactOrigin;
  root: string;
  treeSha256: string;
  installedFrameworkCommit: string;
  frameworkContentUnchanged: boolean;
  artifactPayloadUnchanged: boolean;
}

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
      digest.update(`file\0${label}\0${before.mode & 0o111n}\0`);
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
export async function frameworkDependencyDigest(application: string): Promise<string> {
  const io = await import('node:fs/promises');
  const paths = await import('node:path');
  const { createRequire } = await import('node:module');
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
    const item = { name: meta.name as string, version: meta.version as string, content: await releaseTreeDigest(root, true, true), dependencies: {} as Record<string, number | null> };
    graph.push(item);
    const resolver = createRequire(paths.join(root, 'package.json'));
    for (const name of Object.keys({ ...meta.dependencies, ...meta.optionalDependencies, ...meta.peerDependencies }).sort()) {
      let target: string | undefined;
      for (const parent of resolver.resolve.paths(`${name}/package.json`) ?? []) {
        const candidate = paths.join(parent, name);
        if (await io.access(paths.join(candidate, 'package.json')).then(() => true, () => false)) { target = candidate; break; }
      }
      if (target) item.dependencies[name] = await visit(target);
      else if (name in (meta.optionalDependencies ?? {}) || meta.peerDependenciesMeta?.[name]?.optional) item.dependencies[name] = null;
      else throw new Error('A framework dependency cannot be resolved');
    }
    return id;
  };
  const scope = paths.join(application, 'node_modules', '@omnitron-dev');
  const roots: Record<string, number> = {};
  for (const name of (await io.readdir(scope)).filter(packageName => !packageName.startsWith('.')).sort()) roots[name] = await visit(paths.join(scope, name));
  return createHash('sha256').update(JSON.stringify({ roots, graph })).digest('hex');
}

export function frameworkDigestCommand(application: string): string {
  return `node --input-type=module -e ${shellEscape(`const releaseTreeDigest=${releaseTreeDigest.toString()};const inspect=${frameworkDependencyDigest.toString()};console.log(await inspect(${JSON.stringify(application)}));`)}`;
}

/** Dependency installers may add locks, but must not silently rewrite the shipped payload. */
export function artifactPayloadDigestCommand(application: string, archiveName: string): string {
  const excluded = [archiveName, 'package-lock.json', 'npm-shrinkwrap.json'];
  return `node --input-type=module -e ${shellEscape(`const inspect=${releaseTreeDigest.toString()};console.log(await inspect(${JSON.stringify(application)},true,true,${JSON.stringify(excluded)}));`)}`;
}

function validOrigin(value: ReleaseArtifactOrigin): boolean {
  return Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.releaseId) && !value.releaseId.includes('..') &&
    /^[a-f0-9]{64}$/.test(value.manifestSha256) && /^[a-f0-9]{64}$/.test(value.artifactSha256) &&
    /^[a-f0-9]{40}$/.test(value.frameworkCommit) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.app) &&
    Number.isSafeInteger(value.artifactBytes) && value.artifactBytes > 0);
}

/** Called only after checked delivery and dependency installation in a new directory. */
export function sealReleaseArtifactCommand(directory: string, origin: ReleaseArtifactOrigin, installedFrameworkCommit: string, frameworkContentUnchanged: boolean, artifactPayloadUnchanged: boolean): string {
  if (!validOrigin(origin) || !path.isAbsolute(directory) || !/^[a-f0-9]{40}$/.test(installedFrameworkCommit))
    throw new Error('Invalid release origin');
  const source = `import fs from 'node:fs/promises';
const root=await fs.realpath(${JSON.stringify(directory)}), origin=${JSON.stringify(origin)};
const treeSha256=await (${releaseTreeDigest.toString()})(root);
await fs.writeFile(root+'/${RELEASE_RECEIPT}',JSON.stringify({version:1,root,origin,treeSha256,installedFrameworkCommit:${JSON.stringify(installedFrameworkCommit)},frameworkContentUnchanged:${JSON.stringify(frameworkContentUnchanged)},artifactPayloadUnchanged:${JSON.stringify(artifactPayloadUnchanged)}}),{mode:0o600,flag:'wx'});`;
  return `node --input-type=module -e ${shellEscape(source)}`;
}

/** A fresh launch may verify a receipt; a surviving legacy process may not. */
export async function verifyLaunchRelease(entry: IEcosystemAppEntry, launchId: string, executionPaths: readonly string[] = []): Promise<RuntimeReleaseEvidence> {
  const unavailable = (reason: string): RuntimeReleaseEvidence => ({ state: 'unreported', reason });
  for (const option of ['NODE_OPTIONS', 'NODE_PATH']) {
    const effective = entry.env && Object.hasOwn(entry.env, option) ? entry.env[option] : process.env[option];
    if (typeof effective === 'string' && effective.trim())
      return unavailable('Node runtime options or additional module paths are configured outside the installed release receipt.');
  }
  if (!entry.releaseRoot || !path.isAbsolute(entry.releaseRoot)) return unavailable('No installed release boundary was recorded for this launch.');
  const root = await fs.realpath(entry.releaseRoot).catch(() => null);
  if (!root) return unavailable('The launch directory could not be read.');
  const receiptPath = path.join(root, RELEASE_RECEIPT);
  let receipt: InstalledReleaseReceipt;
  try {
    const stat = await fs.lstat(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384 || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) return unavailable('The installed release receipt is not a private regular file.');
    receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')) as InstalledReleaseReceipt;
    if (receipt.version !== 1 || receipt.root !== root || !validOrigin(receipt.origin) ||
      !/^[a-f0-9]{64}$/.test(receipt.treeSha256) || !/^[a-f0-9]{40}$/.test(receipt.installedFrameworkCommit))
      return unavailable('The installed release receipt is invalid.');
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
    artifactSha256: receipt.origin.artifactSha256, observedAt: new Date().toISOString(), launchId, basis: 'verified-launch' };
}
