/**
 * A peer that goes away mid-call is not a server error.
 *
 * It produced two ERROR lines with stack traces per dropped connection: the
 * task failing, and then the error response having nowhere to go. On a network
 * where circuits drop by design — which is the one this platform runs on —
 * that is a constant event, and a log where it is the loudest thing present is
 * a log nobody reads.
 *
 * What must stay loud is the other half: a reply that could not be sent for
 * any other reason leaves a caller waiting for a response that will never
 * arrive, and nothing else reports that.
 */
import { describe, it, expect, vi } from 'vitest';

import { RemotePeer } from '../../src/netron/remote-peer.js';
import { NetronErrors } from '../../src/errors/index.js';
import { Packet, TYPE_TASK } from '../../src/netron/packet/index.js';

const recordingLogger = () => {
  const lines: Array<{ level: string; msg: string }> = [];
  const record = (level: string) => (_ctx: unknown, msg?: unknown) =>
    lines.push({ level, msg: String(msg ?? '') });
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

/** A peer whose task always fails the way a vanished client makes it fail. */
const peerWithFailingTask = (taskError: unknown, sendError: unknown) => {
  const { logger, lines } = recordingLogger();
  const netron = {
    logger,
    runTask: vi.fn().mockRejectedValue(taskError),
    options: {},
  };
  const socket = { send: vi.fn(), readyState: 3, close: vi.fn() };
  const peer = new RemotePeer(socket as never, netron as never, 'peer-1');
  (peer as unknown as { logger: unknown }).logger = logger;
  (peer as unknown as { sendResponse: unknown }).sendResponse = vi.fn().mockResolvedValue(undefined);
  (peer as unknown as { sendErrorResponse: unknown }).sendErrorResponse = vi
    .fn()
    .mockRejectedValue(sendError);
  return { peer, lines };
};

const taskPacket = () => {
  const packet = new Packet(1);
  packet.setImpulse(1);
  packet.setType(TYPE_TASK);
  packet.data = ['some_task'];
  return packet;
};

describe('a peer that disconnects mid-task', () => {
  it('is not reported as an error', async () => {
    const gone = NetronErrors.connectionClosed('unix', 'Socket closed during RPC');
    const { peer, lines } = peerWithFailingTask(gone, gone);

    await (peer as unknown as { handlePacket(p: unknown): Promise<void> }).handlePacket(taskPacket());

    expect(
      lines.filter((l) => l.level === 'error'),
      'a dropped connection produced errors'
    ).toEqual([]);
    expect(lines.some((l) => l.level === 'debug' && /disconnected/i.test(l.msg))).toBe(true);
  });

  it('still reports a reply that failed for any other reason', async () => {
    // The caller is now waiting for a response that will never arrive, and
    // nothing else in the system says so.
    const taskFailure = new Error('the task itself blew up');
    const sendFailure = new Error('serialiser refused the payload');
    const { peer, lines } = peerWithFailingTask(taskFailure, sendFailure);

    await (peer as unknown as { handlePacket(p: unknown): Promise<void> }).handlePacket(taskPacket());

    expect(lines.some((l) => l.level === 'error' && l.msg === 'Failed to run task')).toBe(true);
    expect(lines.some((l) => l.level === 'warn' && /Failed to send error response/.test(l.msg))).toBe(
      true
    );
  });
});
