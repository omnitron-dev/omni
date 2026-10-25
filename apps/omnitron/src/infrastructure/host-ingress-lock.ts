import { spawn } from 'node:child_process';

export type IngressLock = <T>(file: string, body: () => Promise<T>) => Promise<T>;
/** Linux kernel lock, released on process death. No stale PID-file deletion race. */
export const withIngressLock: IngressLock = async (file, body) => {
  if (process.platform !== 'linux') throw new Error('Host ingress publication requires Linux with util-linux flock');
  const child = spawn('flock', ['--exclusive', '--timeout', '30', file, 'sh', '-c', 'printf "locked\\n"; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  let errorText = '';
  child.stderr.on('data', (chunk: Buffer) => { errorText = (errorText + chunk.toString()).slice(-4096); });
  const ended = new Promise<void>((resolve) => { child.once('close', () => resolve()); child.once('error', () => resolve()); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Host ingress lock timed out')); }, 35_000);
      let output = '';
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', () => { clearTimeout(timer); reject(new Error(`Host ingress lock unavailable: ${errorText}`)); });
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output === 'locked\n') { clearTimeout(timer); resolve(); }
        else if (output.length > 32) { clearTimeout(timer); reject(new Error('Unexpected host ingress lock response')); }
      });
    });
    return await body();
  } finally {
    child.stdin.end();
    await ended;
  }
};
