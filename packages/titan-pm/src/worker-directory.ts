import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function workerDirectory(configured?: string): string {
  if (configured) return resolve(configured);
  const uid = process.geteuid?.();
  return join(tmpdir(), uid === undefined ? 'titan-pm' : `titan-pm-${uid}`);
}

/** Establish ownership before allowing a child to place its management socket here. */
export async function prepareWorkerDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const entry = await lstat(path);
  if (!entry.isDirectory()) throw new Error(`Worker directory must be a physical directory: ${path}`);

  const uid = process.geteuid?.();
  if (uid === undefined) return;
  if (entry.uid !== uid) throw new Error(`Worker directory ${path} belongs to UID ${entry.uid} (expected UID ${uid})`);

  const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const actual = await directory.stat();
    if (actual.dev !== entry.dev || actual.ino !== entry.ino || actual.uid !== uid) {
      throw new Error(`Worker directory changed during startup: ${path}`);
    }
    if (actual.mode & 0o1000) throw new Error(`Choose a private worker directory under ${path}`);
    if ((actual.mode & 0o7777) !== 0o700) await directory.chmod(0o700);
  } finally {
    await directory.close();
  }
}
