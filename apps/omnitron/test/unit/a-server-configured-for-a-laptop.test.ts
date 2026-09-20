/**
 * A server was told its chains were on the laptop that deployed it.
 *
 * `serviceOverrides` is where a stack says that bitcoin and monero are not
 * containers here: they are daemons already running on the node, on mainnet,
 * at an address only this stack knows. `resolveNodeAppEnv` built the
 * environment for the deployed apps and left that block out, so every app
 * was configured from the defaults its own declaration carries — which are
 * the ones that are right on a developer's machine.
 *
 * Measured on the test node, from the config the master had just written to
 * it, beside a `serviceOverrides` naming 192.168.100.2 and mainnet for both
 * chains:
 *
 *     "BITCOIN_RPC_URL":  "http://localhost:18443"
 *     "BITCOIN_RPC_USER": "omni_regtest"
 *     "BITCOIN_RPC_PASS": "omni_regtest_dev_password"
 *     "BITCOIN_NETWORK":  "regtest"
 *     "MONERO_DAEMON_URL": "http://localhost:38081"
 *     "MONERO_RPC_PASS":  "omni_stagenet_dev_password"
 *
 * Nothing listens on those ports on that machine, so the failure was going to
 * be a connection refused rather than a wrong payment — but only by accident,
 * and only until a stack overrode the address and not the network.
 *
 * Which is the second half. `networkMode` reached `docker.variants` and
 * nothing else, so an app pointed at an external MAINNET daemon still read
 * `BITCOIN_NETWORK=regtest` from the template in its own declaration. An
 * application that believes it is on regtest while talking to mainnet gets
 * address validation, confirmation depth and fee policy wrong, and each of
 * those is somebody's money.
 *
 * The third half is the credentials: an override names them
 * (`{ "secret": "monero.mainnet.rpc_password" }`) rather than carrying them,
 * and the resolver that turns a name into a value had no caller at all — so
 * the placeholder `<secret:monero.mainnet.rpc_password>` was handed to the
 * application as its password.
 */

import { describe, it, expect } from 'vitest';

import {
  resolveCustomServiceEnv,
  resolveSecretRefs,
} from '../../src/project/config-resolver.js';
import { ProjectService } from '../../src/services/project.service.js';

const bitcoin = {
  type: 'daemon',
  networkMode: 'regtest',
  ports: { rpc: 18443 },
  env: {
    BITCOIN_RPC_URL: 'http://${host}:${port:rpc}',
    BITCOIN_RPC_USER: '${secret:rpc_user}',
    BITCOIN_NETWORK: '${network}',
  },
  secrets: { rpc_user: 'omni_regtest' },
} as never;

describe('the network is the stack\'s answer, not the declaration\'s', () => {
  it('uses the network the stack selected', () => {
    const env = resolveCustomServiceEnv(
      bitcoin,
      { host: '192.168.100.2', ports: { rpc: 8332 }, secrets: { rpc_user: 'daos' } },
      'mainnet',
    );

    expect(env['BITCOIN_NETWORK']).toBe('mainnet');
    expect(env['BITCOIN_RPC_URL']).toBe('http://192.168.100.2:8332');
    expect(env['BITCOIN_RPC_USER']).toBe('daos');
  });

  it('falls back to what the application declared', () => {
    // A laptop stack overrides nothing, and regtest is the right answer
    // there. Nothing about this changes for a stack that never had an
    // opinion.
    const env = resolveCustomServiceEnv(bitcoin, {
      host: 'localhost',
      ports: { rpc: 18443 },
      secrets: { rpc_user: 'omni_regtest' },
    });

    expect(env['BITCOIN_NETWORK']).toBe('regtest');
  });

  it('leaves a template that never mentions the network alone', () => {
    const env = resolveCustomServiceEnv(
      { ...(bitcoin as object), env: { BITCOIN_NETWORK: 'regtest' } } as never,
      { host: 'h', ports: { rpc: 1 } },
      'mainnet',
    );

    // Not rewritten behind the author's back: a literal is a literal.
    expect(env['BITCOIN_NETWORK']).toBe('regtest');
  });
});

describe('an override names its credentials; the app needs their values', () => {
  const logger = (() => {
    const errors: Array<Record<string, unknown>> = [];
    const warns: Array<Record<string, unknown>> = [];
    const l: Record<string, unknown> = {
      info() {}, debug() {}, trace() {}, fatal() {},
      warn(o: Record<string, unknown>) { warns.push(o); },
      error(o: Record<string, unknown>) { errors.push(o); },
      child() { return l; },
    };
    return { l, errors, warns };
  })();

  const overrides = {
    'monero-daemon': {
      networkMode: 'mainnet',
      external: {
        host: '192.168.100.2',
        ports: { rpc: 28082 },
        secrets: {
          rpc_user: { secret: 'monero.mainnet.rpc_user' },
          rpc_password: { secret: 'monero.mainnet.rpc_password' },
        },
      },
    },
  } as never;

  const vault = new Map([
    ['monero.mainnet.rpc_user', 'daos'],
    ['monero.mainnet.rpc_password', 'the-real-one'],
  ]);

  const service = (secrets?: { get(key: string): Promise<string | null> }) => {
    const orchestrator = { list: () => [], listHandleNames: () => [] } as never;
    const stateStore = { save() {}, load: () => null, get: () => null, set() {} } as never;
    return new ProjectService(
      logger.l as never,
      orchestrator,
      stateStore,
      undefined,
      undefined,
      secrets as never,
    ) as unknown as {
      resolveOverrideSecrets(project: string, o: unknown): Promise<Record<string, never>>;
    };
  };

  it('resolves every reference to the value the vault holds', async () => {
    const svc = service({ get: async (k: string) => vault.get(k) ?? null });
    const out = (await svc.resolveOverrideSecrets('daos', overrides)) as never as Record<
      string,
      { external: { secrets: Record<string, string>; host: string; ports: Record<string, number> } }
    >;

    expect(out['monero-daemon']!.external.secrets).toEqual({
      rpc_user: 'daos',
      rpc_password: 'the-real-one',
    });
  });

  it('leaves everything that is not a reference exactly as written', async () => {
    const svc = service({ get: async (k: string) => vault.get(k) ?? null });
    const out = (await svc.resolveOverrideSecrets('daos', overrides)) as never as Record<
      string,
      { networkMode: string; external: { host: string; ports: Record<string, number> } }
    >;

    expect(out['monero-daemon']!.networkMode).toBe('mainnet');
    expect(out['monero-daemon']!.external.host).toBe('192.168.100.2');
    expect(out['monero-daemon']!.external.ports).toEqual({ rpc: 28082 });
  });

  it('names a key the vault does not hold', async () => {
    // It resolves to an empty string, which the application reports as an
    // authentication failure against a credential it was never given. The
    // log has to carry the key, or nobody can tell those two apart.
    logger.errors.length = 0;
    const svc = service({ get: async () => null });

    await svc.resolveOverrideSecrets('daos', overrides);

    const said = logger.errors.find((e) => Array.isArray(e['missing']));
    expect(said, 'the missing keys are reported').toBeTruthy();
    expect(said!['missing']).toEqual([
      'monero.mainnet.rpc_user',
      'monero.mainnet.rpc_password',
    ]);
  });

  it('says so when there is no vault at all rather than passing placeholders quietly', async () => {
    logger.warns.length = 0;
    const svc = service(undefined);

    const out = await svc.resolveOverrideSecrets('daos', overrides);

    expect(logger.warns.some((w) => Array.isArray(w['services']))).toBe(true);
    // Unchanged, not half-resolved.
    expect(out).toBe(overrides as never);
  });

  it('does nothing when a stack overrides nothing', async () => {
    const svc = service({ get: async () => null });

    expect(await svc.resolveOverrideSecrets('daos', undefined as never)).toBeUndefined();
    expect(await svc.resolveOverrideSecrets('daos', {} as never)).toEqual({});
  });
});

describe('the resolver that had no caller', () => {
  it('walks a nested config and inlines every reference', async () => {
    const out = await resolveSecretRefs(
      {
        a: { secret: 'k1' },
        nested: { deeper: { b: { secret: 'k2' }, plain: 'kept' } },
        list: ['untouched'],
      },
      async (k) => (k === 'k1' ? 'v1' : 'v2'),
    );

    expect(out).toEqual({
      a: 'v1',
      nested: { deeper: { b: 'v2', plain: 'kept' } },
      list: ['untouched'],
    });
  });

  it('prefers a declared default over an empty string', async () => {
    const out = await resolveSecretRefs({ a: { secret: 'missing', default: 'fallback' } }, async () => null);

    expect(out['a']).toBe('fallback');
  });
});
