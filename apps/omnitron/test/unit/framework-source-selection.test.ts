import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { assertFrameworkInput, checkoutFrameworkSource, frameworkRepositoryLocation, projectFrameworkSource } from '../../src/release/framework-source.js';

const exec = promisify(execFile), cleanup: string[] = [];
afterEach(async () => { for (const directory of cleanup.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd })).stdout.trim();
const run = async (command: string, args: string[], cwd: string) => { await exec(command, args, { cwd }); };

describe('one operator-selected framework source', () => {
  it('uses explicit selection over committed defaults and never replaces malformed configuration', () => {
    const manifest = { omnitron: { framework: { repository: 'ssh://git@self-hosted.test/framework', ref: 'refs/heads/stable' } } };
    expect(projectFrameworkSource(manifest)).toEqual(manifest.omnitron.framework);
    expect(projectFrameworkSource(manifest, { repository: '../offline-framework' })).toEqual({ repository: '../offline-framework' });
    expect(projectFrameworkSource({})).toBeUndefined();
    expect(() => projectFrameworkSource(manifest, { repository: '' })).toThrow();
    expect(() => projectFrameworkSource({ omnitron: { framework: null } })).toThrow();
  });
  it('resolves local paths against the project and normalizes package transport without changing identity', () => {
    expect(frameworkRepositoryLocation('../framework', '/srv/project')).toBe('/srv/framework');
    expect(frameworkRepositoryLocation('git+https://self-hosted.test/framework.git', '/srv/project')).toBe('https://self-hosted.test/framework.git');
  });
  it.each([null, [], 'package', { omnitron: null }, { omnitron: [] }, { omnitron: 'configuration' }])
  ('refuses malformed committed configuration rather than inventing defaults', value => {
    expect(() => projectFrameworkSource(value)).toThrow('Committed package.json');
  });
  it('clones the selected offline repository, enforces its declared ref and keeps publication separate', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'framework-selection-')); cleanup.push(root);
    const origin = path.join(root, 'origin'); await fs.mkdir(origin);
    await git(origin, 'init', '-q', '-b', 'stable');
    await fs.writeFile(path.join(origin, 'actual-source'), 'selected repository');
    await git(origin, 'add', '.');
    await git(origin, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'selected');
    const commit = await git(origin, 'rev-parse', 'HEAD');
    const source = { repository: './origin', ref: 'refs/heads/stable' };
    const clone = path.join(root, 'clone');
    expect(await checkoutFrameworkSource(clone, { source, commit, sourceBase: root, env: {}, run }))
      .toMatchObject({ repo: './origin', ref: 'refs/heads/stable', commit, onRemote: false });
    expect(await fs.readFile(path.join(clone, 'actual-source'), 'utf8')).toBe('selected repository');
    await expect(checkoutFrameworkSource(path.join(root, 'refused'), { source: { ...source, ref: 'refs/heads/missing' },
      commit, sourceBase: root, env: {}, run })).rejects.toThrow('selected framework ref');
  });
});

it('enforces the committed distribution policy before creating release artifacts', () => {
  const project = { omnitron: { release: { frameworkInput: 'registry' } } };
  expect(() => assertFrameworkInput(project, 'registry')).not.toThrow();
  for (const layout of ['linked', 'vendored']) {
    expect(() => assertFrameworkInput(project, layout)).toThrow('requires npm registry');
    expect(() => assertFrameworkInput({}, layout)).not.toThrow();
  }
  expect(() => assertFrameworkInput({ omnitron: { release: { frameworkInput: 'unknown' } } }, 'registry')).toThrow('Unsupported');
});
