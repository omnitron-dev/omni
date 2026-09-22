/**
 * Probes that found no code on the node.
 *
 * A third of daos's live probes compare what the rows hold with what the
 * code declares — the enum a column is typed with, the DTO a route returns.
 * On the node they ran next to compiled artifacts and nothing else: the
 * first on-node attestation (daos-202609221835-65e6cb33, 26 probes) had 3
 * fail on ENOENT for `apps/main/src/shared/dto/content.ts` and 3 more say
 * NOT RUN, «no application source was read». Six verdicts that were about
 * the transport, not the release.
 *
 * So the stage carries the application's sources — each app's and package's
 * `src/`, at the release's COMMIT, never the master's working tree — and not
 * the rest of the tree.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { stageAttestation } from '../../src/release/attest-on-node.js';

const made: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=court@example.invalid', '-c', 'user.name=court', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

/** A project at one commit: the given files, committed; returns the commit. */
function project(files: Record<string, string>): { root: string; commit: string } {
  const root = tmp('attest-project-');
  git(root, 'init', '-q');
  for (const [rel, content] of Object.entries({
    'scripts/attest.mjs': 'console.log("{}")\n',
    'omnitron.stacks.json': '{"test":{"type":"remote"}}\n',
    ...files,
  })) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'release');
  return { root, commit: git(root, 'rev-parse', 'HEAD').trim() };
}

async function stage(p: { root: string; commit: string }) {
  // A release root without `scripts/`: the history path, the same commit.
  const staged = await stageAttestation({ releaseRoot: tmp('attest-release-'), projectPath: p.root, projectCommit: p.commit });
  made.push(staged.dir);
  return staged;
}

afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('probes that found no code on the node', () => {
  it('stages each app\'s and package\'s src/ where scripts/.. finds it', async () => {
    const p = project({
      'apps/main/src/shared/dto/content.ts': 'export const CONTENT = 1;\n',
      'packages/kms/src/index.ts': 'export {};\n',
    });
    const staged = await stage(p);

    expect(fs.readFileSync(path.join(staged.dir, 'apps/main/src/shared/dto/content.ts'), 'utf8')).toBe('export const CONTENT = 1;\n');
    expect(fs.existsSync(path.join(staged.dir, 'packages/kms/src/index.ts'))).toBe(true);
    expect(staged.sourceFiles).toBe(2);
  });

  it('takes them from the release\'s commit, not the working tree that has moved since', async () => {
    const p = project({ 'apps/main/src/shared/enums.ts': "export const STATES = ['open'];\n" });
    fs.writeFileSync(path.join(p.root, 'apps/main/src/shared/enums.ts'), "export const STATES = ['open', 'moved-on'];\n");
    const staged = await stage(p);

    expect(fs.readFileSync(path.join(staged.dir, 'apps/main/src/shared/enums.ts'), 'utf8')).toBe("export const STATES = ['open'];\n");
  });

  it('carries only src/ — not the images and packaging around it', async () => {
    const p = project({
      'apps/main/src/main.ts': 'export {};\n',
      'apps/portal/public/assets/banner.webp': 'RIFF....WEBP',
      'apps/main/package.json': '{}\n',
      'docs/content/terms.md': '# terms\n',
    });
    const staged = await stage(p);

    expect(fs.existsSync(path.join(staged.dir, 'apps/portal/public'))).toBe(false);
    expect(fs.existsSync(path.join(staged.dir, 'apps/main/package.json'))).toBe(false);
    expect(fs.existsSync(path.join(staged.dir, 'docs'))).toBe(false);
    expect(staged.sourceFiles).toBe(1);
  });

  it('stages the apps of a project that has no packages — one absent directory does not cost the other', async () => {
    // `git archive` refuses the whole archive when any pathspec matches nothing.
    const staged = await stage(project({ 'apps/main/src/main.ts': 'export {};\n' }));

    expect(fs.existsSync(path.join(staged.dir, 'apps/main/src/main.ts'))).toBe(true);
  });

  it('stages none for a project with no sources, and says so by the count', async () => {
    const staged = await stage(project({}));

    expect(staged.sourceFiles).toBe(0);
    expect(fs.existsSync(path.join(staged.dir, 'scripts/attest.mjs'))).toBe(true);
  });
});
