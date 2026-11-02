import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import { Public, Service } from '@omnitron-dev/titan/decorators';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { TcpTransport } from '@omnitron-dev/titan/netron/transport/tcp';
import { directLink, mintServiceToken } from '../../src/cluster/mesh-link.js';
import { SlaveConnector } from '../../src/cluster/slave-connector.js';
import { createDaemonTokenValidator } from '../../src/services/daemon-authority.js';

@Service('OmnitronDaemon@1.0.0')
class Liveness {
  pings = 0;

  @Public({ auth: { allowAnonymous: true } })
  ping() { this.pings++; return { version: 'untrusted-peer' }; }
}

// Every method is deliberately exposed, even without credentials. The controller
// must guard the boundary when a misconfigured or hostile peer does not.
@Service('OmnitronSync@1.0.0')
class OpenSync {
  reads = 0;
  drains = 0;
  released: string[] = [];

  @Public({ auth: { allowAnonymous: true } })
  getSyncStatus() { this.reads++; return { pendingItems: 777 }; }

  @Public({ auth: { allowAnonymous: true } })
  drainBuffer() {
    this.drains++;
    return { nodeId: 'another-registered-node', entries: this.released.length ? [] : [{ id: 'sample' }] };
  }

  @Public({ auth: { allowAnonymous: true } })
  ackDrained({ ids }: { ids: string[] }) { this.released.push(...ids); }
}

describe('controller authority on the TCP mesh', () => {
  const logger = createNullLogger();
  const secret = randomBytes(32).toString('hex');
  const receiveBatch = vi.fn(async () => ({ acceptedIds: ['sample'], committedIds: ['sample'], receiptVersion: 1 }));
  let host: Netron, controller: SlaveConnector, port: number, liveness: Liveness, sync: OpenSync;
  beforeEach(async () => {
    receiveBatch.mockClear();
    host = new Netron(logger);
    host.configureAuth(new AuthenticationManager(logger, {
      authenticate: async () => { throw new Error('Token required'); },
      validateToken: createDaemonTokenValidator(async token => (
        await jwtVerify(token, new TextEncoder().encode(secret), { issuer: 'omnitron', algorithms: ['HS256'] })
      ).payload, null),
    }), new AuthorizationManager(logger));
    host.registerTransport('tcp', () => new TcpTransport());
    host.registerTransportServer('tcp', { name: 'tcp', options: { host: '127.0.0.1', port: 0 } });
    await host.start();
    port = (host.transportServers.get('tcp') as { port: number }).port;
    liveness = new Liveness();
    sync = new OpenSync();
    await host.peer.exposeService(liveness);
    await host.peer.exposeService(sync);
  });
  afterEach(async () => { await controller?.dispose(); await host?.stop(); });

  async function join(token?: string) {
    controller = new SlaveConnector(logger, { receiveBatch } as never, {
      dial: async target => ({ ...await directLink(target), token }),
    });
    await controller.addSlave({ host: '127.0.0.1', port, nodeId: 'registered-node' });
    expect(await controller.waitUntilConnected('127.0.0.1', port, 2_000)).toBe(true);
  }

  it('allows public liveness but refuses unsolicited status, data, and mutations from an open daemon', async () => {
    await join();
    await expect(controller.invokeOnSlave('127.0.0.1', port, 'OmnitronDaemon', 'ping', [])).resolves.toBeTruthy();
    for (const [service, method, args] of [
      ['OmnitronSync', 'getSyncStatus', []], ['OmnitronSync', 'drainBuffer', []],
      ['OmnitronSync', 'ackDrained', [{ ids: ['sample'] }]], ['OmnitronDaemon', 'ping', ['unexpected']],
    ] as const) {
      await expect(controller.invokeOnSlave('127.0.0.1', port, service, method, [...args])).rejects.toThrow(/verified service credential/);
    }
    await expect(controller.invokeOnSlave('127.0.0.1', port, 'OmnitronDaemon', 'ping', [], { requireCredential: true }))
      .rejects.toThrow(/verified service credential/);
    expect(liveness.pings).toBeGreaterThan(1);
    expect(sync.reads).toBe(0);
    expect(sync.drains).toBe(0);
    expect(sync.released).toEqual([]);
    expect(receiveBatch).not.toHaveBeenCalled();
    expect(controller.getConnections()[0]).toMatchObject({ status: 'connected', authenticated: false, syncStatus: null,
      lastCredentialError: expect.stringContaining('SSH'), lastPullError: expect.stringContaining('verified service credential') });
  });

  it('accepts a verified service credential, stores a real pull under the registered identity, and returns its receipt', async () => {
    await join(await mintServiceToken(secret, 'controller'));
    await vi.waitFor(() => expect(sync.released).toEqual(['sample']));
    expect(receiveBatch).toHaveBeenCalledExactlyOnceWith({ nodeId: 'registered-node', entries: [{ id: 'sample' }] });
    expect(controller.getConnections()[0]).toMatchObject({ authenticated: true, credentialExpiresAt: expect.any(Number),
      syncStatus: { pendingItems: 777 }, lastPullError: null, lastCredentialError: null });
  });
});
