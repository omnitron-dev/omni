/**
 * Tests for expose-service core task
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { expose_service } from '../../../src/netron/core-tasks/expose-service.js';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import { Netron } from '../../../src/netron/netron.js';
import { createMockLogger } from '../test-utils.js';
import type { ServiceMetadata } from '../../../src/netron/types.js';

describe('expose-service core task', () => {
  let netron: Netron;
  let remotePeer: RemotePeer;

  beforeEach(async () => {
    // Create Netron instance with mock logger
    netron = await Netron.create(createMockLogger(), { id: 'test-netron' });

    // Create a mock WebSocket for testing
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
        if (cb) cb();
      }),
      on: jest.fn(),
      close: jest.fn(),
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

    const exposeRemoteServiceSpy = jest.spyOn(netron.peer, 'exposeRemoteService').mockResolvedValue(undefined);

    await expose_service(remotePeer, mockMeta);

    expect(exposeRemoteServiceSpy).toHaveBeenCalledWith(remotePeer, mockMeta);
    expect(exposeRemoteServiceSpy).toHaveBeenCalledTimes(1);
  });

  it('should pass through the return value from exposeRemoteService', async () => {
    const mockMeta: ServiceMetadata = {
      name: 'TestService',
      version: '1.0.0',
    };

    jest.spyOn(netron.peer, 'exposeRemoteService').mockResolvedValue(undefined);

    const result = await expose_service(remotePeer, mockMeta);

    expect(result).toBeUndefined();
  });

  it('should propagate errors from exposeRemoteService', async () => {
    const mockMeta: ServiceMetadata = {
      name: 'TestService',
      version: '1.0.0',
    };

    const testError = new Error('Failed to expose service');
    jest.spyOn(netron.peer, 'exposeRemoteService').mockRejectedValue(testError);

    await expect(expose_service(remotePeer, mockMeta)).rejects.toThrow('Failed to expose service');
  });

  it('should handle different service metadata', async () => {
    const exposeRemoteServiceSpy = jest.spyOn(netron.peer, 'exposeRemoteService').mockResolvedValue(undefined);

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
});
