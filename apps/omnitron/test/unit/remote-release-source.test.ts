import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { create } from 'tar';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { validateAccessRequirements } from '@omnitron-dev/titan/netron/auth';
import { captureRemoteSource, readCapturedSource, sourceFileDigest } from '../../src/release/source-capture.js';
import { loadRelease } from '../../src/release/load.js';
import { confirmReleaseRecipient, verifyRemoteSourceTree } from '../../src/release/remote-source.js';
import { resolveProjectStacks } from '../../src/config/project-stacks.js';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'remote-release-source-')));
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
    registry: { get: (name: string) => name === 'sample' ? registration : undefined },
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

  it('refuses a source digest on the mutating public start before resolving the incumbent stack', async () => {
    const resolveProjectStack = vi.fn(), startStack = vi.fn();
    const rpc = new ProjectRpcService({ resolveProjectStack, startStack } as unknown as ProjectService);
    const input = { project: 'sample', stack: 'test', release: id, prepared: declarationsSha };
    await expect(rpc.startStack(input)).rejects.toThrow(/cannot activate/);
    expect(resolveProjectStack).not.toHaveBeenCalled();
    expect(startStack).not.toHaveBeenCalled();
  });

  it('requires administrator authority for controller paths and permits an operator to recheck only an approved digest', () => {
    for (const name of ['prepareRemoteReleaseSource', 'checkRemoteReleaseSource', 'reviewPreparedHostBindings']) {
      const rule = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, name);
      for (const role of ['viewer', 'operator', 'admin'])
        expect(validateAccessRequirements({ roles: [role], permissions: [] }, rule).allowed).toBe(role === 'admin' || (name === 'checkRemoteReleaseSource' && role === 'operator'));
    }
  });
});
