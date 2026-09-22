/**
 * A deployment that shipped the disk it found.
 *
 * The remote deployment compiles and ships the WORKING TREE. Over one night
 * with three sessions in one checkout that produced, measured:
 *
 *   - an automatic resume compiled somebody's half-finished edit, `main`
 *     failed to build, and five artifacts of six went out under
 *     `Stack started` — 15:17:27 on 2026-09-21;
 *   - four such resumes that day, none of them typed by anyone: a master
 *     restart runs this path, and restarts happen for reasons nobody
 *     chooses;
 *   - and the set of paths that travel is wider than it was guessed to be,
 *     twice: not only `apps/**` but the gateway's whole configuration
 *     directory, every file in it, with its modes.
 *
 * That last point is why the check asks git instead of naming directories.
 * Enumerating the safe ones is a claim about the mechanism that has to be
 * remade whenever the mechanism grows, and it was already wrong twice.
 *
 * Local stacks are exempt deliberately: compiling the working tree is what a
 * development stand is FOR, and a rule that refused there would be switched
 * off within the hour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describeWorkingTree, refusalForDirtyTree } from '../../src/project/working-tree.js';
import { ProjectService } from '../../src/services/project.service.js';

/** A real repository, because the subject is what git says. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tree-probe-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'probe@example.invalid');
  git('config', 'user.name', 'probe');
  writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, '.gitignore'), 'scratch/\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  return dir;
}

describe('what git says about this tree', () => {
  it('answers clean, with the commit', async () => {
    const t = await describeWorkingTree(repo());
    expect(t.checked).toBe(true);
    expect(t.dirty).toEqual([]);
    expect(t.head).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('names a modified file', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'app.ts'), 'export const a = 2;\n');
    const t = await describeWorkingTree(dir);
    expect(t.dirty).toEqual(['app.ts']);
  });

  it('names an untracked one, because it would be compiled too', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'extra.ts'), 'export const b = 1;\n');
    expect((await describeWorkingTree(dir)).dirty).toEqual(['extra.ts']);
  });

  it('says nothing about an ignored one, because it would not be', async () => {
    // The distinction that keeps this usable: a scratch file nobody would
    // commit is not a file anybody ships, and a check that refused over it
    // would be switched off.
    const dir = repo();
    execFileSync('mkdir', ['-p', join(dir, 'scratch')]);
    writeFileSync(join(dir, 'scratch', 'notes.txt'), 'x');
    expect((await describeWorkingTree(dir)).dirty).toEqual([]);
  });

  it('says it could not tell, rather than that all is well', async () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
    const t = await describeWorkingTree(notARepo);
    expect(t.checked).toBe(false);
    expect(t.why).toBeTruthy();
  });
});

describe('the refusal a dirty tree earns', () => {
  it('names the files and the way to mean it', () => {
    const msg = refusalForDirtyTree(
      { checked: true, head: 'abc1234', dirty: ['apps/main/src/x.ts', 'infra/nginx/lua/y.lua'] },
      'daos/test',
    );
    expect(msg).toContain('apps/main/src/x.ts');
    expect(msg).toContain('infra/nginx/lua/y.lua');
    expect(msg).toContain('abc1234');
    expect(msg).toContain('--allow-dirty');
  });

  it('counts the rest instead of printing a hundred lines', () => {
    const many = Array.from({ length: 25 }, (_, i) => `f${i}.ts`);
    const msg = refusalForDirtyTree({ checked: true, head: 'abc1234', dirty: many }, 'daos/test', 3)!;
    expect(msg).toContain('…and 22 more');
  });

  it('is silent on a clean tree, and on one it could not read', () => {
    expect(refusalForDirtyTree({ checked: true, head: 'a', dirty: [] }, 's')).toBeNull();
    expect(refusalForDirtyTree({ checked: false, dirty: [] }, 's')).toBeNull();
  });
});

describe('a remote stack will not start from a tree that is not its commit', () => {
  function service(type: 'remote' | 'local', dir: string) {
    const started: string[] = [];
    const warned: any[] = [];
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: (o: any) => warned.push(o), error: vi.fn(), debug: vi.fn() },
      registry: { get: () => ({ name: 'daos', path: dir }), list: () => [] },
      audit: { record: vi.fn(async () => {}) },
      stackStates: new Map(),
      startsInFlight: new Map(),
      loadProjectConfig: vi.fn(async () => ({})),
      resolveStacks: () => ({ test: { type, apps: 'all' } }),
      startLocalStack: vi.fn(async () => started.push('local')),
      startRemoteStack: vi.fn(async () => started.push('remote')),
      updateEnabledStacks: vi.fn(),
      toStackInfo: () => ({ name: 'test', type, apps: [] }),
      emit: vi.fn(),
    });
    return { svc, started, warned };
  }

  beforeEach(() => vi.clearAllMocks());

  it('refuses, and nothing is built', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'app.ts'), 'edited\n');
    const { svc, started } = service('remote', dir);
    await expect(svc.startStack('daos', 'test', { source: 'boot' })).rejects.toThrow(/differ from the commit/);
    // The claim is not the throw — it is that the deployment never ran.
    expect(started).toEqual([]);
  });

  it('proceeds on a clean tree', async () => {
    const { svc, started } = service('remote', repo());
    await svc.startStack('daos', 'test', { source: 'operator' });
    expect(started).toEqual(['remote']);
  });

  it('proceeds when the operator says they mean it, and says so in the log', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'app.ts'), 'edited\n');
    const { svc, started, warned } = service('remote', dir);
    await svc.startStack('daos', 'test', { source: 'operator', allowDirty: true });
    expect(started).toEqual(['remote']);
    expect(warned.some((w) => w.dirty === 1)).toBe(true);
  });

  it('leaves a local stack alone — compiling the disk is what it is for', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'app.ts'), 'edited\n');
    const { svc, started } = service('local', dir);
    await svc.startStack('daos', 'test', { source: 'boot' });
    expect(started).toEqual(['local']);
  });

  it('deploys when it cannot ask git, and records that it could not', async () => {
    // A check that cannot run is not a check that passed. Refusing every
    // project that is not a git checkout would be a rule about git.
    const { svc, started, warned } = service('remote', mkdtempSync(join(tmpdir(), 'not-a-repo-')));
    await svc.startStack('daos', 'test', { source: 'boot' });
    expect(started).toEqual(['remote']);
    expect(warned.some((w) => typeof w.why === 'string')).toBe(true);
  });
});
