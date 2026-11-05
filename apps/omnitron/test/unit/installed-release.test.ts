import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectInstalledArtifacts, installedRoot } from '../../src/release/installed-artifacts.js';
import { installedReleaseCandidates, installedReleaseCatalog, installedReleaseReport, installedNodeFailure, boundedInstalledNodeRead, installedReadDeadline } from '../../src/release/installed-release.js';
import type { OrchestratorControl } from '../../src/orchestrator/execution-contract.js';
import type { InstalledArtifactObservation } from '../../src/shared/dto/installed-release.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'omni-inspection-')); roots.push(root);
  const app = path.join(root, 'app');
  await mkdir(path.join(app, 'dist'), { recursive: true });
  await writeFile(path.join(app, 'dist/bootstrap.js'), 'original();\n');
  await writeFile(path.join(app, 'package.json'), '{"name":"sample-main"}');
  const framework = path.join(app, 'node_modules/@omnitron-dev/omnitron');
  await mkdir(path.join(framework, 'dist'), { recursive: true });
  await writeFile(path.join(framework, 'package.json'), JSON.stringify({ name: '@omnitron-dev/omnitron', main: 'dist/index.js' }));
  await writeFile(path.join(framework, 'dist/index.js'), '');
  await writeFile(path.join(framework, 'dist/BUILD.json'), JSON.stringify({ commit: 'a'.repeat(40), dirty: false }));
  await promisify(execFile)('tar', ['-czf', path.join(root, 'artifact.tar.gz'), '-C', app, 'dist', 'package.json', 'node_modules']);
  const { copyFile } = await import('node:fs/promises');
  await copyFile(path.join(root, 'artifact.tar.gz'), path.join(app, 'artifact.tar.gz'));
  const handle = { name: 'sample/deployed/main', pid: 123, startedAt: 123456, entry: { cwd: app, bootstrap: path.join(app, 'dist/bootstrap.js'), releaseRoot: undefined as string | undefined } };
  const refreshObservation = vi.fn(async () => undefined);
  const orchestrator = { getHandle: (name: string) => name === handle.name ? handle : undefined, refreshObservation } as unknown as OrchestratorControl;
  return { root, app, handle, orchestrator, refreshObservation };
}
const manifest = (id: string, observation: InstalledArtifactObservation): ReleaseManifest => ({
  id,
  project: { repo: 'fixture-project', commit: 'd'.repeat(40) },
  omni: { repo: 'fixture-framework', commit: 'a'.repeat(40) },
  artifacts: observation.archives.map(archive => ({ app: 'main', version: '1', sha256: archive.sha256, bytes: archive.bytes })),
  gates: [{ name: 'fixture', status: 'passed' }],
  builtWith: { omnitron: '0.3.1', packages: [] },
  builtAt: '2026-11-03T00:00:00.000Z',
  builtBy: 'fixture',
});

it('binds a read-only archive comparison to fresh owner observations without synthesizing launch evidence', async () => {
  const f = await fixture();
  const before = f.handle.pid;
  const [observed] = await inspectInstalledArtifacts(f.orchestrator, [f.handle.name]);
  expect(observed, JSON.stringify(observed)).toMatchObject({ state: 'observed', pid: before, frameworkCommit: 'a'.repeat(40) });
  expect(observed!.archives[0]!.entrySha256).toBe(observed!.entrySha256);
  expect(f.refreshObservation).toHaveBeenCalledTimes(2);
  expect(f.handle.pid).toBe(before);
  expect(observed).not.toHaveProperty('release');
  expect(installedReleaseCandidates(observed!, { complete: true, reasons: [], releases: [{ manifest: manifest('sample-first', observed!), sha256: 'b'.repeat(64) }] })[0]!.state).toBe('entry-matches');
});

it('reports modified bootstrap and framework separately from the retained base archive, including all ambiguous catalog matches', async () => {
  const f = await fixture();
  await writeFile(path.join(f.app, 'dist/bootstrap.js'), 'securityUpdate();\n');
  await writeFile(path.join(f.app, 'node_modules/@omnitron-dev/omnitron/dist/BUILD.json'), JSON.stringify({ commit: 'c'.repeat(40), dirty: false }));
  const [observed] = await inspectInstalledArtifacts(f.orchestrator, [f.handle.name]);
  const catalog = { complete: true, reasons: [], releases: ['sample-one', 'sample-two'].map(id => ({ manifest: manifest(id, observed!), sha256: 'b'.repeat(64) })) };
  const report = installedReleaseReport('sample', 'test', catalog, [{ node: 'test-node', observations: [observed!] }]);
  expect(report.apps[0]!.candidates).toHaveLength(2);
  expect(report.apps[0]!.candidates.every(candidate => candidate.state === 'modified')).toBe(true);
  expect(report.apps[0]!.candidates[0]!.reasons).toEqual(expect.arrayContaining([expect.stringContaining('entry point differs'), expect.stringContaining('framework reports')]));
  expect(report.limitations.join(' ')).toContain('does not prove what a running process loaded');
  const first = catalog.releases[0]!;
  first.manifest = { ...first.manifest, artifacts: [{ ...first.manifest.artifacts[0]!, bytes: 1 }] };
  expect(installedReleaseCandidates(observed!, catalog)).toHaveLength(1);
});

it('requires a full commit for verified archives and preserves legacy linked matches', async () => {
  const f = await fixture();
  const [full] = await inspectInstalledArtifacts(f.orchestrator, [f.handle.name]);
  const linked = manifest('linked', full!);
  const verified = { ...linked, id: 'registry', omni: { ...linked.omni, registry: { packages: [] } } };
  const reproduced = { ...linked, id: 'vendored', omni: { ...linked.omni, reproduced: { tree: 'c'.repeat(40), packages: [] } } };
  const catalog = { complete: true, reasons: [], releases: [linked, verified, reproduced].map(manifest => ({ manifest, sha256: 'b'.repeat(64) })) };
  const states = (frameworkCommit: string) =>
    installedReleaseCandidates({ ...full!, frameworkCommit }, catalog).map(candidate => candidate.state);
  expect(states('a'.repeat(12))).toEqual(['entry-matches', 'incomplete', 'incomplete']);
  expect(states('b'.repeat(12))).toEqual(['modified', 'modified', 'modified']);
  expect(states('a'.repeat(40))).toEqual(['entry-matches', 'entry-matches', 'entry-matches']);
});

it('discards disk evidence when owner PID or entry changes during the scan', async () => {
  const f = await fixture();
  f.refreshObservation.mockImplementation(async () => { if (f.refreshObservation.mock.calls.length === 2) f.handle.pid++; });
  const [observed] = await inspectInstalledArtifacts(f.orchestrator, [f.handle.name]);
  expect(observed).toMatchObject({ state: 'changed-during-inspection', archives: [], entrySha256: null });
});

it('does not turn an archive checksum match into provenance for an incomplete manifest', async () => {
  const f = await fixture();
  const [observed] = await inspectInstalledArtifacts(f.orchestrator, [f.handle.name]);
  const { project: _project, ...missingSource } = manifest('sample-missing-source', observed!);
  const candidates = installedReleaseCandidates(observed!, { complete: true, reasons: [],
    releases: [{ manifest: missingSource as ReleaseManifest, sha256: 'b'.repeat(64) }] });
  expect(candidates).toMatchObject([{ state: 'incomplete', reasons: [expect.stringContaining('producer could not be verified')] }]);
});

it('accepts only canonical inventory names and rejects escaping entry points and symlink archives', async () => {
  const f = await fixture();
  const [unknown] = await inspectInstalledArtifacts(f.orchestrator, [f.app]);
  expect(unknown).toMatchObject({ state: 'unavailable', archives: [] });
  f.handle.entry.bootstrap = path.join(f.root, 'outside.js');
  const [outside] = await inspectInstalledArtifacts(f.orchestrator, [f.handle.name]);
  expect(outside!.reasons).toContain('Entry point is outside its installation root');
  f.handle.entry.bootstrap = path.join(f.app, 'dist/bootstrap.js');
  await rm(path.join(f.app, 'artifact.tar.gz'));
  await symlink(path.join(f.root, 'artifact.tar.gz'), path.join(f.app, 'linked.tar.gz'));
  const [linked] = await inspectInstalledArtifacts(f.orchestrator, [f.handle.name]);
  expect(linked!.archives).toEqual([]);
  await expect(inspectInstalledArtifacts(f.orchestrator, Array(33).fill('sample/deployed/main'))).rejects.toThrow('1–32');
});

it('reads only valid project manifests and exposes an incomplete catalog explicitly', async () => {
  const f = await fixture();
  const [observed] = await inspectInstalledArtifacts(f.orchestrator, [f.handle.name]);
  const catalogRoot = path.join(f.root, 'catalog');
  const id = 'sample-202611021200-aaaaaaaa-bbbbbbbb';
  await mkdir(path.join(catalogRoot, id), { recursive: true });
  await writeFile(path.join(catalogRoot, id, 'manifest.json'), JSON.stringify(manifest(id, observed!)));
  const other = 'other-202611021200-aaaaaaaa-bbbbbbbb';
  await mkdir(path.join(catalogRoot, other));
  await writeFile(path.join(catalogRoot, other, 'manifest.json'), '{}');
  expect(await installedReleaseCatalog(catalogRoot, 'sample')).toMatchObject({ complete: true, releases: [{ manifest: { id } }] });
  await writeFile(path.join(catalogRoot, id, 'manifest.json'), '{}');
  expect(await installedReleaseCatalog(catalogRoot, 'sample')).toMatchObject({ complete: false, releases: [] });
});

it('locates a legacy artifact independently of project cwd, without treating its directory name as release evidence', async () => {
  const legacy = { cwd: '/opt/omnitron/projects/sample', bootstrap: '/opt/omnitron/artifacts/sample/main/0.0.1-patched/dist/bootstrap.js' };
  expect(installedRoot('sample/deployed/main', legacy)).toBe('/opt/omnitron/artifacts/sample/main/0.0.1-patched');
  expect(installedRoot('other/deployed/main', legacy)).toBe(legacy.cwd);
  const f = await fixture();
  f.handle.entry.releaseRoot = f.app;
  f.handle.entry.cwd = path.join(f.root, 'project');
  const [observed] = await inspectInstalledArtifacts(f.orchestrator, [f.handle.name]);
  expect(observed).toMatchObject({ state: 'observed' });
  expect(observed!.archives).toHaveLength(1);
  expect(observed).not.toHaveProperty('releaseId');
});

it('distinguishes unsupported node methods from timeouts without leaking exception details', () => {
  expect(installedNodeFailure({ code: 'METHOD_NOT_FOUND' })).toContain('does not support');
  expect(installedNodeFailure(new Error('RPC timed out'))).toContain('time limit');
  expect(installedNodeFailure(new Error('SECRET=value /private/path'))).not.toContain('SECRET');
});

it('rejects malformed node evidence and bounds a non-answering inventory read', async () => {
  await expect(boundedInstalledNodeRead(async () => [{ app: 'sample/deployed/main', state: 'observed', archives: [], reasons: [] }])).rejects.toThrow('Invalid inspection response');
  vi.useFakeTimers();
  try {
    const check = expect(installedReadDeadline(() => new Promise(() => undefined), 25)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(25);
    await check;
  } finally { vi.useRealTimers(); }
});

it('admits human viewers and cluster readers through the actual RPC authorization metadata, but rejects anonymous callers', async () => {
  const { METADATA_KEYS } = await import('@omnitron-dev/titan/decorators');
  const { validateAccessRequirements } = await import('@omnitron-dev/titan/netron/auth');
  const { ProjectRpcService } = await import('../../src/services/project.rpc-service.js');
  const { DaemonRpcService } = await import('../../src/daemon/daemon.rpc-service.js');
  for (const [prototype, roles] of [[ProjectRpcService.prototype, ['viewer', 'operator', 'admin']], [DaemonRpcService.prototype, ['viewer', 'operator', 'admin', 'service_role']]] as const) {
    const requirement = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, prototype, 'inspectInstalledArtifacts');
    for (const role of roles) expect(validateAccessRequirements({ roles: [role], permissions: [] }, requirement).allowed).toBe(true);
    expect(validateAccessRequirements({ roles: [], permissions: [] }, requirement).allowed).toBe(false);
  }
});
