/**
 * A stand counted without reading it.
 *
 * Moving daos/test off the JWT secret it shares with the development stand
 * needed one number first: MFA secrets there are sealed under a root derived
 * from that secret, a new root cannot open them, and nothing could say how
 * many there were without a door for arbitrary SQL on the node — which is
 * not a door worth having. And «is the seeded admin still on its published
 * password» was answered by comparing hashes, which the dev seed defeats by
 * re-hashing the same password with a new salt.
 *
 * `omnitron stack account --census` runs the project's tool there, under the
 * lease, and brings back counts only: accounts by role and status, MFA by the
 * form it is stored in, and whether the seeded admin still OPENS with the
 * password its seed published.
 */

import { describe, expect, it, vi } from 'vitest';

import { operatorCensusCommand, readCensusRun } from '../../src/project/operator-account.js';
import { ProjectService } from '../../src/services/project.service.js';

const CENSUS = {
  users: 12,
  byRole: { superadmin: 2, admin: 1, user: 9 },
  byStatus: { active: 12 },
  mfa: { totpEnabled: 0, totpSecretEncrypted: 0, totpSecretPlain: 0, backupCodes: 0 },
  seededAdmin: { present: true, status: 'active', role: 'admin', publishedPassword: true },
};
const line = (census: unknown) => `${JSON.stringify({ operatorCensus: census })}\n`;

describe('the census, read', () => {
  it('takes the counts from the answer line', () => {
    expect(readCensusRun({ stdout: line(CENSUS), stderr: '12 account(s)', code: 0 })).toEqual({ ok: true, census: CENSUS });
  });

  it('keeps «cannot check» apart from «changed»', () => {
    const read = readCensusRun({ stdout: line({ ...CENSUS, seededAdmin: { ...CENSUS.seededAdmin, publishedPassword: null } }), stderr: '', code: 0 });
    expect(read).toMatchObject({ ok: true, census: { seededAdmin: { publishedPassword: null } } });
  });

  it('refuses a line with a count missing, and quotes it — it holds no value', () => {
    const { mfa: _mfa, ...partial } = CENSUS;
    const read = readCensusRun({ stdout: line(partial), stderr: '', code: 0 });
    expect(read).toMatchObject({ ok: false, because: expect.stringContaining('"users":12') });
    expect(readCensusRun({ stdout: line({ ...CENSUS, users: -1 }), stderr: '', code: 0 }).ok).toBe(false);
  });

  it('carries the tool\'s words when the stand could not be read', () => {
    expect(readCensusRun({ stdout: '', stderr: 'could not take the census: docker gone', code: 1 })).toEqual({
      ok: false,
      because: 'exit 1: could not take the census: docker gone',
    });
  });

  it('asks the tool for the census and nothing else', () => {
    expect(operatorCensusCommand({ remoteDir: '/x', containerPrefix: 'daos-test' })).toMatch(
      /DAOS_PG_CONTAINER='daos-test-postgres'.* node scripts\/operator-account\.mjs '--census'$/,
    );
  });
});

describe('the service', () => {
  it('brings the counts back from the node and takes its stage away', async () => {
    const commands: string[] = [];
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registry: { get: () => ({ name: 'daos', path: process.cwd() }), list: () => [] },
      loadProjectConfig: async () => ({}),
      resolveStacks: () => ({ test: { type: 'remote', apps: 'all', nodes: [{ nodeId: 'n1' }] } }),
      targetForStackNode: async () => ({ host: '37.27.130.185', sshPort: 22 }),
      deployer: {
        underLease: async (_t: unknown, _p: string, work: () => Promise<unknown>) => work(),
        uploadStaticBundle: async () => ({ remoteDir: '/opt/omnitron/operator/abc', bytes: 1 }),
        readFromNode: async (_t: unknown, command: string) => {
          commands.push(command);
          return { stdout: line(CENSUS), stderr: '', code: 0 };
        },
        runOnNode: async (_t: unknown, command: string) => {
          commands.push(command);
          return { stdout: '', stderr: '', code: 0 };
        },
      },
    });
    // The tool is staged from the project's HEAD: a project whose commit has one.
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'census-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=c@o', '-c', 'user.name=c', ...args], { cwd: repo });
    git('init', '-q');
    fs.mkdirSync(path.join(repo, 'scripts'));
    fs.writeFileSync(path.join(repo, 'scripts', 'operator-account.mjs'), '// tool\n');
    git('add', '.');
    git('commit', '-q', '-m', 'tool');
    svc.registry = { get: () => ({ name: 'daos', path: repo }), list: () => [] };
    try {
      const answer = await svc.censusOperatorAccounts('daos', 'test');
      expect(answer).toMatchObject({ node: '37.27.130.185:22', census: CENSUS });
      expect(commands.some((c) => c.endsWith("'--census'"))).toBe(true);
      expect(commands.some((c) => c.startsWith("rm -rf '/opt/omnitron/operator/abc'"))).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('`stack account --census` on the command line', () => {
  async function run(options: Record<string, unknown>, answer: () => Promise<unknown>) {
    const said: string[] = [];
    vi.doMock('../../src/daemon/daemon-client.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/daemon/daemon-client.js')>()),
      createDaemonClient: () => ({ service: async () => ({ censusStackAccounts: answer }), disconnect: async () => undefined }),
    }));
    vi.doMock('../../src/commands/output.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/commands/output.js')>();
      const say = (m: string) => void said.push(m);
      return { ...actual, emitJson: () => false, emitError: (m: string) => (said.push(m), true), emitStep: say, emitSuccess: say, emitInfo: say };
    });
    const { stackAccountCommand } = await import('../../src/commands/stack.js');
    try {
      process.exitCode = 0;
      await stackAccountCommand('daos', 'test', options as never);
      return { said: said.join('\n'), exitCode: process.exitCode };
    } finally {
      process.exitCode = 0;
      vi.doUnmock('../../src/daemon/daemon-client.js');
      vi.doUnmock('../../src/commands/output.js');
      vi.resetModules();
    }
  }

  it('prints the counts and says a published password plainly', async () => {
    const { said, exitCode } = await run({ census: true }, async () => ({ node: '37.27.130.185:22', commit: 'c', census: CENSUS }));
    expect(exitCode).toBe(0);
    expect(said).toContain('daos/test at 37.27.130.185:22: 12 account(s)');
    expect(said).toContain('  roles: user 9, superadmin 2, admin 1');
    expect(said).toContain('  MFA: 0 enabled · 0 secret(s) sealed · 0 plain · 0 with backup codes');
    expect(said).toContain('  seeded admin: active, admin, opens with the PUBLISHED password');
  });

  it('refuses the census beside anything else', async () => {
    const { accountOptionsRefusal } = await import('../../src/commands/stack.js');
    expect(accountOptionsRefusal({ census: true })).toBeNull();
    expect(accountOptionsRefusal({ census: true, username: 'a' })).toMatch(/exactly one of/);
    expect(accountOptionsRefusal({ census: true, vaultKey: 'k' })).toMatch(/--census takes nothing else/);
  });
});
