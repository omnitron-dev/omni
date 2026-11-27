import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants, type BigIntStats } from 'node:fs';
import { chmod, link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { withKernelFileLock } from '@xec-sh/ops/utils/file-lock';
import { HOST_BINDING_NAMES, type HostBindingProfile, type HostConfigGrant, type HostConfigReceipt } from '../shared/dto/host-bindings.js';
import { HOST_BINDING_PROFILES } from './host-binding-review.js';
import { attestInstalledHostConfig, hasHostConfigEvidence, hostConfigFileIdentity, privateHostConfigEvidence, requireModeOnly, rootDirectories, serviceGroups, unchangedInstalledHostConfig } from './private-host-config.js';
import { checkGrant, checkHello, checkInstallReceipt, fields, HostConfigFrames, renderInstalledConfigs, required, sameGrant, socketPath,
  type HostConfigHello } from './host-config-transfer.js';

const runtime = '/run/omnitron-host-config';
const storage = '/var/lib/omnitron-host-config-install';
const run = promisify(execFile);
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT';
type Entry = { stage: string; object: string; receipt?: string };
interface Journal { grant: HostConfigGrant; files: Record<string, Entry> }
const objectId = (s: BigIntStats) => [s.dev, s.ino, s.birthtimeNs, s.uid, s.gid, s.mode, s.size, s.mtimeNs].map(String).join('/');

async function entry(path: string) {
  try { return await lstat(path, { bigint: true }); }
  catch (e) { if (missing(e)) return null; throw e; }
}
async function syncDirectory(path: string) {
  const fd = await open(path, constants.O_DIRECTORY | constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function readRootFile(path: string, publicKey: boolean): Promise<string> {
  await rootDirectories(dirname(path));
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat({ bigint: true });
    required(before.isFile() && before.uid === 0n && before.nlink === 1n && before.size > 0n &&
      before.size <= BigInt(publicKey ? 2048 : 16384) &&
      (publicKey ? (before.mode & 0o022n) === 0n && (before.mode & 0o004n) !== 0n : (before.mode & 0o7777n) === 0o600n));
    const data = Buffer.alloc(Number(before.size) + 1);
    const { bytesRead } = await fd.read(data, 0, data.length, 0);
    required(bytesRead === Number(before.size) && hostConfigFileIdentity(before) === hostConfigFileIdentity(await fd.stat({ bigint: true })) &&
      hostConfigFileIdentity(before) === hostConfigFileIdentity(await lstat(path, { bigint: true })));
    return data.toString('utf8', 0, bytesRead);
  } finally { await fd.close(); }
}
async function directory(path: string, mode: number) {
  await rootDirectories(dirname(path));
  try { await mkdir(path, { mode }); await chmod(path, mode); await syncDirectory(dirname(path)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  await rootDirectories(path);
  if (mode === 0o700) required(((await lstat(path)).mode & 0o7777) === mode);
  await requireModeOnly([path]);
}

async function save(journal: Journal) {
  const file = join(storage, journal.grant.ticket + '.json'), temp = file + '.' + randomUUID();
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(journal)); await handle.sync();
    await rename(temp, file); await syncDirectory(storage);
  } finally { await handle.close(); await unlink(temp).catch(e => { if (!missing(e)) throw e; }); }
}

async function journalFor(grant: HostConfigGrant): Promise<Journal | null> {
  const file = join(storage, grant.ticket + '.json');
  const info = await entry(file);
  if (!info) return null;
  required(info.isFile() && info.uid === 0n && info.nlink === 1n && (info.mode & 0o7777n) === 0o600n && info.size <= 16384n);
  const row = JSON.parse(await readRootFile(file, false)) as Journal;
  required(sameGrant(row.grant, grant) && fields(row.files, HOST_BINDING_NAMES));
  for (const profile of HOST_BINDING_NAMES) {
    const f = row.files[profile]!;
    required(typeof f.object === 'string' && /^\.omnitron-config-[a-f0-9-]{36}$/.test(f.stage) && basename(f.stage) === f.stage);
  }
  return row;
}

async function inactive(profile: HostBindingProfile) {
  const unit = HOST_BINDING_PROFILES[profile].unit + '.service';
  let output: string;
  try { output = (await run('/usr/bin/systemctl', ['show', unit, '--all', '--property=LoadState,ActiveState,MainPID,Job'], { timeout: 5000, maxBuffer: 8192 })).stdout; }
  catch (e) {
    const r = e as { code?: number; stdout?: string };
    required(r.code === 4 && typeof r.stdout === 'string'); output = r.stdout;
  }
  const props = Object.fromEntries(output.trim().split('\n').map(line => line.split('=')));
  required(['loaded', 'not-found', 'masked'].includes(props['LoadState']) && props['ActiveState'] === 'inactive' &&
    props['MainPID'] === '0' && Object.hasOwn(props, 'Job') && ['', '0'].includes(props['Job']));
}

async function preflight(grant: HostConfigGrant, journal: Journal | null) {
  const uids = new Set<bigint>(), groups = new Set<bigint>();
  let recovered = false;
  for (const profile of HOST_BINDING_NAMES) {
    const { config, user } = HOST_BINDING_PROFILES[profile];
    await inactive(profile);
    const dir = dirname(config);
    await rootDirectories(dirname(dir));
    const exists = await entry(dir);
    const traversalPath = exists ? dir : dirname(dir);
    if (exists) await rootDirectories(dir);
    // A new directory would inherit its parent's default ACL.
    await requireModeOnly([traversalPath]);
    const account = await serviceGroups(user, { dedicated: true, directory: traversalPath });
    required(!uids.has(account.serviceUid) && !groups.has(account.serviceGid));
    uids.add(account.serviceUid); groups.add(account.serviceGid);
    const current = await entry(config), f = journal?.files[profile];
    if (!f) { required(current === null && !await hasHostConfigEvidence(profile)); continue; }
    if (f.receipt) { await unchangedInstalledHostConfig(profile, f.receipt); continue; }
    const stage = await entry(join(dir, f.stage));
    required((stage || current) && (!stage || (stage.isFile() && objectId(stage) === f.object)) &&
      (!current || (current.isFile() && objectId(current) === f.object)) &&
      (stage ?? current)!.nlink === BigInt(stage && current ? 2 : 1));
    if (await hasHostConfigEvidence(profile)) {
      required(current && !stage);
      f.receipt = await unchangedInstalledHostConfig(profile); // proof is durable, journal update may have been interrupted
      recovered = true;
    }
  }
  if (journal && recovered) await save(journal);
  if (journal && HOST_BINDING_NAMES.every(n => journal.files[n]!.receipt)) {
    return checkInstallReceipt({ protocol: 1, ...grant, files: HOST_BINDING_NAMES.map(profile => ({ profile, receipt: journal.files[profile]!.receipt! })) }, grant);
  }
  return null;
}

async function prepare(grant: HostConfigGrant, contents: Record<string, string>, remaining: () => void) {
  const journal: Journal = { grant, files: {} };
  const created: Array<{ path: string; dev: bigint; ino: bigint; birth: bigint }> = [];
  try {
    for (const name of HOST_BINDING_NAMES) {
      const { config, user } = HOST_BINDING_PROFILES[name], dir = dirname(config);
      remaining();
      await directory(dir, 0o711);
      const { serviceGid } = await serviceGroups(user, { dedicated: true, directory: dir });
      const stage = '.omnitron-config-' + randomUUID(), path = join(dir, stage);
      remaining();
      const fd = await open(path, 'wx', 0o600);
      try {
        const initial = await fd.stat({ bigint: true });
        created.push({ path, dev: initial.dev, ino: initial.ino, birth: initial.birthtimeNs });
        await fd.writeFile(contents[name]!); await fd.chown(0, Number(serviceGid)); await fd.chmod(0o640); await fd.sync();
        await requireModeOnly([path]);
        journal.files[name] = { stage, object: objectId(await fd.stat({ bigint: true })) };
      } finally { await fd.close(); }
      await syncDirectory(dir);
    }
    await save(journal);
    return journal;
  } catch (error) {
    // If the durable journal exists, its stage belongs to recovery even if directory fsync failed.
    if (!(await entry(join(storage, grant.ticket + '.json')))) for (const stage of created) {
      const s = await entry(stage.path);
      if (s?.dev === stage.dev && s.ino === stage.ino && s.birthtimeNs === stage.birth) await unlink(stage.path);
    }
    throw error;
  }
}

async function confirmBytes(path: string, id: string, expected: string) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat({ bigint: true });
    required(before.isFile() && objectId(before) === id && before.size === BigInt(Buffer.byteLength(expected)) && before.size <= 131072n);
    const bytes = await fd.readFile();
    try { required(bytes.equals(Buffer.from(expected))); } finally { bytes.fill(0); }
    const identity = hostConfigFileIdentity(before);
    required(hostConfigFileIdentity(await fd.stat({ bigint: true })) === identity &&
      hostConfigFileIdentity(await lstat(path, { bigint: true })) === identity);
  } finally { await fd.close(); }
}

async function publish(grant: HostConfigGrant, journal: Journal, contents: Record<string, string>, remaining: () => void) {
  // Check every source and occupied destination before the first publication on a retry.
  await preflight(grant, journal);
  for (const name of HOST_BINDING_NAMES) {
    const f = journal.files[name]!, binding = HOST_BINDING_PROFILES[name];
    const stage = join(dirname(binding.config), f.stage);
    if (f.receipt || await hasHostConfigEvidence(name)) {
      const seen = await privateHostConfigEvidence({ name, user: binding.user, systemdUnit: binding.unit,
        configFile: binding.config, configContent: contents[name]! });
      required(seen?.state === 'verified-private' && (!f.receipt || seen.receipt === f.receipt));
    } else await confirmBytes(await entry(stage) ? stage : binding.config, f.object, contents[name]!);
  }
  for (const name of HOST_BINDING_NAMES) {
    const f = journal.files[name]!, { config } = HOST_BINDING_PROFILES[name], dir = dirname(config);
    if (f.receipt) continue;
    remaining(); await inactive(name); remaining();
    const stage = join(dir, f.stage);
    if (!await entry(config)) await link(stage, config); // exclusive publication, also across interrupted retries
    await confirmBytes(config, f.object, contents[name]!);
    if (await entry(stage)) { required(objectId((await entry(stage))!) === f.object); await unlink(stage); }
    await syncDirectory(dir);
    const installed = await lstat(config, { bigint: true });
    required(installed.nlink === 1n && objectId(installed) === f.object);
    const bytes = Buffer.from(contents[name]!);
    try { f.receipt = (await attestInstalledHostConfig(name, { stamp: hostConfigFileIdentity(installed), bytes })).receipt; }
    finally { bytes.fill(0); }
    await save(journal);
  }
  const receipt = await preflight(grant, journal); required(receipt); return receipt;
}

async function handleInstallRequest(socket: Socket, grant: HostConfigGrant, expires: number) {
  const remaining = () => required(Date.now() < expires);
  const frames = new HostConfigFrames(socket);
  const hello: HostConfigHello = await frames.read(); checkHello(hello, grant); remaining();
  const [kind, publicKey] = (await readRootFile('/etc/ssh/ssh_host_ed25519_key.pub', true)).trim().split(/\s+/);
  required(kind === 'ssh-ed25519' && publicKey && 'SHA256:' + createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('base64').replace(/=+$/, '') === hello.review.sshFingerprint);
  let journal = await journalFor(grant);
  const done = await preflight(grant, journal);
  if (done) { await frames.send({ done }); return done; }
  const nonce = randomUUID();
  remaining(); await frames.send({ ...grant, nonce, expires });
  const message = await frames.read();
  required(fields(message, ['nonce', 'values']) && message['nonce'] === nonce);
  const contents = renderInstalledConfigs(hello, message['values']);
  remaining(); await preflight(grant, journal);
  remaining(); journal ??= await prepare(grant, contents, remaining); remaining();
  const receipt = await publish(grant, journal, contents, remaining);
  await frames.send({ done: receipt });
  return receipt;
}

/** One operator-issued root socket, fixed schemas, one connection, a bounded lease. */
export async function receiveHostConfigs(grant: HostConfigGrant, expires: number): Promise<HostConfigReceipt> {
  checkGrant(grant);
  required(process.platform === 'linux' && process.getuid?.() === 0 && process.geteuid?.() === 0 &&
    Number.isSafeInteger(expires) && expires > Date.now() && expires <= Date.now() + 600000);
  await directory(runtime, 0o700); await directory(storage, 0o700);
  return withKernelFileLock(join(storage, 'installation.lock'), async () => {
    required(Date.now() < expires);
    const path = socketPath(grant.ticket), stale = await entry(path);
    if (stale) { required(stale.isSocket() && stale.uid === 0n); await unlink(path); } // global kernel lock proves the previous receiver exited
    const server = createServer();
    let client: Socket | undefined;
    try {
      return await new Promise<HostConfigReceipt>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (client) client.destroy();
          else reject(Error('Host configuration authorization expired'));
        }, expires - Date.now());
        server.once('error', () => { clearTimeout(timer); reject(Error('Host configuration listener unavailable')); });
        server.on('connection', socket => {
          if (client) { socket.destroy(); return; }
          client = socket; socket.on('error', () => {});
          handleInstallRequest(socket, grant, expires).then(resolve, () => reject(Error('Authorized host configuration installation did not complete')))
            .finally(() => { clearTimeout(timer); socket.destroySoon(); });
        });
        server.listen(path);
      });
    } finally {
      client?.destroySoon();
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 2);
}
