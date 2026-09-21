/**
 * A schema that did not arrive, and the new code started on the old one.
 *
 * `migrateNodeApps` caught a failed migration, logged it, and carried on —
 * by design, under a docblock that gave the reason: «an app whose
 * migrations fail will fail its own start with a message about the table it
 * wanted, which is more specific than anything this step could say».
 *
 * True for one of the two ways it goes. An app that fails to START is
 * caught by `verifyHealth` and marked failed — that branch was covered. An
 * app that starts fine and fails on the first REQUEST that touches the
 * missing table passes `verifyHealth`, the stack reports `started`, and the
 * only trace is one ERROR line in the master's log. The justification
 * covered the branch that was already safe.
 *
 * Not measured, and said so: how many of paysys's 160 compiled migrations
 * add something read only on a request path. The case does not need the
 * number — one such migration is enough for the stack to report `started`
 * over a broken app.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';

const TARGET = { host: '37.27.130.185', daemonPort: 9700, username: 'root' } as never;
const NODE = '37.27.130.185:9700';
const APPS = ['main', 'storage', 'paysys'];
const DB = (app: string) => ({ DATABASE_URL: `postgresql://u:p@127.0.0.1:5432/${app}` });

/**
 * The real `deployToStack` and the real `migrateNodeApps`, with the node
 * answering through `sshExec` and the rest of the conversation stubbed at
 * the method boundary.
 */
function deployer(migrationFailsFor: Set<string>) {
  const restarted: string[] = [];
  const svc: any = Object.create(RemoteDeployer.prototype);
  Object.assign(svc, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emitProgress: vi.fn(),
    deployToNode: async (_t: unknown, artifact: { app: string; version: string }) => ({
      app: artifact.app,
      version: artifact.version,
      node: NODE,
      status: 'success',
      unchanged: false,
    }),
    registerNodeApps: async () => ({ changed: true }),
    openGatewayPath: async () => {},
    appsOnline: async () => new Set(APPS),
    signalRemoteDaemon: async (_t: unknown, app: string) => {
      restarted.push(app);
      return { ok: true, detail: '' };
    },
    verifyHealth: async () => ({ online: true, detail: '' }),
    sshExec: async (_t: unknown, cmd: string) => {
      if (cmd.startsWith('test -f')) return 'yes';
      const app = APPS.find((a) => cmd.includes(`/${a}/`));
      if (cmd.includes('migrate.js') && app && migrationFailsFor.has(app)) {
        throw new Error(`ssh root@37.27.130.185: relation "wallets" does not exist`);
      }
      return '';
    },
  });
  return { svc, restarted };
}

const run = (svc: any) =>
  svc.deployToStack(
    [TARGET],
    APPS.map((app) => ({ app, version: '0.0.1' })),
    'daos',
    {
      apps: APPS.map((name) => ({ name, script: `apps/${name}/dist/main.js` })),
      appEnv: Object.fromEntries(APPS.map((a) => [a, DB(a)])),
      stack: 'test',
    }
  );

describe('new code is not started on a schema it does not match', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the app failed and does not restart it', async () => {
    const { svc, restarted } = deployer(new Set(['paysys']));
    const results = await run(svc);

    const paysys = results.find((r: any) => r.app === 'paysys');
    expect(paysys.status).toBe('failed');
    expect(paysys.error).toMatch(/database migrations failed, so the new code was not started/);
    expect(paysys.error).toMatch(/relation "wallets" does not exist/);
    // The claim is about what did NOT happen: nothing restarted it onto the
    // code whose schema is missing.
    expect(restarted).not.toContain('paysys');
  });

  it('still starts the apps whose migrations went through', async () => {
    // The control. A deployer that stopped everything on one failure would
    // pass the test above.
    const { svc, restarted } = deployer(new Set(['paysys']));
    const results = await run(svc);
    expect(results.filter((r: any) => r.status === 'success').map((r: any) => r.app).sort()).toEqual([
      'main',
      'storage',
    ]);
    expect(restarted.sort()).toEqual(['main', 'storage']);
  });

  it('starts everything when every migration succeeds', async () => {
    const { svc, restarted } = deployer(new Set());
    const results = await run(svc);
    expect(results.every((r: any) => r.status === 'success')).toBe(true);
    expect(restarted.sort()).toEqual([...APPS].sort());
  });
});
