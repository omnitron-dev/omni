/**
 * Every CLI call read as `system`.
 *
 * The daemon admits a connection on its owner-only unix socket as
 * `omnitron-local` (`setTransportAuthContext('unix', …)`), and the RPC guard
 * enforces roles against exactly that. But the services learn who is calling
 * from an AsyncLocalStorage, and the only thing that fills it is the
 * transport's `invocationWrapper` — which the HTTP and WebSocket servers were
 * given and the unix server was not. So the guard saw `omnitron-local`, the
 * service saw nobody, and `AuditService` wrote `system`.
 *
 * Measured on the master 2026-09-23 (the trail up to 09:16:35Z): 171 of 178
 * audit rows `actorId NULL`, `actorType system` — the seven others were the
 * console's. Of 79 `stack.start` rows, 44 were the daemon's own boot
 * autostarts and 28 an operator's deployments; 27 of the 28 read `system`
 * exactly as the 44 did, and the one the console made read as its user.
 *
 * Driven for real here: the unix server config is the one
 * `OmnitronDaemon.registerTransports` registers, served by a real Netron on a
 * real socket, and called by the CLI's own `DaemonClient`.
 */

import 'reflect-metadata';

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Netron } from '@omnitron-dev/titan/netron';
import { Service, Public } from '@omnitron-dev/titan/decorators';

import { OmnitronDaemon } from '../../src/daemon/daemon.js';
import { createDaemonClient } from '../../src/daemon/daemon-client.js';
import { AuditService, currentActor } from '../../src/services/audit.service.js';

const logger: Record<string, unknown> = {};
for (const level of ['info', 'warn', 'error', 'debug', 'trace', 'fatal']) logger[level] = () => {};
logger['child'] = () => logger;
logger['isLevelEnabled'] = () => false;

/** What the daemon registers for its unix socket — asked of `registerTransports` itself. */
async function theDaemonsUnixServer(): Promise<{ options: Record<string, unknown>; implicit: unknown }> {
  const servers = new Map<string, { name: string; options: Record<string, unknown> }>();
  const implicit = new Map<string, unknown>();
  // One object answers every token `registerTransports` resolves: the logger
  // module, the JWT service and the session store. None is called here.
  const deps = { logger, verify: async () => ({}), validateToken: async () => null };
  const daemon: any = Object.create(OmnitronDaemon.prototype);
  daemon.app = {
    netron: {
      registerTransport: () => {},
      registerTransportServer: (name: string, config: { name: string; options: Record<string, unknown> }) =>
        servers.set(name, config),
      setTransportAuthContext: (name: string, context: unknown) => implicit.set(name, context),
      configureAuth: () => {},
    },
    container: { resolveAsync: async () => deps },
  };
  await daemon.registerTransports({ socketPath: '/nonexistent/daemon.sock', port: 9700, httpPort: 9800, role: 'master' });

  const unix = servers.get('unix');
  expect(unix, 'the daemon registers a unix server').toBeTruthy();
  return { options: unix!.options, implicit: implicit.get('unix') };
}

const inserted: Array<Record<string, unknown>> = [];
const audit = new AuditService(
  logger as never,
  {
    insertInto: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { execute: async () => {} };
      },
    }),
  } as never,
);

/** `DaemonClient` asks for this one first, as it does of the real daemon. */
@Service({ name: 'OmnitronDaemon' })
class DaemonStub {
  @Public()
  async ping(): Promise<string> {
    return 'pong';
  }
}

/** A service method that writes a row, the way `stopStack` or `secret.get` does. */
@Service({ name: 'AuditProbe' })
class AuditProbe {
  @Public()
  async act(): Promise<{ actorId: string | null; actorType: string }> {
    await audit.record({ action: 'stack.stop', resourceType: 'stack', resourceId: 'daos/test' });
    return currentActor();
  }
}

const open: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of open.splice(0).reverse()) await close().catch(() => {});
  inserted.length = 0;
});

/** A daemon-shaped server on a fresh socket, and the CLI's client connected to it. */
async function serve(options: Record<string, unknown>, implicit: unknown | null) {
  const socketPath = path.join(os.tmpdir(), `omx-audit-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`);
  const server = new Netron(logger as never, { id: 'daemon-under-test' });
  server.registerTransportServer('unix', { name: 'daemon-local', options: { ...options, path: socketPath } });
  if (implicit) server.setTransportAuthContext('unix', implicit as never);
  await server.start();
  await server.peer.exposeService(new DaemonStub());
  await server.peer.exposeService(new AuditProbe());
  open.push(async () => {
    await server.stop();
    fs.rmSync(socketPath, { force: true });
  });

  const client = createDaemonClient(socketPath);
  open.push(() => client.disconnect());
  return client.service<{ act(): Promise<{ actorId: string | null; actorType: string }> }>('AuditProbe');
}

describe('a call over the unix socket is the local operator', () => {
  it('is recorded as the context the daemon admitted it with, not as `system`', async () => {
    const unix = await theDaemonsUnixServer();
    expect(unix.implicit, 'the socket is admitted as omnitron-local').toMatchObject({ userId: 'omnitron-local' });

    const probe = await serve(unix.options, unix.implicit);
    const actor = await probe.act();

    expect(actor).toEqual({ actorId: 'omnitron-local', actorType: 'user' });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ actorId: 'omnitron-local', actorType: 'user', ipAddress: null });
  }, 30_000);

  it('invents nobody for a connection the transport did not admit as anyone — the control', async () => {
    // The wrapper carries the context the connection HAS. A server with no
    // implicit context for the socket still records `system`, so the answer
    // above comes from the admission and not from the wrapper.
    const unix = await theDaemonsUnixServer();

    const probe = await serve(unix.options, null);
    const actor = await probe.act();

    expect(actor).toEqual({ actorId: null, actorType: 'system' });
    expect(inserted[0]).toMatchObject({ actorId: null, actorType: 'system' });
  }, 30_000);

  it('leaves what the daemon does on its own as `system`', async () => {
    // A boot autostart runs outside any call: no transport, no context.
    await audit.record({ action: 'stack.start', resourceType: 'stack', resourceId: 'daos/dev', details: { source: 'boot' } });
    expect(inserted[0]).toMatchObject({ actorId: null, actorType: 'system' });
  });
});

describe('`system` can be asked for', () => {
  function recordingDb() {
    const wheres: unknown[][] = [];
    const q: Record<string, unknown> = {
      selectAll: () => q,
      orderBy: () => q,
      limit: () => q,
      where: (...args: unknown[]) => {
        wheres.push(args);
        return q;
      },
      execute: async () => [],
    };
    return { wheres, db: { selectFrom: () => q } };
  }

  it('filters by the kind of actor the ACTOR column prints', async () => {
    const { wheres, db } = recordingDb();
    await new AuditService(logger as never, db as never).list({ actorType: 'system' });
    expect(wheres).toContainEqual(['actorType', '=', 'system']);
  });

  it('still filters by an id — the control', async () => {
    const { wheres, db } = recordingDb();
    await new AuditService(logger as never, db as never).list({ actorId: 'omnitron-local' });
    expect(wheres).toEqual([['actorId', '=', 'omnitron-local']]);
  });
});
