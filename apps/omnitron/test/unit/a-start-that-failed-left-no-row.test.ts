/**
 * A stack start that failed left no row.
 *
 * `ProjectService` wrote `stack.start` on its success path only — inside the
 * `try`, after the deployment returned — and every refusal before it threw
 * first. Measured on the master 2026-09-23: 178 rows in `omnitron_audit_log`
 * since it began (2026-09-20 15:37Z), no column and no detail saying how
 * anything ended, and not one failure; the daemon log over the same span
 * holds eight operator starts that threw:
 *
 *     09-22 04:37:24 … 08:27:49   Refusing to deploy daos/test: N file(s) differ   ×5
 *     09-22 15:12:41              Refusing release …: the gate 'scans' failed
 *     09-22 15:32:43              daos/test takes releases only
 *     09-22 21:19:02              Deployment to 37.27.130.185:9700 failed for 6 of 6 app(s)
 *
 * and the trail holds the redeploy at 21:20:37 — alone, as if the one before
 * it had never been tried.
 *
 * A failure is recorded as `stack.start.failed`, not as `stack.start`: two
 * readers take every `stack.start` row as a deployment that happened (the
 * console's «last deployed», the attestation freshness check), and the last
 * section pins that a failure does not become one.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { ProjectService } from '../../src/services/project.service.js';
import { AuditService, outcomeOf, type AuditRow } from '../../src/services/audit.service.js';
import { ReleaseRpcService } from '../../src/services/release.rpc-service.js';

const logger: Record<string, unknown> = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => logger,
};

const scratch = fs.mkdtempSync(path.join(tmpdir(), 'a-start-that-failed-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

/** The real recorder over a table that keeps what it is given, oldest first. */
function trail() {
  const rows: Array<Record<string, any>> = [];
  let clock = Date.UTC(2026, 8, 22, 21, 19, 0);
  const db = {
    insertInto: () => ({
      values: (v: Record<string, any>) => {
        rows.push({ ...v, createdAt: new Date((clock += 1000)).toISOString() });
        return { execute: async () => {} };
      },
    }),
  };
  return { rows, audit: new AuditService(logger as never, db as never) };
}

const NODE = { host: '203.0.113.7', port: 9700 };
const REMOTE = { type: 'remote', apps: 'all', nodes: [NODE] };
const LOCAL = { type: 'local', apps: 'all' };

function service(stack: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const { rows, audit } = trail();
  const svc: any = Object.create(ProjectService.prototype);
  Object.assign(svc, {
    logger,
    audit,
    registry: { get: () => null, list: () => [] },
    stackStates: new Map(),
    startsInFlight: new Map(),
    loadProjectConfig: vi.fn(async () => ({})),
    resolveStacks: () => ({ test: stack }),
    startLocalStack: vi.fn(async () => {}),
    startRemoteStack: vi.fn(async () => ({ nodes: 1, reached: 1, skipped: [] })),
    updateEnabledStacks: vi.fn(),
    toStackInfo: () => ({
      name: 'test',
      type: stack['type'],
      status: 'stopped',
      config: stack,
      apps: [{ name: 'main', status: 'online' }],
    }),
    emit: vi.fn(),
    ...overrides,
  });
  return { svc, rows };
}

/** A checkout whose one file is edited: the tree the operator had five times that morning. */
function dirtyRepo(): { dir: string; head: string } {
  const dir = fs.mkdtempSync(path.join(scratch, 'project-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'omnitron.config.ts'), 'export default {};\n');
  git('add', '.');
  git('commit', '-qm', 'one');
  const head = git('rev-parse', '--short', 'HEAD');
  fs.writeFileSync(path.join(dir, 'omnitron.config.ts'), 'export default { edited: true };\n');
  return { dir, head };
}

beforeEach(() => vi.clearAllMocks());

describe('a start that failed is in the trail, as a failure', () => {
  it('records a deployment that threw — with the first line of why', async () => {
    const { svc, rows } = service(LOCAL, {
      startLocalStack: vi.fn(async () => {
        throw new Error(
          "Stack 'daos/test' infrastructure provisioning failed: redis://omni:hunter2@127.0.0.1:6379 refused the connection\n" +
            '    at provision (infrastructure.ts:1:1)',
        );
      }),
    });

    await expect(svc.startStack('daos', 'test', { source: 'operator' })).rejects.toThrow(/provisioning failed/);

    expect(rows, 'one row for the one attempt').toHaveLength(1);
    expect(rows[0]!.action).toBe('stack.start.failed');
    expect(rows[0]!.resourceId).toBe('daos/test');
    expect(rows[0]!.details).toMatchObject({ outcome: 'failed', source: 'operator', type: 'local' });
    // The first line, and never the password a connection string carried.
    expect(rows[0]!.details.error).toBe(
      "Stack 'daos/test' infrastructure provisioning failed: redis://omni:«redacted»@127.0.0.1:6379 refused the connection",
    );
    expect(outcomeOf(rows[0] as unknown as AuditRow)).toBe('failed');
  });

  it('records a refusal — the dirty tree the operator met five times on 2026-09-22', async () => {
    const { dir, head } = dirtyRepo();
    const { svc, rows } = service(REMOTE, { registry: { get: () => ({ name: 'daos', path: dir }), list: () => [] } });

    await expect(svc.startStack('daos', 'test', { source: 'operator' })).rejects.toThrow(/Refusing to deploy daos\/test/);

    expect(svc.startRemoteStack, 'refused before anything moved').not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('stack.start.failed');
    expect(rows[0]!.details.error).toMatch(/^Refusing to deploy daos\/test: 1 file\(s\) differ from the commit \(HEAD [0-9a-f]+\)/);
    // The refusal goes on to list the files, which is for the terminal.
    expect(rows[0]!.details.error).not.toContain('omnitron.config.ts');
    expect(rows[0]!.details.commit, 'the commit the refused tree was on').toBe(head);
  });

  it('records «takes releases only»', async () => {
    const { svc, rows } = service({ ...REMOTE, release: { mode: 'required' } });

    await expect(svc.startStack('daos', 'test', { source: 'operator' })).rejects.toThrow(/takes releases only/);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'stack.start.failed',
      details: { outcome: 'failed', source: 'operator', type: 'remote' },
    });
    expect(rows[0]!.details.error).toMatch(/^daos\/test takes releases only/);
  });

  it('records a refused release under the id it was asked for', async () => {
    const store = fs.mkdtempSync(path.join(scratch, 'store-'));
    const { svc, rows } = service({ ...REMOTE, release: { mode: 'required' } }, { releaseStore: async () => store });

    await expect(
      svc.startStack('daos', 'test', { source: 'operator', release: 'daos-202609221455-ae9d7a6f-7f4d1a01' }),
    ).rejects.toThrow(/No release 'daos-202609221455-ae9d7a6f-7f4d1a01'/);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.details.release).toBe('daos-202609221455-ae9d7a6f-7f4d1a01');
    expect(rows[0]!.details.outcome).toBe('failed');
  });

  it("records the daemon's own failed start, as the daemon's", async () => {
    // 2026-09-21 15:16:45: the boot resume of daos/dev, «Docker is not
    // available». Nobody typed it, and the row says so twice over.
    const { svc, rows } = service(LOCAL, {
      startLocalStack: vi.fn(async () => {
        throw new Error("Stack 'daos/dev' infrastructure provisioning failed: Docker is not available.");
      }),
    });

    await expect(svc.startStack('daos', 'test', { source: 'boot' })).rejects.toThrow(/Docker/);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorType).toBe('system');
    expect(rows[0]!.details.source).toBe('boot');
    expect(rows[0]!.details.outcome).toBe('failed');
  });

  it('says `ok` on the start that worked — the control', async () => {
    const { svc, rows } = service(LOCAL);

    await svc.startStack('daos', 'test', { source: 'operator' });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('stack.start');
    expect(rows[0]!.details.outcome).toBe('ok');
    expect(rows[0]!.details).not.toHaveProperty('error');
  });

  it('writes nothing for a restart re-attaching a remote stack, even when no node answers', async () => {
    // It deploys nothing either way, and the reconciler re-asks a silent node
    // every few minutes: rows about looking, not about changing anything.
    const { svc, rows } = service(REMOTE, {
      slaveConnector: { invokeOnSlave: vi.fn(async () => Promise.reject(new Error('mesh connection not established'))) },
      remoteInfraStatus: vi.fn(async () => null),
    });

    await expect(svc.startStack('daos', 'test', { source: 'auto-resume' })).rejects.toThrow(/Not deploying daos\/test/);

    expect(svc.startRemoteStack).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });
});

describe('a failure does not become the last deployment', () => {
  /**
   * What `AuditService` answers for this table: `list` — exact action, newest
   * first — and `latestPerResource`, the newest row of an exact action per
   * resource, which `deployments()` reads since f19b16b0.
   */
  function readerOver(rows: Array<Record<string, any>>) {
    const newestFirst = (action?: string) =>
      rows
        .filter((r) => !action || r.action === action)
        .reverse()
        .map((r) => ({ ...r, id: r.createdAt, ipAddress: null }));
    return {
      available: true,
      list: async (q: { action?: string }) => newestFirst(q.action),
      latestPerResource: async (action: string) => {
        const seen = new Set<string>();
        return newestFirst(action).filter((r) => !seen.has(r.resourceId) && (seen.add(r.resourceId), true));
      },
    };
  }

  it("is not what the console reports as the stack's last deployment, nor what an attestation is dated against", async () => {
    const { svc, rows } = service(REMOTE);
    await svc.startStack('daos', 'test', { source: 'operator' });
    const deployed = rows[0]!.createdAt as string;

    // Then an operator asks for a release this machine does not have.
    svc.releaseStore = async () => fs.mkdtempSync(path.join(scratch, 'store-'));
    await expect(svc.startStack('daos', 'test', { source: 'operator', release: 'daos-refused' })).rejects.toThrow(
      /No release 'daos-refused'/,
    );
    expect(rows, 'both attempts are in the trail').toHaveLength(2);

    const rpc = new ReleaseRpcService({} as never, readerOver(rows) as never);
    const [last] = await rpc.deployments();
    expect(last?.at, 'the deployment that happened').toBe(deployed);
    expect(last?.release, 'not the release that was refused').toBeNull();
    expect(await (rpc as any).lastDeployedAt('daos-refused', 'test')).toBeNull();
  });
});
