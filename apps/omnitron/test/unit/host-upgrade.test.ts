import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  planHostUpgrade, executeHostUpgrade, recoverHostUpgrade, verifyRestoredInventory, bundleProbeCommand,
  hookCommand, receiptCommand, updateContractBindingsCommand, runtimeStartCommand, runtimeStopCommand,
  type HostInventory, type InstalledBundle, type HostUpgradeActions,
} from '../../src/services/host-upgrade.js';
import { pruneSteps } from '../../src/services/bundle-builder.js';

const old: InstalledBundle = { root: '/opt/omnitron/versions/0.2.0+old.1', version: '0.2.0+old.1', commit: 'a'.repeat(40) };
const next: InstalledBundle = { root: '/opt/omnitron/versions/0.2.0+next.2', version: '0.2.0+next.2', commit: 'b'.repeat(40) };
function inventory(): HostInventory {
  return {
    runtime: { kind: 'fork', cwd: '/apps' },
    status: { version: '0.2.0', build: { commit: old.commit, dirty: false }, pid: 100, apps: [
      { name: 'one/prod/benchmarks', status: 'online' }, { name: 'two/prod/benchmarks', status: 'online' },
    ] },
    projects: [{ name: 'one', path: '/apps/one', enabledStacks: ['prod'] }, { name: 'two', path: '/apps/two', enabledStacks: ['prod'] }],
    stacks: ['one', 'two'].map(project => ({ project, path: `/apps/${project}`, stacks: [
      { name: 'prod', type: 'local', apps: [{ handleKey: `${project}/prod/benchmarks`, status: 'online' }] },
      { name: 'idle', type: 'local', apps: [{ handleKey: `${project}/idle/worker`, status: 'stopped' }] },
    ] })),
    contracts: ['one', 'two'].map(project => ({ project, schema: 1, apps: ['prod/benchmarks', 'idle/worker'].map(name => ({
      name: `${project}/${name}`, cwd: `/apps/${project}/releases/first`, version: 'first', health: ['node', 'health.mjs'],
      binding: { kind: 'hook' as const, bundleRoot: old.root, bundleEnv: 'DECLARED_BUNDLE', rebind: ['node', 'bind.mjs'], verify: ['node', 'verify.mjs'] },
    })) })),
  };
}
function actions() {
  const calls: string[] = [];
  const api: HostUpgradeActions = {
    save: vi.fn(async r => { calls.push(`save:${r.phase}`); }),
    stop: vi.fn(async b => { calls.push(`stop:${b.version}`); }),
    activate: vi.fn(async b => { calls.push(`activate:${b.version}`); }),
    rebind: vi.fn(async (a, b) => { calls.push(`rebind:${a.name}:${b.version}`); }),
    start: vi.fn(async b => { calls.push(`start:${b.version}`); }),
    verify: vi.fn(async b => { calls.push(`verify:${b.version}`); }),
    prune: vi.fn(async () => { calls.push('prune'); }),
  };
  return { calls, api };
}
describe('host upgrade inventory preflight', () => {
  it('keeps qualified names from different projects and disabled apps distinct', () => {
    const p = planHostUpgrade(old, next, inventory());
    expect(p.online).toEqual(['one/prod/benchmarks', 'two/prod/benchmarks']);
    expect(p.offline).toEqual(['one/idle/worker', 'two/idle/worker']);
    expect(p.apps).toHaveLength(4);
  });
  it.each([
    ['missing rebind contract', (i: HostInventory) => { i.contracts = []; }],
    ['stale binding', (i: HostInventory) => { (i.contracts[0]!.apps[0]!.binding as any).bundleRoot = '/current'; }],
    ['missing health', (i: HostInventory) => { delete i.contracts[0]!.apps[0]!.health; }],
    ['missing hook', (i: HostInventory) => { (i.contracts[0]!.apps[0]!.binding as any).rebind = []; }],
    ['partial enabled stack', (i: HostInventory) => { i.stacks[0]!.stacks[0]!.apps[0]!.status = 'stopped'; }],
    ['disabled online stack', (i: HostInventory) => { i.projects[0]!.enabledStacks = []; }],
    ['enabled remote stack', (i: HostInventory) => { i.stacks[0]!.stacks[0]!.type = 'remote'; }],
    ['unregistered online handle', (i: HostInventory) => { i.status.apps.push({ name: 'orphan', status: 'online' }); }],
    ['duplicate app', (i: HostInventory) => { i.status.apps.push(i.status.apps[0]!); }],
    ['wrong daemon build', (i: HostInventory) => { i.status.build.commit = next.commit; }],
    ['unknown enabled stack', (i: HostInventory) => { i.projects[0]!.enabledStacks.push('unknown'); }],
  ])('refuses %s before any mutation', (_name, change) => {
    const i = inventory(); change(i); expect(() => planHostUpgrade(old, next, i)).toThrow();
  });
  it('rejects daemon-only success and accidental startup of an offline app', () => {
    const p = planHostUpgrade(old, next, inventory());
    const status = { ...p.inventory.status, build: { commit: next.commit, dirty: false }, apps: [] };
    expect(() => verifyRestoredInventory(p, next, status)).toThrow(/exactly/);
    status.apps = [...p.inventory.status.apps, { name: p.offline[0]!, status: 'online' }] as never;
    expect(() => verifyRestoredInventory(p, next, status)).toThrow(/exactly/);
  });
});
describe('host upgrade recovery order', () => {
  it('persists intent before stop and verifies every app before retention', async () => {
    const { api, calls } = actions(); const p = planHostUpgrade(old, next, inventory());
    const result = await executeHostUpgrade(p, 'upgrade', api);
    expect(result.outcome).toBe('upgraded');
    expect(calls.indexOf('save:prepared')).toBeLessThan(calls.indexOf(`stop:${old.version}`));
    expect(calls.indexOf(`verify:${next.version}`)).toBeLessThan(calls.indexOf('prune'));
    expect(api.prune).toHaveBeenCalledWith([old.root, next.root]);
    expect(api.rebind).toHaveBeenCalledTimes(4);
  });
  it('does not stop when the durable receipt cannot be written', async () => {
    const { api } = actions(); vi.mocked(api.save).mockRejectedValue(new Error('disk full'));
    await expect(executeHostUpgrade(planHostUpgrade(old, next, inventory()), 'upgrade', api)).rejects.toThrow('disk full');
    expect(api.stop).not.toHaveBeenCalled();
  });
  it.each(['activate', 'rebind', 'start', 'verify'] as const)('recovers failed %s and never prunes', async failure => {
    const { api, calls } = actions(); vi.mocked(api[failure]).mockRejectedValueOnce(new Error('injected failure'));
    const result = await executeHostUpgrade(planHostUpgrade(old, next, inventory()), 'upgrade', api);
    expect(result.outcome).toBe('rolled-back');
    expect(api.prune).not.toHaveBeenCalled();
    expect(calls).toContain(`activate:${old.version}`);
    expect(calls).toContain(`verify:${old.version}`);
    expect(result.plan.inventory.projects).toEqual(inventory().projects);
    expect(result.events.some(e => e.error?.includes('injected failure'))).toBe(true);
  });
  it.each(['stopping', 'activating', 'rebinding', 'starting', 'verifying'])('recovers durable intent left in %s without pruning', async phase => {
    const { api } = actions();
    const receipt = { schema: 1 as const, id: 'interrupted', plan: planHostUpgrade(old, next, inventory()), phase, outcome: 'running' as const, events: [] };
    const recovered = await recoverHostUpgrade(receipt, api);
    expect(recovered.outcome).toBe('rolled-back'); expect(api.activate).toHaveBeenCalledWith(old);
    expect(api.verify).toHaveBeenCalledWith(old); expect(api.prune).not.toHaveBeenCalled();
    expect(api.rebind).toHaveBeenCalledTimes(4);
  });
  it('never writes terminal upgraded status into rollback intent after a failed verified receipt write', async () => {
    const { api } = actions(); const saved: Array<{phase: string; outcome: string}> = [];
    vi.mocked(api.save).mockImplementation(async receipt => {
      if (receipt.phase === 'verified') throw Error('lost verified receipt write');
      saved.push({ phase: receipt.phase, outcome: receipt.outcome });
    });
    const result = await executeHostUpgrade(planHostUpgrade(old, next, inventory()), 'upgrade', api);
    expect(result.outcome).toBe('rolled-back');
    expect(saved.filter(record => ['rollback', 'recovering'].includes(record.phase))).toEqual([
      { phase: 'rollback', outcome: 'running' }, { phase: 'recovering', outcome: 'running' },
    ]);
    expect(api.prune).not.toHaveBeenCalled();
  });
  it('keeps a recovery-required receipt when rollback bindings fail; does not restart inconsistent apps', async () => {
    const { api } = actions(); vi.mocked(api.rebind).mockRejectedValue(new Error('binding unavailable'));
    const result = await executeHostUpgrade(planHostUpgrade(old, next, inventory()), 'upgrade', api);
    expect(result.outcome).toBe('recovery-required');
    expect(api.start).not.toHaveBeenCalled(); expect(api.prune).not.toHaveBeenCalled();
    expect(result.phase).toBe('recovery-required');
  });
});

describe('generated remote commands on a real filesystem', () => {
  function temporary(run: (directory: string) => void) {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'host-upgrade-')));
    try { run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
  const execute = (command: string) => execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  it('checks installed metadata and rejects a dirty or mismatched candidate', () => temporary(dir => {
    const root = path.join(dir, 'versions', next.version); fs.mkdirSync(path.join(root, 'dist/cli'), { recursive: true });
    const meta = { version: next.version, commit: next.commit, dirty: false };
    fs.writeFileSync(path.join(root, 'BUNDLE.json'), JSON.stringify(meta));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: next.version }));
    fs.writeFileSync(path.join(root, 'dist/BUILD.json'), JSON.stringify(meta));
    fs.writeFileSync(path.join(root, 'dist/cli/omnitron.js'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.symlinkSync(root, path.join(dir, 'current'));
    expect(JSON.parse(execute(bundleProbeCommand(dir)))).toEqual({ ...next, root });
    fs.writeFileSync(path.join(root, 'dist/BUILD.json'), JSON.stringify({ ...meta, dirty: true }));
    expect(() => execute(bundleProbeCommand(dir, next.version))).toThrow();
  }));
  it('executes declared argv as literal data under recorded cwd and can restore the old binding', () => temporary(dir => {
    fs.writeFileSync(path.join(dir, 'bind.mjs'), `import fs from 'node:fs';fs.writeFileSync('binding.json',JSON.stringify({cwd:process.cwd(),root:process.env.DECLARED_BUNDLE,arg:process.argv[2]}));`);
    const app = inventory().contracts[0]!.apps[0]!; app.cwd = dir;
    const literal = '$(touch SHOULD_NOT_EXIST); `false`';
    (app.binding as any).rebind = ['node', 'bind.mjs', literal];
    execute(hookCommand(app, next, 'rebind'));
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'binding.json'), 'utf8'))).toEqual({ cwd: dir, root: next.root, arg: literal });
    execute(hookCommand(app, old, 'rebind'));
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'binding.json'), 'utf8')).root).toBe(old.root);
    expect(fs.existsSync(path.join(dir, 'SHOULD_NOT_EXIST'))).toBe(false);
  }));
  it('persists a private receipt containing offline state and both versions; retention protects both', () => temporary(dir => {
    const p = planHostUpgrade(old, next, inventory());
    const receipt = { schema: 1 as const, id: 'court', plan: p, phase: 'prepared', outcome: 'running' as const, events: [] };
    execute(receiptCommand(dir, receipt));
    const file = path.join(dir, 'upgrade-receipts/court.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(receipt);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const roots = ['old.1', 'obsolete.2', 'candidate.3'].map(v => path.join(dir, 'versions', v));
    roots.forEach(r => fs.mkdirSync(r, { recursive: true })); fs.symlinkSync(roots[2]!, path.join(dir, 'current'));
    execute(pruneSteps({ prefix: dir, version: 'candidate.3' }, 1, [roots[0]!, roots[2]!])[0]!.command);
    expect(roots.map(r => fs.existsSync(r))).toEqual([true, false, true]);
  }));
  it('updates only dependency roots and rejects changed release source during upgrade', () => temporary(dir => {
    const p = planHostUpgrade(old, next, inventory());
    p.inventory.projects.forEach(project => {
      project.path = path.join(dir, project.name); fs.mkdirSync(project.path);
      const contract = p.inventory.contracts.find(c => c.project === project.name)!;
      fs.writeFileSync(path.join(project.path, 'omnitron.host-upgrade.json'), JSON.stringify(contract));
    });
    execute(updateContractBindingsCommand(p, next));
    execute(updateContractBindingsCommand(p, old));
    const file = path.join(p.inventory.projects[0]!.path, 'omnitron.host-upgrade.json');
    const contract = JSON.parse(fs.readFileSync(file, 'utf8')); contract.apps[0].cwd = '/changed/source';
    fs.writeFileSync(file, JSON.stringify(contract));
    expect(() => execute(updateContractBindingsCommand(p, next))).toThrow();
  }));
});

describe('captured systemd binding recovery', () => {
  it('changes only framework paths and restores original unit bytes and enablement', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'host-unit-')));
    try {
      const log = path.join(dir, 'calls.jsonl'); const file = path.join(dir, 'omnitron-daemon.service');
      const contents = `[Service]\nExecStart=/usr/bin/node --import tsx/esm ${old.root}/dist/daemon/daemon-entry.js\nWorkingDirectory=${old.root}\nEnvironment=OMNITRON_CWD=${old.root}\nUser=appowner\nEnvironment=HOME=/home/appowner\nEnvironment=UNCHANGED=business-data\n`;
      fs.writeFileSync(file, contents, { mode: 0o640 });
      fs.writeFileSync(path.join(dir, 'systemctl'), `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');`, { mode: 0o755 });
      const runtime = { kind: 'systemd' as const, cwd: old.root, scope: 'system' as const, file, contents, enabled: false };
      const run = (command: string) => execSync(command, { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
      run(runtimeStopCommand(runtime, old)); run(runtimeStartCommand(runtime, old, next));
      expect(fs.readFileSync(file, 'utf8')).toBe(contents.replaceAll(old.root, next.root));
      run(runtimeStartCommand(runtime, old, old));
      expect(fs.readFileSync(file, 'utf8')).toBe(contents);
      expect(fs.statSync(file).mode & 0o777).toBe(0o640);
      const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      expect(calls).toEqual([
        ['stop', 'omnitron-daemon.service'],
        ['daemon-reload'], ['disable', 'omnitron-daemon.service'], ['start', 'omnitron-daemon.service'],
        ['daemon-reload'], ['disable', 'omnitron-daemon.service'], ['start', 'omnitron-daemon.service'],
      ]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
