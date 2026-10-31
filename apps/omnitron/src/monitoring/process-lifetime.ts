import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export type ProcessLifetime = { state: 'alive'; identity: string } | { state: 'dead' } | { state: 'unknown' };
let bootIdentity: string | undefined;

/** A PID alone can identify a different process after a crash or host restart. */
export function readProcessLifetime(pid: number): ProcessLifetime {
  if (!Number.isSafeInteger(pid) || pid < 1) return { state: 'unknown' };
  try {
    if (process.platform === 'linux') {
      bootIdentity ??= fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      if (!stat.includes(')')) return { state: 'unknown' };
      // comm is parenthesized and may itself contain spaces or parentheses.
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      const start = fields[19]; // /proc stat field 22; this list starts at field 3.
      if (!bootIdentity || !start || !/^\d+$/.test(start)) return { state: 'unknown' };
      return { state: 'alive', identity: `${bootIdentity}:${start}` };
    }
    if (process.platform === 'darwin') {
      const options = { encoding: 'utf8' as const, timeout: 1000, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } };
      bootIdentity ??= execFileSync('/usr/sbin/sysctl', ['-n', 'kern.boottime'], options).trim();
      const start = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], options).trim();
      if (!bootIdentity || !start) return { state: 'unknown' };
      return { state: 'alive', identity: `${bootIdentity}:${start}` };
    }
  } catch {
    // A permission error or failed probe does not prove that a writer died.
  }
  try { process.kill(pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { state: 'dead' }; }
  return { state: 'unknown' };
}
