import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readOwnedServiceBytes, serviceReadFlags } from './service-record.js';
import { readServiceDefinition } from './service-definition.js';
import { environmentLine, OWNER_SYSTEMD_UNIT, SYSTEMD_UNIT, unitValue } from './service-units.js';
import { checkGuardianStopEffects, guardianStopProperties } from '../daemon/system-guardian-unit.js';

type Role = 'owner' | 'backend';
type Pair = Record<Role, string>;
type ReadOnlyMount = { source: string; destination: string };
const roles = ['owner', 'backend'] as const;
const units: Pair = { owner: OWNER_SYSTEMD_UNIT, backend: SYSTEMD_UNIT };
const system = '/etc/systemd/system';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const digest = /^[0-9a-f]{64}$/;
const accountName = /^[a-z_][a-z0-9_.-]*\$?$/;
const nativeEnv = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C' };

export interface SystemPairRequest {
  account: string;
  /** Instance path inside the unit and its backing directory on the host. */
  home: string;
  state: string;
  from: Pair;
  to: Pair;
  record: string;
}

function plainPath(value: string): boolean {
  return value !== '/' && /^\/[a-zA-Z0-9._/-]+$/.test(value) && path.resolve(value) === value;
}

function validate(request: SystemPairRequest): void {
  if (!plainPath(request.home) || !plainPath(request.state) || !accountName.test(request.account) ||
      [request.record, ...roles.flatMap(role => [request.from[role], request.to[role]])].some(id => !digest.test(id))) {
    throw Error('The account, two absolute paths, four full runtime hashes and active record hash are required');
  }
}

/** Only these three installer directives change. The root-owned original supplies all service policy. */
export function systemPairUnit(body: string, role: Role, request: SystemPairRequest, primaryGroup: string) {
  const lines = body.split('\n');
  const extensions = new Set<string>();
  const mounts: ReadOnlyMount[] = [];
  const overlaps = (left: string, right: string) => left === right || left.startsWith(right + '/') || right.startsWith(left + '/');
  for (const line of lines.filter(value => value.startsWith('BindReadOnlyPaths='))) {
    const [source, destination, ...rest] = line.slice('BindReadOnlyPaths='.length).split(':');
    if (mounts.length >= 32 || !source || !plainPath(source) || !destination || !plainPath(destination) || rest.length ||
        !['/opt/', '/srv/', '/var/lib/'].some(root => destination.startsWith(root)) ||
        [request.home, request.state].some(dir => overlaps(dir, source) || overlaps(dir, destination)) ||
        mounts.some(mount => overlaps(mount.destination, destination)))
      throw Error('Unsupported or overlapping read-only application mount');
    mounts.push({ source, destination }); extensions.add(line);
  }
  if (lines.includes('Group=' + primaryGroup)) extensions.add('Group=' + primaryGroup);
  if (request.state !== request.home) {
    const overlay = 'TemporaryFileSystem=' + path.dirname(request.home) + ':mode=0755';
    const bind = 'BindPaths=' + request.state + ':' + request.home;
    if (!lines.includes(overlay) || !lines.includes(bind) || path.dirname(request.home) === '/') {
      throw Error('The root-owned unit does not map the reviewed private instance into its service view');
    }
    extensions.add(overlay); extensions.add(bind);
  }
  for (const line of extensions) {
    const index = lines.indexOf(line);
    if (index <= lines.indexOf('[Service]') || index >= lines.indexOf('[Install]') || lines.lastIndexOf(line) !== index)
      throw Error('Unexpected or repeated systemd service policy');
  }
  const unit = readServiceDefinition(lines.filter(line => !extensions.has(line)).join('\n'), 'linux', 'system', units[role]!, '/');
  const release = (id: string) => path.join(request.home, 'runtime/releases', id);
  const current = [request.from[role], request.to[role]].find(id => unit.argv[0] === release(id) + '/node');
  if (!current || unit.role !== role || unit.account !== request.account || unit.home !== request.home ||
      unit.workdir !== release(current) + '/packages/0') throw Error('System service role, account, instance or release differs');
  const directives = (id: string) => {
    const base = release(id);
    return ['ExecStart=' + [base + '/node', base + '/packages/0/dist/daemon/managed-entry.js', role].map(unitValue).join(' '),
      'WorkingDirectory=' + base + '/packages/0', environmentLine('OMNITRON_CWD', base + '/packages/0')];
  };
  const previous = directives(current);
  const render = (id: string) => {
    const next = directives(id);
    return lines.map(line => {
      const index = previous.indexOf(line);
      return index < 0 ? line : next[index];
    }).join('\n');
  };
  if (previous.some(line => !lines.includes(line))) throw Error('Missing exact runtime directives in the root-owned unit');
  return { before: render(request.from[role]), after: render(request.to[role]), current, home: unit.environment['HOME'], mounts };
}

function native(command: string, args: string[]): string {
  return execFileSync(command, args, { env: nativeEnv, encoding: 'utf8', timeout: 40_000, maxBuffer: 128 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const control = (args: string[]) => native('/usr/bin/systemctl', ['--system', '--no-ask-password', ...args]);
function manager(role: Role) {
  const fields = ['Id', 'FragmentPath', 'User', 'Group', 'MainPID', 'Job', 'ActiveState', 'SubState', 'ControlGroup', 'Delegate', 'WorkingDirectory', ...guardianStopProperties];
  const result: Record<string, string> = Object.create(null);
  for (const line of control(['show', '--all', '--property=' + fields.join(','), units[role]]).split('\n')) {
    const at = line.indexOf('='), key = line.slice(0, at);
    if (at < 1 || Object.hasOwn(result, key)) throw Error('Invalid systemd service properties');
    result[key] = line.slice(at + 1);
  }
  return result;
}

/** Descend by directory descriptors. A service-owned link cannot redirect the root reader. */
function activeRecord(request: SystemPairRequest, uid: number) {
  let fd = fs.openSync('/', serviceReadFlags | fs.constants.O_DIRECTORY);
  try {
    let anchor = '';
    const parts = request.state.slice(1).split('/');
    for (const [index, part] of [...parts, 'runtime'].entries()) {
      const next = fs.openSync('/proc/self/fd/' + fd + '/' + part, serviceReadFlags | fs.constants.O_DIRECTORY);
      fs.closeSync(fd); fd = next;
      const stat = fs.fstatSync(fd, { bigint: true });
      const privateDir = index >= parts.length - 1;
      if ((privateDir ? stat.uid !== BigInt(uid) : stat.uid !== 0n && stat.uid !== BigInt(uid)) ||
          (stat.mode & (privateDir ? 0o077n : 0o022n)) !== 0n) throw Error('Unsafe directory in the dedicated instance path');
      if (index === parts.length - 1) anchor = stat.dev + ':' + stat.ino;
    }
    const raw = readOwnedServiceBytes('/proc/self/fd/' + fd + '/supervision.json', uid, 1024 * 1024, true);
    if (hash(raw) !== request.record) throw Error('The active private supervision record differs from the reviewed bytes');
    const config = JSON.parse(raw.toString('utf8'));
    if (config.protocol !== 1 || config.scope !== 'system' || config.instanceHome !== request.home ||
        config.environment?.OMNITRON_HOME !== request.home || roles.some(role =>
          config[role]?.unit !== units[role] || config[role]?.artifact !== request.to[role]))
      throw Error('The active private record does not select the reviewed instance and role pair');
    return anchor;
  } finally { fs.closeSync(fd); }
}

export interface PairSystem {
  identity(account: string): { uid: number; gid: number; group: string; machine: string };
  record(request: SystemPairRequest, uid: number): string;
  unit(role: Role): string;
  facts(role: Role): Record<string, string>;
  property(role: Role, name: 'ExecStartEx' | 'BindPaths' | 'BindReadOnlyPaths' | 'TemporaryFileSystem'): unknown;
  mountIdentity(source: string, uid: number): string;
  replace(role: Role, before: string, after: string): void;
  reload(): void;
  start(role: Role): void;
  attest(role: Role, pid: number, request: SystemPairRequest, uid: number, gid: number, mounts: ReadOnlyMount[]): void;
}

const host: PairSystem = {
  identity(account) {
    if (process.platform !== 'linux' || process.getuid?.() !== 0 || process.geteuid?.() !== 0)
      throw Error('A Linux root operator is required for the native system pair');
    const uid = Number(native('/usr/bin/id', ['-u', '--', account])), gid = Number(native('/usr/bin/id', ['-g', '--', account]));
    const group = native('/usr/bin/id', ['-gn', '--', account]);
    if (![uid, gid].every(id => Number.isSafeInteger(id) && id > 0) || !accountName.test(group))
      throw Error('The system pair requires a dedicated non-root UID and primary GID');
    for (const dir of ['/etc', '/etc/systemd', system]) {
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022)) throw Error('Unsafe system unit directory');
    }
    const machine = readOwnedServiceBytes('/etc/machine-id', 0, 128).toString('utf8').trim();
    if (!/^[0-9a-f]{32}$/.test(machine)) throw Error('Invalid native machine identity');
    return { uid, gid, group, machine };
  },
  record: activeRecord,
  unit: role => readOwnedServiceBytes(path.join(system, units[role]), 0, 128 * 1024).toString('utf8'),
  facts: manager,
  property(role, name) {
    const unit = units[role].replace(/-/g, '_2d').replace(/\./g, '_2e');
    const raw = native('/usr/bin/busctl', ['--system', '--json=short', 'get-property', 'org.freedesktop.systemd1',
      '/org/freedesktop/systemd1/unit/' + unit, 'org.freedesktop.systemd1.Service', name]);
    return JSON.parse(raw).data;
  },
  mountIdentity(source, uid) {
    let current = '/';
    for (const item of source.slice(1).split('/')) {
      current = path.join(current, item);
      const stat = fs.lstatSync(current, { bigint: true });
      if (!stat.isDirectory() || (stat.mode & 0o022n) !== 0n ||
          (current === source ? ![0n, BigInt(uid)].includes(stat.uid) : stat.uid !== 0n))
        throw Error('Read-only application mounts require a physical directory under an administrator-owned parent');
      if (current === source) return stat.dev + ':' + stat.ino;
    }
    throw Error('An absolute application directory is required');
  },
  replace(role, before, after) {
    const file = path.join(system, units[role]), temporary = path.join(system, '.omnitron-' + randomUUID());
    const fd = fs.openSync(temporary, 'wx', 0o644);
    try {
      try { fs.writeFileSync(fd, after); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (host.unit(role) !== before) throw Error('The system unit changed before installation');
      fs.renameSync(temporary, file);
      const dir = fs.openSync(system, 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    } finally { fs.rmSync(temporary, { force: true }); }
  },
  reload() { control(['daemon-reload']); },
  start(role) { control(['start', units[role]]); },
  attest(role, pid, request, uid, gid, mounts) {
    const proc = '/proc/' + pid;
    const same = (a: string, b: string) => {
      const x = fs.statSync(a, { bigint: true }), y = fs.statSync(b, { bigint: true });
      return x.dev === y.dev && x.ino === y.ino;
    };
    const release = path.join(request.home, 'runtime/releases', request.to[role]);
    if (!same(proc + '/root' + request.home, request.state) || !same(proc + '/exe', proc + '/root' + release + '/node'))
      throw Error('The kernel reports another instance mount or executable for the native role');
    if (mounts.length) {
      const entries = fs.readFileSync(proc + '/mountinfo', 'utf8').split('\n').map(line => line.split(' '));
      for (const mount of mounts) {
        const matches = entries.filter(entry => entry[4] === mount.destination);
        if (matches.length !== 1 || !matches[0]![5]?.split(',').includes('ro') ||
            entries.some(entry => entry[4]?.startsWith(mount.destination + '/') && !entry[5]?.split(',').includes('ro')) ||
            !same(proc + '/root' + mount.destination, mount.source))
          throw Error('The kernel reports a different or writable application mount');
      }
    }
    const status = fs.readFileSync(proc + '/status', 'utf8').split('\n');
    for (const [key, id] of [['Uid:', uid], ['Gid:', gid]] as const) {
      const rows = status.filter(line => line.startsWith(key));
      if (rows.length !== 1 || rows[0]!.slice(key.length).trim().split(/\s+/).join(' ') !== [id, id, id, id].join(' '))
        throw Error('The native role has unexpected kernel credentials');
    }
    const expected = [release + '/node', release + '/packages/0/dist/daemon/managed-entry.js', role, ''].join('\0');
    const facts = manager(role), group = facts['ControlGroup'];
    if (!group || !path.isAbsolute(group) || path.normalize(group) !== group || path.basename(group) !== units[role] || facts['Delegate'] !== 'no' ||
        fs.readFileSync(proc + '/cgroup', 'utf8').trim() !== '0::' + group ||
        fs.readFileSync(proc + '/cmdline', 'utf8') !== expected || facts['MainPID'] !== String(pid))
      throw Error('The native role PID, cgroup or argument vector differs from the reviewed runtime');
  },
};

/** This operator installs only a stopped, registered pair. Starting the pair is a distinct reviewed dispatch. */
export function systemPairCommand(action: string, request: SystemPairRequest, review?: string, os: PairSystem = host) {
  validate(request);
  if (!['review', 'install', 'start'].includes(action) || (action === 'review' ? review !== undefined : !digest.test(review ?? '')))
    throw Error('Use review, then install or start with the exact review digest');
  if (os === host && action !== 'review') {
    host.identity(request.account);
    // flock inherits this open file description. The parent retains it across both OS operations.
    const lock = '/run/omnitron-system-pair';
    fs.mkdirSync(lock, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(lock, serviceReadFlags | fs.constants.O_DIRECTORY);
    try {
      const stat = fs.fstatSync(fd);
      if (stat.uid !== 0 || (stat.mode & 0o077)) throw Error('Unexpected administrative lock directory');
      execFileSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { env: nativeEnv, stdio: ['ignore', 'ignore', 'pipe', fd] });
      return operate(action, request, review, host);
    } finally { fs.closeSync(fd); }
  }
  return operate(action, request, review, os);
}

function operate(action: string, request: SystemPairRequest, review: string | undefined, os: PairSystem) {
  const identity = os.identity(request.account);
  const observe = (allowReload: boolean) => {
    const state = os.record(request, identity.uid);
    const jobs = roles.map(role => {
      const body = os.unit(role);
      const definition = systemPairUnit(body, role, request, identity.group);
      const facts = os.facts(role);
      checkGuardianStopEffects(facts, !allowReload);
      const pendingOwnWrite = allowReload && body === definition.after && definition.before !== definition.after;
      if (facts['Id'] !== units[role] || facts['FragmentPath'] !== path.join(system, units[role]) || facts['User'] !== request.account ||
          !['', identity.group].includes(facts['Group'] ?? '?') || facts['Job'] !== '' ||
          !['no', ...(pendingOwnWrite ? ['yes'] : [])].includes(facts['NeedDaemonReload'] ?? '?'))
        throw Error('Loaded service identity, policy or pending job differs from the reviewed system pair');
      const bindingsMatch = (property: 'BindPaths' | 'BindReadOnlyPaths', wanted: ReadOnlyMount[]) => {
        const actual = os.property(role, property);
        return Array.isArray(actual) && actual.length === wanted.length && wanted.every(mount => actual.some(row =>
          Array.isArray(row) && row.length === 4 && row[0] === mount.source && row[1] === mount.destination &&
          row[2] === false && [0, 16_384].includes(row[3])));
      };
      const separate = request.home !== request.state;
      const overlay = os.property(role, 'TemporaryFileSystem');
      if (!bindingsMatch('BindReadOnlyPaths', definition.mounts) || !bindingsMatch('BindPaths', separate ? [{ source: request.state, destination: request.home }] : []) ||
          !Array.isArray(overlay) || overlay.length !== (separate ? 1 : 0) ||
          (separate && (!Array.isArray(overlay[0]) || overlay[0][0] !== path.dirname(request.home) || !['mode=0755', 'mode=755'].includes(overlay[0][1]))))
        throw Error('Loaded systemd mount policy differs from the root-owned instance and application paths');
      const starts = os.property(role, 'ExecStartEx');
      const allowed = pendingOwnWrite ? [request.from[role], request.to[role]] : [definition.current];
      const loaded = Array.isArray(starts) && starts.length === 1 && Array.isArray(starts[0]) && allowed.find(id => {
        const base = path.join(request.home, 'runtime/releases', id);
        const [exe, argv, options] = starts[0];
        return exe === base + '/node' && JSON.stringify(argv) === JSON.stringify([exe, base + '/packages/0/dist/daemon/managed-entry.js', role]) &&
          Array.isArray(options) && options.length === 0 && facts['WorkingDirectory'] === base + '/packages/0';
      });
      if (!loaded) throw Error('Loaded systemd executable, arguments, flags or working directory differ');
      const stopped = facts['ActiveState'] === 'inactive' && facts['SubState'] === 'dead' && facts['MainPID'] === '0';
      const running = facts['ActiveState'] === 'active' && facts['SubState'] === 'running' && /^[1-9]\d*$/.test(facts['MainPID'] ?? '');
      if (!stopped && !running) throw Error('System pair has no settled native state');
      if (running && action === 'start') os.attest(role, Number(facts['MainPID']), request, identity.uid, identity.gid, definition.mounts);
      return { role, body, ...definition, stopped, dirty: facts['NeedDaemonReload'] === 'yes' || loaded !== definition.current,
        pid: running ? Number(facts['MainPID']) : null };
    });
    if (jobs[0]!.home !== jobs[1]!.home) throw Error('The native roles have different account homes');
    const bindings = jobs.map(job => ({ role: job.role, before: hash(job.before), after: hash(job.after),
      mounts: job.mounts.map(mount => ({ ...mount, identity: os.mountIdentity(mount.source, identity.uid) })) }));
    const token = hash(JSON.stringify([1, identity.machine, identity.uid, identity.gid, identity.group, request.account,
      request.home, request.state, state, request.record, ...roles.flatMap(role => [request.from[role], request.to[role]]), bindings]));
    if (review && review !== token) throw Error('The host, instance, account, pair or unit policy changed since review');
    return { jobs, token, bindings };
  };
  const seen = observe(action === 'install');
  const requireStopped = (jobs: typeof seen.jobs) => {
    if (jobs.some(job => !job.stopped)) throw Error('Both native services must already be cold and free of jobs before installation');
  };
  if (action === 'review') {
    requireStopped(seen.jobs);
    if (seen.jobs.some(job => job.current !== request.from[job.role])) throw Error('Only the registered original roles can authorize a new review');
  }
  if (action === 'install') {
    requireStopped(seen.jobs);
    let wrote = false;
    for (const role of roles) {
      const { jobs } = observe(true);
      requireStopped(jobs);
      const job = jobs.find(item => item.role === role)!;
      if (job.body !== job.after) { os.replace(role, job.before, job.after); wrote = true; }
    }
    const { jobs } = observe(true);
    requireStopped(jobs);
    if (jobs.some(job => job.body !== job.after)) throw Error('Target role definitions changed before reload');
    if (wrote || jobs.some(job => job.dirty)) os.reload();
    const loaded = observe(false).jobs;
    requireStopped(loaded);
    if (loaded.some(job => job.body !== job.after)) throw Error('Loaded role definitions differ after reload');
  }
  if (action === 'start') {
    for (const role of roles) {
      const jobs = observe(false).jobs;
      if (jobs.some(job => job.body !== job.after)) throw Error('Install the exact two reviewed definitions before starting');
      const job = jobs.find(item => item.role === role)!;
      if (job.stopped) os.start(role);
    }
  }
  const end = action === 'review' ? seen : observe(false);
  if (action === 'start' && end.jobs.some(job => job.body !== job.after || job.stopped)) throw Error('The reviewed pair has not reached native running state');
  return { review: end.token, account: request.account, uid: identity.uid, gid: identity.gid, home: request.home, state: request.state,
    from: request.from, to: request.to, record: request.record, units: end.bindings,
    native: end.jobs.map(job => ({ unit: units[job.role], mainPid: job.pid })) };
}
