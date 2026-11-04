/** Exercise the actual deployment boundary. A present file or DATABASE_URL is
 * not migration authority; a declared missing program is not permission to skip. */
import { expect, it, vi } from 'vitest';
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';
import type { MigrationRequest } from '../../src/services/migration-target.js';

const target = { host: '127.0.0.2', daemonPort: 9700, username: 'fixture' };
const apps = ['api', 'worker'];
const legacy = (app = 'api'): MigrationRequest => ({ service: 'postgres', database: app, app, mode: 'script', source: 'src/database/migrate.ts', release: 'dist/database/migrate.js' });
function fixture(options: { missing?: string; failure?: string; sealed?: boolean; drift?: boolean } = {}) {
  const mutations: string[] = [], preparations: string[] = [];
  const service = Object.create(RemoteDeployer.prototype) as any;
  const origin = { releaseId: 'fixture', manifestSha256: 'a'.repeat(64), artifactSha256: 'b'.repeat(64), artifactBytes: 100,
    app: 'api', frameworkCommit: 'c'.repeat(40) };
  let checks = 0;
  Object.assign(service, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emitProgress: vi.fn(),
    inspectInstalledBundle: async () => ({ applicationRuntime: { root: '/verified/framework', executable: '/verified/node', commit: 'c'.repeat(40), execution: { mode: 'resident', protocol: 1, ownerId: 'fixture', pid: 42, epoch: 1 } } }),
    deployToNode: vi.fn(async (_target: unknown, artifact: { app: string; version: string }) => ({ app: artifact.app, version: artifact.version,
      status: 'success', node: '127.0.0.2:9700', unchanged: false, ...(options.sealed ? { migrationNode: '/verified/node' } : {}) })),
    sshExec: async (_target: unknown, command: string, _timeout: unknown, stdin: string) => {
      if (command.includes('.omnitron-release.json')) return options.drift && ++checks > 1 ? 'stale' : 'verified';
      if (command.startsWith('test -f')) { preparations.push(command); return options.missing && command.includes(options.missing) ? 'no' : 'yes'; }
      if (command.includes('validated:true')) { preparations.push('config validated'); return '{"validated":true}'; }
      mutations.push(command);
      expect(command).not.toContain('private-password');
      expect(JSON.parse(stdin).DATABASE_URL).toContain('private-password');
      if (options.failure && command.includes(options.failure)) throw Error('schema refused');
      return 'applied';
    },
    registerNodeApps: vi.fn(async () => ({ changed: true })), openGatewayPath: async () => {},
    appsOnline: async () => new Set(apps), signalRemoteDaemon: vi.fn(async () => ({ ok: true, detail: '' })),
    verifyHealth: async () => ({ online: true, detail: '' }),
  });
  const run = (migrations: readonly MigrationRequest[] = [], env?: Record<string, Record<string, string>>) => service.deployToStack([target],
    apps.map(app => ({ app, version: '1', ...(options.sealed && app === 'api' ? { release: origin } : {}) })), 'project', {
      apps: apps.map(name => ({ name, script: 'dist/main.js' })), stack: 'test', migrations,
      appEnv: env ?? Object.fromEntries(apps.map(app => [app, { DATABASE_URL: `postgres://u:private-password@localhost/${app}` }])),
    });
  return { run, service, preparations, mutations };
}

it('does not discover migration files from DATABASE_URL when no owner opted in', async () => {
  const f = fixture();
  expect((await f.run()).every((result: any) => result.status === 'success')).toBe(true);
  expect(f.preparations).toEqual([]); expect(f.mutations).toEqual([]);
});
it('runs only the declared legacy owner and retains full node activation ordering', async () => {
  const f = fixture();
  expect((await f.run([legacy()])).every((result: any) => result.status === 'success')).toBe(true);
  expect(f.mutations).toHaveLength(1); expect(f.mutations[0]).toContain('/api/');
  expect(f.service.registerNodeApps).toHaveBeenCalledOnce();
});
it('prepares every declared member before running any and refuses a missing one', async () => {
  const f = fixture({ missing: '/worker/' });
  expect((await f.run([legacy(), legacy('worker')])).every((result: any) => result.status === 'failed')).toBe(true);
  expect(f.preparations).toHaveLength(2); expect(f.mutations).toEqual([]);
  expect(f.service.registerNodeApps).not.toHaveBeenCalled(); expect(f.service.signalRemoteDaemon).not.toHaveBeenCalled();
});
it('refuses wrong database and missing owners before transferring any artifact', async () => {
  const f = fixture();
  await expect(f.run([legacy()], { api: { DATABASE_URL: 'postgres://u:p@localhost/wrong' } })).rejects.toThrow('targeting api');
  await expect(f.run([legacy('missing')])).rejects.toThrow('no unique application');
  expect(f.service.deployToNode).not.toHaveBeenCalled(); expect(f.mutations).toEqual([]);
});
it('stops after a failed migration and never activates the partially prepared node', async () => {
  const f = fixture({ failure: '/api/' });
  expect((await f.run([legacy(), legacy('worker')])).every((result: any) => result.status === 'failed')).toBe(true);
  expect(f.mutations).toHaveLength(1); expect(f.service.registerNodeApps).not.toHaveBeenCalled();
});
it('requires release authority for explicit configs before transfer', async () => {
  const f = fixture();
  await expect(f.run([{ ...legacy(), mode: 'config', release: 'dist/migrations.js' }])).rejects.toThrow('verified release artifact');
  expect(f.service.deployToNode).not.toHaveBeenCalled();
});
it('rechecks sealed origin immediately before executing a config and refuses drift', async () => {
  const f = fixture({ sealed: true, drift: true });
  expect((await f.run([{ ...legacy(), mode: 'config', release: 'dist/migrations.js' }])).every((result: any) => result.status === 'failed')).toBe(true);
  expect(f.mutations).toEqual([]); expect(f.service.registerNodeApps).not.toHaveBeenCalled();
});
it('uses the public operation for a verified config and never runs an unrequested worker', async () => {
  const f = fixture({ sealed: true });
  expect((await f.run([{ ...legacy(), mode: 'config', release: 'dist/migrations.js' }])).every((result: any) => result.status === 'success')).toBe(true);
  expect(f.mutations).toHaveLength(1); expect(f.mutations[0]).toContain('executeMigrationOperation');
});
