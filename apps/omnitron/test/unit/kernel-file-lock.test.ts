import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { withKernelFileLock } from '@xec-sh/ops/utils/file-lock';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-kernel-fence-')); roots.push(root); return path.join(root, 'fence'); }

describe.skipIf(!['darwin', 'linux'].includes(process.platform))('native inherited-descriptor owner fence', () => {
  it('excludes another independent descriptor after the helper exits and never unlinks the fence', async () => {
    const file = await fixture();
    let inode = 0;
    await withKernelFileLock(file, async () => {
      inode = (await fs.lstat(file)).ino;
      await expect(withKernelFileLock(file, async () => { throw new Error('Concurrent admission'); }, 0)).rejects.toThrow('not acquired');
    });
    await withKernelFileLock(file, async () => { expect((await fs.lstat(file)).ino).toBe(inode); }, 0);
  });
  it('releases on a rejected operation without replacing the lock file', async () => {
    const file = await fixture();
    await expect(withKernelFileLock(file, async () => { throw new Error('persistence failed'); })).rejects.toThrow('persistence failed');
    await expect(withKernelFileLock(file, async () => 'next', 0)).resolves.toBe('next');
  });
  it('refuses symlink and shared-permission lock files', async () => {
    const file = await fixture(), target = file + '.target';
    await fs.writeFile(target, '', { mode: 0o600 }); await fs.symlink(target, file);
    await expect(withKernelFileLock(file, async () => undefined)).rejects.toThrow();
    await fs.unlink(file); await fs.writeFile(file, '', { mode: 0o666 }); await fs.chmod(file, 0o666);
    await expect(withKernelFileLock(file, async () => undefined)).rejects.toThrow('regular file');
  });
  it('tightens a legacy read-only-to-others lock without changing its inode or accepting a shared directory', async () => {
    const file = await fixture(); await fs.writeFile(file, '', { mode: 0o644 }); await fs.chmod(file, 0o644);
    const before = await fs.lstat(file);
    await withKernelFileLock(file, async () => { expect((await fs.lstat(file)).mode & 0o777).toBe(0o600); });
    expect((await fs.lstat(file)).ino).toBe(before.ino);
    await fs.chmod(path.dirname(file), 0o755);
    await expect(withKernelFileLock(file, async () => undefined)).rejects.toThrow('private parent');
  });
  it('releases the kernel fence if its owning Node process dies', async () => {
    const file = await fixture();
    const module = import.meta.resolve('@xec-sh/ops/utils/file-lock');
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import {withKernelFileLock} from ${JSON.stringify(module)}; await withKernelFileLock(process.argv[1], async()=>{setInterval(()=>{},1000);process.stdout.write('locked\\n');await new Promise(()=>{});});`, file], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    try {
      const message = await Promise.race([once(child.stdout!, 'data').then(([bytes]) => String(bytes)), closed.then(() => { throw new Error('Fixture exited before lock acquisition'); })]);
      expect(message).toBe('locked\n');
      await expect(withKernelFileLock(file, async () => undefined, 0)).rejects.toThrow('not acquired');
      child.kill('SIGKILL'); await closed;
      await expect(withKernelFileLock(file, async () => 'recovered', 0)).resolves.toBe('recovered');
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; } }
  });
});
