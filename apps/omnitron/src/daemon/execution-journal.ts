import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ControllerGrant, ExecutionOwnerIdentity } from '@omnitron-dev/titan-pm';

export interface ExecutionJournalRecord {
  protocol: 1;
  owner: ExecutionOwnerIdentity;
  grant: ControllerGrant;
}

/** An owner writes its fence durably before a new backend may mutate anything. */
export class ExecutionJournal {
  constructor(readonly file: string) {}

  async read(): Promise<ExecutionJournalRecord | null> {
    const record = await readPrivateRecord<ExecutionJournalRecord>(this.file);
    if (!record) return null;
    if (record.protocol !== 1 || !record.owner?.id || !Number.isSafeInteger(record.owner.pid) || record.owner.pid < 1 ||
        !Number.isFinite(Date.parse(record.owner.startedAt)) || record.grant?.ownerId !== record.owner.id ||
        !record.grant.controllerId || !Number.isSafeInteger(record.grant.epoch) || record.grant.epoch < 1) {
      throw new Error('Invalid execution journal; automatic takeover is refused');
    }
    return record;
  }

  async write(record: ExecutionJournalRecord): Promise<void> {
    await writePrivateRecord(this.file, record);
  }
}

export async function readPrivateRecord<T>(file: string): Promise<T | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())) throw new Error('Controller record must be a private regular file owned by this user');
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writePrivateRecord(file: string, record: unknown): Promise<void> {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) throw new Error('Execution directory must be private and owned by this user');
  const temporary = path.join(directory, `.grant-${randomUUID()}`);
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(record));
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, file);
    const parent = await fs.open(directory, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally {
    await fs.unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}
