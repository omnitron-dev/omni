import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyRuntimeArtifact } from '../shared/runtime-artifact.js';
import { readBuildStamp, type BuildStamp } from '../shared/build-stamp.js';
import { readHostBootIdentity } from '../shared/host-boot-identity.js';
import { readManagedRuntime, type ManagedRuntime } from './managed-runtime.js';
import { parseDarwinJob, parseDarwinProcesses } from './darwin-owner-evidence.js';
import { ExecutionJournal } from './execution-journal.js';

const exec = promisify(execFile);
async function native(file: string, args: string[]) {
  const result = await exec(file, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
  return result.stdout.trimEnd();
}
function requireProof(condition: unknown, reason: string): asserts condition {
  if (!condition) throw Error('Resident owner build could not be verified: ' + reason);
}
async function trustedFile(file: string) {
  const stat = await fs.lstat(file);
  requireProof(stat.isFile() && (stat.mode & 0o022) === 0 && stat.uid === process.getuid!() && await fs.realpath(file) === file,
    'unsafe or noncanonical service file');
  return stat;
}

/** launchd's registered argv, the unit on disk, and the process's native executable must all agree. */
async function darwin(config: ManagedRuntime, pid: number, argv: string[], boot: string) {
  const target = (config.scope === 'system' ? 'system' : 'gui/' + process.getuid!()) + '/' + config.owner.label;
  const job = await native('/bin/launchctl', ['print', target]);
  const state = parseDarwinJob(job, target);
  const file = job.match(/^\s*path = (.+)$/m)?.[1];
  const loaded = job.match(/^[\t ]*arguments = \{\n([\s\S]*?)\n[\t ]*\}/m)?.[1]?.split('\n').map(s => s.trim());
  requireProof(state.state === 'active' && state.mainPid === pid && file && path.isAbsolute(file) &&
    job.match(/^\s*program = (.+)$/m)?.[1] === argv[0] && JSON.stringify(loaded) === JSON.stringify(argv), 'launchd binding differs');
  const stat = await trustedFile(file);
  requireProof(stat.size <= 128 * 1024, 'unexpected plist size');
  const plist = JSON.parse(await native('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', file]));
  requireProof(plist.Label === config.owner.label && (!plist.Program || plist.Program === argv[0]) &&
    JSON.stringify(plist.ProgramArguments) === JSON.stringify(argv), 'owner plist differs');
  const [identity, args, opened] = await Promise.all([
    native('/bin/ps', ['-ww', '-p', String(pid), '-o', 'pid=,ppid=,pgid=,uid=,lstart=,comm=']),
    native('/bin/ps', ['-ww', '-p', String(pid), '-o', 'args=']),
    native('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-d', 'txt', '-F0fin']),
  ]);
  const row = parseDarwinProcesses(identity, boot)[0];
  requireProof(row && row.pid === pid && row.ppid === 1 && row.uid === process.getuid!() && row.executable === argv[0] &&
    args.trim() === argv.join(' '), 'native macOS process differs');
  const inode = (await fs.stat(argv[0]!, { bigint: true })).ino;
  const texts = opened.split('\n').map(line => line.split('\0'));
  requireProof(texts.some(fields => fields.includes('ftxt') && fields.includes('i' + inode) && fields.includes('n' + argv[0])),
    'the executable mapped by the process differs from the sealed file');
  const born = Date.parse(row.lifetime.slice((boot + ':utc:').length) + ' UTC');
  requireProof(Number.isFinite(born), 'unknown macOS process birth');
  return { token: row.lifetime, born, file, unitInode: stat.ino, unitCtime: stat.ctimeMs };
}

async function linux(config: ManagedRuntime, pid: number, argv: string[], boot: string) {
  const { unit } = config.owner;
  const details = await native('systemctl', [...(config.scope === 'user' ? ['--user'] : []), 'show', unit, '--all',
    '--property=Id,MainPID,FragmentPath,ControlGroup,LoadState,ActiveState,NeedDaemonReload,DropInPaths,ExecStart']);
  const values = Object.fromEntries(details.split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  const group = values['ControlGroup'], file = values['FragmentPath'];
  requireProof(values['Id'] === unit && values['MainPID'] === String(pid) && values['LoadState'] === 'loaded' &&
    values['ActiveState'] === 'active' && values['NeedDaemonReload'] === 'no' && values['DropInPaths'] === '' && group &&
    path.basename(group) === unit && file && path.isAbsolute(file) && path.basename(file) === unit, 'systemd binding differs');
  const stat = await trustedFile(file);
  requireProof(stat.size <= 128 * 1024 && values['ExecStart']?.includes('path=' + argv[0] + ' ; argv[]=' + argv.join(' ') + ' ;'), 'systemd owner command differs');
  const proc = '/proc/' + pid;
  const [actual, binary, inode, owner, cmd, groups, fields, cpu, times] = await Promise.all([
    fs.realpath(proc + '/exe'), fs.stat(proc + '/exe', { bigint: true }), fs.stat(argv[0]!, { bigint: true }), fs.stat(proc),
    fs.readFile(proc + '/cmdline', 'utf8'), fs.readFile(proc + '/cgroup', 'utf8'), fs.readFile(proc + '/stat', 'utf8'),
    native('getconf', ['CLK_TCK']), fs.readFile('/proc/stat', 'utf8'),
  ]);
  requireProof(actual === argv[0] && binary.dev === inode.dev && binary.ino === inode.ino && owner.uid === process.getuid!() &&
    cmd === argv.join('\0') + '\0' && groups.split('\n').some(line => line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1) === group), 'native Linux process differs');
  const ticks = fields.slice(fields.lastIndexOf(')') + 2).split(' ')[19];
  const bootSeconds = times.match(/^btime (\d+)$/m)?.[1];
  requireProof(ticks && /^\d+$/.test(ticks) && /^\d+$/.test(cpu) && Number(cpu) > 0 && bootSeconds, 'unknown Linux process birth');
  return { token: boot + ':' + ticks, born: Number(bootSeconds) * 1000 + Number(ticks) * 1000 / Number(cpu),
    file, unitInode: stat.ino, unitCtime: stat.ctimeMs };
}

/** On explicit legacy release admission, prove what the physical owner actually launched. */
export async function attestManagedOwnerRuntime(instanceHome: string, expected: { id: string; pid: number; startedAt?: string }): Promise<{ build: BuildStamp; packageRoot: string }> {
  requireProof(expected.id && Number.isSafeInteger(expected.pid) && expected.pid > 0, 'invalid owner identity');
  const observe = async () => {
    const config = await readManagedRuntime(instanceHome);
    requireProof(config && await fs.realpath(instanceHome) === instanceHome, 'no canonical managed instance');
    const record = await new ExecutionJournal(path.join(config.directory, 'controller.json')).read();
    requireProof(record?.owner.id === expected.id && record.owner.pid === expected.pid &&
      (!expected.startedAt || record.owner.startedAt === expected.startedAt), 'private execution journal differs');
    const root = path.join(instanceHome, 'runtime/releases', config.owner.artifact);
    const argv = [path.join(root, 'node'), path.join(root, 'packages/0/dist/daemon/managed-entry.js'), 'owner'];
    requireProof(await fs.realpath(root) === root && await fs.realpath(argv[1]!) === argv[1], 'noncanonical owner runtime');
    const boot = readHostBootIdentity();
    requireProof(process.platform === 'darwin' || process.platform === 'linux', 'unsupported native service manager');
    const processIdentity = await (process.platform === 'darwin' ? darwin : linux)(config, expected.pid, argv, boot);
    return { root, digest: config.owner.artifact, startedAt: record.owner.startedAt, ...processIdentity };
  };
  const before = await observe();
  await verifyRuntimeArtifact(before.root, before.digest, before.born);
  const stamp = readBuildStamp(path.join(before.root, 'packages/0/dist'));
  requireProof(stamp && /^[a-f0-9]{40}$/.test(stamp.commit) && stamp.dirty === false, 'missing exact clean owner build');
  requireProof(JSON.stringify(await observe()) === JSON.stringify(before), 'owner or service binding changed during verification');
  return { build: stamp, packageRoot: path.join(before.root, 'packages/0') };
}

/** Existing admission callers keep the original build-only contract. */
export async function attestManagedOwnerBuild(instanceHome: string, expected: { id: string; pid: number; startedAt?: string }): Promise<BuildStamp> {
  return (await attestManagedOwnerRuntime(instanceHome, expected)).build;
}
