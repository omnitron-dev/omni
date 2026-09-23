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
 * in this daemon's vault — the one place it is written.
 *
 * Its first run on daos/test made the account and lost the password: the
 * transport masks `"password":"…"` in every stdout it returns, the line came
 * back as `"password": [REDACTED]`, no longer JSON, and was refused —
 * `superadmin` stayed on the stand with a password nobody holds, and the
 * answer said only that it might. So the password now comes back sealed to a
 * key made for the run, an answer this side cannot read makes it ask the
 * stand what it holds, and an account can be looked at and taken away.
 */

import { execFileSync } from 'node:child_process';
import { constants, createPublicKey, publicEncrypt } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionService } from '../../src/execution/execution.service.js';
import {
  accountVaultKey,
  describeStdout,
  operatorAccountCommand,
  operatorAccountRemoveCommand,
  operatorAccountShowCommand,
  readAccountRun,
  readRemoveRun,
  readShowRun,
  sealingKey,
} from '../../src/project/operator-account.js';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';

const PASSWORD = 'k3Y-generated-on-the-node-xyzQW42!';
const ID = '01a0cf59-a85d-7544-9acd-564e494ef530';

/** What the tool does with `--seal-to`. */
function sealTo(spki: string, plain: string): string {
  const key = createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' });
  return publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(plain)).toString('base64');
}
const accountLine = (fields: Record<string, unknown>) =>
  JSON.stringify({ operatorAccount: { username: 'superadmin', id: ID, role: 'superadmin', ...fields } });
const quiet = { debug() {}, info() {}, warn() {}, error() {} } as never;

describe('the transport, measured', () => {
  it('rewrites a password printed on stdout, and leaves a sealed one alone', async () => {
    const execution = new ExecutionService(quiet);
    const key = await sealingKey();

    const plain = await execution.exec(`printf '%s\\n' '${accountLine({ password: PASSWORD })}'`);
    expect(plain.stdout).not.toContain(PASSWORD);
    expect(plain.stdout).toContain('[REDACTED]');
    expect(() => JSON.parse(plain.stdout)).toThrow();

    const sealed = accountLine({ sealed: sealTo(key.spki, PASSWORD) });
    const back = await execution.exec(`printf '%s\\n' '${sealed}'`);
    expect(back.stdout).toBe(sealed);
    expect(readAccountRun({ stdout: back.stdout, stderr: '', code: 0 }, 'superadmin', key.open)).toEqual({
      made: true,
      account: { username: 'superadmin', password: PASSWORD, id: ID, role: 'superadmin' },
    });
  });
});

describe('the run, read', () => {
  let key: Awaited<ReturnType<typeof sealingKey>>;
  beforeEach(async () => {
    key ??= await sealingKey();
  });
  const sealedRun = () => ({ stdout: `${accountLine({ sealed: sealTo(key.spki, PASSWORD) })}\n`, stderr: 'made superadmin', code: 0 });

  it('finds the answer line with a line after it', () => {
    const run = sealedRun();
    const read = readAccountRun({ ...run, stdout: `${run.stdout}(node:4242) Warning: something\n` }, 'superadmin', key.open);
    expect(read).toMatchObject({ made: true, account: { password: PASSWORD } });
  });

  it('never takes a password that came in the clear — through this transport it is [REDACTED] at best', () => {
    const masked = `${accountLine({ password: 'PLACEHOLDER' }).replace('"PLACEHOLDER"', ' [REDACTED]')}\n`;
    const read = readAccountRun({ stdout: masked, stderr: '', code: 0 }, 'superadmin', key.open);
    expect(read).toMatchObject({ made: false, uncertain: true });
    // Its shape, never its content.
    expect((read as { because: string }).because).toMatch(/stdout had 1 line\(s\); the last, \d+ characters, starts like JSON and does not parse/);
    expect((read as { because: string }).because).not.toContain('REDACTED');

    const valid = readAccountRun({ stdout: accountLine({ password: '[REDACTED]' }), stderr: '', code: 0 }, 'superadmin', key.open);
    expect(valid).toMatchObject({ made: false, uncertain: true, because: expect.stringMatching(/carries no sealed password/) });
  });

  it('says a sealed password that does not open with this run\'s key', async () => {
    const other = await sealingKey();
    const read = readAccountRun({ stdout: accountLine({ sealed: sealTo(other.spki, PASSWORD) }), stderr: '', code: 0 }, 'superadmin', key.open);
    expect(read).toMatchObject({ made: false, uncertain: true, because: expect.stringMatching(/does not open with this run's key/) });
  });

  it('carries the tool\'s words for a refusal and for its arguments, and knows nothing was made', () => {
    expect(readAccountRun({ stdout: '', stderr: "'superadmin' already exists on this stand", code: 1 }, 'superadmin', key.open)).toMatchObject({
      made: false,
      uncertain: false,
      because: expect.stringMatching(/the stand refused: 'superadmin' already exists/),
    });
    // A tool older than --seal-to refuses the flag before it makes anything.
    expect(readAccountRun({ stdout: '', stderr: 'unknown argument(s): --seal-to=…', code: 2 }, 'superadmin', key.open)).toMatchObject({
      made: false,
      uncertain: false,
      because: expect.stringMatching(/refused its arguments \(exit 2\): unknown argument/),
    });
  });

  it('calls the transport\'s exit uncertain, without quoting stdout', () => {
    const run = sealedRun();
    const read = readAccountRun({ ...run, code: 255, stderr: 'Connection reset by peer' }, 'superadmin', key.open);
    expect(read).toMatchObject({ made: false, uncertain: true });
    expect(JSON.stringify(read)).toContain('Connection reset by peer');
    expect(JSON.stringify(read)).not.toContain(run.stdout.trim().slice(40, 80));
  });

  it('refuses an account line for another name', () => {
    const line = JSON.stringify({ operatorAccount: { username: 'someone.else', id: ID, role: 'superadmin', sealed: sealTo(key.spki, PASSWORD) } });
    expect(readAccountRun({ stdout: line, stderr: '', code: 0 }, 'superadmin', key.open)).toMatchObject({ made: false, uncertain: true });
  });

  it('describes stdout by its shape', () => {
    expect(describeStdout('')).toBe('stdout was empty');
    expect(describeStdout('hello\n{"a":1}\n')).toBe('stdout had 2 line(s); the last, 7 characters, is a JSON object with a');
  });

  it('reads what the stand holds, and quotes a --show it cannot read — that stdout has no secret', () => {
    const shown = { username: 'superadmin', id: ID, role: 'superadmin', status: 'active', createdAt: '2026-09-23T18:04:18Z', lastActiveAt: null };
    expect(readShowRun({ stdout: JSON.stringify({ operatorAccountShown: shown }), stderr: '', code: 0 })).toEqual({ ok: true, account: shown });
    expect(readShowRun({ stdout: '{"operatorAccountShown":null}', stderr: '', code: 0 })).toEqual({ ok: true, account: null });
    expect(readShowRun({ stdout: 'garbled', stderr: '', code: 0 })).toEqual({ ok: false, because: expect.stringContaining('garbled') });
    expect(readShowRun({ stdout: '', stderr: 'could not read superadmin: docker gone', code: 1 })).toEqual({
      ok: false,
      because: 'exit 1: could not read superadmin: docker gone',
    });
  });

  it('reads a removal only when it names the account it was asked about', () => {
    const line = JSON.stringify({ operatorAccountRemoved: { username: 'superadmin', id: ID } });
    expect(readRemoveRun({ stdout: line, stderr: '', code: 0 }, 'superadmin', ID)).toEqual({ removed: true });
    expect(readRemoveRun({ stdout: line, stderr: '', code: 0 }, 'superadmin', 'another-id')).toMatchObject({ removed: false });
    expect(readRemoveRun({ stdout: '', stderr: 'no account superadmin with id x', code: 1 }, 'superadmin', ID)).toEqual({
      removed: false,
      because: 'exit 1: no account superadmin with id x',
    });
  });
});

describe('the command', () => {
  it('names the stack\'s containers, passes only what the operator gave, and always seals', () => {
    const plain = operatorAccountCommand({ remoteDir: '/opt/omnitron/operator/abc', containerPrefix: 'daos-test', username: 'superadmin', sealTo: 'AAAA' });
    expect(plain).toContain("DAOS_PG_CONTAINER='daos-test-postgres'");
    expect(plain).toContain("DAOS_REDIS_CONTAINER='daos-test-redis'");
    expect(plain).toContain("node scripts/operator-account.mjs '--username=superadmin' '--seal-to=AAAA'");
    // Which roles exist, and the default, are the project's to say.
    expect(plain).not.toContain('--role');

    const named = operatorAccountCommand({
      remoteDir: '/x',
      containerPrefix: 'daos-test',
      username: 'superadmin',
      role: 'superadmin',
      displayName: 'Super Admin',
      sealTo: 'AAAA',
    });
    expect(named).toContain("'--role=superadmin' '--display-name=Super Admin'");
  });

  it('keeps a name that tries to be a command inside its quotes', () => {
    const evil = "x'; touch /tmp/owned; echo '";
    const command = operatorAccountCommand({ remoteDir: '/x', containerPrefix: 'p', username: evil, sealTo: 'AAAA' });
    // What a shell makes of it: the name as given, one argument.
    const argv = execFileSync('sh', ['-c', `set -- ${command.split(' node scripts/operator-account.mjs ')[1]}; printf '%s\\n' "$@"`], {
      encoding: 'utf8',
    });
    expect(argv).toBe(`--username=${evil}\n--seal-to=AAAA\n`);
  });

  it('shows by name, and removes by name AND id', () => {
    expect(operatorAccountShowCommand({ remoteDir: '/x', containerPrefix: 'daos-test', username: 'superadmin' })).toMatch(
      /'--show=superadmin'$/,
    );
    expect(operatorAccountRemoveCommand({ remoteDir: '/x', containerPrefix: 'daos-test', username: 'superadmin', id: ID })).toMatch(
      new RegExp(`'--remove=superadmin' '--id=${ID}'$`),
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

describe('the service', () => {
  type Run = { stdout: string; stderr: string; code: number };
  let vault: Map<string, string>;
  let vaultRefuses: boolean;
  /** What the node's tool answers a make with, given the key it was asked to seal to. */
  let make: (sealTo: string | undefined) => Run;
  let showRun: Run;
  let removeRun: Run;
  let commands: string[];
  let uploaded: { dir: string; tool: string } | null;
  let logged: unknown[];
  let svc: any;

  const SHOWN = { username: 'superadmin', id: ID, role: 'superadmin', status: 'active', createdAt: '2026-09-23T18:04:18Z', lastActiveAt: null };

  beforeEach(() => {
    vault = new Map();
    vaultRefuses = false;
    make = (spki) => ({
      stdout: `${accountLine(spki ? { sealed: sealTo(spki, PASSWORD) } : { password: PASSWORD })}\n`,
      stderr: "made superadmin (superadmin) on daos-test-postgres's stand",
      code: 0,
    });
    showRun = { stdout: JSON.stringify({ operatorAccountShown: SHOWN }), stderr: '', code: 0 };
    removeRun = { stdout: JSON.stringify({ operatorAccountRemoved: { username: 'superadmin', id: ID } }), stderr: 'removed', code: 0 };
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
        delete: vi.fn(async (key: string) => vault.delete(key)),
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
        // The tool's runs are data (`readFromNode`); the stage's removal is not.
        readFromNode: vi.fn(async (_target: unknown, command: string) => {
          commands.push(command);
          if (command.includes("'--show=")) return showRun;
          if (command.includes("'--remove=")) return removeRun;
          return make(/'--seal-to=([^']+)'/.exec(command)?.[1]);
        }),
        runOnNode: vi.fn(async (_target: unknown, command: string) => {
          commands.push(command);
          if (command.startsWith('rm -rf')) return { stdout: '', stderr: '', code: 0 };
          return { stdout: '', stderr: `not a command this court expects on runOnNode: ${command.slice(0, 60)}`, code: 127 };
        }),
      },
    });
  });

  const makeIt = (stack = 'test') => svc.createOperatorAccount('daos', stack, { username: 'superadmin' });
  const removedTheStage = () => commands.some((c) => c.startsWith("rm -rf '/opt/omnitron/operator/abc'"));

  it('keeps the password in the vault and nowhere else', async () => {
    const answer = await makeIt();

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
    // The tool's answer is data, read past the transport's masker.
    expect(svc.deployer.readFromNode).toHaveBeenCalledTimes(1);
    expect(svc.deployer.runOnNode.mock.calls.map((c: unknown[]) => String(c[1]).split(' ')[0])).toEqual(['rm']);
  });

  it('runs the committed tool, not the working tree', async () => {
    await makeIt();
    expect(uploaded!.tool).toBe('// the committed tool\n');
  });

  it('refuses a vault key already taken, before the node is touched', async () => {
    vault.set('daos.test.account.superadmin.password', 'somebody else\'s');

    await expect(makeIt()).rejects.toThrow(/already holds 'daos\.test\.account\.superadmin\.password'.*nothing was made/s);

    expect(svc.deployer.underLease).not.toHaveBeenCalled();
    expect(vault.get('daos.test.account.superadmin.password')).toBe('somebody else\'s');
  });

  it('takes the account away again when the vault refuses its password', async () => {
    vaultRefuses = true;

    await expect(makeIt()).rejects.toThrow(/the vault refused the password of superadmin \(the vault is sealed\).*taken away again/);

    expect(commands.some((c) => c.includes("'--remove=superadmin'") && c.includes(`'--id=${ID}'`))).toBe(true);
    expect(vault.size).toBe(0);
    expect(removedTheStage()).toBe(true);
    expect(JSON.stringify(logged)).not.toContain(PASSWORD);
  });

  it('says the account is stranded when the undo fails too', async () => {
    vaultRefuses = true;
    removeRun = { stdout: '', stderr: 'no account superadmin with id … — nothing was removed', code: 1 };

    await expect(makeIt()).rejects.toThrow(new RegExp(`superadmin \\(id ${ID}\\) is on the stand with a password nobody holds`));
  });

  it('leaves the vault untouched when the stand refuses, and still removes the stage', async () => {
    make = () => ({ stdout: '', stderr: "'superadmin' already exists on this stand — choose another name; nothing was changed", code: 1 });

    await expect(makeIt()).rejects.toThrow(/daos\/test on 37\.27\.130\.185:22: the stand refused: 'superadmin' already exists/);

    expect(svc.secrets.set).not.toHaveBeenCalled();
    expect(commands.some((c) => c.includes("'--show="))).toBe(false);
    expect(removedTheStage()).toBe(true);
  });

  it('asks the stand what it holds when the answer cannot be read, and says how to take it away', async () => {
    // What daos/test sent back on 2026-09-23.
    make = () => ({ stdout: `${accountLine({ password: 'PLACEHOLDER' }).replace('"PLACEHOLDER"', ' [REDACTED]')}\n`, stderr: 'made superadmin', code: 0 });

    const refused = await makeIt().catch((err: Error) => err);

    expect(refused.message).toMatch(/the tool exited 0, but no account line could be read/);
    expect(refused.message).toContain(`The stand holds superadmin: id ${ID}, role superadmin, made 2026-09-23T18:04:18Z, never signed in`);
    expect(refused.message).toContain(`omnitron stack account daos test --remove superadmin --id ${ID}`);
    expect(refused.message).not.toContain('REDACTED');
    expect(vault.size).toBe(0);
  });

  it('says nothing was made when the stand holds no such account', async () => {
    make = () => ({ stdout: '', stderr: 'Connection reset by peer', code: 255 });
    showRun = { stdout: '{"operatorAccountShown":null}', stderr: '', code: 0 };

    await expect(makeIt()).rejects.toThrow(/whether superadmin was made is not known.*The stand holds no superadmin — nothing was made/s);
  });

  it('refuses a local stack, a stack of two nodes, and a daemon with no vault — without the node', async () => {
    await expect(makeIt('dev')).rejects.toThrow(/is local/);
    await expect(makeIt('wide')).rejects.toThrow(/has 2 nodes/);
    svc.secrets = undefined;
    await expect(makeIt()).rejects.toThrow(/no vault/);
    expect(svc.deployer.underLease).not.toHaveBeenCalled();
  });

  it('shows what the stand holds', async () => {
    expect(await svc.showOperatorAccount('daos', 'test', 'superadmin')).toEqual({ node: '37.27.130.185:22', commit: HEAD, account: SHOWN });
    showRun = { stdout: '', stderr: 'could not read superadmin: docker gone', code: 1 };
    await expect(svc.showOperatorAccount('daos', 'test', 'superadmin')).rejects.toThrow(/could not read superadmin: exit 1: .*docker gone/);
    expect(removedTheStage()).toBe(true);
  });

  it('takes an account away on the stand first, then its password from the vault', async () => {
    vault.set('daos.test.account.superadmin.password', PASSWORD);

    expect(await svc.removeOperatorAccount('daos', 'test', { username: 'superadmin', id: ID })).toEqual({
      username: 'superadmin',
      id: ID,
      node: '37.27.130.185:22',
      commit: HEAD,
      vaultKeyRemoved: 'daos.test.account.superadmin.password',
    });
    expect(vault.size).toBe(0);
  });

  it('keeps the password when the stand would not remove the account', async () => {
    vault.set('daos.test.account.superadmin.password', PASSWORD);
    removeRun = { stdout: '', stderr: 'no account superadmin with id … — nothing was removed', code: 1 };

    await expect(svc.removeOperatorAccount('daos', 'test', { username: 'superadmin', id: ID })).rejects.toThrow(/was not removed/);
    expect(vault.get('daos.test.account.superadmin.password')).toBe(PASSWORD);
  });
});

describe('the audit rows', () => {
  const MADE = {
    username: 'superadmin',
    role: 'superadmin',
    id: ID,
    node: '37.27.130.185:22',
    vaultKey: 'daos.test.account.superadmin.password',
    commit: HEAD,
  };

  it('records who was made and where the password is kept', async () => {
    const record = vi.fn(async () => undefined);
    const rpc = new ProjectRpcService({ createOperatorAccount: vi.fn(async () => MADE) } as never, { record } as never);

    await rpc.createStackAccount({ project: 'daos', stack: 'test', username: 'superadmin' });

    expect(record).toHaveBeenCalledWith({
      action: 'stack.account.create',
      resourceType: 'stack',
      resourceId: 'daos/test',
      details: { username: 'superadmin', role: 'superadmin', id: ID, node: '37.27.130.185:22', vault: MADE.vaultKey, commit: HEAD },
      outcome: 'ok',
    });
  });

  it('records a refused make as failed, with its words', async () => {
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

  it('records a removal both ways', async () => {
    const record = vi.fn(async () => undefined);
    const removed = { username: 'superadmin', id: ID, node: '37.27.130.185:22', commit: HEAD, vaultKeyRemoved: null };
    const ok = new ProjectRpcService({ removeOperatorAccount: vi.fn(async () => removed) } as never, { record } as never);
    await ok.removeStackAccount({ project: 'daos', stack: 'test', username: 'superadmin', id: ID });
    expect(record).toHaveBeenCalledWith({
      action: 'stack.account.remove',
      resourceType: 'stack',
      resourceId: 'daos/test',
      details: { username: 'superadmin', id: ID, node: '37.27.130.185:22', commit: HEAD, vault: null },
      outcome: 'ok',
    });

    const refusal = new Error('was not removed');
    const failed = new ProjectRpcService(
      {
        removeOperatorAccount: vi.fn(async () => {
          throw refusal;
        }),
      } as never,
      { record } as never,
    );
    await expect(failed.removeStackAccount({ project: 'daos', stack: 'test', username: 'superadmin', id: ID })).rejects.toBe(refusal);
    expect(record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'stack.account.remove', outcome: 'failed', details: { username: 'superadmin', id: ID } }),
    );
  });
});

describe('`stack account` on the command line', () => {
  async function run(options: Record<string, string>, service: Record<string, () => Promise<unknown>>) {
    const said: string[] = [];
    vi.doMock('../../src/daemon/daemon-client.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/daemon/daemon-client.js')>()),
      createDaemonClient: () => ({ service: async () => service, disconnect: async () => undefined }),
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
      await stackAccountCommand('daos', 'test', options);
      return { said: said.join('\n'), exitCode: process.exitCode };
    } finally {
      process.exitCode = 0;
      vi.doUnmock('../../src/daemon/daemon-client.js');
      vi.doUnmock('../../src/commands/output.js');
      vi.resetModules();
    }
  }

  it('names the vault key and the command that reads it, never the password', async () => {
    const { said, exitCode } = await run(
      { username: 'superadmin' },
      {
        createStackAccount: async () => ({
          username: 'superadmin',
          role: 'superadmin',
          id: ID,
          node: '37.27.130.185:22',
          vaultKey: 'daos.test.account.superadmin.password',
          commit: HEAD,
        }),
      },
    );
    expect(exitCode).toBe(0);
    expect(said).toContain('Made superadmin (superadmin) on daos/test at 37.27.130.185:22');
    expect(said).toContain('omnitron secret get daos.test.account.superadmin.password');
  });

  it('exits 1 with the stand\'s words', async () => {
    const { said, exitCode } = await run(
      { username: 'superadmin' },
      {
        createStackAccount: async () => {
          throw new Error("the stand refused: 'superadmin' already exists");
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(said).toMatch(/Could not make superadmin on daos\/test: the stand refused: 'superadmin' already exists/);
  });

  it('shows an account that was never signed in to, and removes one with its password', async () => {
    const shown = await run(
      { show: 'superadmin' },
      {
        showStackAccount: async () => ({
          node: '37.27.130.185:22',
          commit: HEAD,
          account: { username: 'superadmin', id: ID, role: 'superadmin', status: 'active', createdAt: '2026-09-23T18:04:18Z', lastActiveAt: null },
        }),
      },
    );
    expect(shown.said).toContain(`  id ${ID}`);
    expect(shown.said).toContain('never signed in');

    const removed = await run(
      { remove: 'superadmin', id: ID },
      {
        removeStackAccount: async () => ({
          username: 'superadmin',
          id: ID,
          node: '37.27.130.185:22',
          commit: HEAD,
          vaultKeyRemoved: 'daos.test.account.superadmin.password',
        }),
      },
    );
    expect(removed.said).toContain(`Removed superadmin (id ${ID}) from daos/test at 37.27.130.185:22`);
    expect(removed.said).toContain('and its password from the vault (daos.test.account.superadmin.password)');
  });

  it('refuses options that say no one thing, before the daemon is asked', async () => {
    const { accountOptionsRefusal } = await import('../../src/commands/stack.js');
    expect(accountOptionsRefusal({})).toMatch(/exactly one of/);
    expect(accountOptionsRefusal({ username: 'a', show: 'a' })).toMatch(/exactly one of/);
    expect(accountOptionsRefusal({ remove: 'a' })).toMatch(/--remove needs --id/);
    expect(accountOptionsRefusal({ username: 'a', id: ID })).toMatch(/--id goes with --remove/);
    expect(accountOptionsRefusal({ show: 'a', role: 'admin' })).toMatch(/go with --username/);
    expect(accountOptionsRefusal({ show: 'a', vaultKey: 'k' })).toMatch(/--vault-key goes with/);
    expect(accountOptionsRefusal({ username: 'a', role: 'admin', vaultKey: 'k' })).toBeNull();
    expect(accountOptionsRefusal({ remove: 'a', id: ID, vaultKey: 'k' })).toBeNull();

    const { exitCode } = await run({ remove: 'superadmin' }, {});
    expect(exitCode).toBe(1);
  });
});
