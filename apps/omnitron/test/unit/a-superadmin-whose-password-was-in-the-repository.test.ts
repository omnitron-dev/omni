/**
 * A superadmin whose password was in the repository.
 *
 * Asked on 2026-09-23 for the test stand's super-administrator, the only
 * answer there was the seed: `admin` from daos's migration 009, its password
 * `ADmin123!@` in the project's history, its role `admin` — not the
 * platform's highest. Nothing in omnitron could make another. An account has
 * to be made where the stack's containers are (the captcha's answer is read
 * from its redis, the role goes in through its postgres), and the only
 * transport that runs a project's code on a node was the attestation's.
 *
 * `omnitron stack account` runs the project's own tool there, under the
 * node's deploy lease, and keeps the password the tool generated ON the node
 * in this daemon's vault — the one place it is written. These are the
 * properties that make it safe to hand a stand's highest role to.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  accountVaultKey,
  operatorAccountCommand,
  operatorAccountUndoCommand,
  readAccountRun,
} from '../../src/project/operator-account.js';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';

const PASSWORD = 'k3Y-generated-on-the-node-xyzQW42!';
const ID = '01a0cf59-a85d-7544-9acd-564e494ef530';
const made = (username = 'superadmin', role = 'superadmin') => ({
  stdout: `${JSON.stringify({ operatorAccount: { username, password: PASSWORD, id: ID, role } })}\n`,
  stderr: `made ${username} (${role}) on daos-test-postgres's stand`,
  code: 0,
});

describe('the run, read', () => {
  it('takes the account from the last line of a run that made it', () => {
    expect(readAccountRun(made(), 'superadmin')).toEqual({
      made: true,
      account: { username: 'superadmin', password: PASSWORD, id: ID, role: 'superadmin' },
    });
  });

  it('never quotes stdout — on a transport failure it may hold the password', () => {
    const run = readAccountRun({ ...made(), code: 255, stderr: 'Connection reset by peer' }, 'superadmin');
    expect(run).toMatchObject({ made: false, uncertain: true });
    expect(JSON.stringify(run)).not.toContain(PASSWORD);
    expect(JSON.stringify(run)).toContain('Connection reset by peer');
  });

  it('calls a silent exit 0 uncertain, without quoting what it printed', () => {
    const run = readAccountRun({ stdout: `password=${PASSWORD}\n`, stderr: '', code: 0 }, 'superadmin');
    expect(run).toMatchObject({ made: false, uncertain: true });
    expect(JSON.stringify(run)).not.toContain(PASSWORD);
  });

  it('carries the tool\'s own words for a refusal, and knows nothing was made', () => {
    const run = readAccountRun(
      { stdout: '', stderr: "'superadmin' already exists on this stand — choose another name; nothing was changed", code: 1 },
      'superadmin',
    );
    expect(run).toMatchObject({ made: false, uncertain: false });
    expect(JSON.stringify(run)).toContain('already exists');
  });

  it('refuses an account line for another name', () => {
    expect(readAccountRun(made('someone.else'), 'superadmin')).toMatchObject({ made: false, uncertain: true });
  });
});

describe('the command', () => {
  it('names the stack\'s containers, passes only what the operator gave, and carries no password', () => {
    const plain = operatorAccountCommand({ remoteDir: '/opt/omnitron/operator/abc', containerPrefix: 'daos-test', username: 'superadmin' });
    expect(plain).toContain("DAOS_PG_CONTAINER='daos-test-postgres'");
    expect(plain).toContain("DAOS_REDIS_CONTAINER='daos-test-redis'");
    expect(plain).toContain("node scripts/operator-account.mjs '--username=superadmin'");
    // Which roles exist, and the default, are the project's to say.
    expect(plain).not.toContain('--role');

    const named = operatorAccountCommand({
      remoteDir: '/x',
      containerPrefix: 'daos-test',
      username: 'superadmin',
      role: 'superadmin',
      displayName: 'Super Admin',
    });
    expect(named).toContain("'--role=superadmin' '--display-name=Super Admin'");
  });

  it('keeps a name that tries to be a command inside its quotes', () => {
    const evil = "x'; touch /tmp/owned; echo '";
    const command = operatorAccountCommand({ remoteDir: '/x', containerPrefix: 'p', username: evil });
    // What a shell makes of it: exactly one argument, the name as given.
    const argv = execFileSync('sh', ['-c', `set -- ${command.split(' node scripts/operator-account.mjs ')[1]}; printf '%s\\n' "$@"`], {
      encoding: 'utf8',
    });
    expect(argv).toBe(`--username=${evil}\n`);
  });

  it('undoes by name AND id', () => {
    expect(operatorAccountUndoCommand({ remoteDir: '/x', containerPrefix: 'daos-test', username: 'superadmin', id: ID })).toContain(
      `'--remove=superadmin' '--id=${ID}'`,
    );
  });
});

// A project whose tool is committed, with an edit to it that is not.
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-account-'));
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=court@omnitron', '-c', 'user.name=court', ...args], { cwd: repo, encoding: 'utf8' }).trim();
git('init', '-q');
fs.mkdirSync(path.join(repo, 'scripts', 'lib'), { recursive: true });
fs.writeFileSync(path.join(repo, 'scripts', 'operator-account.mjs'), '// the committed tool\n');
fs.writeFileSync(path.join(repo, 'scripts', 'lib', 'accounts.mjs'), '// its recipe\n');
git('add', '.');
git('commit', '-q', '-m', 'tool');
const HEAD = git('rev-parse', 'HEAD');
fs.writeFileSync(path.join(repo, 'scripts', 'operator-account.mjs'), '// an edit nobody committed\n');
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('`createOperatorAccount`', () => {
  let vault: Map<string, string>;
  let vaultRefuses: boolean;
  let makeRun: { stdout: string; stderr: string; code: number };
  let undoRun: { stdout: string; stderr: string; code: number };
  let commands: string[];
  let uploaded: { dir: string; tool: string } | null;
  let logged: unknown[];
  let svc: any;

  beforeEach(() => {
    vault = new Map();
    vaultRefuses = false;
    makeRun = made();
    undoRun = { stdout: '{"operatorAccountRemoved":{}}', stderr: 'removed', code: 0 };
    commands = [];
    uploaded = null;
    logged = [];
    const log = (...args: unknown[]) => logged.push(args);
    svc = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(log), warn: vi.fn(log), error: vi.fn(log), debug: vi.fn(log) },
      secrets: {
        get: async (key: string) => vault.get(key) ?? null,
        set: vi.fn(async (key: string, value: string) => {
          if (vaultRefuses) throw new Error('the vault is sealed');
          vault.set(key, value);
        }),
      },
      registry: { get: (name: string) => (name === 'daos' ? { name: 'daos', path: repo } : undefined), list: () => [] },
      loadProjectConfig: async () => ({}),
      resolveStacks: () => ({
        test: { type: 'remote', apps: 'all', nodes: [{ nodeId: 'n1' }] },
        dev: { type: 'local', apps: 'all' },
        wide: { type: 'remote', apps: 'all', nodes: [{ nodeId: 'n1' }, { nodeId: 'n2' }] },
      }),
      targetForStackNode: async () => ({ host: '37.27.130.185', sshPort: 22 }),
      deployer: {
        underLease: vi.fn(async (_target: unknown, _purpose: string, work: () => Promise<unknown>) => work()),
        uploadStaticBundle: vi.fn(async (_target: unknown, dir: string) => {
          uploaded = { dir, tool: fs.readFileSync(path.join(dir, 'scripts', 'operator-account.mjs'), 'utf8') };
          return { remoteDir: '/opt/omnitron/operator/abc', bytes: 1 };
        }),
        runOnNode: vi.fn(async (_target: unknown, command: string) => {
          commands.push(command);
          if (command.startsWith('rm -rf')) return { stdout: '', stderr: '', code: 0 };
          if (command.includes('--remove=')) return undoRun;
          return makeRun;
        }),
      },
    });
  });

  const make = (stack = 'test', vaultKey?: string) =>
    svc.createOperatorAccount('daos', stack, { username: 'superadmin', ...(vaultKey ? { vaultKey } : {}) });
  const removedTheStage = () => commands.some((c) => c.startsWith("rm -rf '/opt/omnitron/operator/abc'"));

  it('keeps the password in the vault and nowhere else', async () => {
    const answer = await make();

    expect(answer).toEqual({
      username: 'superadmin',
      role: 'superadmin',
      id: ID,
      node: '37.27.130.185:22',
      vaultKey: accountVaultKey('daos', 'test', 'superadmin'),
      commit: HEAD,
    });
    expect(vault.get('daos.test.account.superadmin.password')).toBe(PASSWORD);
    expect(JSON.stringify(answer)).not.toContain(PASSWORD);
    expect(JSON.stringify(logged)).not.toContain(PASSWORD);
    expect(commands.join('\n')).not.toContain(PASSWORD);
    // The stage is taken away on both sides.
    expect(removedTheStage()).toBe(true);
    expect(fs.existsSync(uploaded!.dir)).toBe(false);
  });

  it('runs the committed tool, not the working tree', async () => {
    await make();
    expect(uploaded!.tool).toBe('// the committed tool\n');
  });

  it('refuses a vault key already taken, before the node is touched', async () => {
    vault.set('daos.test.account.superadmin.password', 'somebody else\'s');

    await expect(make()).rejects.toThrow(/already holds 'daos\.test\.account\.superadmin\.password'.*nothing was made/s);

    expect(svc.deployer.underLease).not.toHaveBeenCalled();
    expect(vault.get('daos.test.account.superadmin.password')).toBe('somebody else\'s');
  });

  it('takes the account away again when the vault refuses its password', async () => {
    vaultRefuses = true;

    await expect(make()).rejects.toThrow(/the vault refused the password of superadmin \(the vault is sealed\).*taken away again/);

    expect(commands.some((c) => c.includes("'--remove=superadmin'") && c.includes(`'--id=${ID}'`))).toBe(true);
    expect(vault.size).toBe(0);
    expect(removedTheStage()).toBe(true);
    expect(JSON.stringify(logged)).not.toContain(PASSWORD);
  });

  it('says the account is stranded when the undo fails too', async () => {
    vaultRefuses = true;
    undoRun = { stdout: '', stderr: 'no account superadmin with id … — nothing was removed', code: 1 };

    await expect(make()).rejects.toThrow(new RegExp(`superadmin \\(id ${ID}\\) is on the stand with a password nobody holds`));
  });

  it('leaves the vault untouched when the stand refuses, and still removes the stage', async () => {
    makeRun = { stdout: '', stderr: "'superadmin' already exists on this stand — choose another name; nothing was changed", code: 1 };

    await expect(make()).rejects.toThrow(/daos\/test on 37\.27\.130\.185:22: the stand refused: 'superadmin' already exists/);

    expect(svc.secrets.set).not.toHaveBeenCalled();
    expect(removedTheStage()).toBe(true);
  });

  it('refuses a local stack, a stack of two nodes, and a daemon with no vault — without the node', async () => {
    await expect(make('dev')).rejects.toThrow(/is local/);
    await expect(make('wide')).rejects.toThrow(/has 2 nodes/);
    svc.secrets = undefined;
    await expect(make()).rejects.toThrow(/no vault/);
    expect(svc.deployer.underLease).not.toHaveBeenCalled();
  });
});

describe('the audit row', () => {
  it('records who was made and where the password is kept', async () => {
    const record = vi.fn(async () => undefined);
    const answer = {
      username: 'superadmin',
      role: 'superadmin',
      id: ID,
      node: '37.27.130.185:22',
      vaultKey: 'daos.test.account.superadmin.password',
      commit: HEAD,
    };
    const rpc = new ProjectRpcService({ createOperatorAccount: vi.fn(async () => answer) } as never, { record } as never);

    await rpc.createStackAccount({ project: 'daos', stack: 'test', username: 'superadmin' });

    expect(record).toHaveBeenCalledWith({
      action: 'stack.account.create',
      resourceType: 'stack',
      resourceId: 'daos/test',
      details: { username: 'superadmin', role: 'superadmin', id: ID, node: '37.27.130.185:22', vault: answer.vaultKey, commit: HEAD },
      outcome: 'ok',
    });
  });

  it('records a refusal as failed, with its words', async () => {
    const record = vi.fn(async () => undefined);
    const refused = new Error("daos/test on 37.27.130.185:22: the stand refused: 'superadmin' already exists");
    const rpc = new ProjectRpcService(
      {
        createOperatorAccount: vi.fn(async () => {
          throw refused;
        }),
      } as never,
      { record } as never,
    );

    await expect(rpc.createStackAccount({ project: 'daos', stack: 'test', username: 'superadmin' })).rejects.toBe(refused);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stack.account.create', outcome: 'failed', error: refused, details: { username: 'superadmin' } }),
    );
  });
});

describe('`stack account` says where the password is, and exits 1 on a refusal', () => {
  async function run(answer: () => Promise<unknown>) {
    const said: string[] = [];
    vi.doMock('../../src/daemon/daemon-client.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/daemon/daemon-client.js')>()),
      createDaemonClient: () => ({
        service: async () => ({ createStackAccount: answer }),
        disconnect: async () => undefined,
      }),
    }));
    vi.doMock('../../src/commands/output.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/commands/output.js')>();
      const say = (m: string) => {
        said.push(m);
      };
      return {
        ...actual,
        emitJson: () => false,
        emitError: (m: string) => {
          said.push(m);
          return true;
        },
        emitStep: say,
        emitSuccess: say,
        emitInfo: say,
      };
    });
    const { stackAccountCommand } = await import('../../src/commands/stack.js');
    try {
      process.exitCode = 0;
      await stackAccountCommand('daos', 'test', { username: 'superadmin' });
      return { said: said.join('\n'), exitCode: process.exitCode };
    } finally {
      process.exitCode = 0;
      vi.doUnmock('../../src/daemon/daemon-client.js');
      vi.doUnmock('../../src/commands/output.js');
      vi.resetModules();
    }
  }

  it('names the vault key and the command that reads it', async () => {
    const { said, exitCode } = await run(async () => ({
      username: 'superadmin',
      role: 'superadmin',
      id: ID,
      node: '37.27.130.185:22',
      vaultKey: 'daos.test.account.superadmin.password',
      commit: HEAD,
    }));
    expect(exitCode).toBe(0);
    expect(said).toContain('Made superadmin (superadmin) on daos/test at 37.27.130.185:22');
    expect(said).toContain('omnitron secret get daos.test.account.superadmin.password');
  });

  it('exits 1 with the stand\'s words', async () => {
    const { said, exitCode } = await run(async () => {
      throw new Error("the stand refused: 'superadmin' already exists");
    });
    expect(exitCode).toBe(1);
    expect(said).toMatch(/Could not make superadmin on daos\/test: the stand refused: 'superadmin' already exists/);
  });
});
