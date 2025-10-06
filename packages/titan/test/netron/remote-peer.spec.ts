import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { delay } from '@omnitron-dev/common';

import { Service1, IService1 } from './fixtures/service1';
import { Service2, IService2 } from './fixtures/service2';
import { Service5, IService5 } from './fixtures/service5';
import {
  Netron,
  Interface,
  RemotePeer,
  NETRON_EVENT_PEER_CONNECT,
  NETRON_EVENT_SERVICE_EXPOSE,
  NETRON_EVENT_PEER_DISCONNECT,
  NETRON_EVENT_SERVICE_UNEXPOSE,
} from '../../src/netron/index';
import { createMockLogger, createNetronClient } from './test-utils.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket-transport.js';

describe('RemotePeer', () => {
  let netron: Netron;
  let testPort: number;

  beforeEach(async () => {
    // Use random port to avoid conflicts during parallel test execution
    testPort = 8000 + Math.floor(Math.random() * 1000);

    const logger = createMockLogger();

    netron = new Netron(logger, {
      id: 'n1',
      allowServiceEvents: true,
    });

    netron.registerTransport('ws', () => new WebSocketTransport());
    netron.registerTransportServer('ws', {
      name: 'ws',
      options: { host: 'localhost', port: testPort }
    });

    await netron.start();
  });

  afterEach(async () => {
    await netron.stop();
  });

  async function testMembers(iface: IService1, svc1?: Service1) {
    expect(await iface.greet()).toEqual('Hello, Context1!');
    expect(await iface.addNumbers(1, 2)).toEqual(3);
    expect(await iface.concatenateStrings('Hello, ', 'World!')).toEqual('Hello, World!');
    expect(await iface.getBooleanValue(true)).toEqual(true);
    expect(await iface.getObjectProperty({ key: 'value' })).toEqual('value');
    expect(await iface.getArrayElement([1, 2, 3], 1)).toEqual(2);
    expect(await iface.fetchData('https://jsonplaceholder.typicode.com/todos/1')).toEqual({
      userId: 1,
      id: 1,
      title: 'delectus aut autem',
      completed: false,
    });
    expect(await iface.updateData('nana', 'New Name')).toEqual(undefined);
    expect(await iface.updateData('desc1', 'New Description')).toEqual(undefined);
    expect(await iface.getDataKeys()).toEqual(['nana', 'desc1']);
    expect(await iface.delay(50)).toEqual(undefined);
    expect(await iface.fetchDataWithDelay('https://jsonplaceholder.typicode.com/todos/1', 500)).toEqual({
      userId: 1,
      id: 1,
      title: 'delectus aut autem',
      completed: false,
    });
    expect(await iface.updateDataWithDelay('nana', 'New Name', 50)).toEqual(undefined);
    expect(await iface.updateDataWithDelay('desc1', 'New Description', 50)).toEqual(undefined);
    expect(await iface.getStatus()).toEqual('ACTIVE');
    expect(await iface.getPriority()).toEqual(3);
    expect(await iface.getAllStatuses()).toEqual(['ACTIVE', 'INACTIVE', 'PENDING']);
    expect(await iface.getAllPriorities()).toEqual([1, 2, 3]);
    expect(await iface.getUndefined()).toEqual(undefined);
    expect(await iface.getNull()).toEqual(null);
    expect(await iface.getBigInt()).toEqual(BigInt(9007199254740991));
    if (svc1) {
      expect(await iface.getDate()).toEqual(svc1.getDate());
    }
    expect(await iface.getRegExp()).toEqual(/test/i);
    expect(await iface.getMap()).toEqual(
      new Map([
        ['one', 1],
        ['two', 2],
      ])
    );
    expect(await iface.getSet()).toEqual(new Set(['first', 'second']));
    expect(await iface.getPromise()).toEqual('resolved');
    expect(await iface.echo('test')).toEqual('test');
  }

  it('should connect to remote peer', async () => {
    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);
    expect(peer1).toBeInstanceOf(RemotePeer);
    expect(peer1.id).toBe(netron.id);
    expect(netron.peers.has(n2.id)).toBe(true);
    peer1.disconnect();
  });

  it('start netron second time should throw error', async () => {
    await expect(netron.start()).rejects.toThrow('Netron already started');
  });

  it('should emit peer connect and disconnect events with correct peerId and update peers list', async () => {
    const n2 = await createNetronClient();

    const connectHandlerN1 = jest.fn();
    const disconnectHandlerN1 = jest.fn();
    const connectHandlerN2 = jest.fn();
    const disconnectHandlerN2 = jest.fn();

    netron.on(NETRON_EVENT_PEER_CONNECT, connectHandlerN1);
    netron.on(NETRON_EVENT_PEER_DISCONNECT, disconnectHandlerN1);
    n2.on(NETRON_EVENT_PEER_CONNECT, connectHandlerN2);
    n2.on(NETRON_EVENT_PEER_DISCONNECT, disconnectHandlerN2);

    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    await delay(100);

    expect(connectHandlerN1).toHaveBeenCalledTimes(1);
    expect(connectHandlerN1).toHaveBeenCalledWith(expect.objectContaining({ peerId: n2.id }));
    expect(disconnectHandlerN1).toHaveBeenCalledTimes(0);
    expect(connectHandlerN2).toHaveBeenCalledTimes(1);
    expect(connectHandlerN2).toHaveBeenCalledWith(expect.objectContaining({ peerId: netron.id }));
    expect(disconnectHandlerN2).toHaveBeenCalledTimes(0);

    expect(netron.peers.has(n2.id)).toBe(true);
    expect(n2.peers.has(netron.id)).toBe(true);

    peer1.disconnect();

    await delay(100);

    expect(disconnectHandlerN1).toHaveBeenCalledTimes(1);
    expect(disconnectHandlerN1).toHaveBeenCalledWith(expect.objectContaining({ peerId: n2.id }));
    expect(disconnectHandlerN2).toHaveBeenCalledTimes(1);
    expect(disconnectHandlerN2).toHaveBeenCalledWith(expect.objectContaining({ peerId: netron.id }));

    expect(netron.peers.has(n2.id)).toBe(false);
    expect(n2.peers.has(netron.id)).toBe(false);

    // Clean up client
    await n2.stop();
  });

  it('should use specified id', async () => {
    const n2 = new Netron(createMockLogger(), {
      id: 'n2',
    });
    n2.registerTransport('ws', () => new WebSocketTransport());

    const peer1 = await n2.connect(`ws://localhost:${testPort}`);
    const peer2 = netron.peers.get('n2');

    expect(peer2).toBeInstanceOf(RemotePeer);
    expect(peer1.id).toBe(netron.id);
    expect(peer2?.id).toBe(n2.id);

    peer1.disconnect();
  });

  it('should have abilities after connection', async () => {
    const n2 = new Netron(createMockLogger(), {
      id: 'n2',
    });
    n2.registerTransport('ws', () => new WebSocketTransport());

    const peer1 = await n2.connect(`ws://localhost:${testPort}`);
    const peer2 = netron.peers.get('n2')!;

    expect(peer1.abilities).toEqual({
      services: new Map(),
      allowServiceEvents: true,
    });

    expect(peer2.abilities).toEqual({
      allowServiceEvents: false,
    });

    peer1.disconnect();
  });

  it('connector side can send abilities', async () => {
    const n2 = new Netron(createMockLogger(), {
      id: 'n2',
      allowServiceEvents: true,
    });
    n2.registerTransport('ws', () => new WebSocketTransport());

    const peer1 = await n2.connect(`ws://localhost:${testPort}`);
    const peer2 = netron.peers.get('n2')!;

    expect(peer1.abilities).toEqual({
      services: new Map(),
      allowServiceEvents: true,
    });

    expect(peer2.abilities).toEqual({
      allowServiceEvents: true,
    });

    await peer1.disconnect();
  });

  it('should call methods and access properties of remote service', async () => {
    const svc1 = new Service1();
    const peer = netron.peer;
    peer.exposeService(svc1);

    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);
    const iface = await peer1.queryInterface<IService1>('service1');

    await testMembers(iface, svc1);

    await peer1.releaseInterface(iface);

    await peer1.disconnect();
  });

  it('should throw error while request timeout', async () => {
    const ctx1 = new Service1();
    const peer = netron.peer;
    peer.exposeService(ctx1);

    const n2 = new Netron(createMockLogger(), {});
    n2.registerTransport('ws', () => new WebSocketTransport());
    n2.setTransportOptions('ws', { requestTimeout: 500 });
    await n2.start();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);
    const iface = await peer1.queryInterface<IService1>('service1');

    expect(async () => await iface.delay(1000)).rejects.toThrow(/Request timeout exceeded/);

    await peer1.releaseInterface(iface);

    await delay(1000);

    await peer1.disconnect();
    await n2.stop();
  });

  it('should throw if set read-only property', async () => {
    const ctx1 = new Service1();
    const peer = netron.peer;
    peer.exposeService(ctx1);

    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    const iface = await peer1.queryInterface<IService1>('service1');

    expect(() => ((iface as any).isActive = false)).toThrow(/Property is not writable/);
    await peer1.releaseInterface(iface);

    await peer1.disconnect();
  });

  it('should get all std and custom error', async () => {
    const ctx1 = new Service5();
    const peer = netron.peer;
    peer.exposeService(ctx1);

    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    const iface = await peer1.queryInterface<IService5>('service5');

    const errorTypes = [
      'TypeError',
      'RangeError',
      'ReferenceError',
      'SyntaxError',
      'URIError',
      'EvalError',
      'GenericError',
    ];

    for (const errorType of errorTypes) {
      try {
        await iface.generateError(errorType);
      } catch (error: any) {
        expect(error.name).toBe(errorType === 'GenericError' ? 'Error' : errorType);
        expect(error.message).toMatch(/This is a/);
      }
    }

    await peer1.releaseInterface(iface);
    await peer1.disconnect();
  });

  it('should return error with custom fields', async () => {
    const ctx1 = new Service5();
    const peer = netron.peer;
    peer.exposeService(ctx1);

    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    const iface = await peer1.queryInterface<IService5>('service5');

    try {
      await iface.generateCustomError('CustomError', 400, { detail: 'Some detail', abc: [1, 2, 3] });
    } catch (error: any) {
      expect(error.name).toBe('CustomError');
      expect(error.message).toBe('This is a custom error');
      expect(error.code).toBe(400);
      expect(error.meta).toEqual({ detail: 'Some detail', abc: [1, 2, 3] });
    }

    await peer1.releaseInterface(iface);
    await peer1.disconnect();
  });

  it('call method that returns another service and release it', async () => {
    const svc2 = new Service2();
    const peer = netron.peer;
    peer.exposeService(svc2);

    const n2 = new Netron(createMockLogger(), {});
    n2.registerTransport('ws', () => new WebSocketTransport());
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    expect(peer1.getServiceNames()).toEqual(['service2']);

    const iService2 = await peer1.queryInterface<IService2>('service2');
    expect(iService2).toBeInstanceOf(Interface);
    expect((iService2 as any).$def.parentId).toBe('');
    expect(peer.stubs.size).toBe(1);
    expect(peer1.definitions.size).toBe(1);

    const iService1 = await iService2.getService1();
    expect(iService1).toBeInstanceOf(Interface);
    expect(peer.stubs.size).toBe(2);
    expect(peer1.definitions.size).toBe(2);
    expect((iService1 as unknown as Interface).$def?.parentId).toBeDefined();
    expect((iService1 as unknown as Interface).$def?.parentId).toBe((iService2 as unknown as Interface).$def?.id);
    expect(await iService1.name).toBe('Context1');
    expect(await iService1.greet()).toBe('Hello, Context1!');
    expect(await iService1.addNumbers(1, 2)).toBe(3);
    expect(await iService1.concatenateStrings('Hello, ', 'World!')).toBe('Hello, World!');
    expect(await iService1.getBooleanValue(true)).toBe(true);
    expect(await iService1.getObjectProperty({ key: 'value' })).toBe('value');
    expect(await iService1.getArrayElement([1, 2, 3], 1)).toBe(2);
    svc2.getService1().description = 'testd1';
    expect(await iService1.description).toBe('testd1');
    iService1.description = 'testd2';
    await (iService1 as any as Interface).waitForAssigned('description');
    expect(await iService1.description).toBe('testd2');
    expect(peer.stubs.keys()).toContain((iService1 as any).$def.id);
    expect(peer1.definitions.keys()).toContain((iService1 as any).$def.id);

    const defId = (iService1 as any).$def.id;
    await peer1.releaseInterface(iService1);
    expect(peer1.definitions.keys()).not.toContain(defId);
    expect(peer.stubs.keys()).not.toContain(defId);
    try {
      await iService1.addNumbers(1, 2);
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid interface/);
    }

    peer1.disconnect();
  });

  it('call method that returns another service and release it', async () => {
    const svc2 = new Service2();
    const peer = netron.peer;
    peer.exposeService(svc2);

    const n2 = new Netron(createMockLogger(), {});
    n2.registerTransport('ws', () => new WebSocketTransport());
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);
    const iService2 = await peer1.queryInterface<IService2>('service2');
    const iService1 = await iService2.getService1();
    const defId = (iService1 as any).$def.id;
    await expect(async () => peer.releaseInterface(iService1)).rejects.toThrow(/Invalid interface/);
    expect(await iService1.addNumbers(1, 2)).toBe(3);

    peer1.disconnect();
  });

  it('autosubscribe to expose and unexpose events', async () => {
    const peer = netron.peer;
    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    await peer.exposeService(new Service1());

    await delay(100);

    expect(peer1.services.keys()).toContain('service1');

    await peer.unexposeService('service1');

    await delay(100);

    expect(peer1.services.size).toBe(0);

    peer1.disconnect();
  });

  it('subscribe to event', async () => {
    const peer = netron.peer;
    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    const eventHandler1 = jest.fn();
    const eventHandler2 = jest.fn();
    await peer1.subscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandler1);

    peer.exposeService(new Service1());

    await delay(100);

    expect(eventHandler1).toHaveBeenCalledTimes(1);
    expect(eventHandler1).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'service1',
        peerId: peer.id,
      })
    );

    await peer1.subscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandler2);
    await peer1.subscribe(NETRON_EVENT_SERVICE_UNEXPOSE, eventHandler2);

    peer.unexposeService('service1');
    peer.exposeService(new Service2());

    await delay(100);

    expect(eventHandler1).toHaveBeenCalledTimes(2);
    expect(eventHandler2).toHaveBeenCalledTimes(2);

    peer1.disconnect();
  });

  it('subscribe to same event multiple times should handle it only once', async () => {
    const peer = netron.peer;
    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    const eventHandler1 = jest.fn();
    const eventHandler2 = jest.fn();
    await peer1.subscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandler1);
    await peer1.subscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandler1);

    peer.exposeService(new Service1());

    await delay(100);

    expect(eventHandler1).toHaveBeenCalledTimes(1);
    expect(eventHandler1).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'service1',
        peerId: peer.id,
      })
    );

    peer1.disconnect();
  });

  it('unsubscribe event', async () => {
    const peer = netron.peer;
    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    const eventHandler1 = jest.fn();
    await peer1.subscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandler1);

    peer.exposeService(new Service1());

    await delay(100);

    expect(eventHandler1).toHaveBeenCalledTimes(1);
    expect(eventHandler1).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'service1',
        peerId: peer.id,
      })
    );

    await peer1.unsubscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandler1);

    peer.exposeService(new Service2());

    await delay(100);

    expect(eventHandler1).toHaveBeenCalledTimes(1);

    peer1.disconnect();
  });

  it('unsubscribe all events', async () => {
    const peer = netron.peer;
    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    const eventHandler1 = jest.fn();
    await peer1.subscribe(NETRON_EVENT_SERVICE_UNEXPOSE, eventHandler1);

    peer.exposeService(new Service1());
    peer.exposeService(new Service2());

    await peer.unexposeAllServices();

    await delay(100);

    expect(eventHandler1).toHaveBeenCalledTimes(2);

    peer1.disconnect();
  });

  it('expose service remotely and query it from local peer', async () => {
    const peer = netron.peer;
    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    const svc1 = new Service1();
    await peer1.exposeService(svc1);
    expect(peer.stubs.size).toBe(1);
    expect(netron.services.size).toBe(1);
    expect(netron.services.keys()).toContain('service1');

    const iface = await peer.queryInterface<IService1>('service1');

    await testMembers(iface, svc1);

    await peer1.unexposeService('service1');

    peer1.disconnect();
  });

  it('expose service remotely and query it from other remote peer', async () => {
    const peer = netron.peer;
    const n2 = await createNetronClient();
    const n3 = await createNetronClient();
    const peer21 = await n2.connect(`ws://localhost:${testPort}`);
    const peer31 = await n3.connect(`ws://localhost:${testPort}`);

    const svc1 = new Service1();
    await peer21.exposeService(svc1);
    expect(peer.stubs.size).toBe(1);
    expect(netron.services.size).toBe(1);
    expect(netron.services.keys()).toContain('service1');

    await delay(100);

    const iface = await peer31.queryInterface<IService1>('service1');

    expect(await iface.greet()).toEqual('Hello, Context1!');
    expect(await iface.addNumbers(1, 2)).toEqual(3);
    expect(await iface.concatenateStrings('Hello, ', 'World!')).toEqual('Hello, World!');
    expect(await iface.getBooleanValue(true)).toEqual(true);
    expect(await iface.getObjectProperty({ key: 'value' })).toEqual('value');
    expect(await iface.getArrayElement([1, 2, 3], 1)).toEqual(2);
    expect(await iface.fetchData('https://jsonplaceholder.typicode.com/todos/1')).toEqual({
      userId: 1,
      id: 1,
      title: 'delectus aut autem',
      completed: false,
    });
    expect(await iface.updateData('nana', 'New Name')).toEqual(undefined);
    expect(await iface.updateData('desc1', 'New Description')).toEqual(undefined);
    expect(await iface.getDataKeys()).toEqual(['nana', 'desc1']);
    expect(await iface.delay(100)).toEqual(undefined);
    expect(await iface.fetchDataWithDelay('https://jsonplaceholder.typicode.com/todos/1', 500)).toEqual({
      userId: 1,
      id: 1,
      title: 'delectus aut autem',
      completed: false,
    });
    expect(await iface.updateDataWithDelay('nana', 'New Name', 500)).toEqual(undefined);
    expect(await iface.updateDataWithDelay('desc1', 'New Description', 500)).toEqual(undefined);
    expect(await iface.getStatus()).toEqual('ACTIVE');
    expect(await iface.getPriority()).toEqual(3);
    expect(await iface.getAllStatuses()).toEqual(['ACTIVE', 'INACTIVE', 'PENDING']);
    expect(await iface.getAllPriorities()).toEqual([1, 2, 3]);
    expect(await iface.getUndefined()).toEqual(undefined);
    expect(await iface.getNull()).toEqual(null);
    try {
      const receivedSymbol = await iface.getSymbol();
    } catch (error: any) {
      expect(error.message).toMatch(/Not supported/);
    }
    expect(await iface.getBigInt()).toEqual(BigInt(9007199254740991));
    expect(await iface.getDate()).toEqual(svc1.getDate());
    expect(await iface.getRegExp()).toEqual(/test/i);
    expect(await iface.getMap()).toEqual(
      new Map([
        ['one', 1],
        ['two', 2],
      ])
    );
    expect(await iface.getSet()).toEqual(new Set(['first', 'second']));
    expect(await iface.getPromise()).toEqual('resolved');

    await peer21.unexposeService('service1');

    await delay(100);

    peer21.disconnect();
    peer31.disconnect();
  });

  it('subscribe to event for remote service exposed by another peer', async () => {
    const peer = netron.peer;
    const n2 = await createNetronClient();
    const n3 = await createNetronClient();
    const peer21 = await n2.connect(`ws://localhost:${testPort}`);
    const peer31 = await n3.connect(`ws://localhost:${testPort}`);

    const eventHandlerLocal = jest.fn();
    const eventHandler21 = jest.fn();
    const eventHandler31 = jest.fn();

    await peer.subscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandlerLocal);
    await peer21.subscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandler21);
    await peer31.subscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandler31);

    const def = await peer21.exposeService(new Service1());

    await delay(100);

    expect(eventHandlerLocal).toHaveBeenCalledTimes(1);
    expect(eventHandlerLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'service1',
        peerId: peer.id,
        remotePeerId: n2.id,
      })
    );
    expect(eventHandler21).toHaveBeenCalledTimes(1);
    expect(eventHandler21).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'service1',
        peerId: peer.id,
        remotePeerId: n2.id,
      })
    );
    expect(eventHandler31).toHaveBeenCalledTimes(1);
    expect(eventHandler31).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'service1',
        peerId: peer.id,
        remotePeerId: n2.id,
      })
    );

    eventHandlerLocal.mockClear();
    eventHandler21.mockClear();
    eventHandler31.mockClear();
    await peer.unsubscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandlerLocal);
    await peer21.unsubscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandler21);
    await peer31.unsubscribe(NETRON_EVENT_SERVICE_EXPOSE, eventHandler31);

    const def2 = await peer21.exposeService(new Service2());

    await delay(100);

    expect(eventHandlerLocal).toHaveBeenCalledTimes(0);
    expect(eventHandler21).toHaveBeenCalledTimes(0);
    expect(eventHandler31).toHaveBeenCalledTimes(0);

    await peer.subscribe(NETRON_EVENT_SERVICE_UNEXPOSE, eventHandlerLocal);
    await peer21.subscribe(NETRON_EVENT_SERVICE_UNEXPOSE, eventHandler21);
    await peer31.subscribe(NETRON_EVENT_SERVICE_UNEXPOSE, eventHandler31);

    await peer21.unexposeService('service2');

    await delay(100);

    expect(eventHandlerLocal).toHaveBeenCalledTimes(1);
    expect(eventHandler21).toHaveBeenCalledTimes(1);
    expect(eventHandler31).toHaveBeenCalledTimes(1);

    peer21.disconnect();
    peer31.disconnect();
  });

  it('query, use and release proxified service', async () => {
    const peer = netron.peer;
    const n2 = await createNetronClient();
    const n3 = await createNetronClient();
    const peer21 = await n2.connect(`ws://localhost:${testPort}`);
    const peer31 = await n3.connect(`ws://localhost:${testPort}`);

    const svc2 = new Service2();
    await peer21.exposeService(svc2);
    await delay(100);

    expect(peer.netron.services.keys()).toContain('service2');
    expect(peer21.services.keys()).toContain('service2');
    expect(peer31.services.keys()).toContain('service2');

    let iService2 = await peer.queryInterface<IService2>('service2');
    expect(iService2).toBeInstanceOf(Interface);
    let iService1 = await iService2.getService1();
    expect(iService1).toBeInstanceOf(Interface);

    await testMembers(iService1);
    await peer.releaseInterface(iService1);
    await peer.releaseInterface(iService2);

    await peer21.unexposeService('service2');
    await peer21.exposeService(svc2);
    await delay(100);

    iService2 = await peer21.queryInterface<IService2>('service2');
    expect(iService2).toBeInstanceOf(Interface);
    iService1 = await iService2.getService1();
    expect(iService1).toBeInstanceOf(Interface);

    await testMembers(iService1);
    await peer21.releaseInterface(iService1);
    await peer21.releaseInterface(iService2);

    await peer21.unexposeService('service2');
    await peer21.exposeService(svc2);
    await delay(100);

    iService2 = await peer31.queryInterface<IService2>('service2');
    expect(iService2).toBeInstanceOf(Interface);
    iService1 = await iService2.getService1();
    expect(iService1).toBeInstanceOf(Interface);

    await testMembers(iService1);
    await peer31.releaseInterface(iService1);
    await peer31.releaseInterface(iService2);

    await peer21.unexposeService('service2');

    await delay(100);

    peer21.disconnect();
    peer31.disconnect();
  });

  it('should be able to release and re-query interface', async () => {
    const svc1 = new Service1();
    const peer = netron.peer;
    await peer.exposeService(svc1);

    const n2 = await createNetronClient();
    const peer1 = await n2.connect(`ws://localhost:${testPort}`);

    // Запрашиваем интерфейс в первый раз
    let iface = await peer1.queryInterface<IService1>('service1');
    expect(iface).toBeInstanceOf(Interface);

    // Вызываем метод
    const result = await iface.echo('test');
    expect(result).toBe('test');

    // Релизим интерфейс
    await peer1.releaseInterface(iface);

    // Запрашиваем интерфейс повторно
    iface = await peer1.queryInterface<IService1>('service1');
    expect(iface).toBeInstanceOf(Interface);

    // Проверяем что методы работают
    const result2 = await iface.echo('test2');
    expect(result2).toBe('test2');

    await peer1.releaseInterface(iface);
    await peer1.disconnect();
  });
});
