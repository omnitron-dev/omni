/**
 * A census of what the probes left.
 *
 * daos has a tool for what its live probes left on a stand —
 * `scripts/probe-leftovers.mjs` (omni-fd): without a flag a census, SELECTs
 * and nothing else; `--rehearse` and `--apply` remove. On daos/test the census
 * could only be read on the dev stand: nothing ran the project's tool on a
 * node but the account tool. The owner decides the removal from the census
 * (2026-09-25), so the census is what has to reach the node first.
 *
 * Held here: `stack account --leftovers` runs the tool with NO flag on the
 * node, staged from the project's commit, reads its answer as a census and
 * nothing else — a report in a removal's mode is refused, not shown — and
 * prints the tool's own words.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  PROBE_LEFTOVERS_TOOL,
  probeLeftoversCensusCommand,
  readLeftoversRun,
  stageOperatorTool,
} from '../../src/project/operator-account.js';
import { ProjectService } from '../../src/services/project.service.js';

const REPORT = { mode: 'census', stand: 'daos-test-postgres', predicate: { templates: ['probe_'], named: [], namedOrganisations: [] } };
const WORDS = 'accounts a template names: 26\norganisations nobody who stays belongs to: 95\n  kept: probe_spare3_mugen3px4cb6 — 1 live storage row\n';
const answer = (report: unknown) => `${JSON.stringify({ probeLeftovers: report })}\n`;

function repoWith(files: readonly string[]): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'leftovers-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=c@o', '-c', 'user.name=c', ...args], { cwd: repo });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'scripts'));
  for (const f of files) fs.writeFileSync(path.join(repo, f), '// tool\n');
  git('add', '.');
  git('commit', '-q', '-m', 'tools');
  return repo;
}

describe('the command', () => {
  it('runs the tool with no flag — its census — the stand\'s containers named as they are there', () => {
    const command = probeLeftoversCensusCommand({ remoteDir: '/opt/omnitron/operator/abc', containerPrefix: 'daos-test' });
    expect(command).toMatch(/DAOS_PG_CONTAINER='daos-test-postgres'/);
    expect(command).toMatch(/DAOS_REDIS_CONTAINER='daos-test-redis'/);
    expect(command.endsWith(`node ${PROBE_LEFTOVERS_TOOL}`)).toBe(true);
    expect(command).not.toMatch(/--rehearse|--apply|--accept-losses/);
  });
});

describe('reading its answer', () => {
  it('a census: the report as the tool wrote it, and its words line by line', () => {
    expect(readLeftoversRun({ stdout: answer(REPORT), stderr: WORDS, code: 0 })).toEqual({
      ok: true,
      census: {
        report: REPORT,
        lines: [
          'accounts a template names: 26',
          'organisations nobody who stays belongs to: 95',
          '  kept: probe_spare3_mugen3px4cb6 — 1 live storage row',
        ],
      },
    });
  });

  it('a report in a removal\'s mode is refused — this door asks for the census only', () => {
    for (const mode of ['rehearse', 'apply']) {
      expect(readLeftoversRun({ stdout: answer({ ...REPORT, mode }), stderr: '', code: 0 })).toEqual({
        ok: false,
        because: `the tool answered in mode '${mode}', and this door asks for the census only`,
      });
    }
  });

  it('a failed run carries the tool\'s words; a run with no report says what stdout looked like', () => {
    expect(readLeftoversRun({ stdout: '', stderr: 'no container daos-test-postgres', code: 1 })).toEqual({
      ok: false,
      because: 'exit 1: no container daos-test-postgres',
    });
    const none = readLeftoversRun({ stdout: 'hello\n', stderr: '', code: 0 });
    expect(none.ok).toBe(false);
    expect(!none.ok && none.because).toMatch(/without a report \(stdout had 1 line/);
  });
});

describe('on the node', () => {
  it('stages the tool from the project\'s commit, runs the census and takes its stage away', async () => {
    const commands: string[] = [];
    const repo = repoWith(['scripts/operator-account.mjs', PROBE_LEFTOVERS_TOOL]);
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registry: { get: () => ({ name: 'daos', path: repo }), list: () => [] },
      loadProjectConfig: async () => ({}),
      resolveStacks: () => ({ test: { type: 'remote', apps: 'all', nodes: [{ nodeId: 'n1' }] } }),
      targetForStackNode: async () => ({ host: '37.27.130.185', sshPort: 22 }),
      deployer: {
        underLease: async (_t: unknown, _p: string, work: () => Promise<unknown>) => work(),
        uploadStaticBundle: async () => ({ remoteDir: '/opt/omnitron/operator/abc', bytes: 1 }),
        readFromNode: async (_t: unknown, command: string) => {
          commands.push(command);
          return { stdout: answer(REPORT), stderr: WORDS, code: 0 };
        },
        runOnNode: async (_t: unknown, command: string) => {
          commands.push(command);
          return { stdout: '', stderr: '', code: 0 };
        },
      },
    });
    try {
      const found = await svc.probeLeftoversCensus('daos', 'test');
      expect(found).toMatchObject({ node: '37.27.130.185:22', report: REPORT });
      expect(found.lines).toContain('organisations nobody who stays belongs to: 95');
      expect(commands[0]!.endsWith(`node ${PROBE_LEFTOVERS_TOOL}`)).toBe(true);
      expect(commands.some((c) => c.startsWith("rm -rf '/opt/omnitron/operator/abc'"))).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('refuses a commit that has no such tool, naming it — before anything reaches the node', async () => {
    const repo = repoWith(['scripts/operator-account.mjs']);
    const reached = vi.fn();
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registry: { get: () => ({ name: 'daos', path: repo }), list: () => [] },
      loadProjectConfig: async () => ({}),
      resolveStacks: () => ({ test: { type: 'remote', apps: 'all', nodes: [{ nodeId: 'n1' }] } }),
      targetForStackNode: async () => ({ host: '37.27.130.185', sshPort: 22 }),
      deployer: { underLease: reached, uploadStaticBundle: reached, readFromNode: reached, runOnNode: reached },
    });
    try {
      await expect(stageOperatorTool(repo, PROBE_LEFTOVERS_TOOL)).rejects.toThrow(/has no scripts\/probe-leftovers\.mjs/);
      await expect(svc.probeLeftoversCensus('daos', 'test')).rejects.toThrow(/has no scripts\/probe-leftovers\.mjs/);
      expect(reached).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('`stack account --leftovers` on the command line', () => {
  it('prints the tool\'s words and says nothing was removed', async () => {
    const said: string[] = [];
    vi.doMock('../../src/daemon/daemon-client.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/daemon/daemon-client.js')>()),
      createDaemonClient: () => ({
        service: async () => ({
          probeLeftoversCensus: async () => ({ node: '37.27.130.185:22', commit: '83db4a79cafe', report: REPORT, lines: ['organisations nobody who stays belongs to: 95'] }),
        }),
        disconnect: async () => undefined,
      }),
    }));
    vi.doMock('../../src/commands/output.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/commands/output.js')>();
      const say = (m: string) => void said.push(m);
      return { ...actual, emitJson: () => false, emitError: (m: string) => (said.push(m), true), emitStep: say, emitSuccess: say, emitInfo: say };
    });
    try {
      const { stackAccountCommand } = await import('../../src/commands/stack.js');
      process.exitCode = 0;
      await stackAccountCommand('daos', 'test', { leftovers: true });
      expect(process.exitCode).toBe(0);
      expect(said).toContain('organisations nobody who stays belongs to: 95');
      expect(said.at(-1)).toBe(
        'census of what the probes left on daos/test at 37.27.130.185:22 — the tool at 83db4a79; nothing was removed',
      );
    } finally {
      process.exitCode = 0;
      vi.doUnmock('../../src/daemon/daemon-client.js');
      vi.doUnmock('../../src/commands/output.js');
      vi.resetModules();
    }
  });

  it('takes nothing else', async () => {
    const { accountOptionsRefusal } = await import('../../src/commands/stack.js');
    expect(accountOptionsRefusal({ leftovers: true })).toBeNull();
    expect(accountOptionsRefusal({ leftovers: true, census: true })).toMatch(/exactly one of/);
    expect(accountOptionsRefusal({ leftovers: true, id: 'x' })).toMatch(/--leftovers takes nothing else/);
  });
});
