import { afterAll, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import type { LeaseGrant } from '@omnitron-dev/titan-database/coordination';
import { OMNITRON_HOME } from '../../src/config/defaults.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { ProjectService } from '../../src/services/project.service.js';
import { ClusterRecipient, ClusterSigner } from '../../src/cluster/stop-authority.js';
import { releaseTreeDigest, RELEASE_RECEIPT } from '../../src/release/runtime-provenance.js';
import { targetRuntime } from '../../src/release/target-runtime.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';

const isolatedHome = await vi.hoisted(async () => {
  const io = await import('node:fs/promises');
  const os = await import('node:os');
  const paths = await import('node:path');
  const root = await io.realpath(await io.mkdtemp(paths.join(os.tmpdir(), 'omni-admitted-recovery-')));
  vi.stubEnv('OMNITRON_HOME', root);
  return root;
});
vi.mock('../../src/infrastructure/container-runtime.js', async actual => ({
  ...await actual<typeof import('../../src/infrastructure/container-runtime.js')>(),
  inspectStackContainers: async () => [],
  removeContainer: async () => { throw new Error('This allocation has no containers'); },
}));
afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(isolatedHome, { recursive: true, force: true });
});

it('recovers a signed source-stack stop through its imported allocation and verifies the installed PID and manifest', async () => {
  expect(OMNITRON_HOME).toBe(isolatedHome);
  const logger = createNullLogger();
  const store = new DaemonStateStore(logger, path.join(isolatedHome, 'worker.db'));
  const owner = new OrchestratorService(logger, {} as never, new StateStore(store), isolatedHome, { reapForeignOrphans: false });
  // Observe only the classic child under test. No host inventory polling, janitor or periodic state snapshots.
  Object.assign(owner, { ensureBootReconciled: async () => {}, ensureMetricsPolling: () => {}, persistState: () => {} });
  const service = new ProjectService(logger, owner, store);
  const projectDir = path.join(isolatedHome, 'project'), allocationDir = path.join(projectDir, 'allocation');
  const releaseRoot = path.join(isolatedHome, 'release');
  const source = { project: 'sample', stack: 'prod' };
  let name: string | undefined;
  try {
    for (const dir of [projectDir, allocationDir, releaseRoot]) await fs.mkdir(dir);
    await fs.writeFile(path.join(releaseRoot, 'app.cjs'), "process.send('ready');setInterval(()=>{},1000);");
    const archive = path.join(isolatedHome, 'api.tgz');
    await promisify(execFile)('tar', ['-czf', archive, '-C', releaseRoot, 'app.cjs']);
    const bytes = await fs.readFile(archive);
    const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
    const artifact = { app: 'api', version: '1.0.0', bytes: bytes.length, sha256: sha(bytes) };
    const manifest: ReleaseManifest = { id: 'release-1', project: { repo: 'sample', commit: '1'.repeat(40) },
      omni: { repo: 'framework', commit: '2'.repeat(40) }, artifacts: [artifact], gates: [], builtBy: 'test',
      builtAt: new Date().toISOString(), builtWith: { omnitron: '1.0.0', packages: [], target: await targetRuntime() } };
    const manifestFile = path.join(isolatedHome, 'manifest.json');
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    const origin = { app: artifact.app, releaseId: manifest.id, manifestSha256: sha(await fs.readFile(manifestFile)),
      artifactSha256: artifact.sha256, artifactBytes: artifact.bytes, frameworkCommit: manifest.omni.commit };
    await fs.writeFile(path.join(releaseRoot, RELEASE_RECEIPT), JSON.stringify({
      version: 2, root: releaseRoot, origin, target: manifest.builtWith.target, nodeOptions: '',
      ownerPackage: await fs.realpath(fileURLToPath(new URL('../../', import.meta.url))),
      frameworkContentUnchanged: true, artifactPayloadUnchanged: true, installedFrameworkCommit: manifest.omni.commit,
      treeSha256: await releaseTreeDigest(releaseRoot),
    }), { mode: 0o600 });

    const entry = { name: 'api', script: 'app.cjs', releaseRoot, cwd: releaseRoot, env: { NODE_PATH: '', NODE_OPTIONS: '' } };
    const writeConfig = (dir: string, config: unknown) => fs.writeFile(path.join(dir, 'omnitron.config.mjs'), 'export default ' + JSON.stringify(config));
    await writeConfig(projectDir, { project: source.project, apps: [], stacks: { dev: { type: 'local' } } });
    await writeConfig(allocationDir, { project: source.project, apps: [entry], stacks: { deployed: {
      type: 'local', apps: ['api'], managedOrigin: source, infrastructureOwnership: 'external' } } });
    await fs.writeFile(path.join(allocationDir, 'omnitron.stacks.json'), JSON.stringify({ standby: { type: 'local', apps: [] } }));
    await service.addProject(source.project, projectDir);
    await service.importProjectConfiguration({ project: source.project, name: 'edge', path: allocationDir,
      stacks: { deployed: 'worker', standby: 'spare' }, expectedRevision: service.listProjects()[0]!.catalogRevision! });
    const runtime = { project: service.projectConfigurations('sample').find(record => record.configuration)!.name, stack: 'deployed' };
    expect(runtime.project).not.toBe(source.project);
    name = runtime.project + '/' + runtime.stack + '/api';
    const config = await service.loadProjectConfig(runtime.project);
    const original = await owner.startApp({ ...entry, name }, config);
    const firstPid = original.pid;
    expect(original.release).toMatchObject({ state: 'confirmed', manifestSha256: origin.manifestSha256 });

    const audience = { clusterId: 'west', nodeId: 'node-1' }, signer = new ClusterSigner();
    const grant: LeaseGrant = { key: 'omnitron/cluster/west', owner: 'controller', incarnation: signer.incarnation,
      epoch: '7', remainingMs: 30_000, expiresAt: new Date(Date.now() + 30_000).toISOString() };
    service.setClusterStop(new ClusterRecipient(audience, { read: async () => grant }, store));
    const stop = await service.prepareNodeStackStop({ ...source, audience, applications: true });
    const stopped = await service.executeNodeStackStop({ ...source, operationId: stop.operationId, permit: signer.issue(stop, grant) });
    expect(stopped.applications).toMatchObject({ ...runtime, stopped: [name] });
    expect(original.status).toBe('stopped');
    const request = { ...source, audience, apps: ['api'], operationId: randomUUID(),
      stopOperationId: stop.operationId, stopObservedAt: stopped.observedAt };
    const plan = await service.prepareNodeInstalledResume(request);
    const permit = signer.issueEffect(plan, grant);
    await expect(service.executeNodeInstalledResume({ ...request, plan, permit: signer.issue(stop, grant) })).rejects.toThrow('signature');
    expect(owner.getHandle(name)?.pid).toBeNull();
    const receipt = await service.executeNodeInstalledResume({ ...request, plan, permit });
    expect(receipt).toMatchObject({ ...source, outcome: 'running', apps: [name], epoch: '7' });
    const restored = owner.getHandle(name)!;
    expect(restored.generation).not.toBe(original.generation);
    expect(restored.pid).toBeGreaterThan(0);
    expect(restored.pid).not.toBe(firstPid);
    expect(restored.release).toMatchObject({ state: 'confirmed', manifestSha256: origin.manifestSha256, artifactSha256: artifact.sha256 });
    expect(await service.executeNodeInstalledResume({ ...request, plan, permit })).toEqual(receipt);
    expect(service.getNodeInstalledResumeReceipt(request)).toEqual(receipt);
    expect(owner.getHandle(name)?.pid).toBe(restored.pid);
  } finally {
    try { if (name) await owner.stopApp(name); }
    finally { await store.dispose(); }
  }
}, 30_000);
