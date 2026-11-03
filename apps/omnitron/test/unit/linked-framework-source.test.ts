import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const directory of cleanup.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
const command = async (cwd: string, tool: string, ...args: string[]) =>
  (await exec(tool, args, { cwd, timeout: 45_000, maxBuffer: 1024 * 1024 })).stdout.trim();
async function commit(directory: string) {
  await command(directory, 'git', 'add', '.');
  await command(directory, 'git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  return command(directory, 'git', 'rev-parse', 'HEAD');
}

it('builds from declared and explicit sources when the nominal developer SDK is absent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linked-source-release-')); cleanup.push(root);
  const origin = path.join(root, 'selected-origin'), project = path.join(root, 'consumer');
  await fs.mkdir(origin); await fs.mkdir(project);
  await command(origin, 'git', 'init', '-q', '-b', 'stable');
  await fs.writeFile(path.join(origin, '.gitignore'), 'node_modules/\ndist/\n');
  await fs.writeFile(path.join(origin, 'package.json'), JSON.stringify({ name: 'framework-fixture', private: true, packageManager: 'pnpm@12.16.1' }));
  await fs.writeFile(path.join(origin, 'pnpm-workspace.yaml'), "packages: ['apps/*', 'packages/*']\n");
  for (const [name, directory] of [['omnitron', 'apps/omnitron'], ['titan', 'packages/titan']]) {
    const pkg = path.join(origin, directory!); await fs.mkdir(pkg, { recursive: true });
    await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: '@omnitron-dev/' + name, version: '0.3.2',
      type: 'module', main: 'dist/index.js', scripts: { build: 'node build.mjs' } }));
    await fs.writeFile(path.join(pkg, 'build.mjs'), "import fs from 'node:fs';import{execFileSync}from'node:child_process';fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.js','export const origin=\"selected\";');fs.writeFileSync('dist/BUILD.json',JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:false,timeBasis:'source',builtAt:'2026-01-01T00:00:00Z'}));");
  }
  await command(origin, 'pnpm', 'install', '--lockfile-only', '--ignore-scripts');
  const sha = await commit(origin);
  const nominal = path.join(root, 'missing-framework'); await fs.symlink(origin, nominal);
  await fs.mkdir(path.join(project, 'apps/worker'), { recursive: true });
  await fs.writeFile(path.join(project, '.gitignore'), 'node_modules/\ndist/\n');
  await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'consumer', private: true,
    dependencies: { '@omnitron-dev/omnitron': 'link:../missing-framework/apps/omnitron' },
    scripts: { 'test:release': 'node -e "process.exit(0)"' },
    omnitron: { framework: { repository: '../selected-origin', ref: 'refs/heads/stable' }, release: { gates: ['test:release'] } } }));
  await fs.writeFile(path.join(project, 'pnpm-workspace.yaml'), "packages: ['apps/*']\n");
  await fs.writeFile(path.join(project, 'apps/worker/package.json'), JSON.stringify({ name: 'worker', version: '1.0.0',
    dependencies: { '@omnitron-dev/titan': 'link:../../../missing-framework/packages/titan' }, scripts: { build: 'node build.mjs' } }));
  await fs.writeFile(path.join(project, 'apps/worker/build.mjs'), "import fs from 'node:fs';fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/main.js','console.log(1);');");
  await fs.writeFile(path.join(project, 'omnitron.config.mjs'), "export default {apps:[{name:'worker',cwd:'apps/worker',script:'dist/main.js'}]};");
  await command(project, 'pnpm', 'install', '--lockfile-only', '--ignore-scripts');
  await fs.unlink(nominal);
  await command(project, 'git', 'init', '-q'); await commit(project);
  vi.stubEnv('OMNITRON_HOME', path.join(root, 'instance')); vi.resetModules();
  const { ProjectRegistry } = await import('../../src/project/registry.js');
  vi.spyOn(ProjectRegistry, 'open').mockReturnValue({ get: () => ({ name: 'consumer', path: project }) } as unknown as InstanceType<typeof ProjectRegistry>);
  const { runReleaseBuild } = await import('../../src/release/build-run.js');
  const phases: string[] = [];
  const result = await runReleaseBuild('consumer', { omniCommit: sha, keepSource: true }, phase => phases.push(phase.phase));
  expect(result.manifest.omni).toMatchObject({ repo: '../selected-origin', ref: 'refs/heads/stable', commit: sha, onRemote: false });
  expect(result.manifest.artifactFailures).toBeUndefined();
  expect(result.manifest.artifacts).toEqual([expect.objectContaining({ app: 'worker', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
  expect(result.manifest.gates).toEqual([expect.objectContaining({ name: 'test:release', status: 'passed' })]);
  expect(phases).toContain(`framework source: ../selected-origin [refs/heads/stable] @ ${sha}`);
  expect(await fs.readFile(path.join(result.root, 'src/missing-framework/packages/titan/dist/index.js'), 'utf8')).toContain('selected');
  await expect(fs.stat(nominal)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(runReleaseBuild('consumer', { omniCommit: 'stable' })).rejects.toThrow('full --omni-commit');
  const selected = path.join(root, 'override-origin');
  await command(root, 'git', 'clone', '-q', origin, selected);
  const selectedBuild = path.join(selected, 'packages/titan/build.mjs');
  await fs.writeFile(selectedBuild, (await fs.readFile(selectedBuild, 'utf8')).replace('selected', 'explicit-override'));
  const selectedSha = await commit(selected);
  const override = await runReleaseBuild('consumer', { omniCommit: selectedSha, keepSource: true,
    frameworkSource: { repository: '../override-origin', ref: 'refs/heads/stable' } });
  expect(override.manifest.omni).toMatchObject({ repo: '../override-origin', ref: 'refs/heads/stable', commit: selectedSha, onRemote: false });
  expect(override.manifest.artifactFailures).toBeUndefined();
  expect(await fs.readFile(path.join(override.root, 'src/missing-framework/packages/titan/dist/index.js'), 'utf8')).toContain('explicit-override');
  expect(result.manifest.omni.commit).toBe(sha);
}, 120_000);
