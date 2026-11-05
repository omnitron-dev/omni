import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { extract, list } from 'tar';
import { applicationBootstrapRuntime } from '../orchestrator/application-runtime.js';
import { shellEscape } from '../shared/shell-escape.js';
import { CLOSURE_FILE } from './application-closure.js';
import { RELEASE_RECEIPT, releaseTreeDigest } from './runtime-provenance.js';
import { assertReleaseTarget, targetRuntime, releaseNodeOptions, type TargetRuntime } from './target-runtime.js';
import { writeInstalledReleaseReceipt, validOrigin, type ReleaseArtifactOrigin } from './installed-origin.js';
import type { ReleaseLaunch } from './manifest.js';

const digest = (s: string) => /^[a-f0-9]{64}$/.test(s);
const componentPath = (s: string) => s.length <= 4096 && !s.includes('\\') && !s.includes(':') &&
  !s.includes('\0') && s.split('/').every(part => part && part !== '.' && part !== '..');
const inside = (root: string, name: string) => name.startsWith(root + path.sep);

/** Validate manifest data before any destination is created or archive is transferred. */
export function assertFrozenLaunch(launch: ReleaseLaunch | undefined, origin?: ReleaseArtifactOrigin): asserts launch is ReleaseLaunch {
  if (!launch || !['bootstrap', 'script'].includes(launch.mode) || typeof launch.file !== 'string' ||
      !componentPath(launch.file) || !/\.[cm]?js$/.test(launch.file) || !digest(launch.closureSha256) ||
      (origin && (!origin.runtimeOrigin || origin.runtimeOrigin.entry.mode !== launch.mode || origin.runtimeOrigin.entry.relativeFile !== launch.file)))
    throw Error('Checked release lacks a valid admitted compiled launch; rebuild it before deployment');
}

export async function frozenMember(root: string, relative: string): Promise<string> {
  if (!componentPath(relative) || !/\.[cm]?js$/.test(relative)) throw Error('Expected a package-relative compiled JavaScript entry: ' + relative);
  const file = path.join(root, relative);
  if (file !== await fs.realpath(file) || !(await fs.lstat(file)).isFile()) throw Error('Release entry must be a physical file: ' + relative);
  return file;
}

/** A fresh directory, no special files, hardlinks, path aliases or writes through a symlink. */
export async function extractFrozenArchive(archive: string, directory: string): Promise<void> {
  let invalid: string | undefined, bytes = 0;
  const names = new Map<string, string>();
  await list({ file: archive, strict: true, onReadEntry(entry) {
    if (invalid) return;
    const name = entry.path.replace(/\/$/, ''), key = name.normalize('NFC').toLowerCase();
    if (path.resolve(directory, name) === path.resolve(archive) || !componentPath(name) || names.has(key) || [RELEASE_RECEIPT, '.artifact-sha256'].includes(path.posix.basename(key)) ||
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

export async function assertFrozenDirectory(dir: string) {
  const s = await fs.lstat(dir);
  if (!s.isDirectory() || await fs.realpath(dir) !== dir || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid()))
    throw Error('Frozen installation requires a private physical directory: ' + dir);
}


/** The packed application owns every dependency and its bootstrap adapter. The
 * execution owner supplies the exact Node image, lifecycle and authorization. */
export async function verifyFrozenApplication(root: string, launch: ReleaseLaunch, runtime: TargetRuntime, nodeOptions: string): Promise<string> {
  assertFrozenLaunch(launch);
  await assertFrozenDirectory(root);
  const file = await frozenMember(root, launch.file);
  const handle = await fs.open(path.join(root, CLOSURE_FILE), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let raw: Buffer;
  try {
    const s = await handle.stat();
    if (!s.isFile() || s.size > 2_000_000) throw Error('Invalid frozen closure record');
    raw = await handle.readFile();
  } finally { await handle.close(); }
  if (createHash('sha256').update(raw).digest('hex') !== launch.closureSha256) throw Error('Frozen closure differs from the admitted manifest');
  const c = JSON.parse(raw.toString('utf8'));
  if (c.protocol !== 1 || !digest(c.payloadSha256) ||
    c.nodeOptions !== nodeOptions) throw Error('Frozen release closure, execution target or Node options differ from the build');
  assertReleaseTarget(c.runtime, runtime);
  if (await releaseTreeDigest(root, true, false, [CLOSURE_FILE]) !== c.payloadSha256) throw Error('Frozen release files differ from the admitted payload');
  if (launch.mode === 'bootstrap') {
    // Boot via the same adapter resolution as the supervisor, without a fallback to its SDK.
    const adapter = await fs.realpath(createRequire(file).resolve('@omnitron-dev/omnitron'));
    if (!inside(root, adapter) || !inside(root, await fs.realpath(applicationBootstrapRuntime(file, adapter))))
      throw Error('Frozen release must supply its own aligned Omnitron adapter');
  }
  return file;
}

/** A receipt is operational evidence, never a trusted member of a build archive. */
export async function assertNoReleaseMetadata(root: string): Promise<void> {
  for (const name of [RELEASE_RECEIPT, '.artifact-sha256']) {
    const stat = await fs.lstat(path.join(root, name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (stat) throw Error('Unexpected operational metadata in frozen release: ' + name);
  }
}

/** Execute the same archive and closure checks on the receiving host. No package
 * installation, graph rebinding or application module evaluation is performed. */
export function installFrozenApplicationCommand(directory: string, archiveName: string, launch: ReleaseLaunch,
  origin: ReleaseArtifactOrigin, owner: { root: string; executable: string }, nodeOptions: string, controlPackage: string): string {
  if (!validOrigin(origin) || ![directory, owner.root, owner.executable, controlPackage].every(p => path.isAbsolute(p)) ||
      !/^[a-zA-Z0-9._+-]+\.tar\.gz$/.test(archiveName) || archiveName.includes('..'))
    throw Error('Verified frozen installation requires an admitted origin and physical execution owner');
  assertFrozenLaunch(launch, origin);
  releaseNodeOptions(nodeOptions);
  const source = `import fsSync,{constants,createReadStream} from 'node:fs';import fs from 'node:fs/promises';
import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const controlRequest=createRequire(${JSON.stringify(path.join(controlPackage, 'package.json'))});
const tarEntry=await fs.realpath(controlRequest.resolve('tar'));
if(!tarEntry.startsWith(${JSON.stringify(path.resolve(controlPackage, '../..') + path.sep)}))throw Error('Frozen extractor is outside the attested control runtime');
const {list,extract}=controlRequest('tar');
const CLOSURE_FILE=${JSON.stringify(CLOSURE_FILE)},RELEASE_RECEIPT=${JSON.stringify(RELEASE_RECEIPT)};
const digest=${digest.toString()},componentPath=${componentPath.toString()},inside=${inside.toString()};
const assertFrozenLaunch=${assertFrozenLaunch.toString()};
const assertFrozenDirectory=${assertFrozenDirectory.toString()},frozenMember=${frozenMember.toString()};
const extractFrozenArchive=${extractFrozenArchive.toString()},releaseTreeDigest=${releaseTreeDigest.toString()};
const applicationBootstrapRuntime=((fs)=>(${applicationBootstrapRuntime.toString()}))(fsSync);
const targetRuntime=${targetRuntime.toString()},assertReleaseTarget=${assertReleaseTarget.toString()},verifyFrozenApplication=${verifyFrozenApplication.toString()};
const assertNoReleaseMetadata=${assertNoReleaseMetadata.toString()},writeInstalledReleaseReceipt=${writeInstalledReleaseReceipt.toString()};
const root=${JSON.stringify(directory)},archive=path.join(root,${JSON.stringify(archiveName)}),origin=${JSON.stringify(origin)};
await assertFrozenDirectory(root);await assertNoReleaseMetadata(root);
const before=await fs.lstat(archive,{bigint:true});
if(!before.isFile()||before.size!==BigInt(origin.artifactBytes))throw Error('Delivered frozen archive size or type differs');
const hash=createHash('sha256');for await(const bytes of createReadStream(archive))hash.update(bytes);
if(hash.digest('hex')!==origin.artifactSha256)throw Error('Delivered frozen archive digest differs');
await extractFrozenArchive(archive,root);
const after=await fs.lstat(archive,{bigint:true});
if(before.ino!==after.ino||before.dev!==after.dev||before.ctimeNs!==after.ctimeNs)throw Error('Delivered archive changed while extracting');
await fs.unlink(archive);await assertNoReleaseMetadata(root);
const target=await targetRuntime();await verifyFrozenApplication(root,${JSON.stringify(launch)},target,${JSON.stringify(nodeOptions)});
await writeInstalledReleaseReceipt(root,{version:2,root,origin,ownerPackage:await fs.realpath(${JSON.stringify(owner.root)}),target,
nodeOptions:${JSON.stringify(nodeOptions)},treeSha256:await releaseTreeDigest(root),installedFrameworkCommit:origin.frameworkCommit,
frameworkContentUnchanged:true,artifactPayloadUnchanged:true});
console.log(JSON.stringify(${JSON.stringify(nodeOptions)}));`;
  return `env -u NODE_OPTIONS -u NODE_PATH ${shellEscape(owner.executable)} --input-type=module -e ${shellEscape(source)}`;
}
