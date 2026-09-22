/**
 * A peer that left mid-call is not a failed call.
 *
 * `RemotePeer.handlePacket` logged every exception from a CALL as
 * `logger.error` + «Failed to call method on remote service». Most of them
 * were not failures: `isPeerGone` — which exists in this very file and is
 * asked three times — recognises a `TransportError`, and «Socket closed
 * during RPC» IS a `TransportError` (`NetronErrors.connectionClosed`). The
 * noisiest place was the one that never asked.
 *
 * Measured on the dev stand 2026-09-22, reading the live app logs:
 *
 *     geo       205 × «Failed to call method on remote service»  level 50
 *     storage    19 × same                                       level 50
 *     both      every one `__getProcessMetrics` / «Socket closed during RPC»
 *     both       8 real errors, between them
 *
 * A metrics poll racing a restart, recorded 27 times for every genuine
 * fault. That is how a log stops being read — and the same evening we three
 * mistook a restart window for a crash twice, working from logs exactly like
 * these.
 *
 * So: peer-gone is `debug`, everything else stays `error`. The second
 * assertion is the one that keeps this honest — quieting the routine must not
 * quiet a real fault.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { createPacket, TYPE_CALL } from '../../src/netron/packet/index.js';
import { NetronErrors } from '../../src/errors/index.js';
import { createLogger } from '../utils/test-logger.js';

describe('a peer that left mid-call', () => {
  let netron: Netron;
  let peer: RemotePeer;
  let socket: any;
  let errorSpy: ReturnType<typeof vi.fn>;
  let debugSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    netron = new Netron(createLogger(), { id: 'peer-gone-netron' });

    socket = {
      on: vi.fn(),
      once: vi.fn(),
      send: vi.fn((_d: unknown, _o: unknown, cb?: () => void) => cb?.()),
      close: vi.fn().mockResolvedValue(undefined),
      readyState: 'OPEN',
    };

    peer = new RemotePeer(socket, netron, 'peer-gone-1');

    errorSpy = vi.fn();
    debugSpy = vi.fn();
    peer.logger = {
      ...peer.logger,
      error: errorSpy,
      debug: debugSpy,
      warn: vi.fn(),
      info: vi.fn(),
    } as unknown as typeof peer.logger;
  });

  afterEach(async () => {
    if (netron) await netron.stop();
  });

  /**
   * Make the stub the CALL resolves to throw `err`.
   *
   * The stub is fetched from the LOCAL peer
   * (`localPeer.getStubByDefinitionId`), not from this peer's own map — the
   * first version of this fixture set `peer.stubs` and every call died with
   * «Definition not found», which is itself a genuine error. Both tests then
   * passed their error assertion for the wrong reason, and only the one
   * expecting `debug` caught it.
   */
  function stubThrowing(err: unknown) {
    const defId = '550e8400-e29b-41d4-a716-446655440000';
    const stub = {
      definition: { id: defId, meta: { name: 'Svc', version: '1.0.0', methods: { ping: {} }, properties: {} } },
      call: vi.fn(async () => { throw err; }),
    };
    (netron.peer as unknown as { getStubByDefinitionId: (id: string) => unknown }).getStubByDefinitionId =
      vi.fn(() => stub);
    return defId;
  }

  it('records a transport failure as debug, not as a failed call', async () => {
    const defId = stubThrowing(NetronErrors.connectionClosed('unix', 'Socket closed during RPC'));

    await peer.handlePacket(createPacket(1, 1, TYPE_CALL, [defId, 'ping', []]));

    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
    expect(JSON.stringify(debugSpy.mock.calls)).toContain('Peer gone');
  });

  it('still records a genuine fault as an error', async () => {
    // The control: an ordinary exception from the service must keep its level.
    // Quieting the routine is only safe if the real thing still shouts.
    const defId = stubThrowing(new Error('column "x" does not exist'));

    await peer.handlePacket(createPacket(2, 1, TYPE_CALL, [defId, 'ping', []]));

    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).toContain('Failed to call method');
  });
});
