/**
 * Tests for abilities core task
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { abilities } from '../../../src/netron/core-tasks/abilities.js';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import { Netron } from '../../../src/netron/netron.js';
import { createMockLogger } from '../test-utils.js';
import type { Abilities } from '../../../src/netron/types.js';
import { Service, Public } from '../../../src/decorators/core.js';

describe('abilities core task', () => {
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

  it('should return local abilities without storing remote abilities when none provided', () => {
    const result = abilities(remotePeer);

    expect(result).toBeDefined();
    expect(result.services).toBeInstanceOf(Map);
    expect(result.allowServiceEvents).toBe(false); // Default value
  });

  it('should store remote abilities when provided', () => {
    const remoteAbilities: Abilities = {
      services: new Map([
        ['TestService@1.0.0', {
          id: 'TestService@1.0.0',
          name: 'TestService',
          version: '1.0.0',
          methods: new Map([['test', { name: 'test', params: [] }]])
        }]
      ]),
      allowServiceEvents: true
    };

    abilities(remotePeer, remoteAbilities);

    expect(remotePeer.abilities).toBe(remoteAbilities);
    expect(remotePeer.abilities.allowServiceEvents).toBe(true);
    expect(remotePeer.abilities.services?.size).toBe(1);
  });

  it('should include all local services in returned abilities', async () => {
    // Create a test service and expose it
    @Service('MathService@1.0.0')
    class MathService {
      @Public()
      add(a: number, b: number) {
        return a + b;
      }

      @Public()
      multiply(a: number, b: number) {
        return a * b;
      }
    }

    const testService = new MathService();
    await netron.peer.exposeService(testService);

    const result = abilities(remotePeer);

    expect(result.services).toBeInstanceOf(Map);
    expect(result.services?.size).toBeGreaterThan(0);
    expect(result.services?.has('MathService@1.0.0')).toBe(true);
  });

  it('should respect allowServiceEvents option from Netron configuration', async () => {
    // Create Netron with allowServiceEvents enabled
    const netronWithEvents = await Netron.create(createMockLogger(), {
      id: 'test-netron-events',
      allowServiceEvents: true
    });

    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
        if (cb) cb();
      }),
      on: jest.fn(),
      close: jest.fn(),
    } as unknown as WebSocket;

    const peerWithEvents = new RemotePeer(mockSocket, netronWithEvents, 'peer-with-events');

    const result = abilities(peerWithEvents);

    expect(result.allowServiceEvents).toBe(true);

    await netronWithEvents.stop();
  });

  it('should handle empty services map', () => {
    // Netron with no services exposed
    const result = abilities(remotePeer);

    expect(result.services).toBeInstanceOf(Map);
    expect(result.services?.size).toBe(0);
  });

  it('should handle multiple services correctly', async () => {
    // Expose multiple services
    @Service('Service1@1.0.0')
    class TestService1 {
      @Public()
      method1() {
        return 'result1';
      }
    }

    @Service('Service2@2.0.0')
    class TestService2 {
      @Public()
      method2() {
        return 'result2';
      }
    }

    const service1 = new TestService1();
    const service2 = new TestService2();

    await netron.peer.exposeService(service1);
    await netron.peer.exposeService(service2);

    const result = abilities(remotePeer);

    expect(result.services?.size).toBe(2);
    expect(result.services?.has('Service1@1.0.0')).toBe(true);
    expect(result.services?.has('Service2@2.0.0')).toBe(true);
  });

  it('should override previous remote abilities when called multiple times', () => {
    const firstAbilities: Abilities = {
      services: new Map([['Service1@1.0.0', {
        id: 'Service1@1.0.0',
        name: 'Service1',
        version: '1.0.0',
        methods: new Map()
      }]]),
      allowServiceEvents: false
    };

    const secondAbilities: Abilities = {
      services: new Map([['Service2@2.0.0', {
        id: 'Service2@2.0.0',
        name: 'Service2',
        version: '2.0.0',
        methods: new Map()
      }]]),
      allowServiceEvents: true
    };

    abilities(remotePeer, firstAbilities);
    expect(remotePeer.abilities.services?.has('Service1@1.0.0')).toBe(true);

    abilities(remotePeer, secondAbilities);
    expect(remotePeer.abilities.services?.has('Service2@2.0.0')).toBe(true);
    expect(remotePeer.abilities.services?.has('Service1@1.0.0')).toBe(false);
    expect(remotePeer.abilities.allowServiceEvents).toBe(true);
  });
});
