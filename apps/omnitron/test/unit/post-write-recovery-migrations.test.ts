import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ReleaseManifest } from '../../src/release/manifest.js';
import { releaseMigrationSources } from '../../src/release/migrations.js';
import { verifyDeploymentMigrations, verifyPostWriteRecoveryMigrations } from '../../src/project/remote-release-deployment.js';

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-recovery-source-')));
afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));
const name = '@omnitron-dev/omnitron';
const apply = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=Test',
  '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgSign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function release(version: string, additions: string[], edit?: (files: Record<string, string>) => void) {
  const root = fs.mkdtempSync(path.join(temp, 'release-'));
  const file = 'vendor/core-' + version + '.tgz', locator = 'file:' + file, bytes = 'archive ' + version;
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  const commit = (version === '1.0.0' ? '1' : '2').repeat(40);
  const files: Record<string, string> = {
    [file]: bytes,
    'vendor/framework-manifest.json': JSON.stringify([{ name, filename: path.basename(file), version, integrity,
      sha256: createHash('sha256').update(bytes).digest('hex'), sourceRevision: commit, sourceDirty: false, dependencies: {} }]),
    'package.json': '{}',
    'apps/main/package.json': JSON.stringify({ name: 'app', dependencies: { [name]: 'file:../../' + file } }),
    'apps/main/migrations/218.sql': 'SELECT 218',
    'apps/main/migration.ts': 'export const apply = () => {}',
    'apps/main/main.ts': 'export const award = 2',
    'pnpm-workspace.yaml': JSON.stringify({ overrides: { [name]: locator } }),
    'pnpm-lock.yaml': JSON.stringify({ lockfileVersion: '9.0',
      overrides: { [name]: locator }, importers: { 'apps/main': { dependencies: { [name]: { specifier: 'file:../../' + file, version: locator } } } },
      packages: { [name + '@' + locator]: { version, resolution: { integrity, tarball: locator } }, 'other@1': { version: '1' } },
      snapshots: { [name + '@' + locator]: {}, 'other@1': {} } }),
  };
  for (const add of additions) files['apps/main/migrations/' + add + '.sql'] = 'SELECT ' + add;
  edit?.(files);
  for (const [p, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), contents);
  }
  apply(root, 'init', '-q'); apply(root, 'add', '.'); apply(root, 'commit', '-qm', 'release');
  const head = apply(root, 'rev-parse', 'HEAD');
  const inventory = await releaseMigrationSources(root, head, ['apps/main'], [{ directory: 'apps/main', mode: 'script',
    source: 'migration.ts', release: 'dist/migration.js', releaseSha256: 'f'.repeat(64) }]);
  const manifest: ReleaseManifest = {
    id: 'release-' + head, project: { repo: 'project', commit: head }, omni: { repo: 'sdk', commit, reproduced: {
      tree: commit, packages: [{ name, version, file, integrity }] } },
    artifacts: [{ app: 'main', version: '1.0.0', bytes: 10, sha256: '1'.repeat(64), packageSource: inventory.packages.get('apps/main')! }],
    migrations: inventory.migrations, builtWith: { omnitron: '1.0.0', packages: [] }, builtBy: 'builder', builtAt: new Date(0).toISOString(), gates: [],
  };
  return { root, manifest };
}

const additions = ['219', '220'];
const [incumbent, candidate, recovery] = await Promise.all([release('1.0.0', []), release('2.0.0', additions), release('1.0.0', additions)]);
const verify = (back: typeof recovery, apps = ['main']) => verifyPostWriteRecoveryMigrations(incumbent, candidate, back, apps);
describe('separately qualified post-write recovery migration sources', () => {
  it('admits identical handlers with two exact SDK closures and preserves ordinary return refusal', async () => {
    await expect(verify(recovery)).resolves.toEqual(['apps/main/migrations/219.sql', 'apps/main/migrations/220.sql']);
    await expect(verifyDeploymentMigrations(incumbent, candidate, ['main'])).rejects.toThrow('cannot preserve');
  });
  it('rejects missing, edited and replaced historical migrations in either return direction', async () => {
    await expect(verify(await release('1.0.0', ['219']))).rejects.toThrow('migration history');
    await expect(verify(await release('1.0.0', additions, files => { files['apps/main/migrations/218.sql'] = 'SELECT 1'; }))).rejects.toThrow('Applied migration');
    await expect(verify(await release('1.0.0', additions, files => { files['apps/main/migrations/219.sql'] = 'SELECT 1'; }))).rejects.toThrow('migration history');
  });
  it('refuses unaccounted artifacts, imports, changed project, or dishonest package attribution', async () => {
    for (const manifest of [
      { ...recovery.manifest, artifacts: [...recovery.manifest.artifacts, { ...recovery.manifest.artifacts[0]!, app: 'other' }] },
      { ...recovery.manifest, artifacts: recovery.manifest.artifacts.map(app => ({ ...app, origin: { release: 'foreign', manifestSha256: '1'.repeat(64), app: app.app } })) },
      { ...recovery.manifest, project: { ...recovery.manifest.project, repo: 'other' } },
      { ...recovery.manifest, artifacts: recovery.manifest.artifacts.map(app => ({ ...app, packageSource: { ...app.packageSource!, migrations: {} } })) },
    ]) await expect(verify({ ...recovery, manifest })).rejects.toThrow('provenance');
    await expect(verify(await release('1.0.0', additions, files => { files['modules/jobs/migrations/hidden.sql'] = 'SELECT 1'; })))
      .rejects.toThrow('Git migration inventory differs');
  });
  it.each(['backend code', 'documentation', 'package scripts', 'third-party lock', 'workspace policy', 'SDK archive', 'SDK index'])(
    'refuses changed %s', async field => {
      const bad = await release('1.0.0', additions, files => {
        if (field === 'backend code') files['apps/main/main.ts'] += '; award()';
        if (field === 'documentation') files['docs/program.md'] = 'embedded input';
        if (field === 'package scripts') files['package.json'] = '{"scripts":{"postinstall":"something"}}';
        if (field === 'third-party lock') files['pnpm-lock.yaml'] = files['pnpm-lock.yaml']!.replace('"other@1"', '"other@2"');
        if (field === 'workspace policy') files['pnpm-workspace.yaml'] = files['pnpm-workspace.yaml']!.replace('{', '{"newSetting":true,');
        if (field === 'SDK archive') files['vendor/core-1.0.0.tgz'] += '!';
        if (field === 'SDK index') files['vendor/framework-manifest.json'] = files['vendor/framework-manifest.json']!.replace('"sourceDirty":false', '"sourceDirty":true');
      });
      await expect(verify(bad)).rejects.toThrow('provenance');
    });
});
