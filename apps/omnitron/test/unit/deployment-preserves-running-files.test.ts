import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';
import { renderNodeAppConfig, selectNodeApps } from '../../src/project/node-app-config.js';
import { publishNodeConfigCommand, restoreNodeConfigCommand } from '../../src/services/node-registration.js';

const cleanup: string[] = [];
afterEach(async () => { for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe('failed preparation preserves the running release', () => {
  it('retains the source-stack binding and refuses an allocation belonging to another stack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnitron-allocation-')); cleanup.push(root);
    const body = (sourceStack: string) => renderNodeAppConfig({ project: 'p', sourceStack, artifactRoot: '/artifacts',
      apps: [{ name: 'api' } as never], artifacts: [{ app: 'api', version: '1' }] });
    const publish = (sourceStack: string, operation: string) => execFileSync('/bin/sh', ['-c', publishNodeConfigCommand({
      directory: root, project: 'p', operation, artifacts: [{ app: 'api', version: '1' }], body: body(sourceStack),
    })], { encoding: 'utf8', stdio: 'pipe' });
    publish('prod', 'first');
    const config = await readFile(join(root, 'omnitron.config.mjs'), 'utf8');
    expect(config).toContain('"managedOrigin"');
    expect(config).toContain('"stack": "prod"');
    publish('prod', 'same');
    expect(() => publish('test', 'foreign')).toThrow('another source stack');
    expect(await readFile(join(root, 'omnitron.config.mjs'), 'utf8')).toBe(config);
  });

  it('does not guess the source of an existing unbound allocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnitron-unbound-')); cleanup.push(root);
    const original = 'export default { apps: [{name:"api"}], stacks: {deployed: {type:"local",apps:["api"]}} };';
    await writeFile(join(root, 'omnitron.config.mjs'), original);
    const command = publishNodeConfigCommand({ directory: root, project: 'p', operation: 'candidate', artifacts: [],
      body: renderNodeAppConfig({ project: 'p', sourceStack: 'prod', artifactRoot: '/artifacts', apps: [{ name: 'api' } as never], artifacts: [{ app: 'api', version: '1' }] }) });
    expect(() => execFileSync('/bin/sh', ['-c', command], { stdio: 'pipe' })).toThrow('explicitly bound');
    expect(await readFile(join(root, 'omnitron.config.mjs'), 'utf8')).toBe(original);
  });

  it('installs a reused package version in a separate directory before registration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnitron-artifact-')); cleanup.push(root);
    const previous = join(root, 'artifacts/project/api/1.0.0'); await mkdir(previous, { recursive: true });
    await writeFile(join(previous, 'runtime.txt'), 'running release');
    const source = join(root, 'source'); await mkdir(source); await writeFile(join(source, 'runtime.txt'), 'candidate');
    const archive = join(root, 'api.tar.gz'); execFileSync('tar', ['-czf', archive, '-C', source, '.']);
    const bytes = await readFile(archive), digest = createHash('sha256').update(bytes).digest('hex');
    const commands: string[] = [];
    const local = (path: string) => path.replaceAll('/opt/omnitron/artifacts', join(root, 'artifacts'));
    const svc: any = new RemoteDeployer({ info() {}, warn() {}, error() {} } as never, {} as never);
    Object.assign(svc, { logger: { info() {}, warn() {}, error() {} }, emitProgress() {}, verifySSH: async () => {},
      inspectInstalledBundle: async () => ({ root: '/unused-owner', commit: 'a'.repeat(40) }),
      scpTransfer: async (_target: unknown, from: string, to: string) => copyFile(from, local(to)),
      sshExec: async (_target: unknown, command: string) => {
        commands.push(command);
        if (command.includes('npm install')) throw Error('simulated registry outage');
        return execFileSync('/bin/sh', ['-c', local(command)], { encoding: 'utf8' });
      },
    });
    const result = await svc.deployToNode({ host: 'example.invalid' }, { app: 'api', version: '1.0.0', path: archive,
      size: bytes.length, checksum: digest, tarballSha256: digest }, 'project', { startAfterInstall: false });
    expect(result.status).toBe('failed'); expect(result.error).toContain('registry outage');
    expect(await readFile(join(previous, 'runtime.txt'), 'utf8')).toBe('running release');
    expect(await readFile(join(root, 'artifacts/project/api/1.0.0-' + digest, 'runtime.txt'), 'utf8')).toBe('candidate');
    expect(commands.some(command => command.includes('find .') || command.includes('rm -rf'))).toBe(false);
  });
  it('renders the selected installation identity rather than the reusable package version', () => {
    const entries = selectNodeApps({ project: 'p', artifactRoot: '/artifacts', apps: [{ name: 'api' } as never],
      artifacts: [{ app: 'api', version: '1.0.0', directory: '1.0.0-verified-content' }] });
    expect(entries[0]?.cwd).toBe('/artifacts/p/api/1.0.0-verified-content');
  });
  it('does not replace the boot configuration when any artifact fails', async () => {
    const target = { host: 'example.invalid' }, svc: any = Object.create(RemoteDeployer.prototype);
    Object.assign(svc, { logger: { info() {}, warn() {}, error() {} }, emitProgress() {},
      deployToNode: async (_: unknown, artifact: { app: string }) => ({ node: 'example.invalid:9700', app: artifact.app, version: '1', status: artifact.app === 'bad' ? 'failed' : 'success' }),
      registerNodeApps: vi.fn(), migrateNodeApps: vi.fn(),
    });
    const results = await svc.deployToStack([target], [{ app: 'good', version: '1' }, { app: 'bad', version: '1' }], 'project', { stack: 'test', apps: [{ name: 'good' }, { name: 'bad' }] });
    expect(results.every((r: { status: string }) => r.status === 'failed')).toBe(true);
    expect(svc.registerNodeApps).not.toHaveBeenCalled(); expect(svc.migrateNodeApps).not.toHaveBeenCalled();
  });
  it('preserves other applications and hook policy while publishing a release, with recoverable boot files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnitron-registration-')); cleanup.push(root);
    const candidate = join(root, 'candidate'); await mkdir(candidate);
    // macOS /var is an alias; contracts record canonical immutable paths.
    const canonical = await import('node:fs/promises').then(fs => fs.realpath(candidate));
    const original = 'export default '+JSON.stringify({ apps: [{ name: 'api', cwd: '/old/api' }, { name: 'worker', cwd: '/old/worker' }], stacks: { deployed: { type: 'local', apps: ['api', 'worker'] } } });
    const contract = { schema: 1, apps: [{ name: 'p/deployed/api', cwd: '/old/api', version: '1', binding: { kind: 'independent' }, health: ['node', 'health.mjs'] }] };
    await writeFile(join(root, 'omnitron.config.mjs'), original);
    await writeFile(join(root, 'omnitron.host-upgrade.json'), JSON.stringify(contract));
    const command = publishNodeConfigCommand({ directory: root, project: 'p', operation: 'test', artifacts: [{ app: 'api', version: '2' }],
      body: 'export default '+JSON.stringify({ apps: [{ name: 'api', cwd: canonical }], stacks: { deployed: { type: 'local', apps: ['api'] } } }) });
    expect(JSON.parse(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).changed).toBe(true);
    const published = await readFile(join(root, 'omnitron.config.mjs'), 'utf8');
    expect(published).toContain('/old/worker'); expect(published).toContain(canonical);
    expect(JSON.parse(await readFile(join(root, 'omnitron.host-upgrade.json'), 'utf8')).apps[0]).toEqual({ ...contract.apps[0], cwd: canonical, version: '2' });
    execFileSync('/bin/sh', ['-c', restoreNodeConfigCommand(root, 'test')]);
    expect(await readFile(join(root, 'omnitron.config.mjs'), 'utf8')).toBe(original);
    expect(JSON.parse(await readFile(join(root, 'omnitron.host-upgrade.json'), 'utf8'))).toEqual(contract);
  });
  it('refuses deployment without source ownership before installing any artifact', async () => {
    const svc: any = new RemoteDeployer({ info() {}, warn() {}, error() {} } as never, {} as never);
    svc.deployToNode = vi.fn();
    await expect(svc.deployToStack([{ host: 'example.invalid' }], [{ app: 'api', version: '1' }], 'project', { apps: [{ name: 'api' }] })).rejects.toThrow(/explicit source stack/);
    expect(svc.deployToNode).not.toHaveBeenCalled();
  });
  it('reports registration failure and does not proceed to restart or health success', async () => {
    const svc: any = new RemoteDeployer({ info() {}, warn() {}, error() {} } as never, {} as never);
    Object.assign(svc, { logger: { info() {}, warn() {}, error() {} }, emitProgress() {},
      deployToNode: async () => ({ node: 'example.invalid:9700', app: 'api', version: '1', status: 'success' }),
      migrateNodeApps: async () => new Map(), registerNodeApps: async () => { throw Error('read refused'); }, signalRemoteDaemon: vi.fn(),
    });
    const result = await svc.deployToStack([{ host: 'example.invalid' }], [{ app: 'api', version: '1' }], 'project', { stack: 'test', apps: [{ name: 'api' }] });
    expect(result[0]).toMatchObject({ status: 'failed', error: 'Node registration failed: read refused' });
    expect(svc.signalRemoteDaemon).not.toHaveBeenCalled();
  });
});
