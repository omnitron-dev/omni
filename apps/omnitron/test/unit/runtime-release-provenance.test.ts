import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { releaseTreeDigest, frameworkDependencyDigest, RELEASE_RECEIPT, verifyLaunchRelease, type ReleaseArtifactOrigin } from '../../src/release/runtime-provenance.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { readStackRelease } from '../../src/shared/release-reading.js';
import { stackFixture, stackAppFixture } from '../helpers/stack-fixture.js';
import { selectNodeApps } from '../../src/project/node-app-config.js';

const directories: string[] = [];
// pnpm can set NODE_PATH for Vitest. Fixtures represent a clean execution owner.
beforeEach(() => { vi.stubEnv('NODE_PATH', ''); vi.stubEnv('NODE_OPTIONS', ''); });
afterEach(async () => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
const origin: ReleaseArtifactOrigin = { releaseId: 'sample-release', manifestSha256: 'a'.repeat(64),
  artifactSha256: 'b'.repeat(64), artifactBytes: 100, app: 'api', frameworkCommit: 'c'.repeat(40) };

async function fixture(framework = origin.frameworkCommit) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-release-evidence-')); directories.push(directory);
  const root = path.join(directory, 'artifact'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'bootstrap.js'), 'export default {};');
  const dependency = path.join(directory, 'dependency'); await fs.mkdir(dependency);
  await fs.writeFile(path.join(dependency, 'index.js'), 'export default 1;');
  await fs.symlink(dependency, path.join(root, 'dependency'));
  const entry = { name: 'sample/deployed/api', cwd: directory, releaseRoot: root, bootstrap: path.join(root, 'bootstrap.js') };
  const receipt = { version: 1, origin, root, installedFrameworkCommit: framework, frameworkContentUnchanged: true, artifactPayloadUnchanged: true, treeSha256: await releaseTreeDigest(root) };
  await fs.writeFile(path.join(root, RELEASE_RECEIPT), JSON.stringify(receipt), { mode: 0o600 });
  return { directory, root, entry, receipt, dependency };
}

describe('launch-bound release evidence', () => {
  it('carries a verified worker-only launch through owner inventory without inventing a PID', async () => {
    const f = await fixture();
    const handle = new AppHandle(f.entry, 'bootstrap');
    handle.release = await verifyLaunchRelease(f.entry, handle.generation);
    handle.declareChildren(['worker'], null);
    handle.markStarting();
    handle.childStarted('worker', null);
    const owner = Object.create(OrchestratorService.prototype) as OrchestratorService;
    Object.assign(owner, {
      handles: new Map([[handle.name, handle]]),
    });
    const read = () => readStackRelease(stackFixture('deployed', {
      status: 'running', apps: owner.list().map(app => stackAppFixture(app.name, app)),
    }));
    expect(owner.list()[0]).toMatchObject({ pid: null, status: 'online', generation: handle.generation });
    expect(read().runningRelease).toBe('confirmed');
    handle.redefine({ ...f.entry, bootstrap: '/next-start/bootstrap.js' });
    expect(read().runningRelease).toBe('confirmed');
    handle.childGone('worker');
    handle.childStarted('worker', null);
    expect(read()).toMatchObject({ runningRelease: 'unreported', releaseEvidence: { verified: 0 } });
  });

  it('verifies the explicit artifact boundary even when the process cwd is the project directory', async () => {
    const f = await fixture();
    expect(await verifyLaunchRelease(f.entry, 'launch-1')).toEqual(expect.objectContaining({
      state: 'confirmed', releaseId: origin.releaseId, launchId: 'launch-1', basis: 'verified-launch' }));
    const { releaseRoot: _boundary, ...withoutBoundary } = f.entry;
    expect(await verifyLaunchRelease(withoutBoundary, 'launch-1')).toEqual(expect.objectContaining({ state: 'unreported' }));
  });

  it('detects changed application bytes and externally rebound framework bytes', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.dependency, 'index.js'), 'export default 2;');
    expect(await verifyLaunchRelease(f.entry, 'launch-1')).toEqual(expect.objectContaining({ state: 'modified', releaseId: origin.releaseId }));
    const other = await fixture();
    await fs.writeFile(path.join(other.root, 'bootstrap.js'), 'export default 2;');
    expect((await verifyLaunchRelease(other.entry, 'launch-2')).state).toBe('modified');
  });

  it('does not confirm a release installed against another framework revision', async () => {
    const f = await fixture('d'.repeat(40));
    expect(await verifyLaunchRelease(f.entry, 'launch-1')).toEqual({ state: 'modified', releaseId: origin.releaseId,
      reason: 'The installed framework differs from the framework recorded by this release.' });
  });

  it('does not reuse another application receipt or accept a bootstrap outside its boundary', async () => {
    const f = await fixture();
    expect((await verifyLaunchRelease({ ...f.entry, name: 'sample/deployed/other' }, 'launch-1')).state).toBe('unreported');
    expect((await verifyLaunchRelease({ ...f.entry, bootstrap: path.join(f.dependency, 'index.js') }, 'launch-1')).state).toBe('unreported');
    expect((await verifyLaunchRelease(f.entry, 'launch-1', [path.join(f.dependency, 'index.js')])).state).toBe('unreported');
    await fs.chmod(path.join(f.root, RELEASE_RECEIPT), 0o644);
    expect((await verifyLaunchRelease(f.entry, 'launch-1')).state).toBe('unreported');
  });

  it('does not confirm installer-modified payloads or source code compiled at launch', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.root, RELEASE_RECEIPT), JSON.stringify({ ...f.receipt, artifactPayloadUnchanged: false }));
    expect((await verifyLaunchRelease(f.entry, 'launch-1')).state).toBe('modified');
    expect((await verifyLaunchRelease({ ...f.entry, bootstrap: path.join(f.root, 'bootstrap.ts') }, 'launch-1')).state).toBe('unreported');
  });

  it('does not attest a launch with external Node loader or module-resolution configuration', async () => {
    const f = await fixture();
    expect((await verifyLaunchRelease({ ...f.entry, env: { NODE_OPTIONS: '--import=/outside/loader.js' } }, 'launch-1')).state).toBe('unreported');
    vi.stubEnv('NODE_PATH', '/outside/modules');
    expect((await verifyLaunchRelease(f.entry, 'launch-1')).state).toBe('unreported');
    expect((await verifyLaunchRelease({ ...f.entry, env: { NODE_PATH: '' } }, 'launch-1')).state).toBe('confirmed');
  });

  it('compares framework bytes and dependency edges independently of package installation paths', async () => {
    const create = async () => {
      const f = await fixture();
      const scope = path.join(f.root, 'node_modules', '@omnitron-dev'); await fs.mkdir(scope, { recursive: true });
      const pkg = path.join(f.directory, 'framework'); await fs.mkdir(pkg);
      const external = path.join(pkg, 'node_modules', 'external'); await fs.mkdir(external, { recursive: true });
      await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: '@omnitron-dev/titan', version: '1.0.0', dependencies: { external: '1.0.0' } }));
      await fs.writeFile(path.join(pkg, 'index.js'), 'export const release = 1;');
      await fs.writeFile(path.join(external, 'package.json'), JSON.stringify({ name: 'external', version: '1.0.0' }));
      await fs.writeFile(path.join(external, 'index.js'), 'export default 1;');
      await fs.symlink(pkg, path.join(scope, 'titan'));
      return { ...f, pkg, external };
    };
    const a = await create(), b = await create();
    const original = await frameworkDependencyDigest(a.root);
    expect(await frameworkDependencyDigest(b.root)).toBe(original);
    await fs.writeFile(path.join(b.pkg, 'index.js'), 'export const release = 2;');
    expect(await frameworkDependencyDigest(b.root)).not.toBe(original);
    await fs.writeFile(path.join(b.pkg, 'index.js'), 'export const release = 1;');
    await fs.writeFile(path.join(b.external, 'index.js'), 'export default 2;');
    expect(await frameworkDependencyDigest(b.root)).not.toBe(original);
  });

  it('keeps launch evidence distinct from next-start configuration and invalidates child replacements', async () => {
    const f = await fixture();
    const handle = new AppHandle(f.entry, 'bootstrap');
    handle.release = await verifyLaunchRelease(f.entry, handle.generation);
    handle.redefine({ ...f.entry, bootstrap: '/another/bootstrap.js' });
    expect(handle.release.state).toBe('confirmed');
    handle.declareChildren(['http'], 'http'); handle.childStarted('http', 100);
    expect(handle.release.state).toBe('confirmed');
    handle.childGone('http'); handle.childStarted('http', 200);
    expect(handle.release.state).toBe('unreported');
  });

  it('node registration replaces a developer-supplied boundary with the selected installed artifact', () => {
    const [app] = selectNodeApps({ project: 'sample', artifactRoot: '/artifacts',
      apps: [{ name: 'api', releaseRoot: '/developer/other' }], artifacts: [{ app: 'api', version: '1', directory: '1-hash' }] });
    expect(app!['releaseRoot']).toBe('/artifacts/sample/api/1-hash');
  });
});
