/**
 * A checkout frozen for files no deployment reads.
 *
 * Admission refused a release unless the project's whole working tree equalled
 * the release's commit, because the stack definition is read from it. On
 * 2026-09-24 every deployment of daos/test froze a checkout three sessions
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
import { afterEach, describe, expect, it } from 'vitest';

import { definitionInputs } from '../../src/release/definition-inputs.js';
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
