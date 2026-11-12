/** Admission must prove the same execution owner and Node target as delivery. */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { refuseReleaseOwners, type ReleaseOwnerAnswer } from '../../src/release/owner-admission.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';
import type { ApplicationRuntime } from '../../src/services/host-upgrade.js';
import type { IStackConfig } from '../../src/config/types.js';
import { ProjectService } from '../../src/services/project.service.js';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-owner-')));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));
const RELEASE_OMNI = 'a'.repeat(40);
const target = { platform: 'linux', arch: 'x64', node: 'v22.23.4', abi: '127', executableSha256: 'b'.repeat(64), libc: '2.39' };
const launch = { mode: 'script' as const, file: 'dist/main.js', closureSha256: 'c'.repeat(64) };
const runtime: ApplicationRuntime = { root: '/runtime/packages/0', executable: '/runtime/node', commit: 'd'.repeat(40), target,
  execution: { mode: 'resident', protocol: 1, ownerId: 'owner', pid: 42, epoch: 9 } };
const stack = { type: 'remote', nodes: [{ host: 'worker.test' }] } as IStackConfig;
const manifest: ReleaseManifest = { id: 'sample', project: { repo: 'project', commit: 'e'.repeat(40) },
  omni: { repo: 'framework', commit: RELEASE_OMNI }, builtWith: { omnitron: '0.3.1', packages: [], target },
  artifacts: [{ app: 'main', version: '1', sha256: 'f'.repeat(64), bytes: 10, launch }], gates: [], builtAt: '', builtBy: 'test' };
const admit = (answer: ReleaseOwnerAnswer, release = manifest) => refuseReleaseOwners(release, stack, [{ name: 'main' }], [answer]);

describe('frozen release execution contract', () => {
  it('accepts a different owner SDK with the proven resident protocol and exact Node image', () => {
    expect(runtime.commit).not.toBe(manifest.omni.commit);
    expect(admit({ host: 'worker.test', runtime })).toBeNull();
  });
  it.each(['platform', 'arch', 'node', 'abi', 'executableSha256', 'libc'] as const)('rejects a changed %s before delivery', key => {
    const changed = { ...target, [key]: key === 'executableSha256' ? '0'.repeat(64) : 'different' };
    expect(admit({ host: 'worker.test', runtime: { ...runtime, target: changed } })).toContain(key);
  });
  it.each([undefined, null, {}, { ...target, libc: undefined }, { ...target, executableSha256: '' }])('rejects incomplete target evidence: %j', value => {
    expect(admit({ host: 'worker.test', runtime: { ...runtime, target: value } } as ReleaseOwnerAnswer)).toContain('complete verified execution target');
  });
  it('does not promote a matching commit or a missing private protocol into execution authority', () => {
    const { execution: _execution, ...unproven } = runtime;
    expect(admit({ host: 'worker.test', runtime: { ...unproven, commit: RELEASE_OMNI } })).toContain('independent execution owner');
    expect(admit({ host: 'worker.test', error: 'native PID changed', runtime })).toContain('native PID changed');
    expect(admit({ host: 'worker.test' })).toContain('independent execution owner');
  });
  it('refuses legacy non-frozen archives even when the SDK commit matches', () => {
    const { launch: _launch, ...archive } = manifest.artifacts[0]!;
    expect(admit({ host: 'worker.test', runtime: { ...runtime, commit: RELEASE_OMNI } }, { ...manifest, artifacts: [archive] })).toContain('valid admitted compiled launch');
  });
});

describe('admission asks the node before anything moves', () => {
  function setup(answer: () => Promise<unknown>) {
    const dir = fs.mkdtempSync(path.join(scratch, 'project-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'omnitron.config.ts'), 'export default {};\n');
    git('add', '.');
    git('commit', '-qm', 'one');
    const commit = git('rev-parse', 'HEAD');

    const id = `sample-${crypto.randomBytes(4).toString('hex')}`;
    const store = path.join(scratch, `store-${id}`);
    fs.mkdirSync(path.join(store, id, 'artifacts'), { recursive: true });
    const body = 'main-tarball';
    fs.writeFileSync(path.join(store, id, 'artifacts', 'main-0.0.1.tar.gz'), body);
    const manifest: ReleaseManifest = {
      id,
      project: { repo: 'gitlab', commit, onRemote: true },
      omni: { repo: 'github', commit: RELEASE_OMNI, onRemote: true },
      artifacts: [
        {
          app: 'main',
          version: '0.0.1',
          sha256: crypto.createHash('sha256').update(body).digest('hex'),
          bytes: body.length, launch,
        },
      ],
      gates: [{ name: 'build', status: 'passed' }],
      builtWith: { omnitron: '0.3.1', packages: [], target },
      builtAt: '2026-09-25T10:00:00.000Z',
      builtBy: 'test',
    };
    fs.writeFileSync(path.join(store, id, 'manifest.json'), JSON.stringify(manifest));

    const inspectInstalledBundle = vi.fn(answer);
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      audit: { record: vi.fn(async () => {}) },
      registry: { get: () => ({ name: 'sample', path: dir }), list: () => [] },
      stackStates: new Map(),
      startsInFlight: new Map(),
    infrastructurePolicy: () => null,
      stopsInFlight: new Map(),
      assertStackMutable: vi.fn(),
      markPriorStopSuperseded: vi.fn(),
      rememberStackTargets: vi.fn(),
      loadProjectConfig: vi.fn(async () => ({ apps: [{ name: 'main', script: 'x' }] })),
      resolveStacks: () => ({
        test: {
          type: 'remote',
          apps: 'all',
          nodes: [{ host: '37.27.130.185', port: 9700 }],
          release: { mode: 'required' },
        },
      }),
      startRemoteStack: vi.fn(async () => ({ nodes: 1, reached: 1, skipped: [] })),
      updateEnabledStacks: vi.fn(),
      toStackInfo: () => ({ name: 'test', type: 'remote', apps: [{ name: 'main', status: 'online' }] }),
      emit: vi.fn(),
      releaseStore: async () => store,
      deployer: { inspectInstalledBundle },
    });
    return { id, svc, inspectInstalledBundle };
  }

  it('refuses an unproven resident before transferring or starting anything', async () => {
    const { id, svc, inspectInstalledBundle } = setup(async () => ({ root: '/old', commit: RELEASE_OMNI }));
    await expect(svc.startStack('sample', 'test', { source: 'operator', release: id })).rejects.toThrow(/independent execution owner/);
    expect(inspectInstalledBundle).toHaveBeenCalledWith(expect.objectContaining({ host: '37.27.130.185', daemonPort: 9700 }));
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });
  it('retains the native refusal reason when the node cannot be verified', async () => {
    const { id, svc } = setup(async () => { throw Error('Pinned SSH identity changed'); });
    await expect(svc.startStack('sample', 'test', { source: 'operator', release: id })).rejects.toThrow(/Pinned SSH identity changed/);
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });
  it('admits the independently verified owner with a different SDK commit', async () => {
    const { id, svc } = setup(async () => ({ applicationRuntime: runtime }));
    await svc.startStack('sample', 'test', { source: 'operator', release: id });
    expect(svc.startRemoteStack).toHaveBeenCalledTimes(1);
  });
  it('uses the recorded owner executable rather than the backend or login Node', async () => {
    const { id, svc } = setup(async () => ({ applicationRuntime: { ...runtime, target: { ...target, abi: '137' } } }));
    await expect(svc.startStack('sample', 'test', { source: 'operator', release: id })).rejects.toThrow(/release target: abi/);
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });
});
