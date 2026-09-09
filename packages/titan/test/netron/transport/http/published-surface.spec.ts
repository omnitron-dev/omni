/**
 * Only what a service DECLARES is on the wire.
 *
 * The HTTP transport registered every prototype method whose name did
 * not start with `_`, under a filter comment reading "Skip private
 * methods". TypeScript's `private` leaves no runtime marker, so every
 * private helper on an `@Service` class was registered and callable.
 *
 * Verified against a live deployment before this was fixed: an
 * unauthenticated HTTP request reached a payments backend's
 * `recordAdminEvent` (appending to its admin audit chain) and
 * `resyncRegistry`, and a marketplace backend's
 * `requireProductPermission` ran a database query for an anonymous
 * caller. Helpers like those carry no auth checks precisely because
 * their callers do the checking — which is the whole reason they must
 * not be reachable.
 *
 * `RemotePeer.enforceMethodAccess` (NET-14) has rejected undeclared
 * methods on WS/TCP/Unix since it was written. This pins the same rule
 * for HTTP, which is the transport that sits behind a public gateway.
 *
 * Two things count as a declaration: `@Public` (what `meta.methods` is
 * built from) and an entry in a `@Contract`, which names the method
 * along with its schemas.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { Netron } from '../../../../src/netron/netron.js';
import { HttpTransport } from '../../../../src/netron/transport/http/http-transport.js';
import { Service, Public } from '../../../../src/decorators/core.js';
import { Contract } from '../../../../src/decorators/validation.js';
import { contract } from '../../../../src/validation/index.js';
import { createMockLogger } from '../../test-utils.js';
import { nextTestPort } from '../../../utils/index.js';

const getWorkerSafePort = () => nextTestPort();

const EchoContract = contract({
  byContract: { input: z.object({ v: z.number() }), output: z.number() },
});

@Service('surface@1.0.0')
@Contract(EchoContract)
class SurfaceService {
  @Public()
  declared(): string {
    return 'declared';
  }

  byContract(input: { v: number }): number {
    return input.v * 2;
  }

  /** A private helper of exactly the shape that was reachable. */
  private secretHelper(): string {
    return 'should never be reachable';
  }

  /** Undecorated and not in the contract: an implementation detail. */
  undeclaredPublicMethod(): string {
    return 'should never be reachable either';
  }
}

describe('the HTTP published surface', () => {
  let server: Netron;
  let url: string;

  beforeAll(async () => {
    const port = getWorkerSafePort();
    url = `http://localhost:${port}`;
    server = new Netron(createMockLogger(), { id: 'surface-server' });
    server.registerTransport('http', () => new HttpTransport());
    server.registerTransportServer('http', { name: 'http', options: { host: 'localhost', port } });
    await server.start();
    await server.peer.exposeService(new SurfaceService());
  });

  afterAll(async () => {
    await server?.stop();
  });

  async function invoke(method: string, input: unknown = {}) {
    const res = await fetch(`${url}/netron/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID(), service: 'surface@1.0.0', method, input }),
    });
    return res.json() as Promise<{ success: boolean; data?: unknown; error?: { message: string } }>;
  }

  it('exposes an @Public method', async () => {
    const r = await invoke('declared');
    expect(r.success).toBe(true);
    expect(r.data).toBe('declared');
  });

  it('exposes a method a @Contract declares, even without @Public', async () => {
    const r = await invoke('byContract', { v: 21 });
    expect(r.success).toBe(true);
    expect(r.data).toBe(42);
  });

  it('does NOT expose a private helper', async () => {
    const r = await invoke('secretHelper');
    expect(r.success).toBe(false);
    expect(r.error!.message).toMatch(/not found/i);
  });

  it('does NOT expose an undecorated method that is not in the contract', async () => {
    const r = await invoke('undeclaredPublicMethod');
    expect(r.success).toBe(false);
    expect(r.error!.message).toMatch(/not found/i);
  });

  it('does not leak inherited Object members either', async () => {
    for (const name of ['toString', 'hasOwnProperty', 'constructor', 'valueOf']) {
      const r = await invoke(name);
      expect(r.success, `${name} must not be callable`).toBe(false);
    }
  });
});
