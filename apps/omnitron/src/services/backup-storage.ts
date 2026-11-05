import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { create, extract, list } from 'tar';
import { dumpToFile, restoreFromFile } from './backup-pipeline.js';

export interface StorageBackupTarget {
  /** An inspected immutable container ID, never a name that can be reassigned. */
  container: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export function validateStorageBucket(bucket: unknown): asserts bucket is string {
  if (typeof bucket !== 'string' || bucket.length < 3 || bucket.length > 63 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) || /\.\.|\.-|-\./.test(bucket) || /^\d+\.\d+\.\d+\.\d+$/.test(bucket))
    throw new Error('A storage backup requires an explicit valid S3 bucket name');
}

/** Bounded argv execution: credentials are environment values, never shell text or argv. */
async function command(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile('docker', args, { env: { ...process.env, ...env }, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) { resolve(stdout); return; }
      let detail = String(stderr || error.message).slice(0, 4096);
      for (const value of [env?.['MC_AK'], env?.['MC_SK']]) if (value) detail = detail.split(value).join('[redacted]');
      reject(new Error(`Storage backup command failed: ${detail}`));
    });
  });
}

const initialize = 'set -eu; umask 077; mkdir "$OMNI_BACKUP_STAGE"; ' +
  'export MC_CONFIG_DIR="$OMNI_BACKUP_STAGE/config"; ' +
  'mc alias set omniBackup http://localhost:9000 "$MC_AK" "$MC_SK" >/dev/null; ';

function inventory(data: string): Array<{ key: string; size: number; etag: string }> {
  if (Buffer.byteLength(data) > 16 * 1024 * 1024) throw new Error('Storage inventory exceeds the 16 MiB backup limit');
  const records: Array<{ key: string; size: number; etag: string }> = [];
  const names = new Set<string>();
  for (const line of data.split('\n').filter(Boolean)) {
    const item = JSON.parse(line) as Record<string, unknown>;
    const key = item['key'], size = item['size'], etag = item['etag'];
    // mc normalizes object names. Refuse keyspaces a filesystem mirror cannot represent losslessly.
    if (item['status'] !== 'success' || item['type'] !== 'file' || typeof key !== 'string' || !key ||
      key.includes('\\') || [...key].some(character => character.charCodeAt(0) < 32) || key.startsWith('/') || key.endsWith('/') ||
      key.split('/').some(part => !part || part === '.' || part === '..') ||
      typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || typeof etag !== 'string' || !etag)
      throw new Error('Storage contains an unsupported object key or unreadable inventory entry');
    const normalized = key.normalize('NFC').toLowerCase();
    if (names.has(normalized)) throw new Error('Storage object names collide on a portable filesystem');
    names.add(normalized); records.push({ key, size, etag });
  }
  for (const key of names) {
    for (let parent = path.posix.dirname(key); parent !== '.'; parent = path.posix.dirname(parent))
      if (names.has(parent)) throw new Error('Storage object is also a directory prefix; cannot mirror it losslessly');
  }
  return records.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

async function listInventory(target: StorageBackupTarget, remote: string) {
  return inventory(await inContainer(target, remote, 'set -eu; export MC_CONFIG_DIR="$OMNI_BACKUP_STAGE/config"; ' +
    'mc ls --recursive --json "omniBackup/$MC_BUCKET"'));
}

/** Settle every started transfer before releasing its shared credential directory. */
async function transferObjects<T>(objects: T[], transfer: (object: T) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < objects.length; offset += 4) {
    const results = await Promise.allSettled(objects.slice(offset, offset + 4).map(transfer));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}

function objectCommand(target: StorageBackupTarget, remote: string, operation: 'cat' | 'pipe', key: string) {
  return { args: ['exec', ...(operation === 'pipe' ? ['-i'] : []), '-e', 'MC_CONFIG_DIR',
    target.container, 'mc', operation, `omniBackup/${target.bucket}/${key}`],
  options: { env: { ...process.env, MC_CONFIG_DIR: `${remote}/config` } } };
}

async function verifyMirroredKeys(directory: string, objects: Array<{ key: string; size: number }>): Promise<void> {
  const remaining = new Map(objects.map(item => [item.key, item.size]));
  const visit = async (folder: string) => {
    for (const name of await fs.readdir(path.join(directory, folder))) {
      const relative = folder ? folder + '/' + name : name;
      const stat = await fs.lstat(path.join(directory, relative));
      if (stat.isDirectory()) await visit(relative);
      else if (!stat.isFile() || stat.nlink !== 1 || remaining.get(relative) !== stat.size)
        throw new Error('Mirrored object names or sizes differ from the source inventory');
      else remaining.delete(relative);
    }
  };
  await visit('');
  if (remaining.size) throw new Error('Storage mirror omitted objects from the source inventory');
}

async function inContainer(target: StorageBackupTarget, remote: string, script: string): Promise<string> {
  return command(['exec', '-e', 'MC_AK', '-e', 'MC_SK', '-e', 'MC_BUCKET', '-e', 'OMNI_BACKUP_STAGE',
    target.container, 'sh', '-c', script], {
    MC_AK: target.accessKey, MC_SK: target.secretKey, MC_BUCKET: target.bucket, OMNI_BACKUP_STAGE: remote,
  });
}

/** Validate every entry before extracting: object backups contain only regular files and directories. */
export async function validateStorageArchive(file: string): Promise<void> {
  let invalid: string | undefined;
  let entries = 0;
  await list({ file, strict: true, onReadEntry(entry) {
    const name = entry.path.replace(/\/$/, '');
    if (++entries > 1_000_000 || !['File', 'Directory'].includes(entry.type) || name.includes('\\') || name.includes('\0') ||
      name.split('/').some(part => !part || part === '.' || part === '..') ||
      (name !== '_bk_storage' && !name.startsWith('_bk_storage/')) ||
      !Number.isSafeInteger(entry.size) || entry.size < 0)
      invalid ??= `Invalid storage backup archive member: ${entry.path}`;
  } });
  if (invalid) throw new Error(invalid);
  if (!entries) throw new Error('Storage backup archive is empty');
}

async function withStorageStage<T>(target: StorageBackupTarget, directory: string, mode: 'stage' | 'restore',
  work: (local: string, remote: string) => Promise<T>): Promise<T> {
  validateStorageBucket(target.bucket);
  if (!/^[a-f0-9]{64}$/.test(target.container)) throw new Error('Storage backup requires an immutable container identity');
  if (!target.accessKey || !target.secretKey) throw new Error('Storage backup credentials are unavailable');
  const token = randomUUID();
  const local = path.join(directory, `.storage-${mode}-${token.slice(0, 8)}`);
  const remote = `/tmp/omnitron-backup-${token}`;
  await fs.mkdir(local, { mode: 0o700 });
  const outcome = await work(local, remote).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  // Every operation owns its paths. Concurrent passes cannot delete one another's snapshot.
  const cleanup = await Promise.allSettled([
    command(['exec', target.container, 'rm', '-rf', remote]), fs.rm(local, { recursive: true, force: true }),
  ]);
  if (!outcome.ok) throw outcome.error;
  if (cleanup.some(result => result.status === 'rejected'))
    throw new Error('Storage backup data transfer finished, but temporary snapshot cleanup is unconfirmed');
  return outcome.value;
}

/** Current object contents only; this is not a versioned-volume or cross-service transaction snapshot. */
export async function backupStorageObjects(target: StorageBackupTarget, destination: string): Promise<void> {
  const partial = destination + '.partial';
  try {
    await withStorageStage(target, path.dirname(destination), 'stage', async (local, remote) => {
      await inContainer(target, remote, initialize + 'mc stat "omniBackup/$MC_BUCKET" >/dev/null');
      const before = await listInventory(target, remote);
      await fs.mkdir(path.join(local, '_bk_storage'));
      // Stream through the common backup pipeline. Docker cp cannot read tmpfs mounts.
      await transferObjects(before, async object => {
        const objectFile = path.join(local, '_bk_storage', object.key);
        await fs.mkdir(path.dirname(objectFile), { recursive: true });
        const { args, options } = objectCommand(target, remote, 'cat', object.key);
        await dumpToFile('docker', args, objectFile, false, options);
      });
      await verifyMirroredKeys(path.join(local, '_bk_storage'), before);
      if (JSON.stringify(before) !== JSON.stringify(await listInventory(target, remote)))
        throw new Error('Storage changed during the snapshot; quiesce writers and retry');
      await create({ file: partial, cwd: local, gzip: true, strict: true, portable: true }, ['_bk_storage']);
      await fs.chmod(partial, 0o600);
      await validateStorageArchive(partial);
    });
    await fs.rename(partial, destination);
  } catch (error) { await fs.rm(partial, { force: true }); throw error; }
}

export async function restoreStorageObjects(target: StorageBackupTarget, file: string): Promise<void> {
  await withStorageStage(target, path.dirname(file), 'restore', async (local, remote) => {
    // Validate and extract the same private copy even if the caller replaces its input path.
    const snapshot = path.join(local, 'snapshot.tar.gz');
    await fs.copyFile(file, snapshot); await fs.chmod(snapshot, 0o600);
    await validateStorageArchive(snapshot);
    await extract({ file: snapshot, cwd: local, strict: true, preserveOwner: false });
    if (!(await fs.lstat(path.join(local, '_bk_storage'))).isDirectory()) throw new Error('Storage backup has no object directory');
    await inContainer(target, remote, initialize + 'mc stat "omniBackup/$MC_BUCKET" >/dev/null');
    const files: string[] = [];
    const visit = async (folder: string) => {
      for (const name of await fs.readdir(path.join(local, '_bk_storage', folder))) {
        const key = folder ? folder + '/' + name : name;
        if ((await fs.lstat(path.join(local, '_bk_storage', key))).isDirectory()) await visit(key);
        else files.push(key);
      }
    };
    await visit('');
    await transferObjects(files, async key => {
      const { args, options } = objectCommand(target, remote, 'pipe', key);
      await restoreFromFile('docker', args, path.join(local, '_bk_storage', key), false, options);
    });
  });
}
