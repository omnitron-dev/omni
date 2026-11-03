/**
 * A checkout frozen for files no deployment reads.
 *
 * Admission refused a release unless the project's whole working tree equalled
 * the release's commit, because the stack definition is read from it. On
 * 2026-09-24 every deployment of sample/test froze a checkout three sessions
 * share, and an edit to a file no deployment reads sent a release back to its
 * build. Only what the definition reads has to be the release's: the config
 * and its relative imports, each app's bootstrap and ITS relative imports,
 * `omnitron.stacks.json` and each app's `config/*.json`.
 *
 * Measured here on a real git repository.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { definitionInputs, UnverifiableDefinitionInputError } from '../../src/release/definition-inputs.js';
import { treeEqualsCommit } from '../../src/release/load.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A project with a config, one app, and a file its bootstrap does not reach. */
function project(): { root: string; commit: string; write: (rel: string, body: string) => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'definition-inputs-'));
  made.push(root);
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  write('omnitron.config.ts', "import { apps } from './lib/apps.ts';\nexport default { apps };\n");
  write('lib/apps.ts', "export const apps = [{ name: 'a', bootstrap: 'apps/a/src/bootstrap.ts' }];\n");
  write('omnitron.stacks.json', '{"test":{"type":"remote"}}\n');
  write('apps/a/src/bootstrap.ts', "import { name } from './shared/name.ts';\nimport 'some-package';\nexport default { name };\n");
  write('apps/a/src/shared/name.ts', "export const name = 'a';\n");
  write('apps/a/src/elsewhere.ts', "export const unrelated = 1;\n");
  write('apps/a/config/default.json', '{"omnitron":{}}\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=c@o', '-c', 'user.name=c', ...args], { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'release');
  return { root, commit: git('rev-parse', 'HEAD'), write };
}

function commitAll(root: string): string {
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=c@o', '-c', 'user.name=c', ...args], { cwd: root, encoding: 'utf8' }).trim();
  git('add', '.');
  git('commit', '-q', '-m', 'configuration inputs');
  return git('rev-parse', 'HEAD');
}

describe('the files a definition reads', () => {
  it('are the config, the bootstraps, what each imports relatively, and the JSON read by path', async () => {
    const { root } = project();
    expect(await definitionInputs(root, ['apps/a/src/bootstrap.ts'])).toEqual([
      'apps/a/config/default.json',
      'apps/a/src/bootstrap.ts',
      'apps/a/src/shared/name.ts',
      'lib/apps.ts',
      'omnitron.config.ts',
      'omnitron.stacks.json',
    ]);
  });
});

describe('admission, against the release commit', () => {
  it('includes parent imports and shipped sibling files from a nested configuration', async () => {
    const { root, write } = project();
    write('configurations/test/omnitron.config.ts', "import { pin } from '../../selected.ts'; export default { pin };\n");
    write('selected.ts', "export const pin = 'release-a';\n");
    write('gateway/config.txt', 'release-a\n');
    const commit = commitAll(root);
    const configRoot = path.join(root, 'configurations/test');
    const inputs = await definitionInputs(configRoot, [], ['../../gateway']);
    expect(inputs).toContain('../../selected.ts');
    expect(inputs).toContain('../../gateway');
    expect(await treeEqualsCommit(configRoot, commit, inputs)).toEqual({ equal: true });
    write('selected.ts', "export const pin = 'release-b';\n");
    write('gateway/config.txt', 'release-b\n');
    expect(await treeEqualsCommit(configRoot, commit, inputs)).toEqual({ equal: false, files: ['gateway/config.txt', 'selected.ts'] });
  });

  it('does not silently omit source imported from another repository', async () => {
    const { root, write } = project();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-definition-'));
    made.push(outside);
    fs.writeFileSync(path.join(outside, 'pin.ts'), "export const pin = 'outside';\n");
    write('omnitron.config.ts', `import { pin } from ${JSON.stringify(path.join(outside, 'pin.ts'))}; export default { pin };\n`);
    await expect(definitionInputs(root, [])).rejects.toBeInstanceOf(UnverifiableDefinitionInputError);
  });

  it('refuses an imported ignored module whose bytes have no commit identity', async () => {
    const { root, write } = project();
    write('.gitignore', 'private-pin.ts\n');
    write('private-pin.ts', "export const pin = 'machine-only';\n");
    write('omnitron.config.ts', "import { pin } from './private-pin.ts'; export default { pin };\n");
    await expect(definitionInputs(root, [])).rejects.toBeInstanceOf(UnverifiableDefinitionInputError);
  });

  it('refuses a symlink that escapes the source repository', async () => {
    const { root, write } = project();
    const foreign = project();
    fs.symlinkSync(path.join(foreign.root, 'lib/apps.ts'), path.join(root, 'selected.ts'));
    write('omnitron.config.ts', "import { apps } from './selected.ts'; export default { apps };\n");
    await expect(definitionInputs(root, [])).rejects.toBeInstanceOf(UnverifiableDefinitionInputError);
  });

  it('does not claim that a parent Git commit verifies mutable submodule source', async () => {
    const { root, write } = project();
    const foreign = project();
    const checkout = path.join(root, 'vendor/dependency');
    fs.mkdirSync(path.dirname(checkout));
    execFileSync('git', ['clone', '--quiet', '--local', foreign.root, checkout]);
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `160000,${foreign.commit},vendor/dependency`], { cwd: root });
    write('omnitron.config.ts', "import { apps } from './vendor/dependency/lib/apps.ts'; export default { apps };\n");
    await expect(definitionInputs(root, [])).rejects.toBeInstanceOf(UnverifiableDefinitionInputError);
  });

  it('binds a tracked symlink even when its new target is unchanged', async () => {
    const { root, write } = project();
    write('a.ts', "export const pin = 'a';\n");
    write('b.ts', "export const pin = 'b';\n");
    fs.symlinkSync('a.ts', path.join(root, 'selected.ts'));
    write('omnitron.config.ts', "import { pin } from './selected.ts'; export default { pin };\n");
    const commit = commitAll(root);
    fs.unlinkSync(path.join(root, 'selected.ts'));
    fs.symlinkSync('b.ts', path.join(root, 'selected.ts'));
    const inputs = await definitionInputs(root, []);
    expect(inputs).toContain('selected.ts');
    expect(await treeEqualsCommit(root, commit, inputs)).toEqual({ equal: false, files: ['selected.ts'] });
  });

  it.each(['./selected.ts', './selected'])('refuses an ignored import link resolved by esbuild: %s', async (specifier) => {
    const { root, write } = project();
    write('.gitignore', 'selected.ts\n');
    write('a.ts', "export const pin = 'a';\n");
    write('b.ts', "export const pin = 'b';\n");
    write('omnitron.config.ts', `import { pin } from ${JSON.stringify(specifier)}; export default { pin };\n`);
    commitAll(root);
    for (const target of ['a.ts', 'b.ts']) {
      fs.rmSync(path.join(root, 'selected.ts'), { force: true });
      fs.symlinkSync(target, path.join(root, 'selected.ts'));
      await expect(definitionInputs(root, [])).rejects.toBeInstanceOf(UnverifiableDefinitionInputError);
    }
  });

  it('checks intermediate links, not just the tracked first link and final physical target', async () => {
    const { root, write } = project();
    write('.gitignore', 'middle.ts\n');
    write('a.ts', "export const pin = 'a';\n");
    fs.symlinkSync('middle.ts', path.join(root, 'selected.ts'));
    write('omnitron.config.ts', "import { pin } from './selected.ts'; export default { pin };\n");
    commitAll(root);
    fs.symlinkSync('a.ts', path.join(root, 'middle.ts'));
    await expect(definitionInputs(root, [])).rejects.toBeInstanceOf(UnverifiableDefinitionInputError);
  });

  it('binds file URL imports and stack registry symlinks to their tracked sources', async () => {
    const { root, write } = project();
    fs.symlinkSync('lib/apps.ts', path.join(root, 'selected.ts'));
    write('omnitron.config.ts', `import { apps } from ${JSON.stringify(pathToFileURL(path.join(root, 'selected.ts')).href)}; export default { apps };\n`);
    fs.renameSync(path.join(root, 'omnitron.stacks.json'), path.join(root, 'stacks.json'));
    fs.symlinkSync('stacks.json', path.join(root, 'omnitron.stacks.json'));
    const commit = commitAll(root);
    const inputs = await definitionInputs(root, []);
    expect(inputs).toEqual(expect.arrayContaining(['selected.ts', 'lib/apps.ts', 'stacks.json', 'omnitron.stacks.json']));
    write('stacks.json', '{}\n');
    expect(await treeEqualsCommit(root, commit, inputs)).toEqual({ equal: false, files: ['stacks.json'] });
  });

  it('binds a directory link without freezing unrelated files under its target', async () => {
    const { root, write } = project();
    fs.symlinkSync('lib', path.join(root, 'selected'));
    write('omnitron.config.ts', "import { apps } from './selected/apps'; export default { apps };\n");
    write('lib/unrelated.ts', 'export const unrelated = 1;\n');
    const commit = commitAll(root);
    write('lib/unrelated.ts', 'export const unrelated = 2;\n');
    const inputs = await definitionInputs(root, []);
    expect(inputs).toContain('selected');
    expect(inputs).toContain('lib/apps.ts');
    expect(inputs).not.toContain('lib');
    expect(await treeEqualsCommit(root, commit, inputs)).toEqual({ equal: true });
  });

  it('includes a shipped symlink target outside that directory and refuses repository escapes', async () => {
    const { root, write } = project();
    write('shared.txt', 'first\n');
    fs.mkdirSync(path.join(root, 'gateway'));
    fs.symlinkSync('../shared.txt', path.join(root, 'gateway/settings.txt'));
    const commit = commitAll(root);
    const inputs = await definitionInputs(root, [], ['gateway']);
    expect(inputs).toContain('shared.txt');
    write('shared.txt', 'second\n');
    expect(await treeEqualsCommit(root, commit, inputs)).toEqual({ equal: false, files: ['shared.txt'] });
    const foreign = project();
    fs.unlinkSync(path.join(root, 'gateway/settings.txt'));
    fs.symlinkSync(path.join(foreign.root, 'lib/apps.ts'), path.join(root, 'gateway/settings.txt'));
    await expect(definitionInputs(root, [], ['gateway'])).rejects.toBeInstanceOf(UnverifiableDefinitionInputError);
  });

  it('refuses ignored symlink targets in shipped data without freezing regular runtime-only files', async () => {
    const { root, write } = project();
    write('.gitignore', 'machine-only.txt\ngateway/secrets.json\n');
    write('machine-only.txt', 'unverified\n');
    write('gateway/committed.txt', 'verified\n');
    write('gateway/secrets.json', '{}\n');
    const commit = commitAll(root);
    expect(await treeEqualsCommit(root, commit, await definitionInputs(root, [], ['gateway']))).toEqual({ equal: true });
    fs.symlinkSync('../machine-only.txt', path.join(root, 'gateway/settings.txt'));
    commitAll(root);
    await expect(definitionInputs(root, [], ['gateway'])).rejects.toBeInstanceOf(UnverifiableDefinitionInputError);
  });

  it('treats file names as literal pathspecs and retains newlines and double-dot prefixes', async () => {
    const { root, write } = project();
    write('..pin.ts', "export const pin = 'a';\n");
    write('omnitron.config.ts', "import { pin } from './..pin.ts'; export default { pin };\n");
    write(':(glob)literal\nname.txt', 'a\n');
    const commit = commitAll(root);
    expect(await definitionInputs(root, [])).toContain('..pin.ts');
    write(':(glob)literal\nname.txt', 'b\n');
    expect(await treeEqualsCommit(root, commit, [':(glob)literal\nname.txt'])).toEqual({ equal: false, files: [':(glob)literal\nname.txt'] });
  });

  it('checks untracked files outside a nested configuration when falling back to the repository', async () => {
    const { root, commit, write } = project();
    fs.mkdirSync(path.join(root, 'nested'));
    write('new-parent.ts', "export const pin = 'uncommitted';\n");
    expect(await treeEqualsCommit(path.join(root, 'nested'), commit)).toEqual({ equal: false, files: ['new-parent.ts (untracked)'] });
    await expect(treeEqualsCommit(root, commit, ['../outside.ts'])).rejects.toThrow('outside the source repository');
  });

  it('ignores work in progress in files no deployment reads', async () => {
    const { root, commit, write } = project();
    write('apps/a/src/elsewhere.ts', 'export const unrelated = 2; // somebody is working here\n');
    write('apps/a/src/brand-new.ts', 'export const x = 1;\n');
    const inputs = await definitionInputs(root, ['apps/a/src/bootstrap.ts']);
    expect(await treeEqualsCommit(root, commit, inputs)).toEqual({ equal: true });
    // The whole tree, as admission compared it before, would have refused.
    expect((await treeEqualsCommit(root, commit)).equal).toBe(false);
  });

  it('refuses an edit to a file the definition reads, and names it', async () => {
    const { root, commit, write } = project();
    write('apps/a/src/shared/name.ts', "export const name = 'b';\n");
    write('omnitron.stacks.json', '{"test":{"type":"local"}}\n');
    const inputs = await definitionInputs(root, ['apps/a/src/bootstrap.ts']);
    expect(await treeEqualsCommit(root, commit, inputs)).toEqual({
      equal: false,
      files: ['apps/a/src/shared/name.ts', 'omnitron.stacks.json'],
    });
  });

  it('sees a new import — the file that gained it is in the graph already', async () => {
    const { root, commit, write } = project();
    write('apps/a/src/bootstrap.ts', "import { name } from './shared/name.ts';\nimport { unrelated } from './elsewhere.ts';\nexport default { name, unrelated };\n");
    const inputs = await definitionInputs(root, ['apps/a/src/bootstrap.ts']);
    expect(inputs).toContain('apps/a/src/elsewhere.ts');
    const tree = await treeEqualsCommit(root, commit, inputs);
    expect(tree.equal).toBe(false);
    expect(tree.equal === false && tree.files).toContain('apps/a/src/bootstrap.ts');
  });
});
