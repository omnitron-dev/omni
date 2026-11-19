import { expect, it } from 'vitest';
import { renderSystemdUnit, OWNER_SYSTEMD_UNIT, SYSTEMD_UNIT } from '../../src/commands/service-units.js';
import { guardianStopProperties } from '../../src/daemon/system-guardian-unit.js';
import { systemPairCommand, type PairSystem, type SystemPairRequest } from '../../src/commands/systemd-pair.js';

const request: SystemPairRequest = { account: 'resident', home: '/private/instance', state: '/var/lib/sample-state',
  from: { owner: 'a'.repeat(64), backend: 'b'.repeat(64) }, to: { owner: 'c'.repeat(64), backend: 'd'.repeat(64) }, record: 'e'.repeat(64) };
type Role = 'owner' | 'backend';
const names = { owner: OWNER_SYSTEMD_UNIT, backend: SYSTEMD_UNIT };
function render(role: Role, id: string) {
  const root = request.home + '/runtime/releases/' + id;
  return renderSystemdUnit({ scope: 'system', execPath: root + '/node', workdir: root + '/packages/0',
    entryPath: root + '/packages/0/dist/daemon/managed-entry.js', args: [role], nodeArgs: [], path: '/usr/bin:/bin',
    stderrLog: '/tmp/test', identity: { user: request.account, home: '/var/lib/sample' }, environment: { OMNITRON_HOME: request.home },
    ...(role === 'owner' ? { restart: false, forceKill: false } : {}) }).replace('[Service]\n',
    '[Service]\nTemporaryFileSystem=/private:mode=0755\nBindPaths=/var/lib/sample-state:/private/instance\n' +
    'BindReadOnlyPaths=/var/lib/reviewed/sample:/opt/services/sample\nGroup=workers\n');
}
function fixture() {
  const unit = { owner: render('owner', request.from.owner), backend: render('backend', request.from.backend) };
  const loaded = { ...request.from };
  const pid = { owner: 0, backend: 0 }, effects: string[] = [];
  const override: Record<string, string> = {};
  let revision = '42:43', state = request.record, fail = false;
  const os: PairSystem = {
    identity: () => ({ uid: 997, gid: 987, group: 'workers', machine: 'fixture' }),
    record(input) { if (input.record !== state) throw Error('active record'); return revision; },
    mountIdentity: () => '7:130',
    unit: role => unit[role],
    facts: role => ({ ...Object.fromEntries(guardianStopProperties.map(key => [key, ''])), NeedDaemonReload: 'no', LoadState: 'loaded',
      KillMode: 'control-group', Id: names[role], FragmentPath: '/etc/systemd/system/' + names[role], User: 'resident', Group: 'workers',
      WorkingDirectory: request.home + '/runtime/releases/' + loaded[role] + '/packages/0',
      ActiveState: pid[role] ? 'active' : 'inactive', SubState: pid[role] ? 'running' : 'dead', MainPID: String(pid[role]), Job: '', ...override }),
    property(role, name) {
      if (name === 'BindReadOnlyPaths') return [['/var/lib/reviewed/sample', '/opt/services/sample', false, 16_384]];
      if (name === 'BindPaths') return [[request.state, request.home, false, 16_384]];
      if (name === 'TemporaryFileSystem') return [['/private', 'mode=0755']];
      const base = request.home + '/runtime/releases/' + loaded[role];
      return [[base + '/node', [base + '/node', base + '/packages/0/dist/daemon/managed-entry.js', role], []]];
    },
    replace(role, before, after) {
      if (unit[role] !== before || fail && role === 'backend') throw Error('simulated interruption');
      unit[role] = after; effects.push('replace ' + role);
    },
    reload() {
      for (const role of ['owner', 'backend'] as const) loaded[role] = unit[role].includes(request.to[role]) ? request.to[role] : request.from[role];
      effects.push('reload');
    },
    start(role) { effects.push('start ' + role); pid[role] = role === 'owner' ? 419 : 827; },
    attest(role, actual) { if (actual !== pid[role]) throw Error('native identity mismatch'); },
  };
  return { os, unit, pid, effects, override, interrupt: (v: boolean) => { fail = v; }, move: () => { revision = '42:44'; },
    record: (v: string) => { state = v; }, call: (act: string, token?: string, input = request) => systemPairCommand(act, input, token, os) };
}

it('installs two reviewed native roles with their original namespace, resumes an interrupted write, and observes a repeated start', () => {
  const f = fixture(), { review } = f.call('review');
  f.interrupt(true);
  expect(() => f.call('install', review)).toThrow('interruption');
  expect(f.effects).toEqual(['replace owner']);
  f.interrupt(false);
  f.call('install', review);
  expect(f.unit).toEqual({ owner: render('owner', request.to.owner), backend: render('backend', request.to.backend) });
  expect(f.call('start', review).native.map(job => job.mainPid)).toEqual([419, 827]);
  f.call('start', review);
  expect(f.effects).toEqual(['replace owner', 'replace backend', 'reload', 'start owner', 'start backend']);
});

it('restores two different original role hashes and the exact original native policy under a fresh review', () => {
  const f = fixture(), before = { ...f.unit };
  f.call('install', f.call('review').review);
  const rollback = { ...request, from: request.to, to: request.from, record: 'f'.repeat(64) };
  f.record(rollback.record);
  f.call('install', f.call('review', undefined, rollback).review, rollback);
  expect(f.unit).toEqual(before);
});

it.each(['account', 'namespace', 'extra directive', 'scope', 'role', 'drop-in', 'job', 'stop side effect',
  'dirty reload', 'native program', 'privileged flag', 'foreign root', 'replacement record', 'active', 'changed review', 'wrong target',
  'replaced application copy', 'writable application mount', 'system mount', 'overlapping mount', 'wrong loaded mounts'])('refuses %s before a native effect', fault => {
  const f = fixture(), { review } = f.call('review');
  const input = structuredClone(request);
  if (fault === 'account') f.override['User'] = 'other';
  if (fault === 'namespace') f.unit.owner = f.unit.owner.replace('BindPaths=/var/lib/sample-state:', 'BindPaths=/var/lib/other:');
  if (fault === 'extra directive') f.unit.owner = f.unit.owner.replace('[Service]\n', '[Service]\nRestartPreventExitStatus=9\n');
  if (fault === 'scope') f.override['FragmentPath'] = '/etc/systemd/user/' + OWNER_SYSTEMD_UNIT;
  if (fault === 'role') f.unit.backend = f.unit.owner;
  if (fault === 'drop-in') f.override['DropInPaths'] = '/etc/other.conf';
  if (fault === 'job') f.override['Job'] = '893';
  if (fault === 'stop side effect') f.override['ConsistsOf'] = 'other.service';
  if (fault === 'dirty reload') f.override['NeedDaemonReload'] = 'unknown';
  if (fault === 'native program' || fault === 'privileged flag' || fault === 'wrong loaded mounts') {
    const normal = f.os.property;
    f.os.property = (role, name) => {
      if (fault === 'wrong loaded mounts' && name === 'BindPaths') return [['/var/lib/another', request.home, false, 0]];
      if (name === 'ExecStartEx' && fault === 'native program') return [['/opt/unrelated', ['/opt/unrelated'], []]];
      const rows = normal(role, name) as unknown[][];
      if (name === 'ExecStartEx' && fault === 'privileged flag') rows[0]![2] = ['privileged'];
      return rows;
    };
  }
  if (fault === 'foreign root') f.move();
  if (fault === 'replacement record') f.record('f'.repeat(64));
  if (fault === 'active') f.pid.backend = 98;
  if (fault === 'wrong target') input.to.owner = '9'.repeat(64);
  if (fault === 'replaced application copy') f.os.mountIdentity = () => '7:197';
  if (fault === 'writable application mount') f.unit.owner = f.unit.owner.replace('BindReadOnlyPaths=', 'BindPaths=');
  if (fault === 'system mount') f.unit.owner = f.unit.owner.replace('/opt/services/sample', '/usr/bin');
  if (fault === 'overlapping mount') f.unit.owner = f.unit.owner.replace('Group=workers', 'BindReadOnlyPaths=/srv/other:/opt/services/sample/sub\nGroup=workers');
  expect(() => f.call('install', fault === 'changed review' ? '8'.repeat(64) : review, input)).toThrow();
  expect(f.effects).toEqual([]);
});

it('refuses a mixed pair or a changed kernel process before starting the next role', () => {
  const f = fixture(), { review } = f.call('review');
  expect(() => f.call('start', review)).toThrow('Install');
  expect(f.effects).toEqual([]);
  f.call('install', review);
  f.pid.owner = 42;
  f.os.attest = () => { throw Error('kernel credential mismatch'); };
  expect(() => f.call('start', review)).toThrow('kernel credential');
  expect(f.effects).not.toContain('start backend');
});
