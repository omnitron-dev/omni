/**
 * A refusal said twice, once as an error.
 *
 * When a core task answers a peer «no» — the service it asked for is not
 * there, it may not have it, it is over its subscription limit — the answer
 * is a 4xx and it goes back to the caller. The peer that ran the task then
 * logged the same event at ERROR as «Failed to run task», beside the task's
 * own warn that already said why.
 *
 * Measured on the master 2026-09-23: 36 of 36 «Failed to run task» were
 * `query_interface` 404s for priceverse's `CollectorWorker`, each paired with
 * «query_interface: service not found in registry», all within four seconds
 * of a daemon start — the server process asks before its sibling registers,
 * and asks again on use. `omnitron doctor` counted 270 in a day, half of all
 * the errors it saw, and called it «a loop that cannot make progress».
 *
 * Two halves hold this:
 *   - the peer logs a refusal at debug and keeps ERROR for a task that FAILED;
 *   - every refusal a core task makes writes its own reason at warn, so
 *     lowering the peer's line hides nothing. Two of the refusal sites
 *     (`_guard.ts`, `subscribe.ts`) threw without a word before this; for
 *     them the peer's ERROR was the only record, and would have become none.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { RemotePeer } from '../../src/netron/remote-peer.js';
import { Errors, TitanError, ErrorCode } from '../../src/errors/index.js';
import { Packet, TYPE_TASK } from '../../src/netron/packet/index.js';
import { query_interface } from '../../src/netron/core-tasks/query-interface.js';
import { enforceRemoteExposureAllowed, enforceOwnership } from '../../src/netron/core-tasks/_guard.js';
import { subscribe } from '../../src/netron/core-tasks/subscribe.js';
import { NETRON_EVENT_SERVICE_EXPOSE } from '../../src/netron/constants.js';

type Line = { level: string; msg: string };

const recordingLogger = () => {
  const lines: Line[] = [];
  const record = (level: string) => (a: unknown, b?: unknown) =>
    lines.push({ level, msg: String((b ?? (typeof a === 'string' ? a : '')) as string) });
  const logger: Record<string, unknown> = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
  };
  logger['child'] = () => logger;
  return { logger: logger as never, lines };
};

/** A peer whose task ends in `taskError`, with a reply that goes out fine. */
const peerRunning = (taskError: unknown) => {
  const { logger, lines } = recordingLogger();
  const netron = { logger, runTask: vi.fn().mockRejectedValue(taskError), options: {} };
  const socket = { send: vi.fn(), readyState: 1, close: vi.fn() };
  const peer = new RemotePeer(socket as never, netron as never, 'peer-1');
  (peer as unknown as { logger: unknown }).logger = logger;
  (peer as unknown as { sendResponse: unknown }).sendResponse = vi.fn().mockResolvedValue(undefined);
  const sendErrorResponse = vi.fn().mockResolvedValue(undefined);
  (peer as unknown as { sendErrorResponse: unknown }).sendErrorResponse = sendErrorResponse;
  return { peer, lines, sendErrorResponse };
};

const runTaskPacket = async (peer: RemotePeer) => {
  const packet = new Packet(1);
  packet.setImpulse(1);
  packet.setType(TYPE_TASK);
  packet.data = ['query_interface', 'CollectorWorker'];
  await (peer as unknown as { handlePacket(p: unknown): Promise<void> }).handlePacket(packet);
};

const errors = (lines: Line[]) => lines.filter((l) => l.level === 'error' || l.level === 'fatal');
const warns = (lines: Line[]) => lines.filter((l) => l.level === 'warn');

describe('the peer that ran a task', () => {
  it('does not call a refusal a failure — the measured case, a 404 from query_interface', async () => {
    const notFound = new TitanError({ code: ErrorCode.NOT_FOUND, message: "Service 'CollectorWorker' not found" });
    const { peer, lines, sendErrorResponse } = peerRunning(notFound);

    await runTaskPacket(peer);

    expect(errors(lines), 'a refusal was logged as a server error').toEqual([]);
    expect(lines.some((l) => l.level === 'debug' && /refused/.test(l.msg))).toBe(true);
    // And the caller still gets its answer: the level changed, not the reply.
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
  });

  it('nor a 403 or a 429', async () => {
    for (const refusal of [Errors.forbidden('no'), Errors.tooManyRequests()]) {
      const { peer, lines } = peerRunning(refusal);
      await runTaskPacket(peer);
      expect(errors(lines), `${(refusal as TitanError).code} was logged as a server error`).toEqual([]);
    }
  });

  it('still calls a failure a failure', async () => {
    const failures: unknown[] = [
      new Error('the task itself blew up'),
      new TitanError({ code: ErrorCode.SERVICE_UNAVAILABLE, message: 'Authentication not configured' }),
      new TitanError({ code: ErrorCode.INTERNAL_ERROR, message: 'broken' }),
    ];
    for (const failure of failures) {
      const { peer, lines } = peerRunning(failure);
      await runTaskPacket(peer);
      expect(
        lines.filter((l) => l.level === 'error' && l.msg === 'Failed to run task'),
        String((failure as Error).message),
      ).toHaveLength(1);
    }
  });
});

/** A peer shaped enough for the core tasks to refuse it. */
const taskPeer = (options: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
  const { logger, lines } = recordingLogger();
  const peer = {
    id: 'peer-1',
    logger,
    netron: { options, services: new Map(), peer: { subscribe: vi.fn() }, ...extra },
    remoteSubscriptions: new Map<string, unknown>(),
    getAuthContext: () => ({ userId: 'u1', roles: [] }),
  };
  return { peer: peer as never as RemotePeer, lines };
};

/** Run a refusal and return what it threw and what it wrote. */
const refusal = async (run: () => unknown, lines: Line[]) => {
  let thrown: unknown;
  try {
    await run();
  } catch (err) {
    thrown = err;
  }
  expect(thrown, 'the task did not refuse').toBeInstanceOf(TitanError);
  expect((thrown as TitanError).code).toBeGreaterThanOrEqual(400);
  expect((thrown as TitanError).code).toBeLessThan(500);
  return { thrown: thrown as TitanError, warned: warns(lines) };
};

describe('every refusal a core task makes says why, at warn, before it throws', () => {
  it('query_interface: absent', async () => {
    const { peer, lines } = taskPeer();
    const { warned } = await refusal(() => query_interface(peer, 'CollectorWorker'), lines);
    expect(warned.map((l) => l.msg)).toEqual(['query_interface: service not found in registry']);
  });

  const exposed = () => {
    const stub = { definition: { id: 'd1', meta: { name: 'Svc', version: '1.0.0', methods: {} } } };
    return new Map([['Svc@1.0.0', stub]]);
  };

  it('query_interface: denied', async () => {
    const { peer, lines } = taskPeer({}, {
      services: exposed(),
      authorizationManager: { canAccessService: () => false, filterDefinition: () => null },
    });
    const { warned } = await refusal(() => query_interface(peer, 'Svc@1.0.0'), lines);
    expect(warned.map((l) => l.msg)).toEqual(['Access denied to service']);
  });

  it('query_interface: nothing left after filtering', async () => {
    const { peer, lines } = taskPeer({}, {
      services: exposed(),
      authorizationManager: { canAccessService: () => true, filterDefinition: () => null },
    });
    const { warned } = await refusal(() => query_interface(peer, 'Svc@1.0.0'), lines);
    expect(warned.map((l) => l.msg)).toEqual(['Access denied to service (no accessible methods)']);
  });

  it('the guard: remote exposure disabled', async () => {
    const { peer, lines } = taskPeer();
    const { warned } = await refusal(() => enforceRemoteExposureAllowed(peer, 'expose_service'), lines);
    expect(warned).toHaveLength(1);
    expect(warned[0]!.msg).toMatch(/remote service exposure is disabled/);
  });

  it('the guard: no such definition', async () => {
    const { peer, lines } = taskPeer({ allowRemoteServiceExposure: true });
    const { warned } = await refusal(() => enforceOwnership(peer, undefined, 'unexpose_service'), lines);
    expect(warned).toHaveLength(1);
    expect(warned[0]!.msg).toMatch(/no such service definition/);
  });

  it('the guard: somebody else\'s definition', async () => {
    const { peer, lines } = taskPeer({ allowRemoteServiceExposure: true });
    const { warned } = await refusal(
      () => enforceOwnership(peer, { id: 'd1', peerId: 'peer-2' } as never, 'unref_service'),
      lines,
    );
    expect(warned).toHaveLength(1);
    expect(warned[0]!.msg).toMatch(/does not own/);
  });

  it('subscribe: an event internal to Netron', async () => {
    const { peer, lines } = taskPeer();
    const { warned } = await refusal(() => subscribe(peer, NETRON_EVENT_SERVICE_EXPOSE), lines);
    expect(warned).toHaveLength(1);
    expect(warned[0]!.msg).toMatch(/internal to Netron/);
  });

  it('subscribe: over the limit', async () => {
    const { peer, lines } = taskPeer({ maxSubscriptionsPerPeer: 1 });
    (peer as unknown as { remoteSubscriptions: Map<string, unknown> }).remoteSubscriptions.set('app:first', () => {});
    const { warned } = await refusal(() => subscribe(peer, 'app:second'), lines);
    expect(warned).toHaveLength(1);
    expect(warned[0]!.msg).toMatch(/subscription limit/);
  });

  it('covers every refusal the core tasks can throw — a new one extends this court', () => {
    // The eight cases above are the refusal sites that exist. A 4xx thrown
    // from a core task that this file does not exercise would be logged by
    // nobody once the peer's line is at debug, so the count is the court.
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/netron/core-tasks');
    let sites = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      sites += (source.match(/throw (Errors\.(forbidden|notFound|tooManyRequests|badRequest|unauthorized)\b|serviceNotFound\()/g) ?? []).length;
    }
    expect(sites).toBe(8);
  });
});
