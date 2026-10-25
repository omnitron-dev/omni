import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';
import { planHostUpgrade, receiptCommand } from '../../src/services/host-upgrade.js';
import type { HostInventory, HostUpgradeReceipt, InstalledBundle } from '../../src/services/host-upgrade.js';

const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: () => logger };
function node(missingContract = false, failCandidate = false, failHealth = false) {
  const prefix = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'host-adapter-')));
  const previous: InstalledBundle = { root: `${prefix}/versions/0.2.0+old.1`, version: '0.2.0+old.1', commit: 'a'.repeat(40) };
  const candidate: InstalledBundle = { root: `${prefix}/versions/0.2.0+new.2`, version: '0.2.0+new.2', commit: 'b'.repeat(40) };
  let active = previous; let running = true; const commands: string[] = [];
  const apps = ['one/prod/benchmarks', 'two/prod/benchmarks'];
  const status = () => ({ version: '0.2.0', build: { commit: active.commit, dirty: false }, pid: 100,
    apps: running && !(failCandidate && active === candidate) ? apps.map(name => ({ name, status: 'online' })) : [] });
  const inventory = (): HostInventory => ({
    runtime: { kind: 'fork', cwd: prefix }, status: status(),
    projects: ['one', 'two'].map(name => ({ name, path: `${prefix}/${name}`, enabledStacks: ['prod'] })),
    stacks: ['one', 'two'].map(project => ({ project, path: `${prefix}/${project}`, stacks: [
      { name: 'prod', type: 'local', apps: [{ handleKey: `${project}/prod/benchmarks`, status: 'online' }] },
      { name: 'idle', type: 'local', apps: [{ handleKey: `${project}/idle/worker`, status: 'stopped' }] },
    ] })),
    contracts: missingContract ? [] : ['one', 'two'].map(project => ({ project, schema: 1, apps: ['prod/benchmarks', 'idle/worker'].map(app => ({
      name: `${project}/${app}`, cwd: `${prefix}/${project}`, version: 'unchanged-release', health: ['node', 'health.mjs'], binding: { kind: 'independent' as const },
    })) })),
  });
  const deployer: any = new RemoteDeployer(logger, {} as any);
  deployer.underLease = vi.fn(async (_target, _purpose, work) => work());
  deployer.sshExecData = vi.fn(async (_target, command: string) => {
    commands.push(command);
    if (command.includes('/platform-operations')) return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (command.includes('const records=ids.map')) return execSync(command, { encoding: 'utf8' });
    if (command.includes('BUNDLE.json')) return JSON.stringify(command.includes(`versions/${candidate.version}`) ? candidate : previous);
    if (command.includes('/proc/')) return JSON.stringify({ kind: 'fork', cwd: prefix });
    if (command.includes('const projects=')) return JSON.stringify(inventory());
    if (command.includes('const status=await client.status()')) return JSON.stringify(status());
    throw Error(`Unexpected read: ${command}`);
  });
  deployer.sshExec = vi.fn(async (_target, command: string) => {
    commands.push(command);
    if (command.includes('upgrade-receipts')) return execSync(command, { encoding: 'utf8' });
    if (failHealth && active === candidate && command.includes('health.mjs')) throw new Error('Operational health failed despite online status');
    if (command.endsWith(' down')) running = false;
    if (command.includes('ln -sfn') && command.includes('/versions/')) active = command.includes(candidate.root) ? candidate : previous;
    if (command.endsWith('up --no-infra')) running = true;
    return '';
  });
  return { deployer, prefix, previous, candidate, commands, inventory,
    interrupt: () => { active = candidate; running = false; },
    state: () => ({ active, running, apps: status().apps }),
    receipt: (): HostUpgradeReceipt => JSON.parse(fs.readFileSync(path.join(prefix, 'upgrade-receipts', fs.readdirSync(path.join(prefix, 'upgrade-receipts'))[0]!), 'utf8')),
    clean: () => fs.rmSync(prefix, { recursive: true, force: true }),
  };
}
describe('RemoteDeployer controlled host-upgrade adapter', () => {
  it('restores two projects, keeps offline apps offline, and records before retention', async () => {
    const host = node();
    try {
      expect(await host.deployer.activateBundle({ host: 'test' }, host.candidate.version, host.prefix, 1)).toBe(true);
      expect(host.state().active).toBe(host.candidate);
      expect(host.state().apps.map(a => a.name)).toEqual(['one/prod/benchmarks', 'two/prod/benchmarks']);
      expect(host.receipt().outcome).toBe('upgraded');
      expect(host.receipt().plan.offline).toEqual(['one/idle/worker', 'two/idle/worker']);
      const retention = host.commands.find(c => c.includes('awk -v keep=1'))!;
      expect(retention).toContain(host.previous.root);
      expect(host.commands.findIndex(c => c.includes('upgrade-receipts'))).toBeLessThan(host.commands.findIndex(c => c.endsWith(' down')));
    } finally { host.clean(); }
  });
  it('blocks unrelated fleet/app operations while allowing only the exact recovering workflow', async () => {
    const host = node();
    try {
      const operation = path.join(host.prefix, 'platform-operations', 'platform');
      fs.mkdirSync(operation, { recursive: true });
      fs.writeFileSync(path.join(operation, 'pending.json'), JSON.stringify({ schema: 1, id: 'attempt', outcome: 'running' }));
      await expect(host.deployer.inspectInstalledBundle({ host: 'test' }, host.prefix)).rejects.toThrow(/Unfinished host operations/);
      expect(await host.deployer.activateBundle({ host: 'test' }, host.candidate.version, host.prefix)).toBe(false);
      expect(host.state().active).toBe(host.previous);
      expect(host.commands.some(c => c.endsWith(' down'))).toBe(false);
      expect(await host.deployer.activateBundle({ host: 'test' }, host.candidate.version, host.prefix, 3, undefined, { name: 'platform', id: 'attempt' })).toBe(true);
      expect(host.state().active).toBe(host.candidate);
    } finally { host.clean(); }
  });
  it('rejects missing manifests without touching current or stopping the host', async () => {
    const host = node(true);
    try {
      expect(await host.deployer.activateBundle({ host: 'test' }, host.candidate.version, host.prefix)).toBe(false);
      expect(host.state().active).toBe(host.previous); expect(host.state().running).toBe(true);
      expect(host.commands.some(c => c.includes('ln -sfn') || c.endsWith(' down'))).toBe(false);
      expect(fs.existsSync(path.join(host.prefix, 'upgrade-receipts'))).toBe(false);
    } finally { host.clean(); }
  });
  it('requires operational health even when all candidate apps report online', async () => {
    const host = node(false, false, true); vi.useFakeTimers();
    try {
      const result = host.deployer.activateBundle({ host: 'test' }, host.candidate.version, host.prefix);
      await vi.runAllTimersAsync(); expect(await result).toBe(false);
      expect(host.state().active).toBe(host.previous); expect(host.receipt().outcome).toBe('rolled-back');
      expect(host.receipt().events.some(e => e.error?.includes('Operational health failed'))).toBe(true);
      expect(host.commands.some(c => c.includes('awk -v keep='))).toBe(false);
    } finally { vi.useRealTimers(); host.clean(); }
  });
  it('recovers an interrupted receipt before attempting a fresh upgrade while the daemon is down', async () => {
    const host = node();
    try {
      const plan = planHostUpgrade(host.previous, host.candidate, host.inventory());
      const receipt = { schema: 1 as const, id: 'interrupted', plan, phase: 'rebinding', outcome: 'running' as const, events: [] };
      execSync(receiptCommand(host.prefix, receipt)); host.interrupt();
      expect(await host.deployer.activateBundle({ host: 'test' }, host.candidate.version, host.prefix)).toBe(false);
      expect(host.state().active).toBe(host.previous); expect(host.state().running).toBe(true);
      expect(host.receipt().outcome).toBe('rolled-back');
      expect(host.commands.some(c => c.includes('awk -v keep='))).toBe(false);
      expect(host.commands.some(c => c.endsWith(' --version'))).toBe(false);
    } finally { host.clean(); }
  });
  it('rolls back a daemon that answers but loses its apps, retaining a durable failure receipt', async () => {
    const host = node(false, true); vi.useFakeTimers();
    try {
      const result = host.deployer.activateBundle({ host: 'test' }, host.candidate.version, host.prefix);
      await vi.runAllTimersAsync(); expect(await result).toBe(false);
      expect(host.state().active).toBe(host.previous); expect(host.state().apps).toHaveLength(2);
      expect(host.receipt().outcome).toBe('rolled-back');
      expect(host.receipt().events.some(e => e.error?.includes('exactly the previously online apps'))).toBe(true);
      expect(host.commands.some(c => c.includes('awk -v keep='))).toBe(false);
    } finally { vi.useRealTimers(); host.clean(); }
  });
});
