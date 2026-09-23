/**
 * A network's ports that nothing read.
 *
 * paysys declares Bitcoin's ports per network — testnet 18332/18333,
 * mainnet 8332/8333 — and monerod's for mainnet (18081/18080), in its docker
 * variants, and nothing read them (2026-09-23). A stack running Bitcoin on
 * mainnet in a container would have published, addressed and health-checked
 * regtest's 18443 while the daemon listened on 8332; the test stack, running
 * it on the node, had to repeat 8332 in its own override. The ports of the
 * network the stack runs now come from the variant of the block it
 * provisions by (`bindService`), and the stack still has the last word.
 */

import { describe, it, expect } from 'vitest';

import { bindService } from '../../src/infrastructure/service-binding.js';
import { selectBareMetal } from '../../src/infrastructure/bare-metal-plan.js';
import { resolveServiceRequirement } from '../../src/infrastructure/service-resolver.js';
import { resolveStack, resolvedConfigToEnv } from '../../src/project/config-resolver.js';
import type { IEcosystemConfig, IStackConfig, IAppDefinition } from '../../src/config/types.js';
import type { IServiceOverride } from '../../src/infrastructure/types.js';

/** paysys's bitcoin, cut to its ports: regtest by declaration, each network's in its variants. */
const bitcoin = {
  type: 'daemon',
  networkMode: 'regtest',
  ports: { rpc: 18443, p2p: 18444 },
  env: { BITCOIN_RPC_URL: 'http://${host}:${port:rpc}' },
  healthCheck: {
    type: 'jsonrpc',
    target: 'getblockchaininfo',
    jsonrpc: { port: 'rpc', method: 'getblockchaininfo', path: '' },
  },
  docker: { image: 'btcpayserver/bitcoin:31.0', variants: { mainnet: { ports: { rpc: 8332, p2p: 8333 } } } },
  bareMetal: {
    systemdUnit: 'bitcoind',
    dataDir: '/var/lib/bitcoind',
    variants: {
      mainnet: { ports: { rpc: 8332, p2p: 8333 }, configTemplate: 'rpcport=${port:rpc}\nport=${port:p2p}\n' },
    },
  },
} as const;

const envOf = (override: IServiceOverride) => {
  const definition = {
    name: 'paysys',
    version: '1.0.0',
    processes: [{ name: 'http', module: 'apps/paysys/src/http.ts' }],
    omnitronConfig: { infrastructure: { bitcoin: bitcoin as never } },
  } as IAppDefinition;
  const config = { project: 'daos', apps: [{ name: 'paysys' }] } as IEcosystemConfig;
  const stack = { type: 'local', apps: 'all', serviceOverrides: { bitcoin: override } } as IStackConfig;
  const resolved = resolveStack(config, 'daos', 'test', stack, new Map([['paysys', definition]]));
  return resolvedConfigToEnv(resolved.appConfigs.get('paysys')!, 'paysys', 'test');
};

describe("a stack on mainnet gets mainnet's ports", () => {
  it('in a container: listening, published, reached and health-checked on them', () => {
    const container = resolveServiceRequirement('bitcoin', bitcoin as never, { networkMode: 'mainnet' })!;

    expect(container.ports).toEqual([
      { host: 8332, container: 8332, bindHost: '127.0.0.1' },
      { host: 8333, container: 8333, bindHost: '127.0.0.1' },
    ]);
    expect(container.healthCheck?.test.join(' ')).toContain('localhost:8332');
    expect(envOf({ networkMode: 'mainnet' })['BITCOIN_RPC_URL']).toBe('http://127.0.0.1:8332');
  });

  it('on the node: its unit configured, and its applications pointed, without the stack repeating them', () => {
    const onTheNode: IServiceOverride = { networkMode: 'mainnet', provisioning: 'bareMetal' };

    expect(selectBareMetal('bitcoin', bitcoin, onTheNode)?.configContent).toBe('rpcport=8332\nport=8333\n');
    expect(envOf(onTheNode)['BITCOIN_RPC_URL']).toBe('http://127.0.0.1:8332');
  });
});

describe('what stays as it was', () => {
  it('the declared network keeps the declaration’s ports', () => {
    expect(bindService(bitcoin).ports).toEqual({ rpc: 18443, p2p: 18444 });
  });

  it('the stack has the last word', () => {
    expect(bindService(bitcoin, { networkMode: 'mainnet', ports: { rpc: 18555 } }).ports).toEqual({
      rpc: 18555,
      p2p: 8333,
    });
  });

  it('an address elsewhere is the stack’s alone', () => {
    const elsewhere = { networkMode: 'mainnet', external: { host: '192.168.100.2', ports: { rpc: 9332 } } };
    expect(bindService(bitcoin, elsewhere).ports).toEqual({ rpc: 9332 });
  });
});
