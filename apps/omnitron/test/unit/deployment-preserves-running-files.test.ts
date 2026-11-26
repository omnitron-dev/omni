import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';
import { renderNodeAppConfig, selectNodeApps } from '../../src/project/node-app-config.js';
import { prepareNodeConfigPublication, restoreNodeConfigCommand } from '../../src/services/node-registration.js';

function runPublication(request: ReturnType<typeof prepareNodeConfigPublication>): string {
  return execFileSync('/bin/sh', ['-c', request.command], { encoding: 'utf8', input: request.stdin, stdio: 'pipe' });
}

const cleanup: string[] = [];
afterEach(async () => { for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe('failed preparation preserves the running release', () => {
  it('retains the source-stack binding and refuses an allocation belonging to another stack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnitron-allocation-')); cleanup.push(root);
    const body = (sourceStack: string) => renderNodeAppConfig({ project: 'p', sourceStack, artifactRoot: '/artifacts',
      apps: [{ name: 'api' } as never], artifacts: [{ app: 'api', version: '1' }] });
    const publish = (sourceStack: string, operation: string) => runPublication(prepareNodeConfigPublication({
      directory: root, project: 'p', operation, artifacts: [{ app: 'api', version: '1' }], body: body(sourceStack),
    }));
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
    const command = prepareNodeConfigPublication({ directory: root, project: 'p', operation: 'candidate', artifacts: [],
      body: renderNodeAppConfig({ project: 'p', sourceStack: 'prod', artifactRoot: '/artifacts', apps: [{ name: 'api' } as never], artifacts: [{ app: 'api', version: '1' }] }) });
    expect(() => runPublication(command)).toThrow('explicitly bound');
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
    expect(entries[0]?.['cwd']).toBe('/artifacts/p/api/1.0.0-verified-content');
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
    const command = prepareNodeConfigPublication({ directory: root, project: 'p', operation: 'test', artifacts: [{ app: 'api', version: '2' }],
      body: 'export default '+JSON.stringify({ apps: [{ name: 'api', cwd: canonical }], stacks: { deployed: { type: 'local', apps: ['api'] } } }) });
    expect(JSON.parse(runPublication(command)).changed).toBe(true);
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

  it.each(['fresh', 'lost-observation', 'owner-changed', 'wrong-artifact', 'wrong-consumer', 'missing-receipt', 'old-generation'])(
    'uses the confirmed stack start and observes the enrolled generation (%s)', async mode => {
      const apps = ['api', 'worker'];
      const manifest = 'b'.repeat(64), checksum = 'a'.repeat(64), commit = 'c'.repeat(40);
      const grant = { mode: 'resident', protocol: 1, ownerId: 'fixture-owner', pid: 12, epoch: 3 };
      const runtime = { root: '/runtime/packages/0', executable: '/runtime/node', commit, execution: grant };
      const artifacts = apps.map(app => ({ app, version: '1', checksum, release: {
        releaseId: 'one', app, artifactBytes: 100, artifactSha256: checksum, manifestSha256: manifest, frameworkCommit: commit } }));
      const generation = (name: string, version: string) => ({ name: 'sample/deployed/' + name, pid: 35, status: 'online', generation: version + name,
        release: { state: 'confirmed', basis: 'verified-launch', launchId: version + name, observedAt: new Date().toISOString(),
          releaseId: 'one', artifactSha256: checksum, manifestSha256: manifest } });
      const observed = (rows: ReturnType<typeof generation>[], epoch = 3) => ({ code: 0, words: '', raw: JSON.stringify({ ok: true, data: {
        appsTotal: rows.length, apps: rows, execution: { mode: 'resident', phase: 'active', connection: { status: 'connected' }, epoch,
          owner: { id: 'fixture-owner', pid: 12 } } } }) });
      const now = apps.map(app => generation(app, 'after-'));
      if (mode === 'wrong-artifact') now[0]!.release.artifactSha256 = 'd'.repeat(64);
      if (mode === 'wrong-consumer') Object.assign(now[0]!.release, { consumer: { app: 'api', releaseId: 'other', manifestSha256: manifest } });
      const before = mode === 'old-generation' || mode === 'missing-receipt' ? [generation('api', 'after-')] : [];
      if (mode === 'missing-receipt') now[0]!.release.launchId = 'unrelated-launch';
      const ask = vi.fn().mockResolvedValueOnce(observed(before)).mockResolvedValueOnce(mode === 'lost-observation'
        ? { code: 1, raw: '', words: 'connection closed' } : observed(now, mode === 'owner-changed' ? 4 : 3))
        .mockResolvedValue(observed([generation('api', 'restarted-'), now[1]!]));
      let operation = '', starts = 0;
      const svc: any = new RemoteDeployer({ info() {}, warn() {}, error() {} } as never, {} as never);
      Object.assign(svc, { inspectInstalledBundle: vi.fn(async () => ({ applicationRuntime: runtime })),
        deployToNode: async (_target: unknown, a: typeof artifacts[number]) => ({ node: 'node.invalid:9700', app: a.app, version: a.version,
          status: 'success', checksum, unchanged: false }),
        migrateNodeApps: async () => new Map(), askNodeStatus: ask, signalRemoteDaemon: vi.fn(async () => ({ ok: true, detail: '' })),
        recordRunningArtifact: vi.fn(), sshExec: async (_target: unknown, command: string, _timeout?: number, stdin?: string) => {
          if (stdin) { operation = JSON.parse(stdin).operation; return '{"changed":true}'; }
          if (command.startsWith('omnitron project add ')) return 'Registered';
          starts++;
          return JSON.stringify({ operation, project: 'sample', stack: 'deployed', confirmed: true, apps });
        } });
      const result = await svc.deployToStack([{ host: 'node.invalid' }], artifacts, 'sample', { stack: 'prod', apps: apps.map(name => ({ name })) });
      const bothUnknown = mode === 'owner-changed' || mode === 'lost-observation';
      const apiUnknown = ['wrong-artifact', 'wrong-consumer', 'missing-receipt'].includes(mode);
      expect(result.map((item: {status: string}) => item.status)).toEqual(bothUnknown ? ['unconfirmed', 'unconfirmed'] :
        apiUnknown ? ['unconfirmed', 'success'] : ['success', 'success']);
      expect(starts).toBe(1);
      expect(svc.signalRemoteDaemon).toHaveBeenCalledTimes(mode === 'old-generation' ? 1 : 0);
      expect(ask).toHaveBeenCalledTimes(mode === 'old-generation' ? 3 : 2);
      expect(svc.recordRunningArtifact).toHaveBeenCalledTimes(bothUnknown ? 0 : apiUnknown ? 1 : 2);
    });
});
