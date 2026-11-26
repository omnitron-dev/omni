import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { create } from 'tar';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import * as containers from '../../src/infrastructure/container-runtime.js';
import { StackTargets } from '../../src/project/stack-targets.js';
import { verifyDeploymentMigrations } from '../../src/project/remote-release-deployment.js';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { validateAccessRequirements } from '@omnitron-dev/titan/netron/auth';
import { captureRemoteSource, readCapturedSource, sourceFileDigest } from '../../src/release/source-capture.js';
import { loadRelease } from '../../src/release/load.js';
import { confirmRegisteredReleaseNode, confirmReleaseRecipient, verifyRemoteSourceTree } from '../../src/release/remote-source.js';
import { resolveProjectStacks } from '../../src/config/project-stacks.js';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const root = await vi.hoisted(async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'remote-release-source-')));
});
vi.mock('../../src/config/defaults.js', async original => ({
  ...await original<typeof import('../../src/config/defaults.js')>(), OMNITRON_HOME: root,
}));
const original = path.join(root, 'serving'), source = path.join(root, 'qualified'), store = path.join(root, 'releases');
const marker = path.join(root, 'bootstrap-reads');
const sentinel = 'fixture-value-never-in-a-capture';
const settings = { appEnv: { main: { APP_BINDING: { secret: 'fixture-reference' } } } };
const id = 'sample-release', nodeId = 'replacement', stableFingerprint = 'SHA256:' + 'A'.repeat(43);
const platform = { platform: 'linux', arch: 'x64', node: 'v22.23.4', abi: '127', executableSha256: 'f'.repeat(64), libc: '2.39' };
const candidateNode = { host: 'candidate.invalid', port: 9700, nodeId, role: 'app' as const };
const oldNode = { host: 'serving.invalid', port: 9700, nodeId: 'incumbent', role: 'app' as const };
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgSign=false',
    ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function stacks(node: typeof candidateNode) {
  return { dev: { type: 'local', apps: 'all' }, test: { type: 'remote', apps: 'all', nodes: [node], settings, release: { mode: 'required' } } };
}
let declarationsSha: string, manifestSha: string, releaseCommit: string, originalCommit: string;
beforeAll(async () => {
  fs.mkdirSync(original); git(original, 'init', '-q');
  fs.writeFileSync(path.join(original, 'omnitron.config.mjs'), [
    "import {existsSync} from 'node:fs';",
    "export default ({phase}) => { if (phase !== 'release' || process.env.OMNI_FIXTURE_PRIVATE || !process.env.APP_BINDING || !existsSync('omnitron.config.mjs')) throw Error('unsafe reader');",
    "return {apps:[{name:'main',bootstrap:'apps/main/src/bootstrap.mjs',env:{APP_BINDING:process.env.APP_BINDING}}]} }",
  ].join('\n'));
  fs.mkdirSync(path.join(original, 'apps/main/src'), { recursive: true });
  fs.writeFileSync(path.join(original, 'apps/main/src/bootstrap.mjs'), [
    "import {appendFileSync} from 'node:fs';", 'appendFileSync(' + JSON.stringify(marker) + ",'x');",
    "if(process.env.OMNI_FIXTURE_PRIVATE || !process.env.APP_BINDING) throw Error('unsafe bootstrap reader');",
    "export default {name:'main',version:'1',processes:[{name:'api'}]};",
  ].join('\n'));
  fs.writeFileSync(path.join(original, 'omnitron.stacks.json'), JSON.stringify(stacks(oldNode)));
  git(original, 'add', '.'); git(original, 'commit', '-qm', 'incumbent'); originalCommit = git(original, 'rev-parse', 'HEAD');
  git(root, 'clone', '-q', '--no-local', original, source);
  fs.writeFileSync(path.join(source, 'omnitron.stacks.json'), JSON.stringify(stacks(candidateNode)));
  git(source, 'add', '.'); git(source, 'commit', '-qm', 'replacement'); releaseCommit = git(source, 'rev-parse', 'HEAD');
  const artifact = path.join(store, id, 'artifacts/main-0.0.1.tar.gz');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  const packageRoot = path.join(root, 'built');
  fs.mkdirSync(path.join(packageRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'config/default.json'), JSON.stringify({ omnitron: { infrastructure: {
    existing: { provisioning: 'bareMetal', env: {}, ports: {} },
  } } }));
  await create({ file: artifact, cwd: packageRoot, gzip: true }, ['config/default.json']);
  const body = fs.readFileSync(artifact);
  const manifest = { id, project: { repo: 'qualified-private-mirror', commit: releaseCommit, onRemote: false },
    omni: { repo: 'sdk', commit: 'c'.repeat(40), onRemote: true }, builtWith: { omnitron: '1.0.0', packages: [], target: platform },
    gates: [{ name: 'build', status: 'passed' }], builtBy: 'producer', builtAt: '2026-01-01T00:00:00.000Z',
    artifacts: [{ app: 'main', version: '0.0.1', bytes: body.length, sha256: sha(body),
      launch: { mode: 'bootstrap', file: 'dist/bootstrap.js', closureSha256: 'e'.repeat(64) } }] };
  const raw = JSON.stringify(manifest); manifestSha = sha(raw); fs.writeFileSync(path.join(store, id, 'manifest.json'), raw);
  vi.stubEnv('OMNI_FIXTURE_PRIVATE', sentinel);
  try { declarationsSha = (await captureRemoteSource('sample', 'test', id, source, store)).declarationsSha256; }
  finally { vi.unstubAllEnvs(); }
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture() {
  const records = new Map<string, unknown>();
  let pin = 'a'.repeat(64);
  const registration = { name: 'sample', path: original, registeredAt: '2026-01-01T00:00:00.000Z' };
  const recipient = () => ({ host: candidateNode.host, port: candidateNode.port, fingerprint: stableFingerprint, pin, managementIdentity: 'fixture-management' });
  const owner = vi.fn(async () => ({ applicationRuntime: { root: '/runtime/packages/0', executable: '/runtime/node',
    commit: 'd'.repeat(40), target: platform, execution: { mode: 'resident', protocol: 1, ownerId: 'resident', pid: 42, epoch: 2 } } }));
  const credentials = vi.fn(async (_host: string, _port: number, _id: string) => ({ host: candidateNode.host, port: 22, username: 'fixture', expectedHostFingerprint: stableFingerprint }));
  const service: ProjectService = Object.assign(Object.create(ProjectService.prototype), {
    registry: { get: (name: string) => name === 'sample' ? registration : undefined,
      resolveStack: (scope: { project: string; stack: string }) => scope },
    getLoadedConfig: () => ({ apps: [] }), resolveStacks: () => resolveProjectStacks({}, original),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, releaseRunningOn: async () => null,
    assertStartAuthority: vi.fn(), resolveNodeCredentials: credentials, deployer: { inspectInstalledBundle: owner },
    daemonStateStore: { kvGetSync: (key: string) => records.get(key), kvUpdateSync: (key: string, update: (previous: unknown) => unknown) => records.set(key, update(records.get(key))) },
  });
  service.setReleaseRecipientResolver(recipient);
  const input = { sourceRoot: source, storeRoot: store, manifestSha256: manifestSha, declarationsSha256: declarationsSha, nodeId };
  return { service, records, registration, recipient, credentials, owner, input, rotate: () => { pin = 'b'.repeat(64); } };
}

describe('prepared source of one registered remote release', () => {
  it('reads older migration inventories from the exact source and rejects either incompatible direction', async () => {
    const newer = path.join(root, 'migration-change');
    git(root, 'clone', '-q', '--no-local', original, newer);
    const dir = path.join(newer, 'apps/main/migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '002.sql'), 'SELECT 2;');
    git(newer, 'add', 'apps/main/migrations/002.sql'); git(newer, 'commit', '-qm', 'add migration');
    const { manifest } = await loadRelease(id, store);
    const base = { root: original, manifest: { ...manifest, project: { ...manifest.project, commit: originalCommit } } };
    const more = { root: newer, manifest: { ...manifest, project: { ...manifest.project, commit: git(newer, 'rev-parse', 'HEAD') } } };
    await expect(verifyDeploymentMigrations(base, more, ['main'])).rejects.toThrow(/return release.*002.sql/);
    await expect(verifyDeploymentMigrations(more, base, ['main'])).rejects.toThrow(/candidate changes.*002.sql/);
  });
  it.each(['return', 'partial', 'realigned', 'renew'])('checks both enrolled nodes through placement and full stop (%s)', async mode => {
    const f = fixture(), dir = fs.mkdtempSync(path.join(root, 'passive-placement-'));
    const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, child() { return this; } };
    const stores: DaemonStateStore[] = [];
    const make = async (name: string) => {
      const db = new DaemonStateStore(log as never, path.join(dir, name, 'state.db')); stores.push(db);
      const state = new StateStore(db); await state.init();
      return new ProjectService(log as never, new OrchestratorService(log as never, {} as never, state, dir), db);
    };
    const footprint: { id: string; name: string }[] = [];
    const inventory = vi.spyOn(containers, 'inspectStackContainers').mockImplementation(async () => structuredClone(footprint));
    const removal = vi.spyOn(containers, 'removeContainer').mockImplementation(async id => {
      const i = footprint.findIndex(c => c.id === id); if (i < 0) throw Error('foreign container'); footprint.splice(i, 1);
    });
    try {
      const controller = await make('controller'), donor = await make('donor'), receiver = await make('receiver');
      const scope = { project: 'sample', stack: 'test' };
      const expectedOld = { ...f.recipient(), host: oldNode.host, pin: 'b'.repeat(64), managementIdentity: 'original-management' };
      const enrolled = (n: string) => n === oldNode.nodeId ? expectedOld : f.recipient();
      controller.setReleaseRecipientResolver(enrolled);
      controller.setNodeCredentialResolver(f.credentials as never);
      vi.spyOn(Reflect.get(controller, 'deployer'), 'inspectInstalledBundle').mockImplementation(f.owner);
      const registered = path.join(dir, 'registered');
      git(root, 'clone', '-q', '--no-local', original, registered);
      await controller.addProject(scope.project, registered);
      const originalConfig = { apps: [{ name: 'main', bootstrap: 'apps/main/src/bootstrap.mjs' }] };
      Object.assign(controller, { getLoadedConfig: () => originalConfig, loadProjectConfig: async () => originalConfig,
        releaseRunningOn: async () => null, assertStartAuthority: async () => {} });
      for (const [node, sub] of [[donor, 'donor'], [receiver, 'receiver']] as const) {
        const p = path.join(dir, sub, 'allocation'); fs.mkdirSync(p);
        const config = { name: scope.project, apps: [{ name: 'main', script: 'unstarted.mjs', enabled: false }],
          stacks: { deployed: { type: 'local', apps: ['main'], infrastructureOwnership: 'controller', managedOrigin: scope, release: { mode: 'required' } } } };
        await expect(node.inspectNodeStackStop({ ...scope, applications: true })).rejects.toThrow('no verified source-stack binding');
        fs.writeFileSync(path.join(p, 'omnitron.config.mjs'), 'export default ' + JSON.stringify(config));
        await node.addProject(scope.project, p); await node.listProjects();
      }
      const invoke = (node: ProjectService, method: string, payload: unknown) => {
        if (!['inspectNodeStackStop', 'prepareNodeStackStop', 'executeNodeStackStop'].includes(method)) throw Error('unexpected node method ' + method);
        return Reflect.get(node, method).call(node, payload);
      };
      controller.setSlaveConnector({
        getConnections: () => [],
        invokeOnSlave: async (host: string, _port: number, _service: string, method: string, args: unknown[]) => {
          expect(host).toBe(oldNode.host); return invoke(donor, method, args[0]);
        },
        pinnedService: (host: string, port: number, node: string, identity: string, service: string) => {
          const old = node === oldNode.nodeId; expect([host, port, identity, service]).toEqual(
            [old ? oldNode.host : candidateNode.host, 9700, old ? expectedOld.managementIdentity : f.recipient().managementIdentity, 'OmnitronProject']);
          return (method: string, payload: unknown) => invoke(old ? donor : receiver, method, payload);
        },
      } as never);
      const reviewedStop = async () => {
        const review = await controller.reviewStackStop(scope.project, scope.stack);
        expect(review.targets).toHaveLength(1); expect(review.digest, JSON.stringify(review.targets)).toBeTruthy();
        return controller.stopStack(scope.project, scope.stack, review.digest!);
      };
      const admitted = await controller.prepareRemoteReleaseSource(scope.project, scope.stack, id, f.input);
      const forward = { ...scope, fromNodeId: oldNode.nodeId, destination: { release: id, prepared: admitted.digest } };
      const rpc = new ProjectRpcService(controller);
      expect(await rpc.preflightRemotePlacement(forward)).toMatchObject({ fromNodeId: oldNode.nodeId, toNodeId: nodeId, release: id });
      await reviewedStop();
      const first = await controller.reviewRemotePlacement(forward); await controller.selectRemotePlacement({ ...forward, review: first.digest });
      const back = { ...scope, fromNodeId: nodeId, destination: { registered: true as const } };
      await expect(controller.reviewRemotePlacement(back)).rejects.toThrow(/full stop/);
      if (mode === 'realigned') {
        const journal = new StackTargets(stores[0]!);
        const stateBefore = journal.inspect(scope);
        const file = path.join(registered, 'omnitron.stacks.json');
        const declarations = stacks(candidateNode);
        fs.writeFileSync(file, JSON.stringify(declarations));
        const prepared = await controller.prepareRemoteReleaseSource(scope.project, scope.stack, id, f.input);
        const request = { ...scope, fromNodeId: nodeId, previousDeclarationCommit: originalCommit,
          destination: { release: id, prepared: prepared.digest } };
        await expect(rpc.preflightRemotePlacement(request)).rejects.toThrow(/committed Git declaration/);
        git(registered, 'commit', '-qam', 'align the registered recipient');
        const head = git(registered, 'rev-parse', 'HEAD');
        await expect(rpc.preflightRemotePlacement({ ...request, previousDeclarationCommit: head })).rejects.toThrow(/does not match/);
        await expect(rpc.preflightRemotePlacement({ ...request, fromNodeId: oldNode.nodeId })).rejects.toThrow(/same-recipient/);
        const preflight = await rpc.preflightRemotePlacement(request);
        expect(preflight).toMatchObject({ fromNodeId: nodeId, toNodeId: nodeId, release: id, sshFingerprint: stableFingerprint,
          registrationChange: { previous: stateBefore.placement!.registration, previousDeclarationCommit: originalCommit, currentDeclarationCommit: head },
          source: { project: scope.project, stack: 'deployed' } });
        expect(preflight.registrationChange!.current).toBe(preflight.registration);
        expect(preflight).not.toHaveProperty('digest');
        expect(journal.inspect(scope)).toEqual(stateBefore);
        await expect(rpc.reviewRemotePlacement(request)).rejects.toThrow(/full stop/);
        await expect(rpc.selectRemotePlacement({ ...request, review: preflight.registration })).rejects.toThrow(/full stop/);
        await reviewedStop();
        const review = await rpc.reviewRemotePlacement(request);
        expect(review.registrationChange).toEqual(preflight.registrationChange);
        const stoppedState = journal.inspect(scope);
        controller.setReleaseRecipientResolver(n => ({ ...enrolled(n), pin: 'e'.repeat(64) }));
        await expect(rpc.selectRemotePlacement({ ...request, review: review.digest })).rejects.toThrow(/registration or approved SSH/);
        expect(journal.inspect(scope)).toEqual(stoppedState);
        controller.setReleaseRecipientResolver(enrolled);
        expect(await rpc.selectRemotePlacement({ ...request, review: review.digest })).toEqual(review);
        expect(await rpc.selectRemotePlacement({ ...request, review: review.digest })).toEqual(review);
        expect(journal.inspect(scope).placement?.origin.nodeId).toBe(oldNode.nodeId);
        expect(controller.getStack(scope.project, scope.stack).config.nodes?.[0]?.nodeId).toBe(nodeId);
        return;
      }
      if (mode === 'partial') footprint.push({ id: 'f'.repeat(64), name: 'fixture-partially-provisioned' });
      const stopped = await reviewedStop();
      expect(stopped.stopOperation?.nodes[0]?.execution).toMatchObject({ project: scope.project, stack: 'deployed', revision: 1 });
      expect(footprint).toEqual([]); expect(removal).toHaveBeenCalledTimes(mode === 'partial' ? 1 : 0);
      if (mode === 'renew') {
        const renewal = { ...forward, fromNodeId: nodeId };
        const review = await rpc.reviewRemotePlacement(renewal);
        expect(review.generation).toBeGreaterThan(first.generation);
        expect(review.stopId).toBe(stopped.stopOperation!.id);
        expect(await rpc.selectRemotePlacement({ ...renewal, review: review.digest })).toEqual(review);
        await expect(rpc.reviewRemotePlacement(renewal)).rejects.toThrow(/newer full stop/);
        return;
      }
      const restored = await controller.reviewRemotePlacement(back); await controller.selectRemotePlacement({ ...back, review: restored.digest });
      expect(controller.getStack(scope.project, scope.stack).config.nodes?.[0]?.nodeId).toBe(oldNode.nodeId);
    } finally {
      inventory.mockRestore(); removal.mockRestore(); await Promise.all(stores.map(store => store.dispose()));
    }
  });

  it('binds an aligned node to the enrolled endpoint and the effective node declaration in the admitted release', () => {
    const recipient = fixture().recipient();
    const release = { type: 'remote' as const, nodes: [candidateNode] };
    const node = { host: candidateNode.host, nodeId, role: candidateNode.role };
    expect(() => confirmRegisteredReleaseNode({ ...release, nodes: [{ ...node, label: 'Current node' }] }, release, nodeId, recipient)).not.toThrow();
    for (const changed of [{ ...node, nodeId: 'other' }, { host: node.host, role: node.role }, { ...node, host: oldNode.host }, { ...node, port: 9800 },
      { ...node, role: 'worker' as const }, { ...node, apps: ['other'] }, { ...node, ssh: { user: 'different' } }, { ...node, ssh: { privateKey: 'unused' } }]) {
      expect(() => confirmRegisteredReleaseNode({ ...release, nodes: [changed] }, release, nodeId, recipient)).toThrow();
    }
    expect(() => confirmRegisteredReleaseNode({ ...release, nodes: [node, oldNode] }, release, nodeId, recipient)).toThrow();
  });

  it('reads the producer release mode, captures only the detached bootstrap and observes exclusively its pinned owner', async () => {
    const f = fixture();
    const reads = fs.readFileSync(marker, 'utf8');
    const receipt = await f.service.prepareRemoteReleaseSource('sample', 'test', id, f.input);
    expect(receipt).toMatchObject({ release: id, manifestSha256: manifestSha, commit: releaseCommit, nodeId, sshFingerprint: stableFingerprint });
    expect(receipt.digest).toMatch(/^[a-f0-9]{64}$/);
    await expect(f.service.checkRemoteReleaseSource('sample', 'test', id, receipt.digest)).resolves.toEqual(receipt);
    expect(fs.readFileSync(marker, 'utf8')).toBe(reads);
    expect(f.credentials.mock.calls.every(call => call[0] === candidateNode.host && call[2] === nodeId)).toBe(true);
    expect(f.owner).toHaveBeenCalledTimes(2);
    expect(f.records.size).toBe(1);
    expect(git(original, 'rev-parse', 'HEAD')).toBe(originalCommit);
    expect(git(original, 'status', '--porcelain')).toBe('');
    expect(JSON.parse(fs.readFileSync(path.join(original, 'omnitron.stacks.json'), 'utf8'))).toEqual(stacks(oldNode));
    await expect(f.service.checkRemoteReleaseSource('sample', 'dev', id, receipt.digest)).rejects.toThrow(/No prepared/);
    f.rotate();
    await expect(f.service.checkRemoteReleaseSource('sample', 'test', id, receipt.digest)).rejects.toThrow(/registration or recipient changed/);
    expect(f.owner).toHaveBeenCalledTimes(2);
  });

  it('rejects a different manifest, declared node, source checkout, dirty source and foreign registration before any owner call', async () => {
    const f = fixture();
    for (const changed of [{ manifestSha256: 'f'.repeat(64) }, { nodeId: 'other' }, { sourceRoot: original }])
      await expect(f.service.prepareRemoteReleaseSource('sample', 'test', id, { ...f.input, ...changed })).rejects.toThrow();
    fs.writeFileSync(path.join(source, 'unexpected'), 'dirty');
    try { await expect(f.service.prepareRemoteReleaseSource('sample', 'test', id, f.input)).rejects.toThrow(/differs from its immutable commit/); }
    finally { fs.unlinkSync(path.join(source, 'unexpected')); }
    const foreign = path.join(root, 'unrelated'); fs.mkdirSync(foreign); git(foreign, 'init', '-q'); git(foreign, 'commit', '--allow-empty', '-qm', 'unrelated');
    await expect(verifyRemoteSourceTree(source, foreign, releaseCommit)).rejects.toThrow(/no verified history/);
    expect(f.owner).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
    expect(() => confirmReleaseRecipient({ type: 'remote', nodes: [candidateNode, oldNode] }, nodeId, f.recipient())).toThrow(/one declared recipient/);
    expect(() => confirmReleaseRecipient({ type: 'remote', nodes: [candidateNode] }, nodeId, { ...f.recipient(), fingerprint: '' })).toThrow(/SSH host key/);
    expect(() => confirmReleaseRecipient({ type: 'remote', nodes: [{ ...candidateNode, ssh: { privateKey: '/unapproved' } }] }, nodeId, f.recipient())).toThrow();
    expect((await loadRelease(id, store)).manifestSha256).toBe(manifestSha);
  });

  it('produces a portable capture with only the committed symbolic binding and checks each bootstrap digest', async () => {
    const f = fixture();
    const originalBytes = fs.readFileSync(path.join(store, '.remote-sources', declarationsSha + '.json'), 'utf8');
    for (const value of [sentinel, source, 'omnitron-capture-']) expect(originalBytes).not.toContain(value);
    const capture = await readCapturedSource(store, declarationsSha, source);
    expect(capture.config.stacks?.['test']?.settings).toEqual(settings);
    expect(capture.config.apps[0]?.env).toEqual({});
    expect(capture.config.apps[0]?.cwd).toBe(source);
    for (const rewrite of [
      (c: typeof capture) => { c.declarations[0]!.sha256 = '0'.repeat(64); },
      (c: typeof capture) => { c.config.stacks!['test']!.nodes![0]!.host = 'other.invalid'; },
      (c: typeof capture) => { c.project = 'foreign'; },
    ]) {
      // Rewrite portable bytes, so each negative case has its own authentic digest.
      const data = JSON.parse(originalBytes); rewrite(data);
      const bytes = JSON.stringify(data), digest = sourceFileDigest(bytes);
      fs.writeFileSync(path.join(store, '.remote-sources', digest + '.json'), bytes);
      await expect(f.service.prepareRemoteReleaseSource('sample', 'test', id, { ...f.input, declarationsSha256: digest })).rejects.toThrow();
    }
    await expect(f.service.prepareRemoteReleaseSource('sample', 'test', id, { ...f.input, unexpected: sentinel } as typeof f.input)).rejects.toThrow();
    expect(f.owner).not.toHaveBeenCalled();
    expect(f.records.size).toBe(0);
  });

  it('uses the candidate archive for the preserve dry run and retains the missing host evidence refusal', async () => {
    const f = fixture();
    const receipt = await f.service.prepareRemoteReleaseSource('sample', 'test', id, f.input);
    const report = await f.service.reviewPreparedStackStart('sample', 'test', id, receipt.digest);
    expect(report.selection).toEqual({ release: id, preparedSource: receipt.digest, nodeId });
    expect(report.digest).toBeNull();
    expect(report.targets).toEqual([{ node: 'preflight', reason: 'A host resource has no verifiable native preservation identity' }]);
    await expect(f.service.reviewPreparedHostBindings('sample', 'test', id, receipt.digest, 'incumbent')).rejects.toThrow(/different prepared recipient/);
  });

  it('makes a replacement infrastructure observation only on the enrolled management connection', async () => {
    const f = fixture();
    const result = { protocol: 1, mode: 'preserve', digest: 'a'.repeat(64), containers: [], checks: [] };
    const invoke = vi.fn(async () => result), pinnedService = vi.fn(() => invoke);
    const connector = { pinnedService, addSlave: vi.fn(), invokeOnSlave: vi.fn() };
    f.service.setSlaveConnector(connector as never);
    const review = Reflect.get(f.service, 'reviewNodeInfrastructure').bind(f.service);
    await expect(review(candidateNode, {}, {}, { project: 'sample', stack: 'test' }, source, undefined, 'fixture-management')).resolves.toEqual(result);
    expect(pinnedService).toHaveBeenCalledWith(candidateNode.host, candidateNode.port, nodeId, 'fixture-management', 'OmnitronInfra');
    expect(invoke).toHaveBeenCalledWith('reviewStack', expect.objectContaining({ infrastructure: 'preserve' }));
    pinnedService.mockImplementationOnce(() => { throw Error('enrollment changed'); });
    await expect(review(candidateNode, {}, {}, { project: 'sample', stack: 'test' }, source, undefined, 'fixture-management')).rejects.toThrow(/enrollment/);
    expect(connector.addSlave).not.toHaveBeenCalled();
    expect(connector.invokeOnSlave).not.toHaveBeenCalled();
  });

  it('sends the first reconcile through provisionStack on the enrolled recipient', async () => {
    const f = fixture();
    const apply = vi.fn(async () => ({ ready: true, running: ['sample-test-db'] }));
    const mesh = { pinnedService: vi.fn(() => apply), addSlave: vi.fn(), invokeOnSlave: vi.fn() };
    const provision = Reflect.get(f.service, 'provisionNodeInfrastructure').bind(f.service);
    const owner = { project: 'sample', stack: 'test' };
    const authority = { mode: 'reconcile', managementIdentity: 'fixture-management' };
    await expect(provision(mesh, candidateNode, {}, {}, owner, source, undefined, authority)).resolves.toMatchObject({ ready: true });
    expect(mesh.pinnedService).toHaveBeenCalledWith(candidateNode.host, candidateNode.port, nodeId, authority.managementIdentity, 'OmnitronInfra');
    expect(apply).toHaveBeenCalledWith('provisionStack', expect.objectContaining({ ...owner, infrastructure: 'reconcile' }));
    expect(mesh.addSlave).not.toHaveBeenCalled();
    expect(mesh.invokeOnSlave).not.toHaveBeenCalled();
  });

  describe('first native health probes on a release recipient', () => {
    const scope = { project: 'sample', stack: 'test' };
    const waiting = { name: 'search', status: 'running', error: 'container health probe is starting' };
    const pending = { ready: false, failed: [waiting], missing: [] };
    const container = { ...scope, name: 'search', containerId: 'f'.repeat(64), status: 'running', health: 'healthy' };
    const full = { ready: true, detail: 'all services ready' };
    function reconcile(responses: unknown[]) {
      const apply = vi.fn(async (_method: string) => responses.shift());
      const service = fixture().service;
      const provision = Reflect.get(service, 'provisionNodeInfrastructure').bind(service);
      const result = provision({ pinnedService: () => apply }, candidateNode, {}, {}, scope, source, undefined,
        { mode: 'reconcile', managementIdentity: 'fixture-management' });
      return { result, apply };
    }
    it('checks the same IDs until healthy, then requires a fresh complete recipient verdict', async () => {
      vi.useFakeTimers();
      try {
        const { result, apply } = reconcile([pending, [{ ...container, health: 'starting' }], [container], full]);
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
        await vi.advanceTimersByTimeAsync(2000);
        await expect(result).resolves.toEqual(full);
        expect(apply.mock.calls.map(([method]) => method)).toEqual(['provisionStack', 'listContainers', 'listContainers', 'provisionStack']);
      } finally { vi.useRealTimers(); }
    });
    it.each([
      ['missing', { ...pending, missing: ['db'] }], ['host failed', { ...pending, failed: [waiting, { name: 'db', status: 'failed' }] }],
      ['unhealthy', { ...pending, failed: [{ ...waiting, error: 'container health probe is unhealthy' }] }],
    ])('preserves the initial %s refusal', async (_name, report) => {
      const { result, apply } = reconcile([report]);
      await expect(result).resolves.toMatchObject({ ready: false });
      expect(apply).toHaveBeenCalledTimes(1);
    });
    it.each([[], [{ ...container, stack: 'other' }], [{ ...container, health: 'unhealthy' }], [container, container]].map(observed => ({ observed })))(
      'rejects an incomplete or conflicting observation %#', async ({ observed }) => {
        const { result, apply } = reconcile([pending, observed]);
        await expect(result).resolves.toMatchObject({ ready: false });
        expect(apply).toHaveBeenCalledTimes(2);
      });
    it('refuses to continue after the same name acquires another container ID', async () => {
      vi.useFakeTimers();
      try {
        const { result, apply } = reconcile([pending, [{ ...container, health: 'starting' }], [{ ...container, containerId: 'a'.repeat(64) }]]);
        await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
        await vi.advanceTimersByTimeAsync(2000);
        await expect(result).resolves.toMatchObject({ ready: false });
        expect(apply).toHaveBeenCalledTimes(3);
      } finally { vi.useRealTimers(); }
    });
    it('keeps a subsequent host or setup failure', async () => {
      const { result } = reconcile([pending, [container], { ready: false, detail: 'host service failed', failed: [], missing: [] }]);
      await expect(result).resolves.toEqual({ ready: false, detail: 'host service failed' });
    });
  });

  it('rejects release topology derived from a secret even when the project returns only its hash', async () => {
    const derived = path.join(root, 'derived'), scope = path.join(root, 'derived-store');
    git(root, 'clone', '-q', '--no-local', source, derived);
    const config = path.join(derived, 'omnitron.config.mjs');
    fs.writeFileSync(config, "import {createHash} from 'node:crypto'; export default { apps:[{name:'main',bootstrap:'apps/main/src/bootstrap.mjs',env:{DERIVED:createHash('sha256').update(process.env.APP_BINDING).digest('hex')}}] };");
    git(derived, 'add', 'omnitron.config.mjs'); git(derived, 'commit', '-qm', 'derived topology');
    fs.cpSync(path.join(store, id), path.join(scope, id), { recursive: true });
    const file = path.join(scope, id, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.project.commit = git(derived, 'rev-parse', 'HEAD'); fs.writeFileSync(file, JSON.stringify(manifest));
    await expect(captureRemoteSource('sample', 'test', id, derived, scope)).rejects.toThrow(/depend on runtime bindings/);
    expect(fs.existsSync(path.join(scope, '.remote-sources'))).toBe(false);
  });

  it.each(['original', 'changed', 'deployment'])('routes a selected placement with a %s registered declaration', async (registrationMode) => {
    const f = fixture();
    const service = f.service;
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const store = new DaemonStateStore(log as never, path.join(root, 'placement-' + registrationMode + '.db'));
    Object.assign(service, { daemonStateStore: store });
    delete (service as unknown as { resolveStacks?: unknown }).resolveStacks;
    const serving = {
      host: oldNode.host,
      port: 9700,
      fingerprint: 'SHA256:' + 'B'.repeat(43),
      pin: 'c'.repeat(64),
      managementIdentity: 'serving-pinned-management',
    };
    service.setReleaseRecipientResolver((key) => (key === oldNode.nodeId ? serving : f.recipient()));
    const incumbent = { ...oldNode };
    delete (incumbent as { nodeId?: string }).nodeId;
    // A pre-pinned mutating registry was not required when this old incumbent was first deployed.
    const registeredSource = path.join(root, 'legacy-serving-' + registrationMode);
    git(root, 'clone', '-q', '--no-local', original, registeredSource);
    fs.writeFileSync(path.join(registeredSource, 'omnitron.stacks.json'), JSON.stringify(stacks(incumbent as typeof oldNode)));
    git(registeredSource, 'add', 'omnitron.stacks.json');
    git(registeredSource, 'commit', '-qm', 'legacy recipient');
    f.registration.path = registeredSource;
    const before = fs.readFileSync(marker, 'utf8');
    const inv = {
      protocol: 1,
      project: 'sample',
      stack: 'test',
      applications: true,
      definition: 'b'.repeat(64),
      containers: [],
      execution: {
        project: 'sample',
        stack: 'deployed',
        phase: 'stopped',
        revision: 9,
        apps: [{ name: 'sample/deployed/main', generation: 'generation-A' }],
      },
    };
    let launched: { id: string; manifestSha256: string; artifactSha256: string } | undefined;
    let loseLaunchReply = false;
    const read = vi.fn(async (method: string, body?: { operationId: string }) => {
      if (method === 'status') {
        const generation = inv.execution.apps[0]!.generation;
        return { apps: launched && inv.execution.phase === 'running' ? [{
          name: 'sample/deployed/main', pid: 102, status: 'online', generation, instances: 1, cpu: 0, memory: 0, restarts: 0, uptime: 5000,
          release: { state: 'confirmed', basis: 'verified-launch', releaseId: launched.id, manifestSha256: launched.manifestSha256,
            artifactSha256: launched.artifactSha256, launchId: generation, observedAt: new Date().toISOString() },
        }] : [] };
      }
      if (method === 'getState') return { services: {} };
      if (method === 'inspectNodeStackStop') return structuredClone(inv);
      if (method === 'prepareNodeStackStop') return { ...structuredClone(inv),
        operationId: registrationMode === 'deployment' ? 'reviewed-stop-' + inv.execution.revision : 'replacement-stop' };
      if (method === 'executeNodeStackStop') {
        inv.execution.revision++;
        inv.execution.phase = 'stopped';
        return {
          protocol: 1,
          project: 'sample',
          stack: 'test',
          operationId: body!.operationId,
          outcome: 'stopped',
          observedAt: '2026-01-01T00:03:00Z',
          applications: {
            project: 'sample',
            stack: 'deployed',
            operationId: body!.operationId,
            revision: inv.execution.revision,
            stopped: ['sample/deployed/main'],
          },
          removedContainers: [],
        };
      }
      return {};
    });
    const pinnedService = vi.fn(() => read),
      invokeOnSlave = vi.fn();
    const base = { apps: [{ name: 'main', bootstrap: 'apps/main/src/bootstrap.mjs' }] };
    const nativeResolve = Reflect.get(ProjectService.prototype, 'resolveStacks').bind(service);
    const launches: Array<{ root?: string; host: string; commit: string; config: unknown }> = [];
    const enable = vi.fn(),
      audit = vi.fn();
    Object.assign(service, {
      stackStates: new Map(),
      startsInFlight: new Map(),
      stopsInFlight: new Map(),
      readColdBatch: async () => null,
      configRegistry: new Map([['sample', { config: base }]]),
      getLoadedConfig: () => base,
      loadProjectConfig: async () => base,
      orchestrator: { list: () => [] },
      infraManager: { getInstance: () => undefined },
      updateEnabledStacks: enable,
      assertStackMutable: vi.fn(),
      nodeStackStop: { assertMutable: vi.fn() },
      emit: vi.fn(),
      audit: { record: audit },
      logger: { ...Reflect.get(service, 'logger'), debug: vi.fn() },
      startRemoteStack: async (
        _p: string,
        _s: string,
        cfg: { nodes: Array<{ host: string }> },
        ecosystem: unknown,
        release: { placement: { root: string; recheck(): Promise<void> }; manifestSha256: string;
          manifest: { id: string; project: { commit: string }; artifacts: { sha256: string }[] } },
      ) => {
        await release.placement.recheck();
        if (registrationMode === 'deployment') {
          inv.execution.phase = 'running';
          inv.execution.revision++;
          inv.execution.apps[0]!.generation = 'launch-' + inv.execution.revision;
          launched = { id: release.manifest.id, manifestSha256: release.manifestSha256, artifactSha256: release.manifest.artifacts[0]!.sha256 };
        }
        launches.push({
          root: release.placement.root,
          host: cfg.nodes[0]!.host,
          commit: release.manifest.project.commit,
          config: ecosystem,
        });
        if (loseLaunchReply) {
          loseLaunchReply = false;
          throw Error('Recipient launched, transport lost the reply');
        }
        return { nodes: 1, reached: 1, skipped: [] };
      },
    });
    service.setSlaveConnector({ pinnedService, invokeOnSlave, getConnections: () => [] } as never);
    const saved = (node: typeof oldNode, revision = 9) => ({
      id: 'stop-' + node.nodeId,
      phase: 'stopped',
      intentCommitted: true,
      completedAt: '2026-01-01T00:02:00Z',
      nodes: [
        {
          node: node.host + ':9700',
          nodeId: node.nodeId,
          outcome: 'stopped',
          operationId: 'source-operation',
          observedAt: '2026-01-01T00:02:00Z',
          definition: inv.definition,
          execution: { project: 'sample', stack: 'deployed', revision },
        },
      ],
    });
    const stopKey = 'stack:sample/test:last-stop';
    try {
      const ready = await service.prepareRemoteReleaseSource('sample', 'test', id, f.input);
      const req = {
        project: 'sample',
        stack: 'test',
        fromNodeId: oldNode.nodeId,
        destination: { release: id, prepared: ready.digest },
      };
      await expect(service.reviewRemotePlacement(req)).rejects.toThrow(/full stop/);
      store.kvSetSync(stopKey, { ...saved(oldNode), keepInfrastructure: true });
      await expect(service.reviewRemotePlacement(req)).rejects.toThrow(/full stop/);
      store.kvSetSync(stopKey, saved(oldNode, 8));
      await expect(service.reviewRemotePlacement(req)).rejects.toThrow(/generation/);
      store.kvSetSync(stopKey, saved(oldNode));
      const obsolete = await service.reviewRemotePlacement(req);
      const journal = new StackTargets(store);
      journal.remember(req, []);
      await expect(service.selectRemotePlacement({ ...req, review: obsolete.digest })).rejects.toThrow(/review changed/);
      const review = await service.reviewRemotePlacement(req);
      expect(nativeResolve(base, 'sample').test.nodes[0].host).toBe(oldNode.host);
      const route = await service.selectRemotePlacement({ ...req, review: review.digest });
      expect(route).toEqual(review);
      await expect(service.selectRemotePlacement({ ...req, review: review.digest })).resolves.toEqual(route);
      expect(new StackTargets(store).inspect(req).placement?.receipt).toEqual(route);
      expect(journal.inspect({ project: 'sample', stack: 'dev' })).toEqual({ version: 1, revision: 0, nodes: [] });
      inv.execution.phase = 'running';
      await expect(service.startStack('sample', 'test', { source: 'operator' })).rejects.toThrow(/stopped execution/);
      expect(launches).toHaveLength(0);
      inv.execution.phase = 'stopped';
      const checks = await service.checkRelease('sample', 'test', id);
      expect(checks.ok).toBe(true);
      const preserve = await service.reviewStackStart('sample', 'test', { infrastructure: 'preserve' });
      expect(preserve.selection).toEqual({ release: id, preparedSource: ready.digest, nodeId });
      expect(nativeResolve(base, 'sample').test.nodes[0]).toEqual(candidateNode);
      expect(nativeResolve(base, 'sample').dev.type).toBe('local');
      const wrong = await service
        .startStack('sample', 'test', { source: 'operator', release: 'some-other-release' })
        .catch((error) => error);
      expect(wrong.message).toMatch(/different immutable release/);
      const call = Reflect.get(service, 'callStackTarget').bind(service);
      await call({ project: 'sample', stack: 'test' }, candidateNode, 'OmnitronDaemon', 'status');
      expect(pinnedService).toHaveBeenLastCalledWith(candidateNode.host, 9700, nodeId, 'fixture-management', 'OmnitronDaemon');
      await expect(
        call({ project: 'sample', stack: 'test' }, oldNode, 'OmnitronProject', 'prepareNodeStackStop', {}),
      ).rejects.toThrow(/outside/);
      pinnedService.mockClear();
      const fresh = await service.getStackStatus('sample', 'test');
      expect(fresh).toMatchObject({ connectedNodes: 1, totalNodes: 1, totalApps: 1, onlineApps: 0 });
      expect(service.getStack('sample', 'test').selectedRelease).toEqual({ id, manifestSha256: manifestSha });
      await service.startStack('sample', 'test', { source: 'boot' });
      expect(pinnedService.mock.calls.length).toBeGreaterThan(1);
      expect(pinnedService.mock.calls.every((args) => (args as unknown[])[2] === nodeId)).toBe(true);
      expect(launches).toHaveLength(0);
      await service.startStack('sample', 'test', { source: 'operator', infrastructure: 'reconcile' });
      expect(launches).toHaveLength(1);
      expect(launches[0]).toMatchObject({ root: source, host: candidateNode.host, commit: releaseCommit });
      expect(fs.readFileSync(marker, 'utf8')).toBe(before);
      if (registrationMode === 'deployment') {
        const second = 'sample-next', secondSource = path.join(root, 'second-release');
        git(root, 'clone', '-q', '--no-local', source, secondSource);
        fs.writeFileSync(path.join(secondSource, 'revision.txt'), 'second revision');
        git(secondSource, 'add', 'revision.txt');
        git(secondSource, 'commit', '-qm', 'new release');
        const originalRelease = path.join(f.input.storeRoot, id), newRelease = path.join(f.input.storeRoot, second);
        fs.cpSync(originalRelease, newRelease, { recursive: true });
        const file = path.join(newRelease, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        manifest.id = second;
        manifest.project.commit = git(secondSource, 'rev-parse', 'HEAD');
        const raw = JSON.stringify(manifest);
        fs.writeFileSync(file, raw);
        const captured = await captureRemoteSource('sample', 'test', second, secondSource, f.input.storeRoot);
        const priorCommit = git(registeredSource, 'rev-parse', 'HEAD');
        fs.writeFileSync(path.join(registeredSource, 'omnitron.stacks.json'), JSON.stringify(stacks(candidateNode)));
        git(registeredSource, 'commit', '-qam', 'register selected recipient');
        const rpc = new ProjectRpcService(service);
        const scope = { project: 'sample', stack: 'test' }, request = { ...scope, release: second };
        const stopCount = () => read.mock.calls.filter(([method]) => method === 'executeNodeStackStop').length;
        await expect(rpc.checkRelease(request)).resolves.toMatchObject({ ok: false, state: 'replacement-unavailable' });
        await service.prepareRemoteReleaseSource('sample', 'test', second, { ...f.input, sourceRoot: secondSource,
          manifestSha256: sha(raw), declarationsSha256: captured.declarationsSha256 });
        const checked = await rpc.checkRelease(request);
        expect(checked, checked.because).toMatchObject({ ok: true, deployment: { previousDeclarationCommit: priorCommit,
          nodeId, release: second, rollback: { release: id }, stop: { applications: ['sample/deployed/main'], containers: [] } } });
        expect(stopCount()).toBe(0);
        const confirmation = { ...request, review: checked.deployment!.digest };
        const previousFile = path.join(originalRelease, 'manifest.json');
        const bytes = fs.readFileSync(previousFile);
        try {
          fs.appendFileSync(previousFile, '\n');
          await expect(rpc.deployReviewedRelease(confirmation)).rejects.toThrow(/manifest/i);
          expect(stopCount()).toBe(0);
        } finally { fs.writeFileSync(previousFile, bytes); }
        inv.execution.revision++;
        await expect(rpc.deployReviewedRelease(confirmation)).rejects.toThrow(/review changed/i);
        inv.execution.revision--;
        loseLaunchReply = true;
        const concurrent = await Promise.allSettled([rpc.deployReviewedRelease(confirmation), rpc.deployReviewedRelease(confirmation)]);
        expect(concurrent.map(result => result.status)).toEqual(['rejected', 'rejected']);
        expect(stopCount()).toBe(1);
        expect(launches).toHaveLength(2);
        // The controller also missed the launch reply. Recover the original generation without another start.
        expect(journal.inspect(scope).placement!.activated).toBe(false);
        await expect(rpc.checkRelease(request)).resolves.toMatchObject({ ok: true, deploymentPhase: 'starting', deployment: { digest: confirmation.review } });
        await expect(service.startStack(scope.project, scope.stack, { release: second })).rejects.toThrow(/unconfirmed release deployment/i);
        await expect(rpc.deployReviewedRelease(confirmation)).resolves.toMatchObject({ selectedRelease: { id: second } });
        expect(journal.inspect(scope).placement!.activated).toBe(true);
        await expect(rpc.deployReviewedRelease(confirmation)).resolves.toMatchObject({ status: 'running' });
        expect(stopCount()).toBe(1);
        expect(launches).toHaveLength(2);
        const back = await rpc.checkRelease({ ...scope, release: id });
        expect(back, back.because).toMatchObject({ ok: true, deployment: { nodeId, release: id, rollback: { release: second } } });
        launched!.id = 'unexpected-release';
        await expect(rpc.checkRelease({ ...scope, release: id })).resolves.toMatchObject({ ok: false, state: 'replacement-unavailable' });
        launched = undefined; // Pinned owner answers, but this application is now absent.
        await expect(rpc.deployReviewedRelease({ ...scope, release: id, review: back.deployment!.digest })).rejects.toThrow(/review changed/i);
        const recover = await rpc.checkRelease({ ...scope, release: id });
        expect(recover, recover.because).toMatchObject({ ok: true, deployment: { recoveryOf: confirmation.review, release: id } });
        await expect(rpc.deployReviewedRelease({ ...scope, release: id, review: recover.deployment!.digest }))
          .resolves.toMatchObject({ status: 'running', selectedRelease: { id } });
        expect(launches.map(item => item.commit)).toEqual([releaseCommit, manifest.project.commit, releaseCommit]);
        expect(stopCount()).toBe(2);
        await expect(rpc.deployReviewedRelease(confirmation)).rejects.toThrow(/superseded/i);
        expect(stopCount()).toBe(2);
        return;
      }
      const restore = { project: 'sample', stack: 'test', fromNodeId: nodeId, destination: { registered: true as const } };
      await expect(service.reviewRemotePlacement(restore)).rejects.toThrow(/full stop/);
      inv.execution.phase = 'running';
      const stillServing = await service.preflightRemotePlacement({ ...req, fromNodeId: nodeId });
      expect(stillServing.source.revision).toBe(inv.execution.revision);
      expect(stillServing).not.toHaveProperty('digest');
      const stopReview = await service.reviewStackStop('sample', 'test');
      expect(stopReview.digest).toBeTruthy();
      await service.stopStack('sample', 'test', stopReview.digest!);
      expect(read).toHaveBeenCalledWith('executeNodeStackStop', expect.objectContaining({ operationId: 'replacement-stop' }));
      if (registrationMode === 'changed') {
        const priorCommit = git(registeredSource, 'rev-parse', 'HEAD');
        const file = path.join(registeredSource, 'omnitron.stacks.json');
        const declarations = JSON.parse(fs.readFileSync(file, 'utf8'));
        declarations.test.infrastructure = { redis: { ports: { redis: 6397 } } };
        fs.writeFileSync(file, JSON.stringify(declarations));
        git(registeredSource, 'commit', '-qam', 'revise service configuration');
        const refreshed = await service.prepareRemoteReleaseSource('sample', 'test', id, f.input);
        const same = { ...req, fromNodeId: nodeId, destination: { release: id, prepared: refreshed.digest } };
        await expect(service.reviewRemotePlacement(same)).rejects.toThrow(/registered stack has changed/);
        const update = { ...same, previousDeclarationCommit: priorCommit };
        await expect(service.reviewRemotePlacement({ ...update, previousDeclarationCommit: originalCommit })).rejects.toThrow(/does not match/);
        await expect(service.reviewRemotePlacement({ ...update, fromNodeId: oldNode.nodeId })).rejects.toThrow(/same-recipient/);
        const at = f.registration.registeredAt;
        f.registration.registeredAt = '2026-01-02T00:00:00.000Z';
        await expect(service.reviewRemotePlacement(update)).rejects.toThrow(/does not match/);
        f.registration.registeredAt = at;
        const change = await service.reviewRemotePlacement(update);
        expect(change.registrationChange?.previousDeclarationCommit).toBe(priorCommit);
        expect(change.registrationChange?.previous).not.toBe(change.registrationChange?.current);
        inv.execution.revision++;
        await expect(service.selectRemotePlacement({ ...update, review: change.digest })).rejects.toThrow(/generation/);
        inv.execution.revision--;
        expect(await service.selectRemotePlacement({ ...update, review: change.digest })).toEqual(change);
        expect(await service.selectRemotePlacement({ ...update, review: change.digest })).toEqual(change);
        await expect(service.reviewRemotePlacement(same)).rejects.toThrow(/newer full stop/);
        const oldStop = store.kvGetSync<ReturnType<typeof saved>>(stopKey)!;
        store.kvSetSync(stopKey, { ...oldStop, id: 'other-receipt-same-execution' });
        await expect(service.reviewRemotePlacement(same)).rejects.toThrow(/newer full stop/);
        const freshStop = await service.reviewStackStop('sample', 'test');
        await service.stopStack('sample', 'test', freshStop.digest!);
        const renewed = await service.reviewRemotePlacement(same);
        expect(renewed.stopId).not.toBe(change.stopId);
        expect(renewed.generation).toBeGreaterThan(change.generation);
        inv.execution.phase = 'running';
        await expect(service.selectRemotePlacement({ ...same, review: renewed.digest })).rejects.toThrow(/stopped execution/);
        inv.execution.phase = 'stopped';
        await expect(service.selectRemotePlacement({ ...same, review: renewed.digest })).resolves.toEqual(renewed);
        await expect(service.selectRemotePlacement({ ...same, review: renewed.digest })).resolves.toEqual(renewed);
        return;
      }
      const back = await service.reviewRemotePlacement(restore);
      await service.selectRemotePlacement({ ...restore, review: back.digest });
      expect(nativeResolve(base, 'sample').test.nodes[0].nodeId).toBe(oldNode.nodeId);
      expect(launches).toHaveLength(1);
      expect(invokeOnSlave).not.toHaveBeenCalled();
      await expect(service.startStack('sample', 'test', { source: 'operator' })).rejects.toThrow(
        /explicitly verified immutable release/,
      );
    } finally {
      await store.dispose();
    }
  });

  it('refuses a source digest on the mutating public start before resolving the incumbent stack', async () => {
    const resolveProjectStack = vi.fn(), startStack = vi.fn();
    const rpc = new ProjectRpcService({ resolveProjectStack, startStack } as unknown as ProjectService);
    const input = { project: 'sample', stack: 'test', release: id, prepared: declarationsSha };
    await expect(rpc.startStack(input)).rejects.toThrow(/cannot activate/);
    expect(resolveProjectStack).not.toHaveBeenCalled();
    expect(startStack).not.toHaveBeenCalled();
  });

  it('requires administrator authority for controller paths and permits an operator to recheck only an approved digest', () => {
    for (const name of ['prepareRemoteReleaseSource', 'checkRemoteReleaseSource', 'reviewPreparedHostBindings',
      'preflightRemotePlacement', 'reviewRemotePlacement', 'selectRemotePlacement', 'deployReviewedRelease']) {
      const rule = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, name);
      for (const role of ['viewer', 'operator', 'admin'])
        expect(validateAccessRequirements({ roles: [role], permissions: [] }, rule).allowed).toBe(role === 'admin' || (name === 'checkRemoteReleaseSource' && role === 'operator'));
    }
  });
});
