/**
 * A secret a stack could not give one app.
 *
 * paysys on daos/test ran on the KMS master key its source derives from a
 * fixed string, because nothing set `OMNI_KMS_MASTER_KEY` — and nothing in
 * omnitron could. `settings.env` reached a LOCAL stack's apps and was ignored
 * on a remote one without a word, took no vault reference, and would have
 * handed the key to every app; a service override's `secrets` belong to an
 * infrastructure service, and a key is not one.
 *
 * Now `settings.env` (every app) and `settings.appEnv[app]` (one app) reach
 * local and remote stacks alike, a value may be `{ "secret": "<vault key>" }`,
 * and what cannot be resolved refuses the start before anything is touched —
 * an app given an empty value where its key should be falls back to whatever
 * it does without one, and for a KMS that is the publicly known key.
 * `omnitron secret generate` makes such a key without it passing through a
 * terminal.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/node-deploy-lease.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/node-deploy-lease.js')>()),
  withNodeLeases: async (_c: unknown, _s: string, _l: unknown, deploy: (leases: unknown) => Promise<unknown>) =>
    deploy({ has: () => true, confirm: async () => {}, unreachable: new Map() }),
}));
vi.mock('../../src/services/master-address.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/master-address.js')>()),
  resolveMasterHost: async () => ({ host: '10.0.0.1', source: 'given' }),
}));

import { resolveStackEnv } from '../../src/project/stack-env.js';
import { ProjectService } from '../../src/services/project.service.js';
import { SecretsRpcService } from '../../src/services/secrets.rpc-service.js';

const KEY = 'daos.test.kms_master_key';
const VALUE = 'k3Y-MUST-NOT-LEAK-INTO-ANY-MESSAGE=';
const vaultOf = (entries: Record<string, string>) => async (key: string) => entries[key] ?? null;

describe('the environment a stack gives its apps', () => {
  it('gives every app `env` and one app its `appEnv`, which wins, with vault references resolved', async () => {
    const reads: string[] = [];
    const env = await resolveStackEnv({
      settings: {
        env: { LOG_FORMAT: 'json', SHARED_TOKEN: { secret: 'shared' } },
        appEnv: { paysys: { OMNI_KMS_MASTER_KEY: { secret: KEY }, LOG_FORMAT: 'pretty' } },
      },
      apps: ['main', 'paysys'],
      getSecret: async (key) => {
        reads.push(key);
        return { shared: 'S', [KEY]: VALUE }[key] ?? null;
      },
      where: 'daos/test',
    });

    expect(env).toEqual({
      main: { LOG_FORMAT: 'json', SHARED_TOKEN: 'S' },
      paysys: { LOG_FORMAT: 'pretty', SHARED_TOKEN: 'S', OMNI_KMS_MASTER_KEY: VALUE },
    });
    expect(reads.sort()).toEqual([KEY, 'shared']);
  });

  it('refuses a key the vault does not hold — or holds empty — naming it and who asked, never a value', async () => {
    for (const held of [{}, { [KEY]: '' }]) {
      const refused = await resolveStackEnv({
        settings: { env: { OTHER: { secret: 'other' } }, appEnv: { paysys: { OMNI_KMS_MASTER_KEY: { secret: KEY } } } },
        apps: ['main', 'paysys'],
        getSecret: vaultOf({ other: VALUE, ...held }),
        where: 'daos/test',
      }).catch((err: Error) => err);

      expect(refused).toBeInstanceOf(Error);
      expect((refused as Error).message).toMatch(
        /daos\/test: the vault holds no 'daos\.test\.kms_master_key' \(named by settings\.appEnv\.paysys\.OMNI_KMS_MASTER_KEY\)/,
      );
      expect((refused as Error).message).toMatch(/omnitron secret generate/);
      expect((refused as Error).message).not.toContain(VALUE);
    }
  });

  it('refuses an `appEnv` for an app the stack does not run — a misspelt name would read as configured', async () => {
    await expect(
      resolveStackEnv({
        settings: { appEnv: { paysy: { OMNI_KMS_MASTER_KEY: { secret: KEY } } } },
        apps: ['main', 'paysys'],
        getSecret: vaultOf({ [KEY]: VALUE }),
        where: 'daos/test',
      }),
    ).rejects.toThrow(/settings\.appEnv names 'paysy', which this stack does not run \(it runs main, paysys\)/);
  });

  it('refuses a name that is not a variable, and a value that is neither a string nor a reference', async () => {
    const base = { apps: ['main'], getSecret: vaultOf({}), where: 'daos/test' };
    await expect(resolveStackEnv({ ...base, settings: { env: { 'NOT-A-NAME': 'x' } } })).rejects.toThrow(/not an environment variable name/);
    await expect(resolveStackEnv({ ...base, settings: { env: { X: { secret: '' } } } })).rejects.toThrow(
      /settings\.env\.X is neither a string nor/,
    );
    await expect(resolveStackEnv({ ...base, settings: { env: { X: 42 as never } } })).rejects.toThrow(/neither a string nor/);
  });

  it('refuses references on a daemon with no vault, and needs none for written values', async () => {
    await expect(
      resolveStackEnv({ settings: { env: { X: { secret: KEY } } }, apps: ['main'], getSecret: undefined, where: 'daos/test' }),
    ).rejects.toThrow(/this daemon has no vault/);
    expect(await resolveStackEnv({ settings: { env: { X: 'y' } }, apps: ['main'], getSecret: undefined, where: 'd/t' })).toEqual({
      main: { X: 'y' },
    });
    expect(await resolveStackEnv({ settings: undefined, apps: ['main'], getSecret: undefined, where: 'd/t' })).toEqual({});
  });
});

describe('a remote stack', () => {
  const NODE = { host: '10.0.0.9', port: 9700 };
  const ECOSYSTEM = {
    apps: [
      { name: 'main', script: 'apps/main/dist/main.js' },
      { name: 'paysys', script: 'apps/paysys/dist/main.js' },
    ],
  } as never;
  const RELEASE = {
    id: 'daos-202609232000-00000000',
    files: ['main', 'paysys'].map((app) => ({ app, version: '0.0.1', path: `/nowhere/${app}.tgz`, bytes: 1, inputs: 'i', sha256: 's' })),
    manifest: { builtAt: '2026-09-23T20:00:00Z' },
    staticsDir: null,
  } as never;

  function deployment(vault: Record<string, string>) {
    const quiet: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child: () => quiet };
    const stateStore: any = { save() {}, load: () => null, get: () => null, set() {} };
    const svc: any = new ProjectService(quiet, { list: () => [], listHandleNames: () => [] } as never, stateStore, {
      secrets: { get: async (key: string) => vault[key] ?? null } as never,
    });
    const provisioned: string[] = [];
    let given: Record<string, Record<string, string>> | undefined;
    svc.registry = { get: () => ({ name: 'daos', path: '/nowhere' }), list: () => [] };
    svc.collectDeclaredServices = async () => ({});
    svc.targetForStackNode = async () => ({ host: NODE.host, username: 'deploy' });
    svc.getSlaveConnector = () => ({ addSlave: async () => {}, waitUntilConnected: async () => true, removeSlave: async () => {} });
    svc.provisionNodeInfrastructure = async () => ({ ready: true, detail: 'healthy' });
    // The node's generated credentials have a court of their own.
    svc.readNodeCredentials = async () => ({});
    // What the master computes for the node: connections, no secrets of the stack's own.
    svc.resolveNodeAppEnv = async () => ({ main: { DATABASE_URL: 'postgres://…/main' }, paysys: { DATABASE_URL: 'postgres://…/paysys' } });
    svc.deployer = {
      onProgress: () => () => {},
      leaseRunner: () => ({}),
      provisionSlaveNode: async () => {
        provisioned.push(NODE.host);
        return true;
      },
      deployToStack: async (_t: unknown, artifacts: Array<{ app: string }>, _p: string, options: { appEnv?: typeof given }) => {
        given = options.appEnv;
        return artifacts.map((a) => ({ app: a.app, status: 'success', node: `${NODE.host}:${NODE.port}` }));
      },
    };
    const stack = {
      type: 'remote',
      apps: ['main', 'paysys'],
      nodes: [NODE],
      settings: { env: { LOG_FORMAT: 'json' }, appEnv: { paysys: { OMNI_KMS_MASTER_KEY: { secret: KEY } } } },
    } as never;
    return { start: () => svc.startRemoteStack('daos', 'test', stack, ECOSYSTEM, RELEASE), provisioned, given: () => given };
  }

  it('gives the key to paysys alone, over what the master computed for the node', async () => {
    const d = deployment({ [KEY]: VALUE });
    const outcome = await d.start().catch((err: Error) => err);
    if (outcome instanceof Error) throw outcome;

    expect(d.given()).toMatchObject({
      paysys: { DATABASE_URL: 'postgres://…/paysys', LOG_FORMAT: 'json', OMNI_KMS_MASTER_KEY: VALUE },
      main: { DATABASE_URL: 'postgres://…/main', LOG_FORMAT: 'json' },
    });
    expect(d.given()!['main']).not.toHaveProperty('OMNI_KMS_MASTER_KEY');
  });

  it('is refused before any node is touched when the vault does not hold the key', async () => {
    const d = deployment({});
    await expect(d.start()).rejects.toThrow(/the vault holds no 'daos\.test\.kms_master_key'/);
    expect(d.provisioned).toEqual([]);
    expect(d.given()).toBeUndefined();
  });
});

describe('a local stack', () => {
  it('starts its apps with the stack\'s env, the app\'s own over the shared', () => {
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      registry: { get: () => ({ name: 'daos', path: '/p' }) },
      infraManager: { getPortAllocation: () => null, getNormalizedServices: () => null },
    });
    const build = svc.stackEntryBuilder('daos', 'dev', { type: 'local', apps: 'all' }, { apps: [] }, new Map(), {
      paysys: { LOG_FORMAT: 'json', OMNI_KMS_MASTER_KEY: VALUE },
    });

    const entry = build({ name: 'paysys', script: 'x', env: { LOG_FORMAT: 'pretty', OWN: '1' } });

    expect(entry.env).toMatchObject({ OWN: '1', LOG_FORMAT: 'json', OMNI_KMS_MASTER_KEY: VALUE });
    expect(build({ name: 'main', script: 'x' }).env).not.toHaveProperty('OMNI_KMS_MASTER_KEY');
  });
});

describe('`secret generate`', () => {
  function rpc(held: Record<string, string> = {}) {
    const store = new Map(Object.entries(held));
    const record = vi.fn(async () => undefined);
    const service = new SecretsRpcService(
      { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => void store.set(k, v) } as never,
      { record } as never,
    );
    return { service, store, record };
  }

  it('keeps random bytes of the asked length and answers with the name only', async () => {
    const { service, store, record } = rpc();

    const answer = await service.generate({ key: KEY, bytes: 32, encoding: 'base64' });

    expect(answer).toEqual({ key: KEY, bytes: 32, encoding: 'base64' });
    expect(Buffer.from(store.get(KEY)!, 'base64')).toHaveLength(32);
    expect(JSON.stringify(record.mock.calls)).not.toContain(store.get(KEY)!);
    expect(record).toHaveBeenCalledWith({
      action: 'secret.generate',
      resourceType: 'secret',
      resourceId: KEY,
      details: { bytes: 32, encoding: 'base64' },
    });

    const second = await rpc().service.generate({ key: KEY });
    expect(second).toEqual({ key: KEY, bytes: 32, encoding: 'base64' });
  });

  it('refuses a key the vault already holds, and bounds it asks for nothing sensible', async () => {
    const { service, store } = rpc({ [KEY]: 'somebody-else' });
    await expect(service.generate({ key: KEY })).rejects.toThrow(/already holds 'daos\.test\.kms_master_key' — nothing was generated/);
    expect(store.get(KEY)).toBe('somebody-else');
    await expect(rpc().service.generate({ key: 'k', bytes: 8 })).rejects.toThrow(/from 16 to 1024/);
    await expect(rpc().service.generate({ key: 'k', encoding: 'utf8' as never })).rejects.toThrow(/base64, base64url or hex/);
  });
});
