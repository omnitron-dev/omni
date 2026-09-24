/**
 * A migration that ran and changed.
 *
 * Once a migration has run on a stack, its file is history. The migrator on
 * the node refuses one whose checksum moved — at the migration step of a
 * deployment, after the build, the gates and the transfer. On 2026-09-24 a
 * function a new migration recreated came within a commit of changing what an
 * applied one had installed; nothing earlier would have said so.
 *
 * A release now records the sha256 of every migration it carries, and
 * admission compares them with the release running on the stack.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { ReleaseManifest } from '../../src/release/manifest.js';
import { changedReleasedMigrations, migrationDigests } from '../../src/release/migrations.js';
import { ProjectService } from '../../src/services/project.service.js';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migration-ran-')));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function repo(): { dir: string; commit: string; git: (...a: string[]) => string } {
  const dir = fs.mkdtempSync(path.join(scratch, 'project-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'omnitron.config.ts'), 'export default {};\n');
  git('add', '.');
  git('commit', '-qm', 'one');
  return { dir, commit: git('rev-parse', 'HEAD'), git };
}

describe('what a release records of its migrations', () => {
  it('is the sha256 of every TRACKED file in an app\'s migrations directory — nothing else', async () => {
    const { dir, git } = repo();
    const write = (rel: string, body: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), body);
    };
    write('apps/main/src/database/migrations/001_first.migration.ts', 'export const up = 1;\n');
    write('apps/storage/src/database/migrations/001_s.migration.ts', 'export const up = 2;\n');
    write('apps/main/src/service.ts', 'export const notAMigration = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'two');
    write('apps/main/src/database/migrations/002_untracked.migration.ts', 'export const up = 3;\n');

    expect(await migrationDigests(dir)).toEqual({
      'apps/main/src/database/migrations/001_first.migration.ts': sha('export const up = 1;\n'),
      'apps/storage/src/database/migrations/001_s.migration.ts': sha('export const up = 2;\n'),
    });
  });

  it('names what ran and changed or went away — never what is new', () => {
    const ran = { a: '1', b: '2' };
    expect(changedReleasedMigrations(ran, { a: '1', b: '2', c: '3' })).toEqual([]);
    expect(changedReleasedMigrations(ran, { a: '1', b: 'X', c: '3' })).toEqual(['b']);
    expect(changedReleasedMigrations(ran, { a: '1' })).toEqual(['b']);
  });
});

describe('admission, against the release running on the stack', () => {
  function stand(ran: Record<string, string> | undefined, candidate: Record<string, string> | undefined) {
    const { dir, commit } = repo();
    const store = path.join(scratch, `store-${crypto.randomBytes(4).toString('hex')}`);
    const put = (id: string, migrations: Record<string, string> | undefined) => {
      fs.mkdirSync(path.join(store, id, 'artifacts'), { recursive: true });
      const body = `main-${id}`;
      fs.writeFileSync(path.join(store, id, 'artifacts', 'main-0.0.1.tar.gz'), body);
      const m: ReleaseManifest = {
        id,
        project: { repo: 'gitlab', commit, onRemote: true },
        omni: { repo: 'github', commit: 'b'.repeat(40), onRemote: true },
        artifacts: [{ app: 'main', version: '0.0.1', sha256: sha(body), bytes: body.length }],
        gates: [{ name: 'build', status: 'passed' }],
        builtWith: { omnitron: '0.2.0', packages: [] },
        builtAt: '2026-09-24T20:00:00.000Z',
        builtBy: 'test',
        ...(migrations ? { migrations } : {}),
      };
      fs.writeFileSync(path.join(store, id, 'manifest.json'), JSON.stringify(m));
    };
    const running = `daos-${crypto.randomBytes(4).toString('hex')}`;
    const next = `daos-${crypto.randomBytes(4).toString('hex')}`;
    put(running, ran);
    put(next, candidate);

    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      audit: {
        record: vi.fn(async () => {}),
        latestPerResource: vi.fn(async () => [{ resourceId: 'daos/test', details: { release: running } }]),
      },
      registry: { get: () => ({ name: 'daos', path: dir }), list: () => [] },
      stackStates: new Map(),
      startsInFlight: new Map(),
      loadProjectConfig: vi.fn(async () => ({ apps: [{ name: 'main', script: 'x' }] })),
      resolveStacks: () => ({
        test: { type: 'remote', apps: 'all', nodes: [{ host: '203.0.113.7', port: 9700 }], release: { mode: 'required' } },
      }),
      startRemoteStack: vi.fn(async () => ({ nodes: 1, reached: 1, skipped: [] })),
      updateEnabledStacks: vi.fn(),
      toStackInfo: () => ({ name: 'test', type: 'remote', apps: [{ name: 'main', status: 'online' }] }),
      emit: vi.fn(),
      releaseStore: async () => store,
    });
    return { svc, next, running };
  }

  const M = 'apps/main/src/database/migrations/190_a_guard.migration.ts';

  it('refuses a release in which a migration that ran here changed, naming it', async () => {
    const { svc, next } = stand({ [M]: 'a'.repeat(64) }, { [M]: 'b'.repeat(64) });
    await expect(svc.startStack('daos', 'test', { source: 'operator', release: next })).rejects.toThrow(
      new RegExp(`1 migration\\(s\\) that ran here .* changed or went away \\(${M.replace(/[.]/g, '\\.')}\\)`),
    );
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });

  it('takes one that only adds migrations', async () => {
    const { svc, next } = stand({ [M]: 'a'.repeat(64) }, { [M]: 'a'.repeat(64), 'apps/main/src/database/migrations/192_new.migration.ts': 'c'.repeat(64) });
    await svc.startStack('daos', 'test', { source: 'operator', release: next });
    expect(svc.startRemoteStack).toHaveBeenCalled();
  });

  it('takes one past a running release that recorded no digests — and says it did not compare', async () => {
    const { svc, next } = stand(undefined, { [M]: 'b'.repeat(64) });
    await svc.startStack('daos', 'test', { source: 'operator', release: next });
    expect(svc.startRemoteStack).toHaveBeenCalled();
    expect(svc.logger.info).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/not compared/));
  });

  it('says so when the trail cannot say what runs — a skipped check is never silent', async () => {
    const { svc, next } = stand({ [M]: 'a'.repeat(64) }, { [M]: 'b'.repeat(64) });
    svc.audit.latestPerResource = vi.fn(async () => {
      throw new Error('audit store is closed');
    });
    await svc.startStack('daos', 'test', { source: 'operator', release: next });
    expect(svc.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'audit store is closed' }),
      expect.stringMatching(/could not be read/),
    );
    expect(svc.logger.info).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/not compared/));
  });

  it('compares with the last start that SUCCEEDED — a failed one is another action in the trail', async () => {
    const { svc, next } = stand({ [M]: 'a'.repeat(64) }, { [M]: 'b'.repeat(64) });
    await expect(svc.startStack('daos', 'test', { source: 'operator', release: next })).rejects.toThrow(/changed or went away/);
    expect(svc.audit.latestPerResource).toHaveBeenCalledWith('stack.start');
    expect(svc.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'stack.start.failed' }));
  });
});
