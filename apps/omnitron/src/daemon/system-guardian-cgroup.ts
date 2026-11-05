import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readProcessLifetime } from '../monitoring/process-lifetime.js';

export interface GuardianStopFence {
  group: string;
  directoryId: string;
  guardianProcess: string;
  backendProcess: string;
}

const cgroupRoot = '/sys/fs/cgroup';

function requireUnifiedHierarchy(): void {
  if (fs.statfsSync(cgroupRoot).type !== 0x63677270) throw Error('Guardian transition requires Linux cgroup v2');
}

export function guardianControlGroup(unit: string, guardianPid: number, facts: Record<string, string>): string {
  const group = facts['ControlGroup'];
  if (facts['Id'] !== unit || facts['MainPID'] !== String(guardianPid) || facts['Delegate'] !== 'no' ||
      facts['KillMode'] !== 'control-group' || facts['ActiveState'] !== 'active' || !group ||
      !group.startsWith('/') || path.normalize(group) !== group || path.basename(group) !== unit) {
    throw Error('Cannot prove the scope of the systemd guardian stop');
  }
  return group;
}

/** cgroup.procs lists direct processes only. An occupied descendant is also killed by systemd. */
export function guardianGroupIdentity(directory: string, permitted: number[]): string {
  const expected = [...permitted].sort((a, b) => a - b).join(' ');
  const entries: string[] = [];
  const device = fs.lstatSync(directory, { bigint: true }).dev;
  const walk = (dir: string, depth: number): void => {
    if (depth > 16 || entries.length >= 256) throw Error('Guardian cgroup tree exceeds the inspection limit');
    const stat = fs.lstatSync(dir, { bigint: true });
    if (!stat.isDirectory() || stat.dev !== device || fs.realpathSync(dir) !== dir) throw Error('Untrusted guardian cgroup directory');
    const read = (file: string) => {
      const fd = fs.openSync(path.join(dir, file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        const source = fs.fstatSync(fd, { bigint: true });
        if (!source.isFile() || source.dev !== device) throw Error('Untrusted guardian cgroup record');
        const data = Buffer.alloc(4096);
        let offset = 0, count: number;
        while ((count = fs.readSync(fd, data, offset, data.length - offset, null)) > 0) {
          offset += count;
          if (offset === data.length) throw Error('Guardian cgroup record exceeds the inspection limit');
        }
        return data.toString('utf8', 0, offset).trim();
      } finally { fs.closeSync(fd); }
    };
    if (read('cgroup.type') !== 'domain') throw Error('Expected a domain cgroup for the guardian');
    const pids = read('cgroup.procs').split(/\s+/).filter(Boolean);
    if (pids.some(pid => !/^[1-9]\d*$/.test(pid) || !Number.isSafeInteger(Number(pid))))
      throw Error('Malformed PID record in the guardian cgroup');
    // cgroup.procs is an unordered process set; the kernel may repeat a PID
    // while membership changes during a read. The enclosing fence separately
    // verifies the process lifetimes and cgroup membership twice.
    // https://docs.kernel.org/admin-guide/cgroup-v2.html#core-interface-files
    const observed = [...new Set(pids.map(Number))].sort((a, b) => a - b);
    const wanted = depth === 0 ? expected : '';
    if (observed.join(' ') !== wanted) {
      const scope = JSON.stringify(path.relative(directory, dir) || '.');
      const shown = observed.slice(0, 16).join(' ') + (observed.length > 16 ? ` … (${observed.length} total)` : '');
      throw Error(`Unknown, missing or nested process in the guardian cgroup ${scope}: expected PIDs [${wanted}], observed [${shown}]. Inspect the processes and wait for unrelated work to settle before preparing again.`);
    }
    const events = read('cgroup.events').split('\n');
    const populated = events.filter(event => event.startsWith('populated'));
    const frozen = events.filter(event => event.startsWith('frozen'));
    const expectedPopulation = depth === 0 && permitted.length ? 'populated 1' : 'populated 0';
    if (frozen.length !== 1 || frozen[0] !== 'frozen 0' || populated.length !== 1 || populated[0] !== expectedPopulation) {
      throw Error(`Unsafe guardian cgroup state ${JSON.stringify(path.relative(directory, dir) || '.')}: expected ${expectedPopulation}, frozen 0; observed populated=${populated.length === 1 ? populated[0]!.slice(-1) : 'unknown'}, frozen=${frozen.length === 1 ? frozen[0]!.slice(-1) : 'unknown'}. Guardian transition was refused.`);
    }
    const index = entries.length;
    entries.push(JSON.stringify([dir, String(stat.dev), String(stat.ino)]));
    const children: string[] = [];
    const handle = fs.opendirSync(dir);
    try {
      for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
        if (entry.isDirectory()) children.push(entry.name);
        else if (!entry.isFile()) throw Error('Unexpected entry in the guardian cgroup');
        if (entries.length + children.length > 256) throw Error('Guardian cgroup tree exceeds the inspection limit');
      }
    } finally { handle.closeSync(); }
    for (const child of children.sort()) walk(path.join(dir, child), depth + 1);
    const counts = read('cgroup.stat').split('\n');
    if (!counts.includes('nr_dying_descendants 0') || !counts.includes('nr_descendants ' + (entries.length - index - 1))) {
      throw Error('Guardian cgroup descendants changed during inspection');
    }
  };
  walk(directory, 0);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

export function checkGuardianStopFence(
  group: string, guardianPid: number, backendPid: number, expected?: GuardianStopFence, retired = false,
): GuardianStopFence {
  requireUnifiedHierarchy();
  const directory = path.join(cgroupRoot, group);
  if (fs.statfsSync(directory).type !== 0x63677270) throw Error('Guardian directory does not belong to a Linux cgroup v2 mount');
  const observe = (): GuardianStopFence => {
    const guardian = readProcessLifetime(guardianPid);
    const backend = readProcessLifetime(backendPid);
    if (guardianPid === backendPid || guardian.state !== 'alive' ||
        (backend.state !== 'alive' && !(backend.state === 'dead' && retired && expected))) {
      throw Error('Cannot verify the native guardian and backend process lifetimes');
    }
    const pids = backend.state === 'alive' ? [guardianPid, backendPid] : [guardianPid];
    const directoryId = guardianGroupIdentity(directory, pids);
    const processStamp = (pid: number, lifetime: string): string => {
      const proc = '/proc/' + pid;
      const exe = fs.realpathSync(proc + '/exe');
      const stat = fs.statSync(proc + '/exe', { bigint: true });
      const command = fs.readFileSync(proc + '/cmdline');
      if (!path.isAbsolute(exe) || exe.endsWith(' (deleted)') || !stat.isFile() || command.length < 2 || command.at(-1) !== 0) {
        throw Error('Cannot verify the running guardian or backend executable');
      }
      return createHash('sha256').update(JSON.stringify([lifetime, exe, String(stat.dev), String(stat.ino)])).update(command).digest('hex');
    };
    for (const pid of pids) {
      if (fs.readFileSync('/proc/' + pid + '/cgroup', 'utf8').trim() !== '0::' + group) {
        throw Error('Managed process does not belong to the verified guardian cgroup');
      }
    }
    return { group, directoryId, guardianProcess: processStamp(guardianPid, guardian.identity),
      backendProcess: backend.state === 'alive' ? processStamp(backendPid, backend.identity) : expected!.backendProcess };
  };
  const first = observe();
  const second = observe();
  for (const key of ['group', 'directoryId', 'guardianProcess', 'backendProcess'] as const) {
    if (first[key] !== second[key] || (expected && expected[key] !== second[key])) {
      throw Error('Guardian cgroup or native process identity changed since preparation');
    }
  }
  return second;
}

/** systemd may remove the cgroup after stopping the unit. Never confuse another MainPID with an empty job. */
export function verifyStoppedGuardian(unit: string, fence: GuardianStopFence | undefined, facts: Record<string, string>): void {
  const group = fence?.group ?? facts['ControlGroup'];
  if (facts['Id'] !== unit || facts['LoadState'] !== 'loaded' || facts['ActiveState'] !== 'inactive' ||
      facts['MainPID'] !== '0' || group === undefined ||
      (facts['ControlGroup'] !== '' && facts['ControlGroup'] !== group) ||
      (group !== '' && (!path.isAbsolute(group) || path.normalize(group) !== group || path.basename(group) !== unit))) {
    throw Error('The previous guardian unit is not verifiably stopped; reconcile the native job');
  }
  requireUnifiedHierarchy();
  // A pre-fence journal can resume without signalling anything when systemd
  // has already removed its cgroup and both recorded PIDs have exited.
  if (!group) return;
  const directory = path.join(cgroupRoot, group);
  try { fs.lstatSync(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  guardianGroupIdentity(directory, []);
}
