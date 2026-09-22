/**
 * A node that could not be asked, taken to have no migrations.
 *
 * `migrateNodeApps` runs an app's migrations only when its artifact carries
 * a migrator, and asked the node first:
 *
 *     await this.sshExec(target, `test -f <migrate.js> && echo yes || echo no`)
 *       .catch(() => 'no');
 *
 * The command exits 0 either way, so `sshExec` throws only when the node
 * could not be asked at all — and the transport reports that as `exit 1`
 * (`ExecutionService.ssh` turns a failed connection into one). The `.catch`
 * answered «no migrator», the app was skipped as one that has no schema,
 * and its new code was started on the old one: the outcome this step's own
 * docblock calls worse than not deploying, because it can come up healthy
 * and fail on a request.
 *
 * The real `deployToStack` and `migrateNodeApps`, and the real `sshExec` over
 * a node whose answers are scripted — one question dropped, as a transient
 * SSH failure drops it.
 */

import { describe, it, expect, vi } from 'vitest';

import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';

const TARGET = { host: '37.27.130.185', daemonPort: 9700, username: 'root' } as never;
const NODE = '37.27.130.185:9700';
const APPS = ['main', 'paysys'];
const DB = (app: string) => ({ DATABASE_URL: `postgresql://u:p@127.0.0.1:5432/${app}` });

/** A deployment of `APPS`, whose node could not be asked about `unasked`. */
function deployment(unasked: Set<string>) {
  const restarted: string[] = [];
  const migrated: string[] = [];
  const svc: any = Object.create(RemoteDeployer.prototype);
  Object.assign(svc, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emitProgress: vi.fn(),
    // The node, through the transport `sshExec` reads.
    execution: {
      ssh: async (_t: unknown, cmd: string) => {
        const app = APPS.find((a) => cmd.includes(`/${a}/`));
        if (cmd.startsWith('test -f')) {
          return app && unasked.has(app)
            ? { stdout: '', stderr: 'Timed out while waiting for handshake', exitCode: 1, duration: 20_000 }
            : { stdout: 'yes', stderr: '', exitCode: 0, duration: 1 };
        }
        if (cmd.includes('migrate.js') && app) migrated.push(app);
        return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
      },
    },
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
  });
  const run = () =>
    svc.deployToStack(
      [TARGET],
      APPS.map((app) => ({ app, version: '0.0.1' })),
      'daos',
      {
        apps: APPS.map((name) => ({ name, script: `apps/${name}/dist/main.js` })),
        appEnv: Object.fromEntries(APPS.map((a) => [a, DB(a)])),
        stack: 'test',
      },
    );
  return { run, restarted, migrated };
}

describe('a node that could not be asked, taken to have no migrations', () => {
  it('does not start the new code of an app whose migrator it could not ask about', async () => {
    const d = deployment(new Set(['paysys']));

    const results = await d.run();

    const paysys = results.find((r: any) => r.app === 'paysys');
    expect(paysys.status).toBe('failed');
    expect(paysys.error).toMatch(/could not be asked/);
    expect(paysys.error).toMatch(/Timed out while waiting for handshake/);
    // What did NOT happen is the claim: nothing migrated it, and nothing
    // started the code that expects the migrated schema.
    expect(d.migrated).not.toContain('paysys');
    expect(d.restarted).not.toContain('paysys');
  });

  it('still migrates and starts the app it could ask about', async () => {
    // The control: a deployer that refused everything on one failed
    // question would pass the case above. About `main` only — what happens
    // to paysys is the case above's claim, not this one's.
    const d = deployment(new Set(['paysys']));

    const results = await d.run();

    expect(results.find((r: any) => r.app === 'main').status).toBe('success');
    expect(d.migrated).toContain('main');
    expect(d.restarted).toContain('main');
  });

  it('migrates and starts both when the node answers', async () => {
    const d = deployment(new Set());

    const results = await d.run();

    expect(results.every((r: any) => r.status === 'success')).toBe(true);
    expect(d.migrated.sort()).toEqual(['main', 'paysys']);
    expect(d.restarted.sort()).toEqual(['main', 'paysys']);
  });
});
