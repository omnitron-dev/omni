import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initCommand } from '../../src/commands/init.js';
import { CONFIG_FILE_NAMES } from '../../src/config/loader.js';
import { reviewExistingProject, writeExistingProject } from '../../src/project/existing-project.js';

let directory: string;
beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-existing-')));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
function write(file: string, content: string | object) {
  const target = path.join(directory, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
}

it.each([
  { section: 'devDependencies', spec: { '@xec-sh/cli': '^0.13.0' }, expected: ['Xec'] },
  { section: 'dependencies', spec: { '@kysera/executor': '^0.10.0' }, expected: ['Kysera'] },
  { section: 'optionalDependencies', spec: { 'task-tool': 'npm:@xec-sh/core@0.13.2', '@kysera/core': 'workspace:*' }, expected: ['Xec', 'Kysera'] },
])('previews $section and adds one standard config while preserving the existing project', async ({ section, spec, expected }) => {
  const originals = {
    'package.json': JSON.stringify({ name: 'sample', [section]: spec, scripts: { prepare: 'node original.js', start: 'node original.js' } }),
    'README.md': 'Existing project instructions', 'package-lock.json': '{}', 'omnitron-worker.js': 'Owned by the project',
    'original.js': "require('node:fs').writeFileSync('ran', 'yes');",
  };
  for (const [file, content] of Object.entries(originals)) write(file, content);
  expect(reviewExistingProject(directory).declarations.map(item => item.framework)).toEqual(expected);
  await initCommand({ existing: true, check: true });
  expect(fs.readdirSync(directory).sort()).toEqual(Object.keys(originals).sort());
  await initCommand({ existing: true });
  expect(fs.readdirSync(directory).sort()).toEqual([...Object.keys(originals), 'omnitron.config.ts'].sort());
  for (const [file, original] of Object.entries(originals)) expect(fs.readFileSync(path.join(directory, file), 'utf8')).toBe(original);
  expect(fs.readFileSync(path.join(directory, 'omnitron.config.ts'), 'utf8')).toBe('export default {\n  "apps": [],\n  "stacks": {}\n};\n');
});

it.each(['pnpm', 'npm', 'yarn'])('reads the declared %s members inside the selected root', manager => {
  const patterns = ['packages/*', '!packages/excluded'];
  const workspaces = manager === 'yarn' ? { packages: patterns } : manager === 'pnpm' ? ['decoy/*'] : patterns;
  write('package.json', { name: 'root', packageManager: manager + '@1.0.0', workspaces });
  if (manager === 'pnpm') write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/excluded'\n");
  write('packages/a/package.json', { devDependencies: { '@xec-sh/core': '*' } });
  write('packages/b/package.json', { peerDependencies: { '@kysera/executor': '*' } });
  for (const name of ['packages/excluded', 'decoy/c', 'packages/a/nested', 'node_modules/example'])
    write(name + '/package.json', 'outside the selected workspace');
  fs.symlinkSync(path.join(directory, 'decoy/c'), path.join(directory, 'packages/symlink'), 'dir');
  const review = reviewExistingProject(directory);
  expect(review.manifests).toEqual(['package.json', 'packages/a/package.json', 'packages/b/package.json']);
  expect(review.declarations.map(({ manifest, section, framework }) => [manifest, section, framework])).toEqual([
    ['packages/a/package.json', 'devDependencies', 'Xec'], ['packages/b/package.json', 'peerDependencies', 'Kysera'],
  ]);
  expect(reviewExistingProject(path.join(directory, 'packages/b')).declarations.map(item => item.framework)).toEqual(['Kysera']);
});

it.each(CONFIG_FILE_NAMES)('preserves occupied %s even when overwrite is requested', async name => {
  write('package.json', { dependencies: { '@kysera/core': '*' } });
  write(name, 'existing content');
  await expect(initCommand({ existing: true, check: true })).rejects.toThrow(name);
  await expect(initCommand({ existing: true })).rejects.toThrow(name);
  await expect(initCommand({ existing: true, force: true })).rejects.toThrow('overwrite');
  expect(fs.readFileSync(path.join(directory, name), 'utf8')).toBe('existing content');
  expect(fs.readdirSync(directory).sort()).toEqual([name, 'package.json'].sort());
});

it('refuses a dangling configuration link, a non-project directory and out-of-root workspace patterns', async () => {
  await expect(initCommand({ existing: true })).rejects.toThrow('Select a package');
  write('package.json', { workspaces: ['../outside/*'] });
  await expect(initCommand({ existing: true })).rejects.toThrow('inside the selected project');
  fs.symlinkSync('missing', path.join(directory, 'omnitron.config.mjs'));
  await expect(initCommand({ existing: true })).rejects.toThrow('omnitron.config.mjs');
  expect(fs.readdirSync(directory).sort()).toEqual(['omnitron.config.mjs', 'package.json']);
});

it('protects another configuration published after discovery and reports only declared dependencies', () => {
  write('package.json', { scripts: { task: 'xec data' }, dependencies: { kysely: '*' } });
  write('package-lock.json', { packages: { 'node_modules/@kysera/executor': {} } });
  const review = reviewExistingProject(directory);
  expect(review.declarations).toEqual([]);
  write('omnitron.config.js', 'another configuration');
  expect(() => writeExistingProject(review)).toThrow('omnitron.config.js');
  expect(fs.existsSync(path.join(directory, 'omnitron.config.ts'))).toBe(false);
  expect(fs.readFileSync(path.join(directory, 'omnitron.config.js'), 'utf8')).toBe('another configuration');
});
