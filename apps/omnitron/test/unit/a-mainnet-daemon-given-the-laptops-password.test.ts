/**
 * A mainnet daemon given the laptop's password.
 *
 * paysys declares its Bitcoin Core twice — a container for a laptop, a
 * hardened systemd unit for a server — with the laptop's credentials beside
 * both: `omni_regtest` / `omni_regtest_dev_password`, in git. The test stack
 * runs Bitcoin on mainnet, and three readers answered for it separately
 * (2026-09-23):
 *
 *   - nothing chose between the two blocks: a node given the service would
 *     make the container AND plan the unit;
 *   - the unit's templates were filled from the declaration's credentials,
 *     whatever network the stack ran — the one thing that stopped the
 *     laptop's password reaching mainnet was a template (`rpc_auth`) nothing
 *     produced;
 *   - the applications' environment for a service provisioned on the node
 *     read the same declaration: the regtest port and the regtest password,
 *     beside `BITCOIN_NETWORK=mainnet`.
 *
 * One answer now (`bindService`), and one rule: a declaration's credentials
 * serve the network it declares. A stack that runs another brings its own,
 * and a credential it did not bring is missing — never the laptop's.
 */

import { describe, it, expect } from 'vitest';

import { bindService, secretValues } from '../../src/infrastructure/service-binding.js';
import { selectBareMetal, planBareMetal } from '../../src/infrastructure/bare-metal-plan.js';
import { resolveServiceRequirement } from '../../src/infrastructure/service-resolver.js';
import { resolveStack, resolvedConfigToEnv } from '../../src/project/config-resolver.js';
import type { IEcosystemConfig, IStackConfig, IAppDefinition } from '../../src/config/types.js';
import type { IServiceOverride } from '../../src/infrastructure/types.js';

const LAPTOP_PASSWORD = 'omni_regtest_dev_password';

/** paysys's bitcoin, as `apps/paysys/config/default.json` declares it, cut to what matters. */
const bitcoin = {
  type: 'daemon',
  networkMode: 'regtest',
  ports: { rpc: 18443, p2p: 18444 },
  env: {
    BITCOIN_RPC_URL: 'http://${host}:${port:rpc}',
    BITCOIN_RPC_USER: '${secret:rpc_user}',
    BITCOIN_RPC_PASS: '${secret:rpc_password}',
    BITCOIN_NETWORK: '${network}',
  },
  secrets: { rpc_user: 'omni_regtest', rpc_password: LAPTOP_PASSWORD },
  docker: { image: 'btcpayserver/bitcoin:31.0', variants: { mainnet: { ports: { rpc: 8332 } } } },
  bareMetal: {
    systemdUnit: 'bitcoind',
    dataDir: '/var/lib/bitcoind',
    user: 'bitcoin',
    variants: {
      mainnet: {
        configFile: '/etc/bitcoin/bitcoin.conf',
        configTemplate: 'server=1\nrpcbind=127.0.0.1\nrpcport=${port:rpc}\nrpcauth=${secret:rpc_auth}\n',
      },
    },
  },
} as const;

/** The test stack after the switch: bitcoin on the node, on mainnet, credentials from the vault. */
const onTheNode = (secrets?: IServiceOverride['secrets']): IServiceOverride => ({
  networkMode: 'mainnet',
  provisioning: 'bareMetal',
  ports: { rpc: 8332, p2p: 8333 },
  ...(secrets ? { secrets } : {}),
});

/** What the master sends once it has resolved the vault references. */
const FROM_THE_VAULT = {
  rpc_user: 'daos',
  rpc_password: 'x7-generated-in-the-rotation',
  rpc_auth: 'daos:0123456789abcdef0123456789abcdef$feedface',
};

describe('how a stack runs a service', () => {
  it('as a container when it has a docker block and the stack says nothing', () => {
    expect(bindService(bitcoin).provisioning).toBe('docker');
  });

  it('as a system service when the stack says so, docker block or not', () => {
    expect(bindService(bitcoin, onTheNode()).provisioning).toBe('bareMetal');
  });

  it('as a system service when that is all it declares', () => {
    const { docker: _docker, ...hostOnly } = bitcoin;
    expect(bindService(hostOnly).provisioning).toBe('bareMetal');
  });

  it('not at all when the stack reaches it elsewhere', () => {
    expect(bindService(bitcoin, { external: { host: '192.168.100.2', ports: { rpc: 8332 } } }).provisioning).toBe(
      'external'
    );
  });
});

describe("a declaration's credentials serve the network it declares", () => {
  it('on that network, they are used', () => {
    expect(secretValues(bindService(bitcoin))).toEqual({ rpc_user: 'omni_regtest', rpc_password: LAPTOP_PASSWORD });
  });

  it('on another, they are not — the stack brings its own', () => {
    expect(secretValues(bindService(bitcoin, onTheNode()))).toEqual({});
    expect(secretValues(bindService(bitcoin, onTheNode(FROM_THE_VAULT)))).toEqual(FROM_THE_VAULT);
  });

  it('a reference the master did not resolve is not a value', () => {
    // Left as `{ secret: … }`, it would be written into bitcoin.conf as
    // `[object Object]`.
    expect(secretValues(bindService(bitcoin, onTheNode({ rpc_auth: { secret: 'bitcoin.mainnet.rpc_auth' } })))).toEqual(
      {}
    );
  });
});

describe('the unit a node would write', () => {
  it('is refused, not filled with the laptop password, when the stack gives none', () => {
    const spec = selectBareMetal('bitcoin', bitcoin, onTheNode())!;
    const plan = planBareMetal(spec, {
      installed: true,
      userExists: true,
      dataDirExists: true,
      unitKnown: true,
      unitActive: false,
      unitEnabled: false,
      configContent: null,
    });

    expect(plan.actions).toEqual([]);
    expect(plan.refusals.join(' ')).toContain('${secret:rpc_auth}');
    expect(plan.refusals.join(' ')).toContain('serviceOverrides.bitcoin.secrets');
    expect(JSON.stringify(spec)).not.toContain(LAPTOP_PASSWORD);
  });

  it("is filled from the vault, on the stack's port", () => {
    const spec = selectBareMetal('bitcoin', bitcoin, onTheNode(FROM_THE_VAULT))!;

    expect(spec.unresolved).toBeUndefined();
    expect(spec.configContent).toContain(`rpcauth=${FROM_THE_VAULT.rpc_auth}`);
    expect(spec.configContent).toContain('rpcport=8332');
  });

  it('is not planned at all for a service the stack runs as a container', () => {
    expect(selectBareMetal('bitcoin', bitcoin)).toBeNull();
  });
});

describe('the container a node would make', () => {
  it('is not made for a service the stack runs on the node', () => {
    expect(resolveServiceRequirement('bitcoin', bitcoin as never, onTheNode(FROM_THE_VAULT))).toBeNull();
  });

  it('is made for one the stack says nothing about', () => {
    expect(resolveServiceRequirement('bitcoin', bitcoin as never)?.image).toBe('btcpayserver/bitcoin:31.0');
  });
});

describe("the applications' environment", () => {
  const envOf = (override: IServiceOverride) => {
    const definition: IAppDefinition = {
      name: 'paysys',
      version: '1.0.0',
      processes: [{ name: 'http', module: 'apps/paysys/src/http.ts' }],
      omnitronConfig: { infrastructure: { bitcoin: bitcoin as never } },
    } as IAppDefinition;
    const config: IEcosystemConfig = { project: 'daos', apps: [{ name: 'paysys' }] } as IEcosystemConfig;
    const stack: IStackConfig = { type: 'local', apps: 'all', serviceOverrides: { bitcoin: override } } as IStackConfig;
    const resolved = resolveStack(config, 'daos', 'test', stack, new Map([['paysys', definition]]));
    return resolvedConfigToEnv(resolved.appConfigs.get('paysys')!, 'paysys', 'test');
  };

  it('reaches a system service on loopback, on the port the stack runs it on, with the vault password', () => {
    const env = envOf(onTheNode(FROM_THE_VAULT));

    expect(env['BITCOIN_RPC_URL']).toBe('http://127.0.0.1:8332');
    expect(env['BITCOIN_RPC_PASS']).toBe(FROM_THE_VAULT.rpc_password);
    expect(env['BITCOIN_NETWORK']).toBe('mainnet');
  });

  it('is given no password rather than the laptop one when the stack gives none', () => {
    const env = envOf(onTheNode());

    expect(env['BITCOIN_RPC_PASS']).toBe('');
    expect(Object.values(env)).not.toContain(LAPTOP_PASSWORD);
  });
});
