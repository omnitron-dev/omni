import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { create } from 'tar';
import { loadRelease } from '../../src/release/load.js';
import { readArchiveInfrastructure } from '../../src/release/infrastructure.js';
import { ProjectService } from '../../src/services/project.service.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import * as metadata from '../../src/project/bootstrap-metadata.js';

const cleanup: string[] = [];
const target = { platform: 'linux', arch: 'x64', node: 'v22.23.4', abi: '127', libc: '2.39', executableSha256: 'a'.repeat(64) };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(archived?: object | string) {
  const root = await mkdtemp(path.join(tmpdir(), 'infra-release-'));
  cleanup.push(root);
  const repo = path.join(root, 'repo'),
    releaseRoot = path.join(root, 'releases', 'candidate'),
    pkg = path.join(root, 'package');
  await Promise.all([
    mkdir(path.join(repo, 'apps/api/src'), { recursive: true }),
    mkdir(path.join(repo, 'apps/api/config'), { recursive: true }),
    mkdir(path.join(pkg, 'config'), { recursive: true }),
    mkdir(path.join(pkg, 'dist'), { recursive: true }),
    mkdir(path.join(releaseRoot, 'artifacts'), { recursive: true }),
  ]);
  await writeFile(path.join(repo, 'omnitron.config.mjs'), 'export default {};');
  await writeFile(
    path.join(repo, 'apps/api/src/bootstrap.mjs'),
    'export default {name:"api",version:"1",processes:[{name:"main",module:"./main.mjs"}]};'
  );
  await writeFile(path.join(repo, 'apps/api/src/main.mjs'), 'export default class Main {}');
  await writeFile(path.join(repo, 'apps/api/config/default.json'), JSON.stringify({ omnitron: { redis: true } }));
  await writeFile(
    path.join(pkg, 'dist/bootstrap.js'),
    'throw Error("never execute the archived application in the controller");'
  );
  if (archived)
    await writeFile(
      path.join(pkg, 'config/default.json'),
      typeof archived === 'string'
        ? archived
        : JSON.stringify({ omnitron: archived, privateSetting: 'fixture-data-must-stay-private' })
    );
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=fixture@example.invalid', '-c', 'user.name=test', 'commit', '-qm', 'fixture');
  const archive = path.join(releaseRoot, 'artifacts/api-1.tar.gz');
  await create({ file: archive, cwd: pkg, gzip: true }, ['config', 'dist']);
  const bytes = await readFile(archive),
    hash = createHash('sha256').update(bytes).digest('hex'),
    commit = git('rev-parse', 'HEAD');
  await writeFile(
    path.join(releaseRoot, 'manifest.json'),
    JSON.stringify({
      id: 'candidate',
      project: { commit, repo: 'fixture' },
      omni: { commit, repo: 'framework' },
      gates: [{ name: 'test', status: 'passed' }],
      artifacts: [{ app: 'api', version: '1', bytes: bytes.length, sha256: hash,
        launch: { mode: 'bootstrap', file: 'dist/bootstrap.js', closureSha256: 'b'.repeat(64) } }],
      builtWith: { packages: [], omnitron: '1', target },
    })
  );
  return { repo, store: path.dirname(releaseRoot), archive, commit };
}

it('uses archived static infrastructure through actual remote admission, even without a new manifest field', async () => {
  const f = await fixture({ database: true });
  const service: any = Object.create(ProjectService.prototype);
  const app = { name: 'api', bootstrap: 'apps/api/src/bootstrap.mjs' };
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const store = new DaemonStateStore(logger as never, path.join(f.repo, 'state.sqlite'));
  const declarations = new metadata.BootstrapMetadataStore(store);
  Object.assign(service, {
    registry: { get: () => ({ name: 'project', path: f.repo }) },
    releaseStore: () => f.store,
    releaseRunningOn: () => null,
    resolveStackApps: () => [app],
    logger,
    bootstrapTopology: new Map(),
    bootstrapMetadata: declarations,
    askReleaseOwners: () => [{ host: 'node', runtime: { root: '/runtime/packages/0', executable: '/runtime/node', commit: f.commit, target,
      execution: { mode: 'resident', protocol: 1, ownerId: 'owner', pid: 42, epoch: 1 } } }],
  });
  const read = vi.spyOn(metadata, 'readBootstrapMetadata');
  const scope = { type: 'remote', nodes: [{ host: 'node' }] };
  try {
    const check = () => service.admitRelease('project', 'test', scope, { apps: [app] }, 'candidate', 'check');
    await expect(check()).rejects.toThrow('bootstrap declarations have not been captured');
    const bootstrap = path.join(f.repo, app.bootstrap);
    const captured = await metadata.readBootstrapMetadata(bootstrap);
    declarations.save(captured.metadata);
    read.mockClear();
    const release = await check();
    expect(release.remoteDefinitions.get('api').omnitronConfig).toEqual({ database: true });
    expect(JSON.stringify(release.remoteDefinitions.get('api'))).not.toContain('privateSetting');
    expect(read).not.toHaveBeenCalled();
  } finally {
    await store.dispose();
  }
});

it('preserves archive absence and refuses a changed archive before using its data', async () => {
  const f = await fixture(),
    release = await loadRelease('candidate', f.store);
  expect(await readArchiveInfrastructure(release, 'api')).toEqual({ configPath: 'config/default.json' });
  const bytes = await readFile(f.archive);
  bytes[4] = bytes[4]! ^ 1; // gzip mtime does not change the uncompressed data
  await writeFile(f.archive, bytes);
  await expect(readArchiveInfrastructure(release, 'api')).rejects.toThrow(/changed/);
});

it('rejects malformed or oversized declared files without reporting their contents', async () => {
  for (const [bytes, reason] of [
    ['sensitive-invalid-input', /Malformed archived/],
    ['x'.repeat(1_048_577), /1 MiB/],
  ] as const) {
    const f = await fixture(bytes);
    const release = await loadRelease('candidate', f.store);
    await expect(readArchiveInfrastructure(release, 'api')).rejects.toThrow(reason);
  }
});
