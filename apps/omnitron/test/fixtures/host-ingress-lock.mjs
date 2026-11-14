import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { withKernelFileLock } from '/test/file-lock.mjs';
const timeout = setTimeout(() => { console.error('Kernel lock fixture timed out'); process.exit(2); }, 12_000);
await mkdir('/tmp/ingress', { recursive: true, mode: 0o700 });
const file = '/tmp/ingress/publication.lock';
if (process.argv[2] === 'holder') {
  await withKernelFileLock(file, async () => { process.stdout.write('entered\n'); await new Promise(() => {}); });
} else {
  const holder = spawn(process.execPath, ['--experimental-strip-types', import.meta.filename, 'holder'], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => { holder.once('error', reject); holder.stdout.once('data', () => resolve()); });
    let acquired = false;
    const contender = withKernelFileLock(file, async () => { acquired = true; });
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (acquired) throw new Error('Kernel lock admitted a concurrent publisher');
    holder.kill('SIGKILL');
    await contender;
    if (!acquired) throw new Error('Kernel lock was not released after owner death');
    await withKernelFileLock(file, async () => { throw new Error('expected body failure'); }).catch((error) => { if (error.message !== 'expected body failure') throw error; });
    await withKernelFileLock(file, async () => {});
    process.stdout.write('exclusive; crash released; exception released\n');
  } finally { holder.kill('SIGKILL'); clearTimeout(timeout); }
}
