import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { releaseWorkspaceDirectory } from '../../src/release/workspace-source.js';

it('resolves the registered configuration against the nearest lock in the named commit', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-workspace-ref-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    fs.mkdirSync(path.join(repo, 'portal/configs/dev'), { recursive: true });
    for (const dir of ['', 'portal']) fs.writeFileSync(path.join(repo,dir,'pnpm-lock.yaml'), 'lock');
    fs.writeFileSync(path.join(repo,'portal/configs/dev/omnitron.config.mjs'),'export default {apps:[]}');
    git('add', '.');
    const commit = () => { git('-c','user.name=fixture','-c','user.email=fixture@localhost','commit','-qm','snapshot'); return git('rev-parse','HEAD'); };
    const first = commit();
    fs.writeFileSync(path.join(repo,'portal/configs/dev/pnpm-lock.yaml'),'untracked');
    expect(await releaseWorkspaceDirectory(repo,first,'portal/configs/dev')).toBe('portal');
    fs.unlinkSync(path.join(repo,'portal/pnpm-lock.yaml')); git('add','-u');
    expect(await releaseWorkspaceDirectory(repo,commit(),'portal/configs/dev')).toBe('');
    fs.symlinkSync('../pnpm-lock.yaml',path.join(repo,'portal/pnpm-lock.yaml')); git('add','portal/pnpm-lock.yaml');
    await expect(releaseWorkspaceDirectory(repo,commit(),'portal/configs/dev')).rejects.toThrow('regular committed');
    await expect(releaseWorkspaceDirectory(repo,first,'../elsewhere')).rejects.toThrow('Invalid');
  } finally { fs.rmSync(repo,{ recursive:true, force:true }); }
});
