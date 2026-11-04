import { execFile } from 'node:child_process';
import { compareProcessLifetimes, formatDarwinProcessLifetime } from '../shared/host-boot-identity.js';
import type { ManagedRuntime } from './managed-runtime.js';

export interface DarwinProcessIdentity {
  pid: number; ppid: number; pgid: number; uid: number; lifetime: string; executable: string;
}
export interface DarwinReconciliationScope {
  platform: 'darwin'; domain: string; bootSession: string; processGroups: number[];
}
interface CommandAnswer { stdout: string; stderr: string; code: number; pid: number }
async function command(file: string, args: string[]): Promise<CommandAnswer> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }, (error, stdout, stderr) => {
      if (error && (typeof error.code !== 'number' || error.killed || error.signal)) { reject(new Error(`Native recovery observation failed: ${file}`, { cause: error })); return; }
      resolve({ stdout, stderr, code: (error?.code as number | undefined) ?? 0, pid: child.pid ?? -1 });
    });
  });
}

export function parseDarwinProcesses(output: string, boot: string): DarwinProcessIdentity[] {
  const rows = output.trim().split('\n').filter(Boolean);
  if (!rows.length || rows.length > 32768 || !boot) throw new Error('Incomplete macOS process inventory');
  const seen = new Set<number>();
  return rows.map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(line);
    if (!match) throw new Error('Unrecognized macOS process identity; recovery is refused');
    const [pid, ppid, pgid, uid] = match.slice(1, 5).map(Number);
    // Darwin prints reserved uid_t values (for example nobody) as signed IDs.
    if ([pid, ppid, pgid, uid].some(n => !Number.isSafeInteger(n)) || pid! < 1 || ppid! < 0 || pgid! < 0 ||
      uid! < -2147483648 || uid! > 4294967295 || seen.has(pid!)) throw new Error('Invalid or duplicate macOS process identity');
    seen.add(pid!);
    return { pid: pid!, ppid: ppid!, pgid: pgid!, uid: uid!, lifetime: formatDarwinProcessLifetime(boot, match[5]!), executable: match[6]! };
  });
}

/** Descendants and every member of retained process groups, regardless of language or UID. */
export function darwinProcessCohort(rows: DarwinProcessIdentity[], roots: readonly number[], groups: readonly number[]): DarwinProcessIdentity[] {
  const selected = new Set(roots), ownedGroups = new Set(groups);
  for (const row of rows) if (selected.has(row.pid) && row.pgid > 0) ownedGroups.add(row.pgid);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (!selected.has(row.pid) && (selected.has(row.ppid) || ownedGroups.has(row.pgid))) {
      selected.add(row.pid); if (row.pgid > 0) ownedGroups.add(row.pgid); changed = true;
      if (selected.size > 8192) throw new Error('Owner recovery process cohort exceeds its limit');
    }
  }
  return rows.filter(row => selected.has(row.pid));
}

export function parseDarwinJob(output: string, target: string): { mainPid: number; state: string } {
  if (!output.startsWith(target + ' = {')) throw new Error('launchd service identity disagrees with private supervision configuration');
  const state = output.match(/^\s*state = ([^\n]+)$/m)?.[1]?.trim();
  const pid = output.match(/^\s*pid = (\d+)\s*$/m)?.[1];
  if (!state || (pid && (!Number.isSafeInteger(Number(pid)) || Number(pid) < 1)) ||
    (!pid && !['not running', 'waiting', 'exited'].includes(state))) throw new Error('Unknown launchd service state');
  return { mainPid: pid ? Number(pid) : 0, state: pid ? 'active' : state === 'not running' || state === 'exited' ? 'inactive' : 'activating' };
}

export function parseDarwinSockets(output: string, directory: string): string[] {
  const result: string[] = [];
  for (const field of output.split('\0').map(part => part.replace(/^\n/, '')).filter(Boolean)) {
    if (field[0] === 'n' && (field.slice(1) === directory || field.slice(1).startsWith(directory + '/'))) result.push(field.slice(1));
    else if (!['p', 'f', 'n'].includes(field[0]!)) throw new Error('Unrecognized kernel socket observation');
  }
  return result;
}

/** Bounded native reads only; no service mutation, signaling, SQLite or shell. */
export async function readDarwinOwnerEvidence(config: ManagedRuntime, expected: readonly { pid: number; lifetime?: string | null }[], bootId: string, scope?: DarwinReconciliationScope) {
  if (process.platform !== 'darwin') throw new Error('macOS native evidence is unavailable on this platform');
  const domain = config.scope === 'system' ? 'system' : `gui/${process.getuid!()}`;
  const session = await command('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']);
  const bootSession = session.stdout.trim().toLowerCase();
  if (session.code || session.stderr || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(bootSession)) throw new Error('Cannot verify the macOS boot session');
  if (bootId !== 'darwin:' + bootSession) throw new Error('The native process inventory does not match the current stable boot session');
  if (scope && (scope.domain !== domain || scope.bootSession !== bootSession)) throw new Error('launchd domain or boot session changed since recovery was planned');
  const units = await Promise.all([config.owner, config.backend].map(async job => {
    const target = `${domain}/${job.label}`, answer = await command('/bin/launchctl', ['print', target]);
    // A missing job is acceptable only when launchd names this exact label.
    if (answer.code === 113 && answer.stderr.includes(`Could not find service "${job.label}"`)) return { mainPid: 0, state: 'inactive' };
    if (answer.code || answer.stderr) throw new Error('Cannot inspect the configured launchd service');
    return parseDarwinJob(answer.stdout, target);
  }));
  const snapshot = await command('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,uid=,lstart=,comm=']);
  if (snapshot.code || snapshot.stderr) throw new Error('Cannot read the complete native process inventory');
  // This exact observer has exited before we examine its captured table.
  const inventory = parseDarwinProcesses(snapshot.stdout, bootId);
  if (!inventory.some(row => row.pid === process.pid) ||
    !inventory.some(row => row.pid === snapshot.pid && row.ppid === process.pid))
    throw new Error('Native process inventory did not include its observers');
  const rows = inventory.filter(row => row.pid !== snapshot.pid);
  const roots = expected.filter(identity => {
    const row = rows.find(item => item.pid === identity.pid);
    return row && (!identity.lifetime || compareProcessLifetimes(identity.lifetime, row.lifetime) !== 'different');
  }).map(identity => identity.pid);
  const cohort = darwinProcessCohort(rows, [...roots, ...units.map(unit => unit.mainPid).filter(Boolean)], scope?.processGroups ?? []);
  const processGroups = [...new Set([...(scope?.processGroups ?? []), ...cohort.map(row => row.pgid).filter(id => id > 0)])].sort((a, b) => a - b);
  const sockets = await command('/usr/sbin/lsof', ['-nP', '-a', '-U', '-u', String(process.getuid!()), '-F0pn']);
  if (sockets.stderr || (sockets.code !== 0 && (sockets.code !== 1 || sockets.stdout.trim()))) throw new Error('Kernel Unix-socket inventory is unavailable or incomplete');
  return { bootId, units, groups: [cohort.map(row => row.pid), []] as number[][],
    processes: [...new Set([...expected.map(row => row.pid), ...cohort.map(row => row.pid)])].map(pid => {
      const row = rows.find(item => item.pid === pid);
      if (row) return { pid, lifetime: row.lifetime };
      try { process.kill(pid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { pid, lifetime: null }; }
      return { pid, lifetime: null, unknown: true };
    }),
    sockets: parseDarwinSockets(sockets.stdout, config.directory),
    native: { platform: 'darwin' as const, domain, bootSession, processGroups },
    cohort };
}
