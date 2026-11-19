import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAUNCHD_LABEL, SYSTEMD_UNIT, OWNER_LAUNCHD_LABEL, OWNER_SYSTEMD_UNIT, renderLaunchdPlist, renderSystemdUnit, type UnitInputs } from '../../src/commands/service-units.js';

const fixture = vi.hoisted(() => ({ root: '', login: '', started: [] as string[], clients: [] as string[],
  shutdowns: [] as string[], forks: 0, reach: true, control: [] as string[] }));
vi.mock('node:child_process', async original => {
  const deny = () => { throw Error('Unexpected subprocess'); };
  return { ...await original<typeof import('node:child_process')>(), execFileSync: vi.fn(deny),
    exec: deny, execFile: deny, spawn: deny, spawnSync: deny, fork: deny };
});
vi.mock('../../src/commands/service-units.js', async original => {
  const units = await original<typeof import('../../src/commands/service-units.js')>();
  return { ...units, unitPathFor: (platform: NodeJS.Platform, scope: 'user' | 'system', _home: string, owner = false) =>
    path.join(fixture.root, 'registry', scope, path.basename(units.unitPathFor(platform, scope, '/test-account', owner))) };
});
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: (socket: string) => {
  fixture.clients.push(socket);
  return { isReachable: async () => fixture.reach, shutdown: async () => { fixture.shutdowns.push(socket); },
    ping: async () => ({ pid: 1707, version: 'test' }), disconnect: async () => {} };
} }));
vi.mock('../../src/daemon/private-control-client.js', () => ({ privateControlClient: async (socket: string) => {
  fixture.control.push(socket); throw Error('Test supervisor is offline');
} }));
vi.mock('../../src/daemon/runtime-installation.js', () => ({ selectedBackend: async () => null,
  RuntimeInstallation: { open: async () => ({ directory: path.join(selected, 'runtime'), activation: () => null,
    selection: () => ({ current: 'b'.repeat(64) }), exclusive: (work: () => unknown) => work(), close: async () => {},
    artifact: async (hash: string) => ({ directory: path.join(selected, 'runtime/releases', hash, 'packages/0/dist'),
      execPath: path.join(selected, 'runtime/releases', hash, 'node'), executionRequirements: { stackControl: 1 } }) }) },
  withRuntimeStartup: (_entry: string, start: () => unknown) => start() }));
vi.mock('../../src/daemon/daemon.js', () => ({ OmnitronDaemon: class {
  async start(_config: unknown, _options: unknown, dc: { socketPath: string }) { fixture.started.push(dc.socketPath); }
} }));
vi.mock('../../src/daemon/spawn-daemon.js', () => ({ spawnDaemon: () => { fixture.forks++; return {}; } }));
vi.mock('../../src/config/loader.js', () => ({ loadEcosystemConfig: async () => ({ apps: [] }) }));
vi.mock('../../src/project/registry.js', () => ({ ProjectRegistry: { open: () => ({
  autoDetect: () => null, list: () => [], listRegistrations: () => [],
}) } }));

const realPlatform = process.platform;
const actor = os.userInfo();
let selected = '';
let calls: string[][] = [];
let overrides = new Map<string, string>();
let dropIns = '';
const loaded = new Map<string, { file: string; argv: string[]; environment: Record<string, string> }>();
const currentSocket = () => path.join(selected, 'daemon.sock');
const label = (owner = false) => process.platform === 'darwin' ? owner ? OWNER_LAUNCHD_LABEL : LAUNCHD_LABEL : owner ? OWNER_SYSTEMD_UNIT : SYSTEMD_UNIT;
const file = (scope: string, name: string) => path.join(fixture.root, 'registry', scope, name + (process.platform === 'darwin' ? '.plist' : ''));
const mutations = () => calls.filter(args => args.some(word => ['enable', 'disable', 'start', 'kickstart', 'bootout', 'bootstrap', 'daemon-reload'].includes(word)));

function select(home: string, explicit = true): void {
  selected = home;
  if (explicit) vi.stubEnv('OMNITRON_HOME', home);
  else vi.stubEnv('OMNITRON_HOME', undefined);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ initialized: true, role: 'master' }));
}

function unit(scope: 'user' | 'system', home: string, options: { legacy?: boolean; managed?: 'owner' | 'backend'; customName?: string } = {}) {
  const role = options.managed;
  const name = options.customName ?? label(role === 'owner');
  const workdir = role ? path.join(home, 'runtime/releases', (role === 'owner' ? 'a' : 'b').repeat(64), 'packages/0') : '/opt/demo installation';
  const exec = role ? path.resolve(workdir, '../../node') : '/opt/demo node';
  const entry = path.join(workdir, role ? 'dist/daemon/managed-entry.js' : 'dist/daemon/daemon-entry.js');
  const environment: Record<string, string> = options.legacy ? {} : { OMNITRON_HOME: home };
  const inputs: UnitInputs = { scope, label: name, execPath: exec, entryPath: entry, workdir, path: '/usr/bin:/bin', environment,
    stderrLog: path.join(home, role ? 'execution/' + (role === 'owner' ? 'owner-service.log' : 'supervisor.log') : 'logs/launchd.err.log'),
    ...(role ? { args: [role], nodeArgs: [], ...(role === 'owner' ? { restart: false, forceKill: false } : {}) } : {}),
    ...(scope === 'system' ? { identity: { user: actor.username, home: fixture.login } } : {}) };
  const answer = process.platform === 'darwin' ? renderLaunchdPlist(inputs) : renderSystemdUnit(inputs);
  const target = file(scope, name);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  fs.writeFileSync(target, answer);
  const argv = [exec, ...(role ? [entry, role] : ['--import', 'tsx/esm', entry])];
  loaded.set(scope + '/' + name, { file: target, argv, environment: { ...environment, ...(scope === 'system' ? { HOME: fixture.login } : {}) } });
  return target;
}

/** The fake domain stores what was loaded separately from the file, so stale and orphan jobs are testable. */
function manager(command: string, args: readonly string[]): string {
  if (command === '/usr/bin/id' && args[0] === '-u' && args[1] === actor.username) return String(actor.uid);
  if (command === '/bin/sh') return '';
  if (command === 'loginctl') return 'Linger=yes';
  if (!['/bin/launchctl', 'systemctl'].includes(command)) throw Error('Unexpected native command: ' + command);
  calls.push([command, ...args]);
  if (command === '/bin/launchctl') {
    const [action, target, source] = args;
    const scope = target?.startsWith('system') ? 'system' : 'user';
    const name = action === 'bootstrap' ? path.basename(source!, '.plist') : target?.split('/').at(-1);
    const key = scope + '/' + name;
    const job = loaded.get(key);
    if (action === 'print') {
      if (overrides.has(key)) return overrides.get(key)!;
      if (!job) throw Object.assign(Error('not found'), { status: 113, stderr: 'Could not find service "' + name + '" in domain ' + target });
      return target + ' = {\n\tpath = ' + job.file + (scope === 'system' ? '\n\tusername = ' + actor.username : '') + '\n\tstate = running\n\targuments = {\n' + job.argv.map(arg => '\t\t' + arg).join('\n') +
        '\n\t}\n\tenvironment = {\n' + Object.entries(job.environment).map(([k,v]) => '\t\t' + k + ' => ' + v).join('\n') + '\n\t}\n}';
    }
    if (action === 'bootout') loaded.delete(key);
    if (action === 'bootstrap') {
      const body = fs.readFileSync(source!, 'utf8');
      const array = body.split('<key>ProgramArguments</key>')[1]!.split('</array>')[0]!;
      const env = body.split('<key>EnvironmentVariables</key>')[1]!.split('</dict>')[0]!;
      loaded.set(key, { file: source!, argv: [...array.matchAll(/<string>(.*?)<\/string>/g)].map(match => match[1]!),
        environment: Object.fromEntries([...env.matchAll(/<key>(\w+)<\/key>\s*<string>(.*?)<\/string>/g)].map(match => [match[1]!, match[2]!])) });
    }
  } else {
    const scope = args[0] === '--user' ? 'user' : 'system';
    const operation = args[0] === '--user' ? args.slice(1) : args;
    if (operation[0] === 'show-environment') return 'HOME=' + fixture.login;
    if (operation[0] === 'show') {
      const name = operation.find(word => word.endsWith('.service'))!;
      const key = scope + '/' + name;
      if (overrides.has(key)) return overrides.get(key)!;
      const target = loaded.get(key)?.file ?? (fs.existsSync(file(scope, name)) ? file(scope, name) : '');
      const properties: Record<string, string> = { Id: name, LoadState: target ? 'loaded' : 'not-found', User: scope === 'system' ? actor.username : '',
        MainPID: '0', ActiveState: 'inactive', SubState: 'dead', Job: '', DropInPaths: dropIns, FragmentPath: target, NeedDaemonReload: 'no', KillMode: 'control-group' };
      return operation.find(arg => arg.startsWith('--property='))!.slice(11).split(',').map(key => key + '=' + (properties[key] ?? '')).join('\n');
    }
  }
  return '';
}

beforeEach(() => {
  vi.resetModules();
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'));
  fixture.login = path.join(fixture.root, 'account');
  fs.mkdirSync(fixture.login);
  vi.spyOn(os, 'homedir').mockReturnValue(fixture.login);
  vi.spyOn(os, 'userInfo').mockReturnValue({ ...actor, homedir: fixture.login });
  vi.spyOn(process, 'kill').mockImplementation(() => { throw Error('Unexpected signal'); });
  vi.mocked(execFileSync).mockImplementation((cmd, args) => manager(String(cmd), (args as string[]) ?? []));
  vi.stubEnv('OMNITRON_SOCKET', undefined);
  calls = []; overrides = new Map(); dropIns = ''; loaded.clear();
  fixture.clients = []; fixture.control = []; fixture.shutdowns = []; fixture.started = []; fixture.forks = 0; fixture.reach = true;
});
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform });
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

describe.each(['darwin', 'linux'] as const)('%s instance lifecycle', platform => {
  beforeEach(() => { Object.defineProperty(process, 'platform', { value: platform }); });
  it('runs and stops a private foreground process with foreign user and system registrations untouched', async () => {
    select(path.join(fixture.root, 'private'));
    vi.stubEnv('OMNITRON_SOCKET', currentSocket());
    const user = unit('user', path.join(fixture.login, '.omnitron'), { legacy: true });
    const system = unit('system', path.join(fixture.root, 'another'));
    const original = [user, system].map(p => fs.readFileSync(p));
    const { upCommand, downCommand } = await import('../../src/commands/up.js');
    const { serviceStatus, serviceUninstall, serviceInstall } = await import('../../src/commands/service.js');
    await expect(upCommand({ foreground: true, noInfra: true, noWatch: true })).resolves.toBe('foreground-running');
    await downCommand();
    await serviceStatus(); await serviceUninstall();
    await expect(serviceInstall({ scope: 'user' })).rejects.toThrow('another instance');
    expect(fixture.started).toEqual([currentSocket()]);
    expect(fixture.shutdowns).toEqual([currentSocket()]);
    expect(fixture.control).toEqual([]);
    expect(calls).toEqual([]);
    expect([user, system].map(p => fs.readFileSync(p))).toEqual(original);
  });

  it.each(['user', 'system'] as const)('stops the installed %s default, then leaves the other scope alone', async scope => {
    select(path.join(fixture.login, '.omnitron'), false);
    unit(scope, selected, { legacy: true });
    const other = unit(scope === 'system' ? 'user' : 'system', path.join(fixture.root, 'elsewhere'));
    const { downCommand } = await import('../../src/commands/up.js');
    await downCommand();
    expect(mutations()).toEqual(platform === 'darwin'
      ? [['/bin/launchctl', 'bootout', (scope === 'system' ? 'system' : 'gui/' + process.getuid!()) + '/' + label()]]
      : [['systemctl', ...(scope === 'user' ? ['--user'] : []), 'disable', '--now', label()]]);
    await (await import('../../src/commands/service.js')).serviceUninstall();
    expect(fs.existsSync(other)).toBe(true);
    expect(fs.existsSync(file(scope, label()))).toBe(false);
    expect(fixture.clients).toEqual([]);
  });

  it('uses the service account when a different root operator addresses the system registration', async () => {
    select(path.join(fixture.root, 'dedicated'));
    unit('system', selected);
    const user = unit('user', path.join(fixture.root, 'foreign'));
    vi.spyOn(os, 'userInfo').mockReturnValue({ ...actor, homedir: fixture.login, username: 'fixture-admin', uid: 0 });
    vi.spyOn(process, 'getuid').mockReturnValue(0);
    const { downCommand } = await import('../../src/commands/up.js');
    await downCommand();
    expect(mutations()).toEqual(platform === 'darwin' ? [['/bin/launchctl', 'bootout', 'system/' + label()]]
      : [['systemctl', 'disable', '--now', label()]]);
    expect(fs.existsSync(user)).toBe(true);
  });

  it('checks the private PID when a private RPC is offline with a default daemon present', async () => {
    select(path.join(fixture.root, 'private'));
    const otherHome = path.join(fixture.login, '.omnitron');
    fs.mkdirSync(otherHome);
    fs.writeFileSync(path.join(otherHome, 'daemon.pid'), '98381\n');
    unit('user', otherHome, { legacy: true });
    fixture.reach = false;
    const { downCommand } = await import('../../src/commands/up.js');
    await downCommand();
    expect(fixture.clients).toEqual([currentSocket()]); expect(fixture.shutdowns).toEqual([]);
    expect(process.kill).not.toHaveBeenCalled(); expect(calls).toEqual([]);
    expect(fs.readFileSync(path.join(otherHome, 'daemon.pid'), 'utf8')).toBe('98381\n');
  });

  it('refuses a socket-only override before PID lookup, RPC, native commands, or foreground startup', async () => {
    select(path.join(fixture.login, '.omnitron'), false);
    fs.writeFileSync(path.join(selected, 'daemon.pid'), '98381\n');
    vi.stubEnv('OMNITRON_SOCKET', path.join(fixture.root, 'other.sock'));
    const { upCommand, downCommand } = await import('../../src/commands/up.js');
    const { daemonStop, daemonKill } = await import('../../src/commands/daemon-cmd.js');
    const { serviceInstall, serviceUninstall, serviceStatus } = await import('../../src/commands/service.js');
    for (const op of [() => upCommand({ foreground: true }), () => upCommand(), downCommand, daemonStop, daemonKill,
      () => serviceInstall(), serviceUninstall, serviceStatus]) await expect(op()).rejects.toThrow('OMNITRON_SOCKET');
    expect(calls).toEqual([]); expect(fixture.clients).toEqual([]); expect(process.kill).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(selected, 'daemon.pid'), 'utf8')).toBe('98381\n');
  });

  it('installs a custom home explicitly, finds its unit subsequently, and preserves a foreign system registration', async () => {
    select(path.join(fixture.root, 'custom'));
    const foreign = unit('system', path.join(fixture.root, 'foreign'));
    const { serviceInstall, serviceUninstall, serviceStatus } = await import('../../src/commands/service.js');
    await serviceInstall({ scope: 'user' });
    const definition = fs.readFileSync(file('user', label()), 'utf8');
    expect(definition).toContain('OMNITRON_HOME'); expect(definition).toContain(selected);
    expect(mutations().some(args => args.includes(platform === 'darwin' ? 'bootstrap' : 'enable'))).toBe(true);
    await serviceStatus(); await serviceUninstall();
    expect(fs.existsSync(foreign)).toBe(true); expect(fs.existsSync(file('user', label()))).toBe(false);
    expect(calls.every(args => platform === 'linux' ? args[1] === '--user' : !args.some(arg => arg.startsWith('system/')))).toBe(true);
  });

  it('rejects ambiguous active membership without unloading any role or silently forking', async () => {
    select(path.join(fixture.root, 'custom'));
    unit('user', selected);
    overrides.set('user/' + label(), platform === 'darwin' ? 'wrong/target = {\n path = /other.plist\n}' :
      'Id=' + label() + '\nLoadState=loaded\nDropInPaths=\nFragmentPath=/other.service');
    const { upCommand, downCommand } = await import('../../src/commands/up.js');
    const { serviceInstall, serviceUninstall, serviceStatus } = await import('../../src/commands/service.js');
    for (const op of [() => upCommand(), downCommand, serviceUninstall, serviceStatus, () => serviceInstall({ scope: 'user' })]) {
      await expect(op()).rejects.toThrow(/Loaded .* differs/);
    }
    expect(mutations()).toEqual([]); expect(fixture.forks).toBe(0); expect(fixture.clients).toEqual([]);
  });

  it('refuses conflicting scopes and a surviving native job whose fragment has disappeared', async () => {
    select(path.join(fixture.root, 'custom'));
    const user = unit('user', selected), system = unit('system', selected);
    const { serviceInstall, serviceUninstall } = await import('../../src/commands/service.js');
    await expect(serviceUninstall()).rejects.toThrow('Both user and system');
    expect(calls).toEqual([]);
    fs.unlinkSync(user); fs.unlinkSync(system);
    await expect(serviceInstall({ scope: 'user' })).rejects.toThrow(/Loaded .* differs/);
    expect(mutations()).toEqual([]); expect(fixture.clients).toEqual([]);
  });
  it('installs independent supervision through the public service command into a fresh custom home', async () => {
    select(path.join(fixture.root, 'i'));
    const directory = path.join(selected, 'execution');
    fs.mkdirSync(path.join(selected, 'runtime'), { mode: 0o700 });
    fs.writeFileSync(path.join(selected, 'config.json'), JSON.stringify({ role: 'master', executionHost: { enabled: true, directory } }));
    const release = path.join(selected, 'runtime/releases', 'b'.repeat(64), 'packages/0/dist');
    fs.mkdirSync(path.join(release, 'daemon'), { recursive: true });
    fs.writeFileSync(path.join(release, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(release, 'daemon/managed-entry.js'), '');
    fs.writeFileSync(path.join(release, 'daemon/execution-capabilities.js'), 'export const OWNER_CAPABILITIES = {stackControl: 1};');
    const foreign = unit('system', path.join(fixture.root, 'foreign'));
    const { serviceInstall, serviceStatus, serviceUninstall } = await import('../../src/commands/service.js');
    await serviceInstall({ scope: 'user' });
    const record = JSON.parse(fs.readFileSync(path.join(selected, 'runtime/supervision.json'), 'utf8'));
    expect(record.instanceHome).toBe(selected); expect(record.directory).toBe(directory);
    for (const owner of [true, false]) expect(fs.readFileSync(file('user', label(owner)), 'utf8')).toContain(selected);
    expect(mutations().filter(args => args.includes(platform === 'darwin' ? 'bootstrap' : '--now'))).toHaveLength(2);
    await serviceStatus();
    expect(fixture.control).toEqual([path.join(directory, 'supervisor.sock')]);
    await serviceUninstall();
    expect(fs.existsSync(foreign)).toBe(true);
    expect(calls.every(args => platform === 'linux' ? args[1] === '--user' : !args.some(arg => arg.startsWith('system/')))).toBe(true);
  });

  it('checks both native roles against the deliberately registered custom home and its private authority', async () => {
    select(path.join(fixture.root, 'i'));
    const directory = path.join(selected, 'execution');
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.mkdirSync(path.join(selected, 'runtime'), { mode: 0o700 });
    fs.writeFileSync(path.join(selected, 'config.json'), JSON.stringify({ role: 'master', executionHost: { enabled: true, directory } }));
    const authority = { protocol: 1, instanceHome: selected, directory, cwd: selected, scope: 'user',
      environment: { OMNITRON_HOME: selected }, owner: { label: 'dev.omnitron.demo.owner', unit: 'omnitron-demo-owner.service', artifact: 'a'.repeat(64) },
      backend: { label: 'dev.omnitron.demo.backend', unit: 'omnitron-demo-backend.service', artifact: 'b'.repeat(64) } };
    const record = path.join(selected, 'runtime/supervision.json');
    fs.writeFileSync(record, JSON.stringify(authority), { mode: 0o600 });
    const roleName = (role: 'owner' | 'backend') => platform === 'darwin' ? authority[role].label : authority[role].unit;
    const owner = unit('user', selected, { managed: 'owner', customName: roleName('owner') });
    unit('user', selected, { managed: 'backend', customName: roleName('backend') });
    const foreign = unit('user', path.join(fixture.root, 'foreign'));
    const { upCommand, downCommand } = await import('../../src/commands/up.js');
    const { serviceStatus, serviceUninstall } = await import('../../src/commands/service.js');
    for (const options of [{ foreground: true }, { noInfra: true }, { noWatch: true }]) {
      await expect(upCommand(options)).rejects.toThrow('verified registration');
    }
    expect(calls).toEqual([]); expect(fixture.started).toEqual([]);
    await serviceStatus();
    expect(fixture.control).toEqual([path.join(directory, 'supervisor.sock')]);
    const old = fs.readFileSync(owner, 'utf8');
    fs.writeFileSync(owner, old.replaceAll('a'.repeat(64), 'c'.repeat(64)));
    calls = [];
    await expect(downCommand()).rejects.toThrow('private role or sealed runtime');
    expect(calls).toEqual([]);
    fs.writeFileSync(owner, old);
    await downCommand();
    const actions = mutations();
    expect(actions.map(args => args.at(-1)?.split('/').at(-1))).toEqual([roleName('backend'), roleName('owner')]);
    await serviceUninstall();
    expect(fs.existsSync(record)).toBe(false); expect(fs.existsSync(foreign)).toBe(true);
  });

  it('starts a background process directly for a foreign registration and uses the manager for its own', async () => {
    select(path.join(fixture.root, 'private'));
    unit('user', path.join(fixture.root, 'other'));
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => { throw Error('fixture exit ' + code); });
    const { upCommand } = await import('../../src/commands/up.js');
    await expect(upCommand()).rejects.toThrow('fixture exit 0');
    expect(calls).toEqual([]); expect(fixture.forks).toBe(1);
    unit('user', selected);
    await expect(upCommand()).rejects.toThrow('fixture exit 0');
    expect(mutations().some(args => args.includes(platform === 'darwin' ? 'kickstart' : 'enable'))).toBe(true);
    expect(fixture.forks).toBe(1); expect(fixture.clients).toEqual([currentSocket(), currentSocket()]);
    exit.mockRestore();
  });

  it('preserves ambiguous definitions, linked endpoints and their registered service', async () => {
    select(path.join(fixture.root, 'private'));
    const target = unit('user', selected);
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8') + '\ninvalid directive');
    const { downCommand } = await import('../../src/commands/up.js');
    await expect(downCommand()).rejects.toThrow('Cannot establish');
    const pid = path.join(selected, 'daemon.pid');
    fs.symlinkSync(path.join(fixture.root, 'another.pid'), pid);
    await expect(downCommand()).rejects.toThrow('symbolic link');
    expect(fs.lstatSync(pid).isSymbolicLink()).toBe(true);
    expect(calls).toEqual([]); expect(fixture.clients).toEqual([]);
  });
});

it('accepts an effective systemd resource limit and refuses a service-identity override before any effect', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  select(path.join(fixture.root, 'custom'));
  unit('user', selected);
  const dir = path.join(fixture.root, 'site.d');
  fs.mkdirSync(dir);
  dropIns = path.join(dir, 'limits.conf');
  fs.writeFileSync(dropIns, '[Service]\nMemoryMax=512M\nCPUQuota=50%\n');
  const { downCommand } = await import('../../src/commands/up.js');
  await downCommand();
  expect(mutations()).toHaveLength(1);
  calls = [];
  fs.writeFileSync(dropIns, '[Service]\nEnvironment=OMNITRON_HOME=/unrelated\n');
  await expect(downCommand()).rejects.toThrow('drop-in');
  expect(mutations()).toEqual([]); expect(fixture.clients).toEqual([]);
});
