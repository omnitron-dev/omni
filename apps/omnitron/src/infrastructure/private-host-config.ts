import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { OMNITRON_CONFIG_MARKER, withMarker, type BareMetalSpec } from './bare-metal-plan.js';
import { HOST_BINDING_PROFILES, type HostBindingProfile } from './host-binding-review.js';

const DIRECTORY = '/var/lib/omnitron-host-config-proofs';
const READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const MAX_CONFIG = 128 * 1024;
const profiles = Object.keys(HOST_BINDING_PROFILES) as HostBindingProfile[];
const run = promisify(execFile);

export type PrivateConfigEvidence = { state: 'verified-private'; receipt: string } | { state: 'unreadable' };
const unreadable = { state: 'unreadable' } as const;
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
function requireEvidence(ok: unknown): asserts ok {
  if (!ok) throw Error('The private host configuration or its installer evidence could not be verified');
}

async function rootDirectories(path: string): Promise<void> {
  if (path !== '/') await rootDirectories(dirname(path));
  const s = await lstat(path, { bigint: true });
  requireEvidence(s.isDirectory() && s.uid === 0n && (s.mode & 0o022n) === 0n);
}

async function systemId(user: string, field: '-u' | '-g'): Promise<bigint> {
  const { stdout } = await run('/usr/bin/id', [field, user], { encoding: 'utf8', timeout: 3000 });
  requireEvidence(/^[1-9][0-9]*$/.test(stdout.trim()));
  return BigInt(stdout.trim());
}

async function groupIds(user: string) {
  const { stdout } = await run('/usr/bin/id', ['-G', user], { encoding: 'utf8', timeout: 3000 });
  requireEvidence(/^\d+(?:\s+\d+)*$/.test(stdout.trim()));
  return stdout.trim().split(/\s+/).map(BigInt);
}

async function serviceGroups(user: string) {
  const [serviceUid, readerUid, serviceGid, readerGid, serviceGroups, readerGroups] = await Promise.all([
    systemId(user, '-u'), systemId('omnitron', '-u'), systemId(user, '-g'), systemId('omnitron', '-g'),
    groupIds(user), groupIds('omnitron'),
  ]);
  requireEvidence(serviceUid !== readerUid && !serviceGroups.includes(readerGid) && !readerGroups.includes(serviceGid));
  return { serviceGid, readerGid, readerUid };
}

/** The Linux installer checks ACL metadata. A group mask alone can hide additional named readers. */
async function requireModeOnly(paths: string[]) {
  const check = 'import os,sys\n' +
    'sys.exit(any(set(os.listxattr(p, follow_symlinks=False)) & {"system.posix_acl_access","system.posix_acl_default"} for p in sys.argv[1:]))';
  try { await run('/usr/bin/python3', ['-I', '-c', check, ...paths], { timeout: 3000 }); }
  catch { throw Error('The private host binding access policy could not be verified'); }
}

/** Linux ctime also changes on in-place writes, permission changes and link changes. */
function identity(s: BigIntStats) {
  return [s.dev, s.ino, s.uid, s.gid, s.mode, s.nlink, s.size, s.birthtimeNs, s.mtimeNs, s.ctimeNs].map(String).join('/');
}

function ordinary(s: BigIntStats, gid: bigint, mode: bigint, limit: number) {
  return s.isFile() && s.uid === 0n && s.gid === gid && (s.mode & 0o7777n) === mode &&
    s.nlink === 1n && s.size > 0n && s.size <= BigInt(limit);
}

async function readPinned(path: string, gid: bigint, mode: bigint, limit: number) {
  await rootDirectories(dirname(path));
  const handle = await open(path, READ);
  try {
    const before = await handle.stat({ bigint: true });
    requireEvidence(ordinary(before, gid, mode, limit));
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const stamp = identity(before);
    requireEvidence(offset === Number(before.size) && stamp === identity(await handle.stat({ bigint: true })) &&
      stamp === identity(await lstat(path, { bigint: true })));
    return { bytes: bytes.subarray(0, offset), stamp };
  } finally { await handle.close(); }
}

function tag(key: Buffer, profile: HostBindingProfile, stamp: string, bytes: Buffer) {
  return createHmac('sha256', key)
    .update(JSON.stringify([1, profile, HOST_BINDING_PROFILES[profile].config, stamp])).update('\0').update(bytes).digest();
}

function receiptFor(profile: HostBindingProfile, stamp: string) {
  return createHash('sha256').update(JSON.stringify([1, profile, stamp])).digest('hex');
}

function matches(record: Buffer, profile: HostBindingProfile, stamp: string, content: Buffer): boolean {
  const row = JSON.parse(record.toString('utf8'));
  if (row?.protocol !== 1 || row.profile !== profile || row.path !== HOST_BINDING_PROFILES[profile].config ||
      row.stamp !== stamp || row.receipt !== receiptFor(profile, stamp) ||
      typeof row.key !== 'string' || !/^[0-9a-f]{64}$/.test(row.key) ||
      typeof row.tag !== 'string' || !/^[0-9a-f]{64}$/.test(row.tag)) return false;
  const key = Buffer.from(row.key, 'hex');
  try { return timingSafeEqual(tag(key, profile, stamp, content), Buffer.from(row.tag, 'hex')); }
  finally { key.fill(0); }
}

/** Local installer entry point. Neither paths, group IDs, secret selectors nor content come from a caller. */
export async function attestInstalledHostConfig(name: string) {
  requireEvidence(process.platform === 'linux' && process.getuid?.() === 0 && process.geteuid?.() === 0 && Object.hasOwn(HOST_BINDING_PROFILES, name));
  const profile = name as HostBindingProfile;
  const config = HOST_BINDING_PROFILES[profile];
  const { serviceGid, readerGid } = await serviceGroups(config.user);
  const file = await readPinned(config.config, serviceGid, 0o640n, MAX_CONFIG);
  try {
    requireEvidence(file.bytes.subarray(0, OMNITRON_CONFIG_MARKER.length + 1).equals(Buffer.from(OMNITRON_CONFIG_MARKER + '\n')));
    await rootDirectories(dirname(DIRECTORY));
    try { await mkdir(DIRECTORY, { mode: 0o711 }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err; }
    await rootDirectories(DIRECTORY);
    await requireModeOnly([config.config, DIRECTORY]);
    const directoryMode = (await lstat(DIRECTORY)).mode & 0o7777;
    if (directoryMode !== 0o711) {
      // Finish creation after a restrictive installer umask, without broadening access to an existing collection.
      requireEvidence((directoryMode & ~0o711) === 0 && (await readdir(DIRECTORY)).length === 0);
      await chmod(DIRECTORY, 0o711);
    }
    const receipt = receiptFor(profile, file.stamp);
    const result = { protocol: 1, profile, path: config.config, receipt };
    const recordPath = join(DIRECTORY, profile + '.json');
    try {
      const existing = await readPinned(recordPath, readerGid, 0o440n, 4096);
      await requireModeOnly([recordPath]);
      if (matches(existing.bytes, profile, file.stamp, file.bytes)) {
        requireEvidence(file.stamp === identity(await lstat(config.config, { bigint: true })) &&
          existing.stamp === identity(await lstat(recordPath, { bigint: true })));
        return result;
      }
    } catch (err) { if (!absent(err)) throw err; }
    const cookie = randomBytes(32);
    const record = { protocol: 1, receipt, profile, path: config.config, stamp: file.stamp,
      key: cookie.toString('hex'), tag: tag(cookie, profile, file.stamp, file.bytes).toString('hex') };
    const temp = join(DIRECTORY, '.' + randomUUID());
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(record));
      await handle.chown(0, Number(readerGid));
      await handle.chmod(0o440);
      await handle.sync();
      requireEvidence(file.stamp === identity(await lstat(config.config, { bigint: true })));
      await rename(temp, recordPath);
      const directory = await open(DIRECTORY, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      await handle.close();
      await unlink(temp).catch(err => { if (!absent(err)) throw err; });
      cookie.fill(0);
    }
    return result;
  } finally { file.bytes.fill(0); }
}

/** A verifier reads only the root-issued private record and metadata of the installed config. */
export async function privateHostConfigEvidence(spec: BareMetalSpec): Promise<PrivateConfigEvidence | null> {
  if (process.platform !== 'linux' || !spec.configFile) return null;
  const profile = profiles.find(name => HOST_BINDING_PROFILES[name].config === spec.configFile);
  if (!profile) return null;
  const recordPath = join(DIRECTORY, profile + '.json');
  try {
    // ENOENT establishes absence only inside verified directories. A dangling receipt never disappears through a read.
    try { await rootDirectories(DIRECTORY); await lstat(recordPath); }
    catch (err) { if (absent(err)) return null; throw err; }
    const config = HOST_BINDING_PROFILES[profile];
    if (spec.name !== profile || spec.user !== config.user || spec.systemdUnit?.replace(/\.service$/, '') !== config.unit ||
        spec.configContent === undefined || spec.unresolved?.length) return unreadable;
    const { serviceGid, readerGid, readerUid } = await serviceGroups(config.user);
    const effective = process.geteuid?.();
    requireEvidence(process.getuid?.() === effective && (effective === 0 ||
      (effective === Number(readerUid) && !process.getgroups?.().includes(Number(serviceGid)))));
    const proof = await readPinned(recordPath, readerGid, 0o440n, 4096);
    await requireModeOnly([DIRECTORY, recordPath]);
    await rootDirectories(dirname(config.config));
    const installed = await lstat(config.config, { bigint: true });
    requireEvidence(ordinary(installed, serviceGid, 0o640n, MAX_CONFIG));
    const stamp = identity(installed);
    const expected = Buffer.from(withMarker(spec.configContent));
    try { requireEvidence(matches(proof.bytes, profile, stamp, expected)); }
    finally { expected.fill(0); }
    requireEvidence(proof.stamp === identity(await lstat(recordPath, { bigint: true })) &&
      stamp === identity(await lstat(config.config, { bigint: true })));
    return { state: 'verified-private', receipt: receiptFor(profile, stamp) };
  } catch { return unreadable; }
}
