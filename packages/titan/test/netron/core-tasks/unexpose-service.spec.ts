/**
 * Tests for unexpose-service core task
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { unexpose_service } from '../../../src/netron/core-tasks/unexpose-service.js';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import { Netron } from '../../../src/netron/netron.js';
import { createMockLogger } from '../test-utils.js';

describe('unexpose-service core task', () => {
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

  it('should delegate to peer.netron.peer.unexposeRemoteService', async () => {
    const serviceName = 'TestService@1.0.0';

    const unexposeRemoteServiceSpy = jest
      .spyOn(netron.peer, 'unexposeRemoteService')
      .mockResolvedValue(undefined);

    await unexpose_service(remotePeer, serviceName);

    expect(unexposeRemoteServiceSpy).toHaveBeenCalledWith(remotePeer, serviceName);
    expect(unexposeRemoteServiceSpy).toHaveBeenCalledTimes(1);
  });

  it('should pass through the return value from unexposeRemoteService', async () => {
    const serviceName = 'TestService@1.0.0';

    jest.spyOn(netron.peer, 'unexposeRemoteService').mockResolvedValue(undefined);

    const result = await unexpose_service(remotePeer, serviceName);

    expect(result).toBeUndefined();
  });

  it('should propagate errors from unexposeRemoteService', async () => {
    const serviceName = 'TestService@1.0.0';
    const testError = new Error('Failed to unexpose service');

    jest.spyOn(netron.peer, 'unexposeRemoteService').mockRejectedValue(testError);

    await expect(unexpose_service(remotePeer, serviceName)).rejects.toThrow('Failed to unexpose service');
  });

  it('should handle different service names', async () => {
    const unexposeRemoteServiceSpy = jest
      .spyOn(netron.peer, 'unexposeRemoteService')
      .mockResolvedValue(undefined);

    const service1 = 'AuthService@2.0.0';
    const service2 = 'DataService@1.5.0';

    await unexpose_service(remotePeer, service1);
    await unexpose_service(remotePeer, service2);

    expect(unexposeRemoteServiceSpy).toHaveBeenNthCalledWith(1, remotePeer, service1);
    expect(unexposeRemoteServiceSpy).toHaveBeenNthCalledWith(2, remotePeer, service2);
    expect(unexposeRemoteServiceSpy).toHaveBeenCalledTimes(2);
  });

  it('should be idempotent when called multiple times for the same service', async () => {
    const serviceName = 'TestService@1.0.0';

    const unexposeRemoteServiceSpy = jest
      .spyOn(netron.peer, 'unexposeRemoteService')
      .mockResolvedValue(undefined);

    await unexpose_service(remotePeer, serviceName);
    await unexpose_service(remotePeer, serviceName);

    expect(unexposeRemoteServiceSpy).toHaveBeenCalledTimes(2);
    expect(unexposeRemoteServiceSpy).toHaveBeenNthCalledWith(1, remotePeer, serviceName);
    expect(unexposeRemoteServiceSpy).toHaveBeenNthCalledWith(2, remotePeer, serviceName);
  });
});
