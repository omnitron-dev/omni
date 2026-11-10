import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

it('keeps ordinary pnpm config on clean installs and accepts only physical packages of the selected SDK', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-bridge-'));
  const root = await fs.realpath(temporary);
  try {
    const project = path.join(root, 'project'), source = path.join(root, 'source');
    const pkg = path.join(source, 'packages', 'titan'), state = path.join(project, '.omnitron', 'dev-sdk');
    await fs.mkdir(pkg, { recursive: true });
    await fs.mkdir(state, { recursive: true });
    await fs.copyFile(new URL('../../bin/pnpmfile-sdk.mjs', import.meta.url), path.join(project, '.pnpmfile.mjs'));
    const probe = (overrides: Record<string, string> = { other: '1' }) => exec(process.execPath, ['--input-type=module', '-e',
      "import {hooks} from './.pnpmfile.mjs'; console.log(JSON.stringify(hooks.updateConfig({overrides:JSON.parse(process.argv[1])})));", JSON.stringify(overrides)], { cwd: project })
      .then(result => JSON.parse(result.stdout));
    expect(await probe()).toEqual({ overrides: { other: '1' } });
    const select = (links: Record<string, string>) => fs.writeFile(path.join(state, 'install.json'), JSON.stringify({
      schema: 1, root: project, source, links,
    }));
    await select({ '@omnitron-dev/titan': pkg });
    expect(await probe()).toEqual({ lockfileDir: state, overrides: { other: '1', '@omnitron-dev/titan': 'link:' + pkg } });
    const local = { '@fixture/archive@1': 'file:vendor/pkg.tgz', 'parent>folder': 'link:../local', kept: 'catalog:' };
    expect((await probe(local)).overrides).toMatchObject({
      '@fixture/archive@1': 'file:' + path.join(project, 'vendor/pkg.tgz').split(path.sep).join('/'),
      'parent>folder': 'link:' + path.resolve(project, '../local').split(path.sep).join('/'), kept: 'catalog:',
    });
    await select({ 'other': pkg });
    await expect(probe()).rejects.toThrow('Invalid Omnitron SDK package');
    await select({ '@omnitron-dev/titan': project });
    await expect(probe()).rejects.toThrow('Invalid Omnitron SDK package');
    await fs.symlink(project, path.join(source, 'outside'), 'dir');
    await select({ '@omnitron-dev/titan': path.join(source, 'outside') });
    await expect(probe()).rejects.toThrow('Invalid Omnitron SDK package');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
