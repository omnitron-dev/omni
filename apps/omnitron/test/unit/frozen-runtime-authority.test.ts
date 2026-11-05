import { describe, expect, it, vi } from 'vitest';
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';
import { assertResidentApplicationRuntime, assertSameApplicationRuntime, type ApplicationRuntime } from '../../src/services/host-upgrade.js';
import { selectNodeApps } from '../../src/project/node-app-config.js';

const runtime: ApplicationRuntime = { root: '/runtime/packages/0', executable: '/runtime/node', commit: 'a'.repeat(40),
  execution: { mode: 'resident', protocol: 1, ownerId: 'private-owner', pid: 42, epoch: 3 } };
const launch = { mode: 'script' as const, file: 'dist/worker.mjs', closureSha256: 'e'.repeat(64) };
const release = { releaseId: 'fixture', app: 'worker', manifestSha256: 'b'.repeat(64), artifactSha256: 'c'.repeat(64),
  artifactBytes: 3, frameworkCommit: 'd'.repeat(40), runtimeOrigin: { projectCommit: 'f'.repeat(40), producerApp: 'producer',
    consumer: { releaseId: 'fixture', manifestSha256: 'b'.repeat(64), app: 'worker' },
    entry: { relativeFile: launch.file, mode: launch.mode } } };
const artifact = { release, launch, app: 'worker', version: '1.0.0', path: '/archive.tgz', size: 3,
  builtAt: '2026-11-04', checksum: release.artifactSha256, tarballSha256: release.artifactSha256 };

describe('verified application execution authority', () => {
  it.each([undefined, { ...runtime, execution: undefined },
    { ...runtime, execution: { ...runtime.execution, protocol: 2 } },
    { ...runtime, execution: { ...runtime.execution, mode: 'coupled' } },
    { ...runtime, execution: { ...runtime.execution, ownerId: '' } },
    { ...runtime, execution: { ...runtime.execution, pid: 0 } },
    { ...runtime, execution: { ...runtime.execution, epoch: 0 } },
  ])('refuses an unproven resident protocol before delivery: %j', async value => {
    const service = new RemoteDeployer({ info() {}, warn() {}, error() {} } as never, {} as never) as any;
    Object.assign(service, { verifySSH: async () => {}, emitProgress: vi.fn(),
      inspectInstalledBundle: async () => ({ applicationRuntime: value }), sshExec: vi.fn(), scpTransfer: vi.fn() });
    const result = await service.deployToNode({ host: 'example.invalid' }, artifact, 'fixture', { startAfterInstall: false });
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.error).toContain('independent execution owner');
    expect(service.sshExec).not.toHaveBeenCalled(); expect(service.scpTransfer).not.toHaveBeenCalled();
  });
  it.each([
    undefined, { ...launch, file: '../outside.js' }, { ...launch, file: 'dist/source.ts' },
    { ...launch, mode: 'unknown' }, { ...launch, closureSha256: 'unverified' },
    { ...launch, file: 'dist/another.mjs' },
  ])('refuses inconsistent launch metadata before any target probe or write: %j', invalid => {
    const service = new RemoteDeployer({ info() {}, warn() {}, error() {} } as never, {} as never) as any;
    Object.assign(service, { verifySSH: async () => {}, emitProgress: vi.fn(),
      inspectInstalledBundle: vi.fn(), sshExec: vi.fn(), scpTransfer: vi.fn() });
    return service.deployToNode({ host: 'example.invalid' }, { ...artifact, launch: invalid }, 'fixture', { startAfterInstall: false }).then((result: { status: string }) => {
      expect(result.status).toBe('failed'); expect(service.inspectInstalledBundle).not.toHaveBeenCalled();
      expect(service.sshExec).not.toHaveBeenCalled(); expect(service.scpTransfer).not.toHaveBeenCalled();
    });
  });
  it.each([
    { ...release, app: 'another' }, { ...release, artifactSha256: '0'.repeat(64) },
    { ...release, artifactBytes: 4 },
  ])('rejects origin/artifact disagreement before connecting: %j', wrongOrigin => {
    const service = new RemoteDeployer({ info() {}, warn() {}, error() {} } as never, {} as never) as any;
    Object.assign(service, { verifySSH: vi.fn(), emitProgress: vi.fn(), inspectInstalledBundle: vi.fn(), sshExec: vi.fn(), scpTransfer: vi.fn() });
    return service.deployToNode({ host: 'example.invalid' }, { ...artifact, release: wrongOrigin }, 'fixture').then((result: { status: string; error: string }) => {
      expect(result.status).toBe('failed'); expect(result.error).toContain('Release origin');
      expect(service.verifySSH).not.toHaveBeenCalled(); expect(service.inspectInstalledBundle).not.toHaveBeenCalled();
      expect(service.sshExec).not.toHaveBeenCalled(); expect(service.scpTransfer).not.toHaveBeenCalled();
    });
  });
  it('refuses a changed owner grant after delivery before publishing registration or starting anything', async () => {
    const service = new RemoteDeployer({ info() {}, warn() {}, error() {} } as never, {} as never) as any;
    let epoch = runtime.execution!.epoch;
    Object.assign(service, { emitProgress: vi.fn(),
      inspectInstalledBundle: async () => ({ applicationRuntime: { ...runtime, execution: { ...runtime.execution, epoch } } }),
      deployToNode: async () => { epoch++; return { app: artifact.app, version: artifact.version, node: 'example.invalid:9700', status: 'success' }; },
      sshExec: vi.fn(), signalRemoteDaemon: vi.fn(), openGatewayPath: vi.fn(),
    });
    const results = await service.deployToStack([{ host: 'example.invalid' }], [artifact], 'fixture', {
      stack: 'test', apps: [{ name: artifact.app, script: launch.file }],
    });
    expect(results[0]).toMatchObject({ status: 'failed' });
    expect(results[0].error).toContain('Execution owner or controller grant changed');
    expect(service.sshExec).not.toHaveBeenCalled(); expect(service.signalRemoteDaemon).not.toHaveBeenCalled();
    expect(service.openGatewayPath).not.toHaveBeenCalled();
  });
  it('accepts the established resident protocol without inferring it from SDK commits', () => {
    expect(() => assertResidentApplicationRuntime(runtime)).not.toThrow();
    expect(runtime.commit).not.toBe(release.frameworkCommit);
    expect(() => assertSameApplicationRuntime(runtime, structuredClone(runtime))).not.toThrow();
  });
  it.each([
    { ...runtime, root: '/another/packages/0' }, { ...runtime, executable: '/another/node' },
    { ...runtime, commit: 'b'.repeat(40) },
    { ...runtime, execution: { ...runtime.execution!, ownerId: 'another' } },
    { ...runtime, execution: { ...runtime.execution!, pid: 43 } },
    { ...runtime, execution: { ...runtime.execution!, epoch: 4 } },
  ])('refuses execution identity drift before activation: %j', changed => {
    expect(() => assertSameApplicationRuntime(runtime, changed)).toThrow('changed during application delivery');
  });
  it('keeps the admitted script entry and removes build-only producer instructions', () => {
    const [entry] = selectNodeApps({ project: 'project', sourceStack: 'test', artifactRoot: '/artifacts',
      apps: [{ name: 'worker', releaseFrom: { release: 'producer', manifestSha256: 'b'.repeat(64), app: 'producer' } }],
      artifacts: [{ app: 'worker', version: '1', directory: 'selected', launch }] });
    expect(entry).toMatchObject({ cwd: '/artifacts/project/worker/selected', script: '/artifacts/project/worker/selected/dist/worker.mjs' });
    expect(entry).not.toHaveProperty('bootstrap'); expect(entry).not.toHaveProperty('releaseFrom');
  });
  it('keeps a nonstandard admitted bootstrap entry without substituting dist/bootstrap.js', () => {
    const [entry] = selectNodeApps({ project: 'project', artifactRoot: '/artifacts', apps: [{ name: 'worker', bootstrap: 'src/main.ts' }],
      artifacts: [{ app: 'worker', version: '1', launch: { ...launch, mode: 'bootstrap', file: 'dist/bootstrap.mjs' } }] });
    expect(entry?.['bootstrap']).toBe('/artifacts/project/worker/1/dist/bootstrap.mjs'); expect(entry).not.toHaveProperty('script');
  });
});
