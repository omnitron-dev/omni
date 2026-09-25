/**
 * A directory shipped past admission.
 *
 * A release deployment reads the stack's definition from the project's
 * working tree, so admission requires those files to be the release's commit
 * (`release/definition-inputs.ts`). The directories the deployment ships to
 * its nodes are read from the same working tree — the gateway's nginx
 * template, entrypoint and Lua modules, and now Nominatim's import scripts —
 * and admission compared none of them. An uncommitted edit to the gateway's
 * template reached the test node past every gate a release has (found
 * 2026-09-25, while making Nominatim's scripts ship).
 *
 * Held here, on a real git repository: what admission compares includes each
 * shipped directory whole — a stack preset's, a stack service's own, an app
 * requirement's — an edit or a new file under one is refused by name, and a
 * machine-local file there that git ignores is not the commit's business.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { treeEqualsCommit } from '../../src/release/load.js';
import { ProjectService } from '../../src/services/project.service.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function project(): { root: string; commit: string; write: (rel: string, body: string) => void } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shipped-admission-')));
  made.push(root);
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  write('omnitron.config.ts', 'export default {};\n');
  write('omnitron.stacks.json', '{"test":{"type":"remote"}}\n');
  write('apps/a/src/bootstrap.ts', 'export default {};\n');
  write('infra/nginx/nginx.conf.template', 'events {}\n');
  write('infra/nominatim/cis-entrypoint.sh', '#!/bin/sh\nexec /app/start.sh\n');
  write('infra/tiles/style.json', '{}\n');
  write('.gitignore', 'infra/nominatim/coverage.override.json\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=c@o', '-c', 'user.name=c', ...args], { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'release');
  return { root, commit: git('rev-parse', 'HEAD'), write };
}

/** What admission compares, asked the way admission asks it. */
async function reads(root: string): Promise<string[]> {
  const svc: any = Object.create(ProjectService.prototype);
  // The services the apps require, as the deployment collects them.
  svc.collectDeclaredServices = async () => ({ tiles: { ports: { http: 80 }, env: {}, configDir: 'infra/tiles' } });
  const config = {
    apps: [{ name: 'a', bootstrap: 'apps/a/src/bootstrap.ts' }],
    infrastructure: {
      services: {
        gateway: { preset: 'openresty', config: { configDir: './infra/nginx' } },
        nominatim: { ports: { http: 8080 }, env: {}, configDir: './infra/nominatim' },
      },
    },
  };
  return svc.deploymentReads('daos', { type: 'remote' }, config, root);
}

describe('what admission compares with the release commit', () => {
  it('includes each directory the deployment ships, whoever declares it', async () => {
    const { root } = project();
    expect(await reads(root)).toEqual([
      'apps/a/src/bootstrap.ts',
      'infra/nginx',
      'infra/nominatim',
      'infra/tiles',
      'omnitron.config.ts',
      'omnitron.stacks.json',
    ]);
  });

  it('refuses an edit to a shipped file and a new one beside it, by name', async () => {
    const { root, commit, write } = project();
    write('infra/nginx/nginx.conf.template', 'events {}\nhttp { server { listen 8080; } }\n');
    write('infra/nominatim/after-import.sh', '#!/bin/sh\n');
    expect(await treeEqualsCommit(root, commit, await reads(root))).toEqual({
      equal: false,
      files: ['infra/nginx/nginx.conf.template', 'infra/nominatim/after-import.sh (untracked)'],
    });
  });

  it('leaves a machine-local file git ignores to the machine', async () => {
    const { root, commit, write } = project();
    write('infra/nominatim/coverage.override.json', '{"regions":["russia"]}\n');
    expect(await treeEqualsCommit(root, commit, await reads(root))).toEqual({ equal: true });
  });
});
