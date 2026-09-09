/**
 * NET-14b — property GET/SET outside the published surface.
 *
 * NET-14 whitelisted method CALLs against `meta.methods` and deliberately left
 * property access alone, because `ServiceMetadata.properties` is assembled by
 * calling `new target()` at decoration time — which throws for every service
 * whose constructor takes arguments, i.e. every DI service — so a whitelist
 * built from it would have rejected annotated properties too.
 *
 * Leaving them open was the larger hole, not the smaller one:
 *
 *   ServiceStub.get(prop) -> this.instance[prop]
 *   ServiceStub.set(prop, v) -> Reflect.set(this.instance, prop, v)
 *
 * an arbitrary read and an arbitrary write against the live service object. A
 * private field carries no `@Public`, so the decorator step enforces nothing,
 * and the ACL step is default-allow when no ACL is registered. `resolveDefId`
 * accepts a SERVICE NAME, so no discovery is needed either. And what comes back
 * is the raw value — `processResult` only wraps `@Service` instances, so a
 * secret or a config object serialises straight onto the wire.
 *
 * The surface is now decided from the PROTOTYPE annotation, which `@Public`
 * writes for properties and methods alike and which needs no instance.
 *
 * This suite uses a service whose constructor takes an argument, so
 * `meta.properties` really is empty — the exact condition NET-14b cited.
 *
 * Measured on a running daos stand (messaging, Netron WS on 3006), where the
 * two halves are NOT equally exposed and the difference is worth knowing:
 *
 *   - READ is bounded by the serializer, not by any check. `get('container')`
 *     and `get('visibility')` came back "Not supported: object" — msgpack has
 *     no codec for an arbitrary class instance. What does cross is what msgpack
 *     can encode: `get('_svc')` returned its value, and in this suite
 *     `get('config')` returns the whole POJO. So a plain secret or a config
 *     object leaks; a service handle does not.
 *   - WRITE has no such accident protecting it. `set('visibility', null)` was
 *     ACCEPTED against the live process, nulling the tier-visibility service
 *     that room listings filter through. Any authenticated account could do it,
 *     addressing the service by the name `query_interface` hands out.
 *
 * A serializer that happens to refuse a shape is not an access control, and it
 * protected only one direction.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { Service, Public } from '../../../src/decorators/core.js';
import { createMockLogger } from '../test-utils.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket/index.js';
import type { RemotePeer } from '../../../src/netron/remote-peer.js';
import type { AuthCredentials } from '../../../src/netron/auth/types.js';
import { getFreePort } from '../../utils/index.js';

@Service('vault@1.0.0')
class VaultService {
  /** Annotated, and therefore published. */
  @Public({ readonly: true })
  public label = 'vault-label';

  /** No annotation: an ordinary field of the implementation. */
  public jwtSecret: string;

  /** No annotation: an object field, which serialises whole. */
  public config = { dbUrl: 'postgres://user:pw@host/db', pepper: 'PEPPER' };

  /** A gate the implementation reads. Writable => defeatable. */
  public enforcing = true;

  constructor(deps: { secret: string }) {
    // Dereferencing an injected dependency is what makes `new target()` throw
    // during decoration — the condition every DI service is in, and the one
    // that empties `meta.properties`. A constructor that merely TAKES an
    // argument does not reproduce it: `new target()` passes `undefined` and
    // succeeds, which is how the first draft of this suite fooled itself.
    this.jwtSecret = deps.secret;
  }

  @Public({ auth: true })
  async open(): Promise<string> {
    return this.enforcing ? 'refused' : 'opened';
  }
}

const netrons: Netron[] = [];

async function boot(): Promise<{ server: Netron; port: number }> {
  const port = await getFreePort();
  const logger = createMockLogger();
  const server = new Netron(logger, { id: `net14b-server-${port}` });

  // Authentication only, no ACL — so the decorator surface is the sole control,
  // which is the posture the daos backends actually run.
  const authn = new AuthenticationManager(logger, {
    authenticate: async (creds: AuthCredentials) => {
      if (creds.username === 'user' && creds.password === 'pw') {
        return { userId: 'u-user', username: 'user', roles: ['user'], permissions: [] };
      }
      throw new Error('Invalid credentials');
    },
    validateToken: async (token: string) => JSON.parse(Buffer.from(token, 'base64').toString()),
  });
  (server as any).authenticationManager = authn;

  server.registerTransport('ws', () => new WebSocketTransport());
  server.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port } });
  await server.start();
  await server.peer.exposeService(new VaultService({ secret: 'THE-SIGNING-SECRET' }));
  netrons.push(server);
  return { server, port };
}

async function connectAuthed(server: Netron, port: number): Promise<{ peer: RemotePeer; defId: string }> {
  const client = new Netron(createMockLogger(), { id: `net14b-client-${port}-${Math.random()}` });
  client.registerTransport('ws', () => new WebSocketTransport());
  netrons.push(client);
  const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
  await peer.runTask('authenticate', { username: 'user', password: 'pw' });

  const stub: any = (server as any).services.get('vault@1.0.0');
  if (!stub) throw new Error('vault@1.0.0 stub not registered');
  (peer as any).definitions.set(stub.definition.id, stub.definition);
  return { peer, defId: stub.definition.id };
}

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
  for (const n of netrons.splice(0)) await n.stop().catch(() => {});
  await new Promise((r) => setTimeout(r, 100));
});

describe('the condition NET-14b cited', () => {
  it('leaves meta.properties empty while methods are still extracted', async () => {
    const { server } = await boot();
    const stub: any = (server as any).services.get('vault@1.0.0');

    // This is why the whitelist reads the prototype annotation rather than
    // this map. Measured on the real daos backends, which show exactly this
    // shape — RoomService methods=16 properties=[], EncryptionService
    // methods=11 properties=[], SpaceService methods=22 properties=[].
    expect(Object.keys(stub.definition.meta.properties ?? {})).toEqual([]);
    expect(Object.keys(stub.definition.meta.methods ?? {}).length).toBeGreaterThan(0);
  });
});

describe('property GET over the persistent wire', () => {
  it('refuses a field that carries no @Public', async () => {
    const { server, port } = await boot();
    const { peer, defId } = await connectAuthed(server, port);

    await expect(peer.get(defId, 'jwtSecret')).rejects.toThrow();
  });

  it('refuses an object field, which would serialise whole', async () => {
    const { server, port } = await boot();
    const { peer, defId } = await connectAuthed(server, port);

    await expect(peer.get(defId, 'config')).rejects.toThrow();
  });

  it('still serves a property that IS annotated', async () => {
    const { server, port } = await boot();
    const { peer, defId } = await connectAuthed(server, port);

    expect(await peer.get(defId, 'label')).toBe('vault-label');
  });

  it('answers a real unpublished field and a made-up one the same way', async () => {
    const { server, port } = await boot();
    const { peer, defId } = await connectAuthed(server, port);

    // The two messages differ only by the name the CALLER supplied, so they
    // are not comparable strings — what must match is the outcome. A field
    // that exists but is not published must be indistinguishable from one
    // that does not exist.
    const real = await peer.get(defId, 'jwtSecret').catch((e: any) => e.code ?? e.constructor.name);
    const absent = await peer.get(defId, 'nothingNamedThis').catch((e: any) => e.code ?? e.constructor.name);
    expect(real).toBe(absent);
  });
});

describe('property SET over the persistent wire', () => {
  it('refuses to write a field that carries no @Public, and the field is unchanged', async () => {
    const { server, port } = await boot();
    const { peer, defId } = await connectAuthed(server, port);
    const instance: any = (server as any).services.get('vault@1.0.0').instance;

    await expect(peer.set(defId, 'jwtSecret', 'ATTACKER-CHOSEN')).rejects.toThrow();
    expect(instance.jwtSecret).toBe('THE-SIGNING-SECRET');
  });

  it('cannot switch off a gate the implementation reads', async () => {
    const { server, port } = await boot();
    const { peer, defId } = await connectAuthed(server, port);
    const instance: any = (server as any).services.get('vault@1.0.0').instance;

    await expect(peer.set(defId, 'enforcing', false)).rejects.toThrow();
    expect(instance.enforcing).toBe(true);
    expect(await peer.call(defId, 'open', [])).toBe('refused');
  });
});
