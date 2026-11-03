import fs from 'node:fs/promises';
import path from 'node:path';
import { releaseNodeOptions, type TargetRuntime } from './target-runtime.js';

export interface ReleaseArtifactOrigin {
  releaseId: string;
  manifestSha256: string;
  artifactSha256: string;
  artifactBytes: number;
  app: string;
  frameworkCommit: string;
  runtimeOrigin?: InstalledRuntimeOrigin;
}

export interface InstalledRuntimeOrigin {
  projectCommit: string;
  producerApp: string;
  consumer: { releaseId: string; manifestSha256: string; app: string };
  entry: { relativeFile: string; mode: 'bootstrap' | 'script' };
}

export interface InstalledReleaseReceipt {
  version: 1 | 2;
  nodeOptions?: string;
  target?: TargetRuntime;
  ownerPackage?: string;
  origin: ReleaseArtifactOrigin;
  root: string;
  treeSha256: string;
  installedFrameworkCommit: string;
  frameworkContentUnchanged: boolean;
  artifactPayloadUnchanged: boolean;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const commit = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const identifier = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(v) && !v.includes('..');

export function validRuntimeOrigin(value: unknown): value is InstalledRuntimeOrigin {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'consumer,entry,producerApp,projectCommit')
    return false;
  const consumer = value['consumer'],
    entry = value['entry'];
  if (
    !record(consumer) ||
    !record(entry) ||
    Object.keys(consumer).sort().join(',') !== 'app,manifestSha256,releaseId' ||
    Object.keys(entry).sort().join(',') !== 'mode,relativeFile'
  )
    return false;
  const file = entry['relativeFile'];
  return (
    commit(value['projectCommit']) &&
    identifier(value['producerApp']) &&
    identifier(consumer['releaseId']) &&
    hash(consumer['manifestSha256']) &&
    identifier(consumer['app']) &&
    (entry['mode'] === 'bootstrap' || entry['mode'] === 'script') &&
    typeof file === 'string' &&
    file.length <= 4096 &&
    !/[\\:\0]/.test(file) &&
    file.split('/').every((p) => p && p !== '.' && p !== '..') &&
    /\.[cm]?js$/.test(file)
  );
}
export function validOrigin(value: unknown): value is ReleaseArtifactOrigin {
  return (
    record(value) &&
    identifier(value['releaseId']) &&
    hash(value['manifestSha256']) &&
    hash(value['artifactSha256']) &&
    commit(value['frameworkCommit']) &&
    identifier(value['app']) &&
    Number.isSafeInteger(value['artifactBytes']) &&
    (value['artifactBytes'] as number) > 0 &&
    (value['runtimeOrigin'] === undefined || (validRuntimeOrigin(value['runtimeOrigin']) &&
      value['runtimeOrigin'].consumer.app === value['app']))
  );
}

/** The same private receipt boundary is used by owners and executing applications. */
export async function readInstalledReleaseReceipt(root: string): Promise<InstalledReleaseReceipt> {
  const file = path.join(root, '.omnitron-release.json');
  if ((await fs.realpath(root)) !== root) throw Error('Installed release root is not physical');
  const { constants } = await import('node:fs');
  const fd = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let raw: string;
  try {
    const stat = await fd.stat();
    if (
      !stat.isFile() ||
      stat.size > 16384 ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw Error('The installed release receipt is not a private regular file');
    raw = await fd.readFile('utf8');
    const after = await fd.stat();
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs)
      throw Error('Installed release receipt changed during verification');
  } finally {
    await fd.close();
  }
  let r: InstalledReleaseReceipt;
  try {
    r = JSON.parse(raw) as InstalledReleaseReceipt;
  } catch {
    throw Error('The installed release receipt is not valid JSON');
  }
  if (
    !record(r) ||
    (r.version !== 1 && r.version !== 2) ||
    r.root !== root ||
    !validOrigin(r.origin) ||
    !hash(r.treeSha256) ||
    !commit(r.installedFrameworkCommit) ||
    typeof r.frameworkContentUnchanged !== 'boolean' ||
    typeof r.artifactPayloadUnchanged !== 'boolean'
  )
    throw Error('The installed release receipt is invalid');
  if (r.version === 2) {
    const t = r.target;
    if (
      !t ||
      !record(t) ||
      typeof t.platform !== 'string' ||
      !/^[a-z0-9_-]{1,32}$/.test(t.platform) ||
      typeof t.arch !== 'string' ||
      !/^[a-z0-9_-]{1,32}$/.test(t.arch) ||
      typeof t.node !== 'string' ||
      !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(t.node) ||
      typeof t.abi !== 'string' ||
      !/^[0-9]{1,8}$/.test(t.abi) ||
      !hash(t.executableSha256) ||
      (t.libc !== null && (typeof t.libc !== 'string' || t.libc.length > 128)) ||
      typeof r.ownerPackage !== 'string' ||
      !path.isAbsolute(r.ownerPackage) ||
      r.ownerPackage.length > 4096 ||
      typeof r.nodeOptions !== 'string' ||
      releaseNodeOptions(r.nodeOptions) !== r.nodeOptions
    )
      throw Error('The installed runtime target is invalid');
  }
  return r;
}

/** Publish complete JSON atomically; readers never observe an empty/partial receipt. */
export async function writeInstalledReleaseReceipt(root: string, receipt: InstalledReleaseReceipt): Promise<void> {
  const io = await import('node:fs/promises'),
    paths = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  const bytes = JSON.stringify(receipt);
  if (Buffer.byteLength(bytes) > 16384) throw Error('Installed release receipt exceeds its size limit');
  const temp = paths.join(paths.dirname(root), '.origin-' + randomUUID());
  try {
    const fd = await io.open(temp, 'wx', 0o600);
    try {
      await fd.writeFile(bytes);
      await fd.sync();
    } finally {
      await fd.close();
    }
    await io.link(temp, paths.join(root, '.omnitron-release.json'));
  } finally {
    await io.unlink(temp).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}
