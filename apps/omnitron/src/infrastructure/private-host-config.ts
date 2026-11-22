import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { OMNITRON_CONFIG_MARKER, withMarker, type BareMetalSpec } from './bare-metal-plan.js';
import { HOST_BINDING_NAMES, type HostBindingProfile } from '../shared/dto/host-bindings.js';
import { HOST_BINDING_PROFILES } from './host-binding-review.js';

const DIRECTORY = '/var/lib/omnitron-host-config-proofs';
const READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const MAX_CONFIG = 128 * 1024;
const run = promisify(execFile);

export type PrivateConfigEvidence = { state: 'verified-private'; receipt: string } | { state: 'unreadable' };
const unreadable = { state: 'unreadable' } as const;
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
function requireEvidence(ok: unknown): asserts ok {
  if (!ok) throw Error('The private host configuration or its installer evidence could not be verified');
}

export async function rootDirectories(path: string): Promise<void> {
  if (path !== '/') await rootDirectories(dirname(path));
  const s = await lstat(path, { bigint: true });
  requireEvidence(s.isDirectory() && s.uid === 0n && (s.mode & 0o022n) === 0n);
}

export async function serviceGroups(user: string, options: { dedicated?: boolean; directory?: string } = {}) {
  const check = [
    'import grp,os,pwd,sys',
    's=pwd.getpwnam(sys.argv[1]); r=pwd.getpwnam("omnitron")',
    'sg=set(os.getgrouplist(s.pw_name,s.pw_gid)); rg=set(os.getgrouplist(r.pw_name,r.pw_gid))',
    'if s.pw_uid == r.pw_uid or r.pw_gid in sg or s.pw_gid in rg: sys.exit(1)',
    'if sys.argv[2] == "dedicated":',
    ' group=grp.getgrgid(s.pw_gid)',
    ' if sg != {s.pw_gid} or group.gr_name != s.pw_name or any(m != s.pw_name for m in group.gr_mem): sys.exit(1)',
    ' if any(p.pw_name != s.pw_name and (p.pw_gid == s.pw_gid or p.pw_uid == s.pw_uid) for p in pwd.getpwall()): sys.exit(1)',
    'if sys.argv[3]:',
    ' for account in (s,r):',
    '  child=os.fork()',
    '  if child == 0:',
    '   try:',
    '    os.initgroups(account.pw_name,account.pw_gid); os.setgid(account.pw_gid); os.setuid(account.pw_uid)',
    '    os._exit(0 if os.access(sys.argv[3],os.X_OK) else 1)',
    '   except OSError: os._exit(1)',
    '  if os.waitpid(child,0)[1] != 0: sys.exit(1)',
    'print(s.pw_uid,s.pw_gid,r.pw_uid,r.pw_gid)',
  ].join('\n');
  let output: string;
  try { output = (await run('/usr/bin/python3', ['-I', '-c', check, user, options.dedicated ? 'dedicated' : 'separate', options.directory ?? ''], { timeout: 3000 })).stdout.trim(); }
  catch { throw Error('The service identity and group could not be verified'); }
  requireEvidence(/^[1-9]\d*( [1-9]\d*){3}$/.test(output));
  const [serviceUid, serviceGid, readerUid, readerGid] = output.split(' ').map(BigInt) as [bigint, bigint, bigint, bigint];
  return { serviceUid, serviceGid, readerUid, readerGid };
}

/** The Linux installer checks ACL metadata. A group mask alone can hide additional named readers. */
export async function requireModeOnly(paths: string[]) {
  const check = 'import os,sys\n' +
    'sys.exit(any(set(os.listxattr(p, follow_symlinks=False)) & {"system.posix_acl_access","system.posix_acl_default"} for p in sys.argv[1:]))';
  try { await run('/usr/bin/python3', ['-I', '-c', check, ...paths], { timeout: 3000 }); }
  catch { throw Error('The private host binding access policy could not be verified'); }
}

/** Linux ctime also changes on in-place writes, permission changes and link changes. */
export function hostConfigFileIdentity(s: BigIntStats) {
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
    const stamp = hostConfigFileIdentity(before);
    requireEvidence(offset === Number(before.size) && stamp === hostConfigFileIdentity(await handle.stat({ bigint: true })) &&
      stamp === hostConfigFileIdentity(await lstat(path, { bigint: true })));
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
export async function attestInstalledHostConfig(name: string, expected?: { stamp: string; bytes: Buffer }) {
  requireEvidence(process.platform === 'linux' && process.getuid?.() === 0 && process.geteuid?.() === 0 && Object.hasOwn(HOST_BINDING_PROFILES, name));
  const profile = name as HostBindingProfile;
  const config = HOST_BINDING_PROFILES[profile];
  const { serviceGid, readerGid } = await serviceGroups(config.user, { directory: dirname(config.config) });
  const file = await readPinned(config.config, serviceGid, 0o640n, MAX_CONFIG);
  try {
    if (expected) requireEvidence(file.stamp === expected.stamp && file.bytes.equals(expected.bytes));
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
        requireEvidence(file.stamp === hostConfigFileIdentity(await lstat(config.config, { bigint: true })) &&
          existing.stamp === hostConfigFileIdentity(await lstat(recordPath, { bigint: true })));
        return result;
      }
      requireEvidence(!expected); // Only the separately authorized attest command can rotate evidence.
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
      requireEvidence(file.stamp === hostConfigFileIdentity(await lstat(config.config, { bigint: true })));
      if (expected) {
        // A concurrent explicit attestation can occupy the path after the check above.
        const publish = 'import ctypes,os,sys\n' +
          'sys.exit(ctypes.CDLL(None).renameat2(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 1) != 0)';
        try { await run('/usr/bin/python3', ['-I', '-c', publish, temp, recordPath], { timeout: 3000 }); }
        catch { throw Error('Initial private configuration evidence could not be published exclusively'); }
      } else await rename(temp, recordPath);
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
  const profile = HOST_BINDING_NAMES.find(name => HOST_BINDING_PROFILES[name].config === spec.configFile);
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
    const stamp = hostConfigFileIdentity(installed);
    const expected = Buffer.from(withMarker(spec.configContent));
    try { requireEvidence(matches(proof.bytes, profile, stamp, expected)); }
    finally { expected.fill(0); }
    requireEvidence(proof.stamp === hostConfigFileIdentity(await lstat(recordPath, { bigint: true })) &&
      stamp === hostConfigFileIdentity(await lstat(config.config, { bigint: true })));
    return { state: 'verified-private', receipt: receiptFor(profile, stamp) };
  } catch { return unreadable; }
}

export async function hasHostConfigEvidence(profile: HostBindingProfile) {
  try { await rootDirectories(DIRECTORY); await lstat(join(DIRECTORY, profile + '.json')); return true; }
  catch (err) { if (absent(err)) return false; throw err; }
}

/** Reconcile a lost install acknowledgement without resolving any vault value again. */
export async function unchangedInstalledHostConfig(profile: HostBindingProfile, expectedReceipt?: string) {
  requireEvidence(process.platform === 'linux' && process.getuid?.() === 0 && process.geteuid?.() === 0);
  const binding = HOST_BINDING_PROFILES[profile];
  await rootDirectories(dirname(binding.config));
  const current = hostConfigFileIdentity(await lstat(binding.config, { bigint: true }));
  const receipt = receiptFor(profile, current);
  requireEvidence(expectedReceipt === undefined || expectedReceipt === receipt);
  const { serviceGid } = await serviceGroups(binding.user);
  const file = await readPinned(binding.config, serviceGid, 0o640n, MAX_CONFIG);
  try {
    const evidence = await privateHostConfigEvidence({ name: profile, user: binding.user, systemdUnit: binding.unit,
      configFile: binding.config, configContent: file.bytes.toString('utf8') });
    requireEvidence(file.stamp === current && evidence?.state === 'verified-private' && evidence.receipt === receipt);
    return receipt;
  } finally { file.bytes.fill(0); }
}
