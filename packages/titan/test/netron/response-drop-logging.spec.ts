/**
 * Tests for Bug Fix 1.4: Silent Response Drop Logging
 *
 * Verifies that when a response packet arrives for an unknown/timed-out
 * packet ID, a debug log is emitted instead of silently dropping.
 */

import { WebSocket } from 'ws';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { createMockLogger } from './test-utils.js';
import { Packet, createPacket } from '../../src/netron/packet/index.js';

function createMockSocket() {
  return {
    readyState: 1,
    send: vi.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
      if (cb) cb();
    }),
    on: vi.fn(),
    once: vi.fn(),
    close: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as WebSocket;
}

describe('Response Drop Logging', () => {
  let netron: Netron;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    logger = createMockLogger();
    netron = await Netron.create(logger, { id: 'test' });
  });

  afterEach(async () => {
    await netron.stop();
  });

  it('should log debug when response has no matching handler', async () => {
    const peerLogger = createMockLogger();
    const peer = new RemotePeer(createMockSocket(), netron, 'peer-1');
    (peer as any).logger = peerLogger;

    // Create a response packet with a random ID that has no handler
    const packet = createPacket(99999, 0, 'test-data');
    // Set impulse to 0 to make it a response packet
    packet.setImpulse(0);

    await peer.handlePacket(packet);

    // The debug log should have been called with the unknown packet ID
    expect(peerLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ packetId: 99999 }),
      expect.stringContaining('unknown packet')
    );
  });
});
