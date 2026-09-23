/**
 * A host that could be read only by deploying to it.
 *
 * `provisionStack` observes, plans and applies a node's host services in one
 * call, and nothing asked for the first two alone. The test node runs
 * mainnet chains and takes SSH by password only, the password staying in the
 * vault — so what a deployment would do there (write a unit? restart a node
 * mid-sync? refuse?) could be learnt only by doing it. `inspectHost` reads
 * and plans, and never writes; nothing it returns is a file's content.
 */

import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';

import {
  inspectHost,
  digestAuthorization,
  jsonRpcCall,
  probeFields,
  fileState,
  redactArgv,
  type InspectionDeps,
  type RpcAuth,
} from '../../src/infrastructure/host-inspection.js';
import { OMNITRON_CONFIG_MARKER } from '../../src/infrastructure/bare-metal-plan.js';
import type { CommandResult, HostRunner } from '../../src/infrastructure/bare-metal-runner.js';

const RPCAUTH =
  'daos:0123456789abcdef0123456789abcdef$90ff3ce205bece1c447b777562931b92721a1956552484506bf368ee0278bcd3';

/** A host that answers from tables, and records anything that would change it. */
function fakeHost(answers: Record<string, string | null>, files: Record<string, string> = {}, dirs: string[] = []) {
  const writes: string[] = [];
  const ok = (stdout: string): CommandResult => ({ ok: true, stdout, stderr: '' });
  const no: CommandResult = { ok: false, stdout: '', stderr: 'no' };
  const host: HostRunner = {
    run: async (argv) => {
      const answer = answers[argv.join(' ')];
      return answer === undefined || answer === null ? no : ok(answer);
    },
    shell: async (command) => {
      const answer = answers[command];
      return answer === undefined || answer === null ? no : ok(answer);
    },
    readFile: async (path) => files[path] ?? null,
    writeFile: async (path) => void writes.push(path),
    exists: async (path) => path in files || dirs.includes(path),
    rename: async (from, to) => void writes.push(`${from} → ${to}`),
  };
  return { host, writes };
}

const interfaces = (): NodeJS.Dict<NetworkInterfaceInfo[]> => ({
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as NetworkInterfaceInfo],
  eth0: [{ address: '37.27.130.185', family: 'IPv4', internal: false } as NetworkInterfaceInfo],
  br0: [
    { address: '192.168.100.2', family: 'IPv4', internal: false, mac: 'aa:bb:cc:dd:ee:ff' } as NetworkInterfaceInfo,
  ],
});

/** monerod as paysys declares it: a health check authenticating as the laptop. */
const monerod = {
  networkMode: 'stagenet',
  ports: { rpc: 38081 },
  env: {},
  secrets: { rpc_user: 'omni_stagenet', rpc_password: 'omni_stagenet_dev_password' },
  healthCheck: {
    type: 'jsonrpc',
    target: 'get_info',
    jsonrpc: {
      port: 'rpc',
      method: 'get_info',
      auth: { user: 'omni_stagenet', password: 'omni_stagenet_dev_password', type: 'digest' },
      report: ['nettype', 'height', 'target_height', 'synchronized'],
    },
  },
} as never;

const bitcoin = {
  networkMode: 'regtest',
  ports: { rpc: 18443 },
  env: {},
  secrets: { rpc_user: 'omni_regtest', rpc_password: 'omni_regtest_dev_password' },
  docker: { image: 'btcpayserver/bitcoin:31.0' },
  bareMetal: {
    systemdUnit: 'bitcoind',
    user: 'bitcoin',
    dataDir: '/var/lib/bitcoind',
    validateCommand: 'bitcoin-cli --version',
    variants: {
      mainnet: {
        configFile: '/etc/bitcoin/bitcoin.conf',
        configTemplate: 'rpcport=${port:rpc}\nrpcauth=${secret:rpc_auth}\n',
      },
    },
  },
} as never;

const deps = (host: HostRunner, calls: Array<{ url: string; auth: RpcAuth | null }> = []): InspectionDeps => ({
  host,
  interfaces,
  reach: async (h, port) => h === '192.168.100.2' && port === 28082,
  jsonRpc: async (url, method, auth) => {
    calls.push({ url, auth });
    return {
      method,
      ok: true,
      result: { height: 3_512_345, target_height: 3_512_345, synchronized: true, nettype: 'mainnet' },
    };
  },
});

describe('a service the stack reaches elsewhere', () => {
  it("says whether the address is this node's own, whether it answers, and how far the chain is", async () => {
    const calls: Array<{ url: string; auth: RpcAuth | null }> = [];
    const reading = await inspectHost(
      {
        services: { 'monero-daemon': monerod },
        overrides: {
          'monero-daemon': {
            networkMode: 'mainnet',
            external: {
              host: '192.168.100.2',
              ports: { rpc: 28082 },
              secrets: { rpc_user: 'daos', rpc_password: 'from-the-vault' },
            },
          },
        },
      },
      deps(fakeHost({}).host, calls)
    );

    const external = reading.services[0]!.external!;
    expect(external).toMatchObject({ host: '192.168.100.2', port: 28082, local: true, reachable: true });
    expect(external.probe?.result).toMatchObject({ synchronized: true, nettype: 'mainnet' });
    expect(external.probe?.report).toEqual(['nettype', 'height', 'target_height', 'synchronized']);
    // As the stack's credentials, not the laptop's the declaration's check names.
    expect(calls).toEqual([
      {
        url: 'http://192.168.100.2:28082/json_rpc',
        auth: { type: 'digest', user: 'daos', password: 'from-the-vault' },
      },
    ]);
  });

  it('asks nothing of one that does not answer', async () => {
    const calls: Array<{ url: string; auth: RpcAuth | null }> = [];
    const reading = await inspectHost(
      {
        services: { bitcoin },
        overrides: { bitcoin: { networkMode: 'mainnet', external: { host: '192.168.100.2', ports: { rpc: 8332 } } } },
      },
      deps(fakeHost({}).host, calls)
    );

    expect(reading.services[0]!.external).toMatchObject({ local: true, reachable: false });
    expect(calls).toEqual([]);
  });
});

describe('a service the stack runs on the node', () => {
  const host = fakeHost(
    {
      'bitcoin-cli --version': 'Bitcoin Core RPC client version v29.0.0',
      'id -u bitcoin': '998',
      'systemctl show bitcoind -p LoadState -p ActiveState -p UnitFileState':
        'LoadState=not-found\nActiveState=inactive\nUnitFileState=',
      'stat -c %U:%G /var/lib/bitcoind': 'root:root',
      'df -B1 --output=target,size,avail /var/lib/bitcoind': 'Mounted on 1B-blocks Avail\n/ 1966000000000 812000000000',
    },
    { '/etc/bitcoin/bitcoin.conf': 'rpcpassword=hunter2\n' },
    ['/var/lib/bitcoind']
  );
  const override = {
    networkMode: 'mainnet',
    provisioning: 'bareMetal' as const,
    ports: { rpc: 8332 },
    secrets: { rpc_user: 'daos', rpc_password: 'from-the-vault', rpc_auth: RPCAUTH },
  };

  it('says what is there, whose it is, the room around it, and what a deployment would do — without doing it', async () => {
    const reading = await inspectHost({ services: { bitcoin }, overrides: { bitcoin: override } }, deps(host.host));
    const onHost = reading.services[0]!.onHost!;

    expect(onHost).toMatchObject({
      installed: true,
      userExists: true,
      dataDir: {
        path: '/var/lib/bitcoind',
        exists: true,
        owner: 'root:root',
        disk: { mount: '/', availBytes: 812_000_000_000 },
      },
      unit: { name: 'bitcoind', known: false },
      config: 'not-managed',
    });
    expect(onHost.refusals.join(' ')).toContain('was not written by omnitron');
    expect(host.writes).toEqual([]);
  });

  it('returns no file content and no credential', async () => {
    const reading = await inspectHost({ services: { bitcoin }, overrides: { bitcoin: override } }, deps(host.host));
    const said = JSON.stringify(reading);

    for (const secret of ['hunter2', 'from-the-vault', RPCAUTH, 'rpcauth=']) expect(said).not.toContain(secret);
    // An interface's hardware address is not an answer anyone asked for.
    expect(said).not.toContain('aa:bb:cc');
  });
});

describe('a service the stack runs on the node, asked how far it is', () => {
  // As paysys declares it for mainnet: its container's check is `bitcoin-cli
  // -regtest`; on the node it is asked over JSON-RPC with the cookie the
  // daemon writes beside `rpcauth`.
  const COOKIE_SECRET = 'c0'.repeat(32);
  const onNode = (file = '.cookie') =>
    ({
      networkMode: 'regtest',
      ports: { rpc: 18443 },
      env: {},
      healthCheck: { type: 'command', target: 'bitcoin-cli -regtest getblockchaininfo' },
      bareMetal: {
        systemdUnit: 'bitcoind',
        dataDir: '/var/lib/bitcoind',
        variants: {
          mainnet: {
            ports: { rpc: 8332 },
            healthCheck: {
              type: 'jsonrpc',
              target: 'getblockchaininfo',
              jsonrpc: {
                port: 'rpc',
                method: 'getblockchaininfo',
                path: '',
                auth: { type: 'cookie', file },
                report: ['chain', 'blocks', 'headers', 'initialblockdownload'],
              },
            },
          },
        },
      },
    }) as never;
  const stack = { bitcoin: { networkMode: 'mainnet', provisioning: 'bareMetal' as const } };
  const asked = (listening: boolean, files: Record<string, string>) => {
    const calls: Array<{ url: string; auth: RpcAuth | null }> = [];
    return {
      calls,
      deps: {
        host: fakeHost({}, files).host,
        interfaces,
        reach: async (h: string, port: number) => listening && h === '127.0.0.1' && port === 8332,
        jsonRpc: async (url: string, method: string, auth: RpcAuth | null) => {
          calls.push({ url, auth });
          return {
            method,
            ok: true,
            result: { chain: 'main', blocks: 915_402, headers: 915_402, initialblockdownload: false },
          };
        },
      } satisfies InspectionDeps,
    };
  };

  it('on loopback, with its cookie, which no reading carries', async () => {
    const { deps: d, calls } = asked(true, { '/var/lib/bitcoind/.cookie': `__cookie__:${COOKIE_SECRET}\n` });
    const reading = await inspectHost({ services: { bitcoin: onNode() }, overrides: stack }, d);

    expect(reading.services[0]!.onHost!.probe).toMatchObject({
      method: 'getblockchaininfo',
      ok: true,
      result: { chain: 'main', blocks: 915_402 },
      report: ['chain', 'blocks', 'headers', 'initialblockdownload'],
    });
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:8332', auth: { type: 'basic', user: '__cookie__', password: COOKIE_SECRET } },
    ]);
    expect(JSON.stringify(reading)).not.toContain(COOKIE_SECRET);
  });

  it('says the daemon is not running when it has written no cookie, and asks nothing', async () => {
    const { deps: d, calls } = asked(true, {});
    const reading = await inspectHost({ services: { bitcoin: onNode() }, overrides: stack }, d);

    expect(reading.services[0]!.onHost!.probe?.error).toBe(
      'no /var/lib/bitcoind/.cookie — the daemon writes it while it runs'
    );
    expect(calls).toEqual([]);
  });

  it('says nothing listens rather than read a cookie for nobody', async () => {
    const { deps: d, calls } = asked(false, { '/var/lib/bitcoind/.cookie': `__cookie__:${COOKIE_SECRET}` });
    const reading = await inspectHost({ services: { bitcoin: onNode() }, overrides: stack }, d);

    expect(reading.services[0]!.onHost!.probe?.error).toBe('nothing listens on 127.0.0.1:8332');
    expect(calls).toEqual([]);
  });

  it('reads a cookie only from inside the data directory', async () => {
    const { deps: d, calls } = asked(true, { '/etc/shadow': 'root:x' });
    const reading = await inspectHost({ services: { bitcoin: onNode('../../../etc/shadow') }, overrides: stack }, d);

    expect(reading.services[0]!.onHost!.probe?.error).toContain('inside the data directory');
    expect(calls).toEqual([]);
  });
});

describe("the host's memory", () => {
  it('is what the kernel says can be taken without swapping, not what is free', async () => {
    const meminfo =
      'MemTotal:       65756092 kB\nMemFree:          812344 kB\nMemAvailable:   40123456 kB\n' +
      'Buffers:          102400 kB\nCached:         38000000 kB\nSwapTotal:       8388604 kB\nSwapFree:        8388000 kB\n';
    const reading = await inspectHost({ services: {} }, deps(fakeHost({}, { '/proc/meminfo': meminfo }).host));

    expect(reading.memory).toEqual({
      totalBytes: 65_756_092 * 1024,
      availableBytes: 40_123_456 * 1024,
      swapTotalBytes: 8_388_604 * 1024,
      swapFreeBytes: 8_388_000 * 1024,
    });
  });

  it('is unknown, not zero, where there is no /proc/meminfo', async () => {
    expect((await inspectHost({ services: {} }, deps(fakeHost({}).host))).memory).toBeNull();
  });
});

describe('host facts for a decision the declaration does not cover', () => {
  const host = fakeHost(
    {
      'systemctl show monero-walletd -p LoadState -p ActiveState -p SubState -p Result -p UnitFileState -p FragmentPath -p ExecStart -p MainPID -p NRestarts -p ActiveEnterTimestamp -p ControlGroup':
        'LoadState=loaded\nActiveState=active\nUnitFileState=enabled\nFragmentPath=/etc/systemd/system/monero-walletd.service\n' +
        'ExecStart={ path=/usr/local/bin/monero-wallet-rpc ; argv[]=/usr/local/bin/monero-wallet-rpc --rpc-login daos:walletpw --daemon-login daos:daemonpw ; ignore_errors=no }',
      'systemctl show bitcoin -p LoadState -p ActiveState -p SubState -p Result -p UnitFileState -p FragmentPath -p ExecStart -p MainPID -p NRestarts -p ActiveEnterTimestamp -p ControlGroup':
        'LoadState=loaded\nActiveState=inactive\nSubState=dead\nResult=success\nUnitFileState=disabled\n' +
        'MainPID=0\nNRestarts=0\nActiveEnterTimestamp=\nControlGroup=\nFragmentPath=/etc/systemd/system/bitcoin.service\n' +
        'ExecStart={ path=/snap/bin/bitcoin-core.daemon ; argv[]=/snap/bin/bitcoin-core.daemon -datadir=/srv/btc -rpcpassword=hunter2 ; ignore_errors=no }',
      'snap list bitcoin-core':
        'Name          Version  Rev  Tracking       Publisher   Notes\nbitcoin-core  28.1     170  latest/stable  bitcoin-core  -',
      'du -sb /srv/btc': '138900000000\t/srv/btc',
      'stat -c %U:%G /srv/btc': 'root:root',
      'df -B1 --output=target,size,avail /srv/btc': 'Mounted on 1B-blocks Avail\n/srv 1966000000000 812000000000',
    },
    { '/srv/btc/bitcoin.conf': 'prune=0\ntxindex=0\nprune=100000\nrpcpassword=hunter2\n' },
    ['/srv/btc']
  );

  it('prints no password a unit passes after a space', async () => {
    const reading = await inspectHost({ services: {}, units: ['monero-walletd'] }, deps(host.host));

    expect(JSON.stringify(reading)).not.toMatch(/walletpw|daemonpw/);
    expect(reading.units[0]!.execStart).toBe('/usr/local/bin/monero-wallet-rpc --rpc-login … --daemon-login …');
  });

  it('reads a unit a person wrote, the password on its command line struck out', async () => {
    const reading = await inspectHost({ services: {}, units: ['bitcoin'] }, deps(host.host));

    expect(reading.units[0]).toEqual({
      unit: 'bitcoin',
      known: true,
      active: false,
      enabled: false,
      state: 'inactive (dead)',
      result: 'success',
      mainPid: null,
      restarts: 0,
      since: null,
      cgroup: null,
      fragmentPath: '/etc/systemd/system/bitcoin.service',
      execStart: '/snap/bin/bitcoin-core.daemon -datadir=/srv/btc -rpcpassword=…',
      jobs: [],
      journal: [],
      processes: [],
    });
  });

  it('says where a unit is in systemd’s words, what it waits on, what it last said, and whose its processes are', async () => {
    // The test node's bitcoind read «inactive» while its chain advanced, and
    // its start was cut at 120 s with no reason (2026-09-23).
    const node = fakeHost(
      {
        [`systemctl show bitcoind -p LoadState -p ActiveState -p SubState -p Result -p UnitFileState -p FragmentPath -p ExecStart -p MainPID -p NRestarts -p ActiveEnterTimestamp -p ControlGroup`]:
          'LoadState=loaded\nActiveState=activating\nSubState=start\nResult=success\nUnitFileState=enabled\n' +
          'MainPID=4242\nNRestarts=0\nActiveEnterTimestamp=\nControlGroup=/system.slice/bitcoind.service\n' +
          'FragmentPath=/etc/systemd/system/bitcoind.service\n' +
          'ExecStart={ path=/usr/local/bin/bitcoind ; argv[]=/usr/local/bin/bitcoind -conf=/etc/bitcoin/bitcoin.conf -datadir=/var/lib/bitcoind ; ignore_errors=no }',
        'systemctl list-jobs --no-legend --no-pager':
          '8812 bitcoind.service                       start waiting\n' +
          '8811 network-online.target                  start waiting\n' +
          '8810 systemd-networkd-wait-online.service   start running\n',
        'journalctl -u bitcoind -n 30 --no-pager -o short-iso':
          '2026-09-23T16:49:20+0000 node systemd[1]: Starting bitcoind.service...\n' +
          '2026-09-23T16:49:21+0000 node bitcoind[4242]: Command-line arg: rpcpassword=hunter2\n',
        'pgrep -x bitcoind': '4242\n4343\n',
      },
      {
        '/proc/4242/cgroup': '0::/system.slice/bitcoind.service\n',
        '/proc/4343/cgroup': '0::/user.slice/user-0.slice/session-7.scope\n',
      }
    );
    const reading = await inspectHost({ services: {}, units: ['bitcoind'] }, deps(node.host));
    const unit = reading.units[0]!;

    expect(unit).toMatchObject({
      state: 'activating (start)',
      mainPid: 4242,
      restarts: 0,
      cgroup: '/system.slice/bitcoind.service',
    });
    expect(unit.jobs).toEqual([
      '8812 bitcoind.service                       start waiting',
      '8811 network-online.target                  start waiting',
      '8810 systemd-networkd-wait-online.service   start running',
    ]);
    expect(unit.journal[1]).toContain('rpcpassword=…');
    expect(unit.processes).toEqual([
      { pid: 4242, cgroup: '/system.slice/bitcoind.service', inUnit: true },
      { pid: 4343, cgroup: '/user.slice/user-0.slice/session-7.scope', inUnit: false },
    ]);
    expect(JSON.stringify(reading)).not.toContain('hunter2');
    expect(node.writes).toEqual([]);
  });

  it('measures a chain directory, reads a snap and the keys asked of a config — and refuses a credential key', async () => {
    const reading = await inspectHost(
      {
        services: {},
        paths: ['/srv/btc'],
        snaps: ['bitcoin-core'],
        configKeys: [{ path: '/srv/btc/bitcoin.conf', keys: ['prune', 'txindex', 'rpcpassword'] }],
      },
      deps(host.host)
    );

    expect(reading.paths[0]).toMatchObject({ exists: true, owner: 'root:root', sizeBytes: 138_900_000_000 });
    expect(reading.snaps[0]).toEqual({ name: 'bitcoin-core', installed: true, version: '28.1', revision: '170' });
    // The last assignment, as bitcoind reads its file.
    expect(reading.configKeys[0]).toEqual({
      path: '/srv/btc/bitcoin.conf',
      exists: true,
      values: { prune: '100000', txindex: '0' },
      refused: ['rpcpassword'],
    });
    expect(JSON.stringify(reading)).not.toContain('hunter2');
  });
});

describe('the pieces', () => {
  it('answers a digest challenge as RFC 2617 does', () => {
    const header = digestAuthorization(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
      { type: 'digest', user: 'Mufasa', password: 'Circle Of Life' },
      'GET',
      '/dir/index.html',
      '0a4f113b'
    );
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
  });

  it('prints the fields a declaration reads its answer by, in its order, and counts the rest', () => {
    // monerod's get_info as it comes: the fields the probe was sent for are
    // not among the first twelve.
    const result = Object.fromEntries([
      ...'abcdefghijklmn'.split('').map((letter) => [`${letter}_field`, 1] as const),
      ['height', 3_768_823],
      ['nettype', 'mainnet'],
      ['synchronized', true],
    ]);
    const reading = { method: 'get_info', ok: true, result };

    expect(probeFields({ ...reading, report: ['nettype', 'height', 'synchronized', 'target_height'] })).toEqual({
      fields: [
        ['nettype', 'mainnet'],
        ['height', 3_768_823],
        ['synchronized', true],
        ['target_height', undefined],
      ],
      more: 14,
    });
    expect(probeFields(reading).fields).toHaveLength(12);
    expect(probeFields(reading).more).toBe(5);
  });

  it('tells a file it wrote from one a person wrote, and a match from a difference', () => {
    expect(fileState(undefined, 'x')).toBe('not-declared');
    expect(fileState('a=1', null)).toBe('absent');
    expect(fileState('a=1', 'a=1')).toBe('not-managed');
    expect(fileState('a=1', `${OMNITRON_CONFIG_MARKER}\na=1\n`)).toBe('matches');
    expect(fileState('a=1', `${OMNITRON_CONFIG_MARKER}\na=2`)).toBe('differs');
  });

  it('strikes out a credential passed after a space, as monero-walletd takes its logins', () => {
    // The first `infra inspect` of the test node printed this unit's
    // mainnet RPC password: only `flag=value` was struck out.
    expect(
      redactArgv(
        '/usr/local/bin/monero-wallet-rpc --rpc-login daos:pw1 --daemon-login daos:pw2 --wallet-dir /var/lib/monero'
      )
    ).toBe('/usr/local/bin/monero-wallet-rpc --rpc-login … --daemon-login … --wallet-dir /var/lib/monero');
    // A flag with no value after it takes nothing with it.
    expect(redactArgv('monerod --rpc-login --non-interactive')).toBe('monerod --rpc-login --non-interactive');
  });

  it('strikes out every credential-shaped flag and keeps the rest', () => {
    expect(redactArgv('monerod --rpc-login=daos:pw --data-dir=/x --rpcauth=u:s$h')).toBe(
      'monerod --rpc-login=… --data-dir=/x --rpcauth=…'
    );
  });
});

/**
 * A JSON-RPC server that authenticates as monerod does (measured against the
 * dev stack's, 2026-09-23): two challenges, MD5 then MD5-sess, in two
 * headers — and the nonce belongs to the connection that was challenged.
 */
async function monerodLike(user: string, password: string) {
  const md5 = (text: string) => createHash('md5').update(text).digest('hex');
  const nonces = new WeakMap<Socket, string>();
  const server = createServer((req, res) => {
    req.resume();
    const nonce = nonces.get(req.socket);
    const answer = Object.fromEntries(
      [...(req.headers.authorization ?? '').matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]*))/g)].map(([, k, q, b]) => [
        k,
        q ?? b,
      ])
    );
    const ha1 = md5(`${user}:monero-rpc:${password}`);
    const expected = md5(`${ha1}:${nonce}:${answer['nc']}:${answer['cnonce']}:auth:${md5(`POST:${req.url}`)}`);
    if (nonce !== undefined && answer['nonce'] === nonce && answer['response'] === expected) {
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 'inspect', result: { height: 3_500_000, synchronized: true } }));
      return;
    }
    const fresh = randomBytes(16).toString('base64');
    nonces.set(req.socket, fresh);
    res.statusCode = 401;
    res.setHeader('www-authenticate', [
      `Digest qop="auth",algorithm=MD5,realm="monero-rpc",nonce="${fresh}",stale=false`,
      `Digest qop="auth",algorithm=MD5-sess,realm="monero-rpc",nonce="${fresh}",stale=false`,
    ]);
    res.end('<html><body><h1>401 Unauthorized</h1></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/json_rpc`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

describe("a health check that speaks monerod's digest", () => {
  it('answers the challenge on the connection that was challenged', async () => {
    const monerod = await monerodLike('daos', 'pw');
    try {
      expect(await jsonRpcCall(monerod.url, 'get_info', { type: 'digest', user: 'daos', password: 'pw' })).toEqual({
        method: 'get_info',
        ok: true,
        result: { height: 3_500_000, synchronized: true },
      });
    } finally {
      monerod.close();
    }
  });

  it('reads a wrong password as the refusal it is', async () => {
    const monerod = await monerodLike('daos', 'pw');
    try {
      expect(await jsonRpcCall(monerod.url, 'get_info', { type: 'digest', user: 'daos', password: 'pv' })).toEqual({
        method: 'get_info',
        ok: false,
        error: 'HTTP 401',
      });
    } finally {
      monerod.close();
    }
  });
});
