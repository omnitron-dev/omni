/**
 * Tests for expose-service core task
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { expose_service } from '../../../src/netron/core-tasks/expose-service.js';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import { Netron } from '../../../src/netron/netron.js';
import { createMockLogger } from '../test-utils.js';
import type { ServiceMetadata } from '../../../src/netron/types.js';

describe('expose-service core task', () => {
  let netron: Netron;
  let remotePeer: RemotePeer;

  beforeEach(async () => {
    // Create Netron instance with mock logger.
    // T#36: remote-peer-initiated service exposure is deny-by-default,
    // so unit tests for the federation entry point must opt in.
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

  it('should delegate to peer.netron.peer.exposeRemoteService', async () => {
    const mockMeta: ServiceMetadata = {
      name: 'TestService',
      version: '1.0.0',
    };

    const exposeRemoteServiceSpy = vi.spyOn(netron.peer, 'exposeRemoteService').mockResolvedValue(undefined);

    await expose_service(remotePeer, mockMeta);

    expect(exposeRemoteServiceSpy).toHaveBeenCalledWith(remotePeer, mockMeta);
    expect(exposeRemoteServiceSpy).toHaveBeenCalledTimes(1);
  });

  it('should pass through the return value from exposeRemoteService', async () => {
    const mockMeta: ServiceMetadata = {
      name: 'TestService',
      version: '1.0.0',
    };

    vi.spyOn(netron.peer, 'exposeRemoteService').mockResolvedValue(undefined);

    const result = await expose_service(remotePeer, mockMeta);

    expect(result).toBeUndefined();
  });

  it('should propagate errors from exposeRemoteService', async () => {
    const mockMeta: ServiceMetadata = {
      name: 'TestService',
      version: '1.0.0',
    };

    const testError = new Error('Failed to expose service');
    vi.spyOn(netron.peer, 'exposeRemoteService').mockRejectedValue(testError);

    await expect(expose_service(remotePeer, mockMeta)).rejects.toThrow('Failed to expose service');
  });

  it('should handle different service metadata', async () => {
    const exposeRemoteServiceSpy = vi.spyOn(netron.peer, 'exposeRemoteService').mockResolvedValue(undefined);

    const metadata1: ServiceMetadata = {
      name: 'AuthService',
      version: '2.0.0',
    };

    const metadata2: ServiceMetadata = {
      name: 'DataService',
      version: '1.5.0',
    };

    await expose_service(remotePeer, metadata1);
    await expose_service(remotePeer, metadata2);

    expect(exposeRemoteServiceSpy).toHaveBeenNthCalledWith(1, remotePeer, metadata1);
    expect(exposeRemoteServiceSpy).toHaveBeenNthCalledWith(2, remotePeer, metadata2);
    expect(exposeRemoteServiceSpy).toHaveBeenCalledTimes(2);
  });

  it('should reject when called by remote peer on a netron that opted out (T#36)', async () => {
    await netron.stop();
    netron = await Netron.create(createMockLogger(), {
      id: 'test-netron-locked',
      // allowRemoteServiceExposure defaults to false — secure default.
    });
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn((d: any, o: any, cb?: any) => cb?.()),
      on: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;
    remotePeer = new RemotePeer(mockSocket, netron, 'remote-peer-id');

    await expect(expose_service(remotePeer, { name: 'X', version: '1.0.0' })).rejects.toThrow(
      /disabled for remote peers/,
    );
  });
});
