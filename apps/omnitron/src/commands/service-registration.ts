import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { OMNITRON_HOME, instanceLifecycleSocket } from '../config/defaults.js';
import { readSavedDaemonConfig } from '../config/saved.js';
import { expandPath } from '../shared/paths.js';
import { assertManagedRuntime, managedRuntimeFile, type ManagedRuntime } from '../daemon/managed-runtime.js';
import { checkGuardianStopEffects, guardianStopProperties } from '../daemon/system-guardian-unit.js';
import type { ServiceScope } from '../shared/dto/runtime-update.js';
import { readServiceDefinition, type ServiceDefinition } from './service-definition.js';
import { LAUNCHD_LABEL, OWNER_LAUNCHD_LABEL, OWNER_SYSTEMD_UNIT, SYSTEMD_UNIT, unitPathFor } from './service-units.js';

export interface NativeJob {
  scope: ServiceScope;
  name: string;
  file: string;
  body: string | null;
  definition?: ServiceDefinition;
}
export interface NativeService { scope: ServiceScope; jobs: NativeJob[]; managed: ManagedRuntime | null }

function readFile(file: string, privateRecord = false): string | null {
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > (privateRecord ? 1024 : 128) * 1024 || (stat.mode & (privateRecord ? 0o077 : 0o022))) {
      throw Error('Unsafe native service record at ' + file);
    }
    const parent = fs.lstatSync(path.dirname(file));
    if (!parent.isDirectory() || (parent.mode & (privateRecord ? 0o077 : 0o022)) || stat.uid !== parent.uid ||
        (privateRecord && stat.uid !== fs.statSync(OMNITRON_HOME).uid)) throw Error('Unexpected native service record owner or directory at ' + file);
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

function privateAuthority(): ManagedRuntime | null {
  const raw = readFile(managedRuntimeFile(), true);
  if (raw === null) return null;
  const config: unknown = JSON.parse(raw);
  assertManagedRuntime(config);
  const policy = readSavedDaemonConfig()?.executionHost;
  const expected = expandPath(policy?.directory ?? path.join(OMNITRON_HOME, 'execution'));
  const stat = fs.lstatSync(config.directory);
  const uid = fs.statSync(OMNITRON_HOME).uid;
  if (!policy?.enabled || path.resolve(config.directory) !== path.resolve(expected) || !stat.isDirectory() ||
      (stat.mode & 0o077) || stat.uid !== uid || (process.getuid?.() !== 0 && process.getuid?.() !== uid) ||
      (config.environment['OMNITRON_SOCKET'] !== undefined && config.environment['OMNITRON_SOCKET'] !== instanceLifecycleSocket())) {
    throw Error('Private supervision authority differs from the selected instance policy');
  }
  return config;
}

/** Canonical labels belong to a supervisor domain. A private record may explicitly name other jobs in that domain. */
function job(scope: ServiceScope, owner: boolean, authority: ManagedRuntime | null): NativeJob {
  const darwin = process.platform === 'darwin';
  const role = owner ? authority?.owner : authority?.backend;
  const name = darwin ? role?.label ?? (owner ? OWNER_LAUNCHD_LABEL : LAUNCHD_LABEL)
    : role?.unit ?? (owner ? OWNER_SYSTEMD_UNIT : SYSTEMD_UNIT);
  const canonical = unitPathFor(process.platform, scope, os.userInfo().homedir, owner);
  const canonicalName = darwin ? (owner ? OWNER_LAUNCHD_LABEL : LAUNCHD_LABEL) : (owner ? OWNER_SYSTEMD_UNIT : SYSTEMD_UNIT);
  const file = name === canonicalName ? canonical : path.join(path.dirname(canonical), darwin ? name + '.plist' : name);
  const body = readFile(file);
  if (body === null) return { scope, name, file, body };
  let definition: ServiceDefinition;
  try { definition = readServiceDefinition(body, process.platform, scope, name, os.userInfo().homedir); }
  catch (cause) { throw Error('Cannot establish which Omnitron instance owns ' + file, { cause }); }
  return { scope, name, file, body, definition };
}

function assertMember(item: NativeJob, authority: ManagedRuntime | null): void {
  const d = item.definition!;
  const uid = fs.statSync(OMNITRON_HOME).uid;
  const actor = os.userInfo();
  if (item.scope === 'user' && actor.uid !== uid ||
      item.scope === 'system' && (!d.account || fs.statSync(d.environment['HOME']!).uid !== uid ||
        (d.account === actor.username ? actor.uid : Number(execFileSync('/usr/bin/id', ['-u', d.account], { encoding: 'utf8' }).trim())) !== uid)) {
    throw Error('Service account differs from the selected instance owner at ' + item.file);
  }
  if (!authority) {
    if (d.role !== 'daemon' || (process.platform === 'darwin' && !d.environment['OMNITRON_HOME'] &&
        d.stderr !== path.join(OMNITRON_HOME, 'logs/launchd.err.log'))) {
      throw Error('Service has no matching private registration at ' + item.file);
    }
    return;
  }
  if (d.role === 'daemon') throw Error('Legacy service conflicts with the private supervision record at ' + item.file);
  const role = authority[d.role];
  const target = process.platform === 'darwin' ? role.label : role.unit;
  const release = path.join(OMNITRON_HOME, 'runtime/releases', role.artifact);
  if (item.name !== target || d.argv[0] !== path.join(release, 'node') || d.workdir !== path.join(release, 'packages/0')) {
    throw Error('Native service disagrees with its private role or sealed runtime at ' + item.file);
  }
}

/** Resolve on-disk membership before contacting any native manager, even for a read-only status. */
export function serviceInventory(): { owned: NativeService | null; foreign: NativeJob[] } {
  instanceLifecycleSocket();
  if (process.platform !== 'darwin' && process.platform !== 'linux') return { owned: null, foreign: [] };
  const record = privateAuthority();
  const foreign: NativeJob[] = [];
  const owned: NativeService[] = [];
  for (const scope of ['system', 'user'] as const) {
    const authority = record?.scope === scope ? record : null;
    const jobs = [job(scope, true, authority), job(scope, false, authority)].filter(item => item.body !== null);
    const matches = jobs.filter(item => path.resolve(item.definition!.home) === path.resolve(OMNITRON_HOME));
    foreign.push(...jobs.filter(item => !matches.includes(item)));
    if (!matches.length && !authority) continue;
    if (jobs.length !== matches.length || matches.length !== (authority ? 2 : 1)) throw Error('Incomplete or mixed native service registration in ' + scope + ' scope');
    for (const item of matches) assertMember(item, authority);
    owned.push({ scope, jobs: matches, managed: authority });
  }
  if (owned.length > 1) throw Error('Both user and system services claim this instance; reconcile their registrations first');
  return { owned: owned[0] ?? null, foreign };
}

export function installTargets(scope: ServiceScope, managed: boolean, inventory: ReturnType<typeof serviceInventory>): NativeJob[] {
  const targets = (managed ? [true, false] : [false]).map(owner => job(scope, owner, null));
  if (inventory.foreign.some(item => item.scope === scope) || targets.some(item => item.body !== null &&
      !inventory.owned?.jobs.some(owned => owned.file === item.file && owned.body === item.body))) {
    throw Error('The destination service registration belongs to another instance in ' + scope + ' scope');
  }
  if (inventory.owned && inventory.owned.scope === scope && inventory.owned.jobs.some(item => !targets.some(target => target.file === item.file))) {
    throw Error('Uninstall the existing native registration before changing its role set or names');
  }
  return targets;
}

export function unchangedJob(item: NativeJob): void {
  if (readFile(item.file) !== item.body) throw Error('Native service definition changed at ' + item.file);
}

export function nativeDomain(scope: ServiceScope): string {
  return scope === 'system' ? 'system' : 'gui/' + process.getuid!();
}

const nativeOptions = { encoding: 'utf8' as const, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, LC_ALL: 'C', LANG: 'C' } };

export function systemctl(scope: ServiceScope, args: string[]): string {
  return execFileSync('systemctl', [...(scope === 'user' ? ['--user'] : []), ...args], nativeOptions);
}

export function launchctl(args: string[]): string { return execFileSync('/bin/launchctl', args, nativeOptions); }

/** Site-owned resource controls do not change the selected process or its stop effects. */
function attestResourceDropIns(value: string | undefined): void {
  if (value === '') return;
  if (!value) throw Error('systemd did not report the effective drop-in paths');
  const allowed = /^(?:CPU(?:Accounting|Weight|Quota|QuotaPeriodSec)|IO(?:Accounting|Weight)|Memory(?:Accounting|Low|Min|High|Max|SwapMax)|Tasks(?:Accounting|Max)|Limit(?:NOFILE|NPROC|CORE|AS|MEMLOCK))=.+$/;
  for (const file of value.split(' ')) {
    if (!path.isAbsolute(file) || !file.endsWith('.conf') || file.includes('\\')) throw Error('Cannot resolve a unique systemd drop-in path');
    const raw = readFile(file);
    const lines = raw?.split('\n').map(line => line.trim()).filter(line => line && !/^[#;]/.test(line));
    if (!lines || lines[0] !== '[Service]' || raw!.split('\n').some(line => line.trimEnd().endsWith('\\')) ||
        lines.slice(1).some(line => !allowed.test(line))) throw Error('Cannot establish unchanged service identity and stop effects for drop-in ' + file);
  }
}

/** After the disk match, prove that this exact definition is what the addressed manager has loaded. */
export function nativeLoaded(item: NativeJob): { state: string; pid: string | undefined; lastExit: string | undefined } | false {
  unchangedJob(item);
  if (process.platform === 'darwin') {
    const target = nativeDomain(item.scope) + '/' + item.name;
    let out: string;
    try { out = launchctl(['print', target]); }
    catch (error) {
      const e = error as { status?: number; stderr?: string | Buffer };
      if (e.status === 113 && String(e.stderr).split('\n').some(line => line.startsWith('Could not find service "' + item.name + '" in domain '))) return false;
      throw Error('Cannot establish launchd registration for ' + target, { cause: error });
    }
    const d = item.definition;
    const args = out.match(/^\s*arguments = \{\n([^]*?)^\s*\}$/m)?.[1]?.trim().split('\n').map(line => line.trim());
    const top = out.match(/^[^\s].*? = \{$/m)?.[0];
    const paths = [...out.matchAll(/^\s*path = (.+)$/gm)].map(match => match[1]);
    if (!d || top !== target + ' = {' || paths[0] !== item.file ||
        !args || args.length !== d.argv.length || args.some((value, index) => value !== d.argv[index])) throw Error('Loaded launchd job differs from ' + item.file);
    if (d.account && out.match(/^\s*username = (.+)$/m)?.[1] !== d.account) {
      const pid = out.match(/^\s*pid = ([1-9]\d*)$/m)?.[1];
      if (!pid || /^\s*username = /m.test(out) ||
          execFileSync('/bin/ps', ['-p', pid, '-o', 'uid='], nativeOptions).trim() !== String(fs.statSync(OMNITRON_HOME).uid)) {
        throw Error('Cannot establish the loaded launchd service account for ' + item.file);
      }
    }
    for (const [key, expected] of Object.entries({ OMNITRON_HOME: d.home, OMNITRON_SOCKET: path.join(d.home, 'daemon.sock'),
      HOME: d.environment['HOME'] ?? os.userInfo().homedir })) {
      const values = [...out.matchAll(new RegExp('^\\s*' + key + ' => (.*)$', 'gm'))].map(match => match[1]);
      if (values.some(value => value !== expected) || (d.environment[key] !== undefined && !values.length)) throw Error('Loaded launchd environment differs from ' + item.file);
    }
    return { state: out.match(/^\s*state = (.+)$/m)?.[1] ?? 'loaded',
      pid: out.match(/^\s*pid = (\d+)$/m)?.[1], lastExit: out.match(/^\s*last exit code = (.+)$/m)?.[1] };
  }
  const fields = ['Id', 'FragmentPath', 'User', 'ActiveState', 'MainPID', 'Job', ...guardianStopProperties];
  let out: string;
  try { out = systemctl(item.scope, ['show', '--all', item.name, '--property=' + fields.join(',')]); }
  catch (error) {
    const e = error as { status?: number; stdout?: string };
    if (e.status !== 4 || typeof e.stdout !== 'string') throw error;
    out = e.stdout;
  }
  const facts: Record<string, string> = Object.create(null);
  for (const line of out.trim().split('\n')) {
    const index = line.indexOf('='), key = line.slice(0, index);
    if (index < 1 || Object.hasOwn(facts, key)) throw Error('Invalid systemd service metadata');
    facts[key] = line.slice(index + 1);
  }
  if (facts['Id'] !== item.name) throw Error('Unexpected systemd unit for ' + item.name);
  attestResourceDropIns(facts['DropInPaths']);
  if (facts['LoadState'] === 'not-found' && facts['ActiveState'] === 'inactive' && facts['MainPID'] === '0' &&
      facts['Job'] === '' && facts['FragmentPath'] === '') return false;
  if (!item.definition || facts['FragmentPath'] !== item.file) throw Error('Loaded systemd registration differs from ' + item.file);
  if (item.definition.account && facts['User'] !== item.definition.account) throw Error('Loaded systemd service account differs from ' + item.file);
  checkGuardianStopEffects({ ...facts, DropInPaths: '' }, true);
  if (item.scope === 'user' && !item.definition.environment['OMNITRON_HOME']) {
    for (const line of systemctl('user', ['show-environment']).split('\n')) {
      if ((line.startsWith('OMNITRON_HOME=') && line !== 'OMNITRON_HOME=' + item.definition.home) ||
          (line.startsWith('OMNITRON_SOCKET=') && line !== 'OMNITRON_SOCKET=' + path.join(item.definition.home, 'daemon.sock')) ||
          (line.startsWith('HOME=') && line !== 'HOME=' + os.userInfo().homedir)) throw Error('User manager environment differs from ' + item.file);
    }
  }
  return { state: facts['ActiveState'] ?? 'loaded', pid: facts['MainPID'] === '0' ? undefined : facts['MainPID'], lastExit: undefined };
}
