import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { AuthenticationManager, AuthenticationUnavailableError } from '../../../src/netron/auth/authentication-manager.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket/index.js';
import { Service, Public } from '../../../src/decorators/core.js';
import type { RemotePeer } from '../../../src/netron/remote-peer.js';
import { createMockLogger } from '../test-utils.js';
import { getFreePort } from '../../utils/index.js';

const scope = new AsyncLocalStorage<AuthContext>();
@Service('AuthorityProbe@1.0.0')
class Probe {
  writtenBy = '';
  @Public({ auth: true, readonly: true }) readonlyValue = 'sealed';
  @Public({ auth: true }) get scopedValue() { return scope.getStore()?.userId ?? 'missing'; }
  set scopedValue(_value: string) { this.writtenBy = scope.getStore()?.userId ?? 'missing'; }
  @Public({ auth: { roles: ['admin'] } }) async privileged() { return scope.getStore()?.userId; }
  @Public({ auth: true }) async currentRole() { return scope.getStore()?.roles; }
}

describe('persistent transport live authority', () => {
  let server: Netron, client: Netron, peer: RemotePeer, service: Probe;
  let role: string, active: boolean, unavailable: boolean, definitionId: string;
  beforeEach(async () => {
    role = 'admin'; active = true; unavailable = false;
    const logger = createMockLogger();
    server = new Netron(logger, { id: 'authority-server' });
    server.configureAuth(new AuthenticationManager(logger, {
      authenticate: async () => { throw new Error('token required'); },
      validateToken: async () => {
        if (unavailable) throw new AuthenticationUnavailableError();
        if (!active) throw new Error('revoked');
        return { userId: 'alice', roles: [role], permissions: [] };
      },
      tokenCache: { enabled: false },
    }));
    const port = await getFreePort('127.0.0.1');
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: {
      host: '127.0.0.1', port,
      invocationWrapper: (metadata, fn) => scope.run(metadata.get('authContext') as AuthContext, fn),
    } });
    await server.start();
    service = new Probe();
    await server.peer.exposeService(service);
    client = new Netron(createMockLogger(), { id: 'authority-client' });
    client.registerTransport('ws', () => new WebSocketTransport());
    peer = await client.connect(`ws://127.0.0.1:${port}`) as RemotePeer;
    expect((await peer.runTask('authenticate', { token: 'private-token' }) as { success: boolean }).success).toBe(true);
    const definition = (server as any).services.get('AuthorityProbe@1.0.0').definition;
    (peer as any).definitions.set(definition.id, definition);
    definitionId = definition.id;
  });
  afterEach(async () => { await client?.stop(); await server?.stop(); });

  it('applies demotion and revocation to the next call without reconnecting', async () => {
    expect(await peer.call(definitionId, 'privileged', [])).toBe('alice');
    role = 'reader';
    await expect(peer.call(definitionId, 'privileged', [])).rejects.toMatchObject({ code: 403 });
    expect(await peer.call(definitionId, 'currentRole', [])).toEqual(['reader']);
    active = false;
    await expect(peer.call(definitionId, 'currentRole', [])).rejects.toMatchObject({ code: 401 });
    await expect(peer.runTask('query_interface', 'AuthorityProbe@1.0.0')).rejects.toMatchObject({ code: 401 });
  });

  it('preserves unavailability as 503 and recovers without losing the session', async () => {
    unavailable = true;
    await expect(peer.call(definitionId, 'privileged', [])).rejects.toMatchObject({ code: 503 });
    unavailable = false;
    expect(await peer.call(definitionId, 'privileged', [])).toBe('alice');
  });

  it('runs property reads and writes within the checked identity frame', async () => {
    expect(await peer.get(definitionId, 'scopedValue')).toBe('alice');
    await peer.set(definitionId, 'scopedValue', 'value');
    expect(service.writtenBy).toBe('alice');
    active = false;
    await expect(peer.get(definitionId, 'scopedValue')).rejects.toMatchObject({ code: 401 });
    await expect(peer.set(definitionId, 'scopedValue', 'value')).rejects.toMatchObject({ code: 401 });
  });

  it('cannot replace a published method or a read-only property through SET', async () => {
    await expect(peer.set(definitionId, 'readonlyValue', 'changed')).rejects.toMatchObject({ code: 403 });
    await expect(peer.set(definitionId, 'privileged', null)).rejects.toMatchObject({ code: 403 });
    expect(service.readonlyValue).toBe('sealed');
    expect(await peer.call(definitionId, 'privileged', [])).toBe('alice');
  });
});
