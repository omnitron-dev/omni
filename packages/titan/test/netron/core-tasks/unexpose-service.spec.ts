/**
 * Tests for unexpose-service core task
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unexpose_service } from '../../../src/netron/core-tasks/unexpose-service.js';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import { Netron } from '../../../src/netron/netron.js';
import { createMockLogger } from '../test-utils.js';

// T#36: the unit tests below exercise the federation entry point and
// must (a) opt in to remote service exposure and (b) plant a stub so
// the ownership check can find a definition with the caller's peer id.
function plantStub(netron: Netron, serviceName: string, peerId: string) {
  const stub: any = { definition: { id: `def-${serviceName}`, peerId } };
  (netron as any).services.set(serviceName, stub);
}

describe('unexpose-service core task', () => {
  let netron: Netron;
  let remotePeer: RemotePeer;

  beforeEach(async () => {
    netron = await Netron.create(createMockLogger(), {
      id: 'test-netron',
      allowRemoteServiceExposure: true,
    });

    // Create a mock WebSocket for testing
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
        if (cb) cb();
      }),
      on: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;

    // Create remote peer with mock socket
    remotePeer = new RemotePeer(mockSocket, netron, 'remote-peer-id');
  });

  afterEach(async () => {
    if (netron) {
      await netron.stop();
    }
  });

  it('should delegate to peer.netron.peer.unexposeRemoteService', async () => {
    const serviceName = 'TestService@1.0.0';
    plantStub(netron, serviceName, remotePeer.id);

    const unexposeRemoteServiceSpy = vi.spyOn(netron.peer, 'unexposeRemoteService').mockResolvedValue(undefined);

    await unexpose_service(remotePeer, serviceName);

    expect(unexposeRemoteServiceSpy).toHaveBeenCalledWith(remotePeer, serviceName);
    expect(unexposeRemoteServiceSpy).toHaveBeenCalledTimes(1);
  });

  it('should pass through the return value from unexposeRemoteService', async () => {
    const serviceName = 'TestService@1.0.0';
    plantStub(netron, serviceName, remotePeer.id);

    vi.spyOn(netron.peer, 'unexposeRemoteService').mockResolvedValue(undefined);

    const result = await unexpose_service(remotePeer, serviceName);

    expect(result).toBeUndefined();
  });

  it('should propagate errors from unexposeRemoteService', async () => {
    const serviceName = 'TestService@1.0.0';
    const testError = new Error('Failed to unexpose service');
    plantStub(netron, serviceName, remotePeer.id);

    vi.spyOn(netron.peer, 'unexposeRemoteService').mockRejectedValue(testError);

    await expect(unexpose_service(remotePeer, serviceName)).rejects.toThrow('Failed to unexpose service');
  });

  it('should handle different service names', async () => {
    const unexposeRemoteServiceSpy = vi.spyOn(netron.peer, 'unexposeRemoteService').mockResolvedValue(undefined);

    const service1 = 'AuthService@2.0.0';
    const service2 = 'DataService@1.5.0';
    plantStub(netron, service1, remotePeer.id);
    plantStub(netron, service2, remotePeer.id);

    await unexpose_service(remotePeer, service1);
    await unexpose_service(remotePeer, service2);

    expect(unexposeRemoteServiceSpy).toHaveBeenNthCalledWith(1, remotePeer, service1);
    expect(unexposeRemoteServiceSpy).toHaveBeenNthCalledWith(2, remotePeer, service2);
    expect(unexposeRemoteServiceSpy).toHaveBeenCalledTimes(2);
  });

  it('should reject when called for a service the peer does not own (T#36 ownership)', async () => {
    const serviceName = 'OthersService@1.0.0';
    plantStub(netron, serviceName, 'someone-else');

    await expect(unexpose_service(remotePeer, serviceName)).rejects.toThrow(
      /does not own service definition/,
    );
  });

  it('should reject when called by remote peer on a netron that opted out of exposure', async () => {
    await netron.stop();
    netron = await Netron.create(createMockLogger(), {
      id: 'test-netron-locked',
      // allowRemoteServiceExposure defaults to false
    });
    remotePeer = new RemotePeer(
      {
        readyState: WebSocket.OPEN,
        send: vi.fn((d: any, o: any, cb?: any) => cb?.()),
        on: vi.fn(),
        close: vi.fn(),
      } as unknown as WebSocket,
      netron,
      'remote-peer-id',
    );
    await expect(unexpose_service(remotePeer, 'X@1.0.0')).rejects.toThrow(/disabled for remote peers/);
  });
});
