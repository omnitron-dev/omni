import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import { ExecutionEngine } from '@xec-sh/core';
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

function hostInspectionEngine() {
  return new ExecutionEngine({ defaultShell: false, preferLocal: false, quiet: true, enableEvents: false, retry: { retries: 0 } });
}

export async function serviceGroups(user: string, options: { dedicated?: boolean; directory?: string } = {}) {
  const engine = hostInspectionEngine();
  const signal = AbortSignal.timeout(3000);
  async function inspect(command: '/usr/bin/getent' | '/usr/bin/id' | '/usr/bin/setpriv', args: string[], stdout?: PassThrough) {
    const result = await engine.execute({ adapter: 'local', shell: false, command, args, envMode: 'replace',
      env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' }, signal, timeout: 0, maxBuffer: 1024 * 1024, nothrow: true,
      stdout: stdout ?? 'pipe', redactOutput: false });
    requireEvidence(result.exitCode === 0);
    return result.stdout.trimEnd();
  }
  async function inventory(database: 'group' | 'passwd', accept: (fields: string[]) => boolean) {
    // NSS enumeration can be large. Validate each record while the local utility writes it.
    const output = new PassThrough();
    const records = createInterface({ input: output });
    let valid = true;
    records.on('line', line => { valid &&= accept(line.split(':')); });
    const closed = new Promise<void>(resolve => records.once('close', resolve));
    try { await inspect('/usr/bin/getent', [database], output); }
    finally { output.end(); await closed; }
    requireEvidence(valid);
  }
  async function account(name: string) {
    const [passwd, groups] = await Promise.all([
      inspect('/usr/bin/getent', ['passwd', name]),
      inspect('/usr/bin/id', ['-G', '--', name]),
    ]);
    const [login, , uid, gid, , , shell, ...extra] = passwd.split(':');
    requireEvidence(login === name && uid && gid && /^[1-9]\d*$/.test(uid) && /^[1-9]\d*$/.test(gid) &&
      shell !== undefined && !extra.length);
    requireEvidence(/^\d+( +\d+)*$/.test(groups));
    const memberships = new Set(groups.split(/ +/).map(BigInt));
    requireEvidence(memberships.has(BigInt(gid)));
    return { uid: BigInt(uid), gid: BigInt(gid), memberships };
  }
  try {
    requireEvidence(Object.values(HOST_BINDING_PROFILES).some(profile => profile.user === user));
    const [service, owner] = await Promise.all([account(user), account('omnitron')]);
    requireEvidence(service.uid !== owner.uid && !service.memberships.has(owner.gid) && !owner.memberships.has(service.gid));
    if (options.dedicated) {
      requireEvidence(service.memberships.size === 1);
      const uid = String(service.uid), gid = String(service.gid);
      let groups = 0, users = 0;
      await Promise.all([
        inventory('group', ([name, , id, members]) => {
          if (id !== gid) return true;
          groups++;
          return name === user && members !== undefined && (members === '' || members.split(',').every(member => member === user));
        }),
        inventory('passwd', ([name, , accountUid, accountGid]) => {
          if (name !== user) return accountUid !== uid && accountGid !== gid;
          users++;
          return accountUid === uid && accountGid === gid;
        }),
      ]);
      requireEvidence(groups === 1 && users === 1);
    }
    if (options.directory) {
      const directory = options.directory;
      await Promise.all([service, owner].map(identity => inspect('/usr/bin/setpriv', [
        '--reuid=' + identity.uid, '--regid=' + identity.gid, '--groups=' + [...identity.memberships].join(','),
        '--', '/usr/bin/test', '-x', directory,
      ])));
    }
    return { serviceUid: service.uid, serviceGid: service.gid, readerUid: owner.uid, readerGid: owner.gid };
  } catch { throw Error('The service identity and group could not be verified'); }
  finally { await engine.dispose(); }
}

/** The Linux installer checks ACL metadata. A group mask alone can hide additional named readers. */
export async function requireModeOnly(paths: string[]) {
  requireEvidence(paths.length && paths.every(path => isAbsolute(path) && !path.includes('\0')));
  const engine = hostInspectionEngine();
  try {
    const result = await engine.execute({ command: '/usr/bin/getfattr', adapter: 'local', shell: false,
      args: ['--no-dereference', '--absolute-names', '--match=^system[.]posix_acl_(access|default)$', '--', ...paths],
      envMode: 'replace', env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' }, timeout: 3000, maxBuffer: 16 * 1024, nothrow: true });
    requireEvidence(result.exitCode === 0 && result.stdout === '' && result.stderr === '');
  } catch { throw Error('The private host binding requires a successful Linux getfattr check with no access or default ACL'); }
  finally { await engine.dispose(); }
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
        try { await run('/usr/bin/python3', ['-I', '-S', '-B', '-c', publish, temp, recordPath], { timeout: 3000, env: { LC_ALL: 'C' } }); }
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
