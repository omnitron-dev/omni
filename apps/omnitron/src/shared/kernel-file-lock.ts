import fs, { constants } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

/** Keep the open file description in Node; the kernel releases it on process death. */
export async function withKernelFileLock<T>(file: string, body: () => Promise<T>, timeoutSeconds = 30): Promise<T> {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Owner recovery requires macOS lockf or Linux flock');
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 30) throw new Error('Invalid kernel lock timeout');
  const parent = await fs.lstat(path.dirname(file));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 ||
    (process.getuid && parent.uid !== process.getuid())) throw new Error('Owner recovery lock requires a private parent directory');
  const handle = await fs.open(file, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || (opened.mode & 0o022) !== 0 || (process.getuid && opened.uid !== process.getuid()))
      throw new Error('Owner recovery lock must be a private regular file owned by this user');
    // Both utilities operate on inherited fd3. They acquire flock(2) on its
    // shared open description; helper exit does not release our descriptor.
    const command = process.platform === 'darwin' ? '/usr/bin/lockf' : 'flock';
    const args = process.platform === 'darwin' ? ['-t', String(timeoutSeconds), '3'] : ['--exclusive', '--timeout', String(timeoutSeconds), '3'];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe', handle.fd] });
      let output = '', errors = '';
      const timer = setTimeout(() => { child.kill(); }, (timeoutSeconds + 5) * 1000);
      child.stdout!.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-1024); });
      child.stderr!.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-1024); });
      child.once('error', error => { clearTimeout(timer); reject(new Error('Native kernel lock helper is unavailable', { cause: error })); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0 && !output && !errors) resolve();
        else reject(new Error(`Owner recovery kernel lock was not acquired (exit ${code ?? 'signal'}): ${errors.trim()}`));
      });
    });
    const named = await fs.lstat(file);
    const currentParent = await fs.lstat(path.dirname(file));
    if (named.isSymbolicLink() || named.dev !== opened.dev || named.ino !== opened.ino ||
      currentParent.isSymbolicLink() || currentParent.dev !== parent.dev || currentParent.ino !== parent.ino || (currentParent.mode & 0o077) !== 0)
      throw new Error('Owner recovery lock path changed during acquisition');
    // Older flock-based owners created an empty 0644 lock under their private
    // execution directory. Preserve that inode/lock domain while tightening it.
    if ((opened.mode & 0o777) !== 0o600) await handle.chmod(0o600);
    return await body();
  } finally { await handle.close(); }
}
