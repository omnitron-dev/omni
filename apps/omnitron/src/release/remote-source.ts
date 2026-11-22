import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';
import type { IAppDefinition, IEcosystemAppEntry, IStackConfig } from '../config/types.js';
import { defineEcosystem } from '../config/define-ecosystem.js';
import { readProjectStacks } from '../config/project-stacks.js';
import { resolveAppPath } from '../config/app-path.js';
import { readCapturedSource, sourceFileDigest, type CapturedSource } from './source-capture.js';
import { withDeclaredConfig, type DeclaredConfig } from '../project/declared-config.js';
import { isSshHostFingerprint } from '../services/node-host-key.js';
import type { RemoteReleaseSourceInput } from '../shared/dto/project.js';
import { loadRelease, treeEqualsCommit } from './load.js';

const exec = promisify(execFile);
const sha256 = /^[a-f0-9]{64}$/;
const validName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export interface RemoteSourceRegistration { name: string; path: string; registeredAt: string }
export interface ReleaseRecipient { host: string; port: number; fingerprint: string; pin: string; managementIdentity: string }

export function remoteReleaseSourceKey(project: string, stack: string, digest: string): string {
  if (![project, stack].every(name => typeof name === 'string' && validName.test(name)) || !sha256.test(digest))
    throw Error('Invalid prepared remote release identity');
  return 'release:remote-source:' + project + '/' + stack + ':' + digest;
}

async function physicalDirectory(directory: string): Promise<string> {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0') ||
      await fs.realpath(directory) !== directory || !(await fs.stat(directory)).isDirectory())
    throw Error('Release source and store must be physical absolute directories on the controller');
  return directory;
}

async function git(directory: string, args: string[], alternates?: string): Promise<string> {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0',
    ...(alternates && { GIT_ALTERNATE_OBJECT_DIRECTORIES: alternates }) };
  return (await exec('git', ['-C', directory, ...args], { env, timeout: 30_000 })).stdout.trimEnd();
}

/** Recheck a private source before importing any of its declarations. A shared immutable
 * commit establishes project lineage even when the producer used a private local mirror. */
export async function verifyRemoteSourceTree(source: string, registered: string, commit: string, directory = ''): Promise<void> {
  const original = await fs.realpath(registered);
  const fromOriginal = path.relative(original, source);
  const fromSource = path.relative(source, original);
  const outside = (relative: string) => relative === '..' || relative.startsWith('..' + path.sep);
  if (!outside(fromOriginal) || !outside(fromSource)) throw Error('A separate source checkout is required');
  if (!/^[a-f0-9]{40}$/.test(commit) || await git(source, ['rev-parse', 'HEAD']) !== commit ||
      (await git(source, ['rev-parse', '--show-prefix'])).replace(/\/$/, '') !== directory ||
      (await git(original, ['rev-parse', '--show-prefix'])).replace(/\/$/, '') !== directory)
    throw Error('Release source checkout or project directory differs from its manifest');
  const originalHead = await git(original, ['rev-parse', 'HEAD']);
  const objects = await git(original, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']);
  // Do not add refs, git alternates, worktrees or objects to the registered development checkout.
  try { await git(source, ['merge-base', originalHead, commit], objects); }
  catch { throw Error('Release source shares no verified history with the registered project'); }
  if (!(await treeEqualsCommit(source, commit)).equal) throw Error('The release source checkout differs from its immutable commit');
}

export function confirmReleaseRecipient(stack: IStackConfig | undefined, nodeId: string, recipient: ReleaseRecipient): void {
  const node = stack?.nodes?.[0];
  if (stack?.type !== 'remote' || stack.nodes?.length !== 1 || !node?.nodeId || node.nodeId !== nodeId || node.ssh?.privateKey !== undefined ||
      node.host !== recipient.host || (node.port ?? 9700) !== recipient.port ||
      !isSshHostFingerprint(recipient.fingerprint) || !sha256.test(recipient.pin) || !recipient.managementIdentity)
    throw Error('Remote release source requires one declared recipient matching its stable registration and approved SSH host key');
}

export async function openRemoteReleaseSource(registration: RemoteSourceRegistration, stack: string, id: string,
  input: RemoteReleaseSourceInput, recipient: ReleaseRecipient) {
  if (!input || Object.keys(input).length !== 5 || !sha256.test(input.manifestSha256) || !sha256.test(input.declarationsSha256) ||
      typeof input.nodeId !== 'string' || !validName.test(input.nodeId))
    throw Error('An exact source, declaration, manifest and registered node ID are required');
  const sourceRoot = await physicalDirectory(input.sourceRoot);
  const storeRoot = await physicalDirectory(input.storeRoot);
  const release = await loadRelease(id, storeRoot);
  if (release.manifestSha256 !== input.manifestSha256) throw Error('The remote release manifest differs from the selected digest');
  const verifyTree = () => verifyRemoteSourceTree(sourceRoot, registration.path, release.manifest.project.commit, release.manifest.project.directory);
  await verifyTree();
  const captured = await readCapturedSource(storeRoot, input.declarationsSha256, sourceRoot);
  if (captured?.protocol !== 1 || captured.project !== registration.name || captured.stack !== stack || captured.release !== id ||
      captured.commit !== release.manifest.project.commit || captured.manifestSha256 !== release.manifestSha256 ||
      !Array.isArray(captured.declarations) || !Array.isArray(captured.config?.apps) || Object.keys(captured.config.stacks ?? {}).length !== 1)
    throw Error('Producer declarations belong to a different project, stack, or release');
  const config = defineEcosystem(captured.config), stackConfig = config.stacks?.[stack];
  if (captured.stackOrigin === 'stacks-file') {
    const declared = readProjectStacks(path.join(sourceRoot, 'omnitron.stacks.json'), registration.name)[stack];
    if (!isDeepStrictEqual(declared, stackConfig)) throw Error('Captured placement differs from the committed stack declaration');
  } else if (captured.stackOrigin !== 'ecosystem') throw Error('Unknown producer stack source');
  confirmReleaseRecipient(stackConfig, input.nodeId, recipient);
  const names = new Set(config.apps.map(entry => entry.name));
  if (!names.size || names.size !== config.apps.length || config.apps.some(entry => typeof entry.name !== 'string' || !validName.test(entry.name) || entry.enabled === false) ||
      (Array.isArray(stackConfig?.apps) && (stackConfig.apps.length !== names.size || stackConfig.apps.some(app => !names.has(app)))))
    throw Error('Incomplete or duplicate application inventory in the selected remote stack');
  return { sourceRoot, storeRoot, release, config, stackConfig: stackConfig!, verifyTree, declarations: captured.declarations };
}

/** Reconstruct the ordinary native declaration from producer evidence and the actual
 * verified archive. Controller admission neither imports a bootstrap nor uses live metadata. */
export async function remoteSourceDeclarations(root: string, commit: string, entries: IEcosystemAppEntry[],
  archived: ReadonlyMap<string, DeclaredConfig>, captured: CapturedSource['declarations']) {
  const repository = await fs.realpath(await git(root, ['rev-parse', '--show-toplevel']));
  const inside = (file: string) => {
    const relative = path.relative(repository, file);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  const definitions = new Map<string, IAppDefinition>();
  const records = new Map(captured.map(row => [row.app, row]));
  if (records.size !== captured.length) throw Error('Duplicate captured bootstrap');
  for (const entry of entries) {
    if (!entry.bootstrap) continue;
    const name = entry.name, declared = archived.get(name), record = records.get(name);
    const bootstrap = resolveAppPath(root, entry, entry.bootstrap);
    if (!inside(bootstrap)) throw Error('Bootstrap path is outside the source repository');
    const physical = await fs.realpath(bootstrap);
    if (!inside(physical) || !declared || declared.malformed || !record ||
        record.bootstrap !== bootstrap || !record.definition || typeof record.definition !== 'object' || Array.isArray(record.definition) ||
        Object.keys(record.definition).some(key => key !== 'requires' && key !== 'omnitronConfig') ||
        !sha256.test(record.sha256) || sourceFileDigest(await fs.readFile(bootstrap)) !== record.sha256)
      throw Error('Incomplete or changed release source declaration for ' + name);
    const relative = path.relative(repository, physical).split(path.sep).join('/');
    const committedBlob = await git(repository, ['rev-parse', '--verify', commit + ':' + relative]);
    if (await git(repository, ['hash-object', '--no-filters', '--', physical]) !== committedBlob)
      throw Error('Bootstrap bytes differ from the committed source for ' + name);
    definitions.set(name, withDeclaredConfig({ name, version: '', processes: [], ...record.definition }, declared));
  }
  if (records.size !== definitions.size) throw Error('Producer bootstrap inventory differs from the release source');
  return definitions;
}
