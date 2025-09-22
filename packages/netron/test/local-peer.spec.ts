import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { Service1 } from './fixtures/service1';
import { Service2 } from './fixtures/service2';
import { Service3 } from './fixtures/service3';
import { Service4 } from './fixtures/service4';
import { Service5 } from './fixtures/service5';
import { Netron, Interface, LocalPeer, NETRON_EVENT_SERVICE_EXPOSE, NETRON_EVENT_SERVICE_UNEXPOSE } from '../src/index.js';

describe('LocalPeer', () => {
  let netron: Netron;

  beforeEach(() => {
    netron = new Netron({
      id: 'n1',
      listenHost: 'localhost',
      listenPort: 8080,
    });
  });

  afterEach(() => {
    netron.peer.unexposeAllServices();
  });

  it('should create own peer', () => {
    expect(netron.peer).toBeDefined();
    expect(netron.peer).toBeInstanceOf(LocalPeer);
    expect(netron.peer.id).toEqual(netron.id);
    expect(netron.peer.netron).toBe(netron);
  });

  it('should expose and unexpose service', async () => {
    const exposeHandler = jest.fn();
    const peer = netron.peer;
    peer.subscribe(NETRON_EVENT_SERVICE_EXPOSE, exposeHandler);

    const svc1 = new Service1();
    const def = await peer.exposeService(svc1);
    expect(peer.netron.services.size > 0).toBe(true);
    expect(peer.netron.services.size).toBe(1);
    expect(peer.netron.services.has('service1')).toBe(true);
    expect(def.id.length).toBeGreaterThan(0);
    expect(peer.getServiceNames()).toContain('service1');

    expect(exposeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'service1',
        peerId: peer.id,
      })
    );

    const unexposeHandler = jest.fn();
    peer.subscribe(NETRON_EVENT_SERVICE_UNEXPOSE, unexposeHandler);

    peer.unexposeService('service1');
    expect(peer.netron.services.size > 0).toBe(false);
    expect(peer.netron.services.size).toBe(0);
    expect(peer.netron.services.has('service1')).toBe(false);
    expect(unexposeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'service1',
        peerId: peer.id,
        defId: def.id,
      })
    );
  });

  it('should throw if expose service with same name', async () => {
    const exposeHandler = jest.fn();
    const peer = netron.peer;
    peer.subscribe(NETRON_EVENT_SERVICE_EXPOSE, exposeHandler);

    const ctx1 = new Service1();
    const ctx2 = new Service1();
    await peer.exposeService(ctx1);
    expect(async () => peer.exposeService(ctx2)).rejects.toThrow(/Service already exposed/);
  });

  it('should throw if unexpose service two times', async () => {
    const unexposeHandler = jest.fn();
    const peer = netron.peer;
    peer.subscribe(NETRON_EVENT_SERVICE_UNEXPOSE, unexposeHandler);

    const ctx1 = new Service1();
    await peer.exposeService(ctx1);
    peer.unexposeService('service1');
    expect(async () => peer.unexposeService('service1')).rejects.toThrow(/Unknown service/);
  });

  it('should throw if unexpose service with unknown name', async () => {
    expect(async () => await netron.peer.unexposeService('unknown')).rejects.toThrow(/Unknown service/);
  });

  it('should throw if exposed instance is not service', async () => {
    class TestNonService {
      a() {
        return 'a';
      }
      b() {
        return 'b';
      }
    }

    const peer = netron.peer;
    expect(async () => await peer.exposeService(new TestNonService())).rejects.toThrow(/Invalid service/);
    expect(async () => await peer.exposeService({})).rejects.toThrow(/Invalid service/);
  });

  it('should throw when query interface with unknown name', async () => {
    const peer = netron.peer;

    await expect(async () => peer.queryInterface('unknown')).rejects.toThrow(/Unknown service/);
  });

  it('should return interface for service and release it', async () => {
    const peer = netron.peer;
    const def = await peer.exposeService(new Service1());

    const iface = await peer.queryInterface<IService1>('service1');
    expect(iface).toBeDefined();
    expect(iface).toBeInstanceOf(Interface);
    expect((iface as any).$def.id).toBe(def.id);
    expect((iface as any).$def.meta.name).toBe('service1');
    expect(async () => peer.releaseInterface(iface)).not.toThrow();
  });

  it('should return initial variable values from context', async () => {
    const peer = netron.peer;
    await peer.exposeService(new Service1());
    const iface = await peer.queryInterface<IService1>('service1');

    expect(await iface.name).toEqual('Context1');
    expect(await iface.description).toEqual('This is a test context');
    expect(await iface.data).toEqual({});
    expect(await iface.isActive).toEqual(true);
    await peer.releaseInterface(iface);
  });

  it('should change variable values in service', async () => {
    const ctx1 = new Service1();
    const peer = netron.peer;
    await peer.exposeService(ctx1);
    const iface = await peer.queryInterface<IService1>('service1');

    iface.name = 'New Name';
    await (iface as any as Interface).waitForAssigned('name');
    expect(await iface.name).toEqual('New Name');
    expect(ctx1.name).toEqual('New Name');

    iface.description = 'New Description';
    await (iface as any as Interface).waitForAssigned('description');
    expect(await iface.description).toEqual('New Description');
    expect(ctx1.description).toEqual('New Description');

    iface.data = { a: 1, b: 2 };
    await (iface as any as Interface).waitForAssigned('data');
    expect(await iface.data).toEqual({ a: 1, b: 2 });
    expect(ctx1.data).toEqual({ a: 1, b: 2 });

    await peer.releaseInterface(iface);
  });

  it('should throw if set read-only property', async () => {
    const ctx1 = new Service1();
    const peer = netron.peer;
    await peer.exposeService(ctx1);
    const iface = await peer.queryInterface<IService1>('service1');

    expect(() => ((iface as any).isActive = false)).toThrow(/Property is not writable/);
    await peer.releaseInterface(iface);
  });

  it('should call methods and access properties', async () => {
    const ctx1 = new Service1();
    const peer = netron.peer;
    await peer.exposeService(ctx1);
    const iface = await peer.queryInterface<IService1>('service1');

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
    const receivedSymbol = await iface.getSymbol();
    expect(receivedSymbol.description).toBe('test');
    expect(await iface.getBigInt()).toEqual(BigInt(9007199254740991));
    expect(await iface.getDate()).toEqual(ctx1.getDate());
    expect(await iface.getRegExp()).toEqual(/test/i);
    expect(await iface.getMap()).toEqual(
      new Map([
        ['one', 1],
        ['two', 2],
      ])
    );
    expect(await iface.getSet()).toEqual(new Set(['first', 'second']));
    expect(await iface.getPromise()).toEqual('resolved');

    await peer.releaseInterface(iface);
  });

  it('should manage interface reference count', async () => {
    const ctx1 = new Service1();
    const peer = netron.peer;
    await peer.exposeService(ctx1);
    const iface1 = await peer.queryInterface<IService1>('service1');
    const iface2 = await peer.queryInterface<IService1>('service1');

    expect(iface1).toBe(iface2);

    await peer.releaseInterface(iface1);
    expect(await iface2.getBigInt()).toBe(BigInt(9007199254740991));
    iface1.description = 'testd1';
    await (iface1 as any as Interface).waitForAssigned('description');
    expect(await iface1.description).toEqual('testd1');

    const iface3 = await netron.peer.queryInterface<IService1>('service1');
    expect(iface3).toBe(iface2);

    await netron.peer.releaseInterface(iface2);
    await netron.peer.releaseInterface(iface3);
    try {
      await iface3.getBigInt();
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid interface/);
    }

    try {
      iface3.description = 'testd2';
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid interface/);
    }
  });

  it('call method that returns another service and release it', async () => {
    const svc2 = new Service2();
    const peer = netron.peer;
    await peer.exposeService(svc2);

    const iService2 = await peer.queryInterface<IService2>('service2');
    expect(iService2).toBeInstanceOf(Interface);
    expect((iService2 as unknown as Interface).$def?.parentId).toBe('');
    const iService1 = await iService2.getService1();
    expect(iService1).toBeInstanceOf(Interface);
    expect((iService1 as unknown as Interface).$def?.parentId).toBeDefined();
    expect((iService1 as unknown as Interface).$def?.parentId).toBe((iService2 as unknown as Interface).$def?.id);
    expect(peer.netron.services.size).toBe(1);
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

    const defId = (iService1 as any).$def.id;
    expect(peer.stubs.keys()).toContain(defId);
    await peer.releaseInterface(iService1);
    expect(peer.stubs.keys()).not.toContain(defId);
    try {
      await iService1.addNumbers(1, 2);
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid interface/);
    }
  });

  it('call subsequent methods that returns another service and release it', async () => {
    const svc3 = new Service3();
    const peer = netron.peer;
    await peer.exposeService(svc3);

    const iService3 = await peer.queryInterface<IService3>('service3');
    expect(iService3).toBeInstanceOf(Interface);
    expect((iService3 as any).$def.parentId).toBe('');
    const iService2 = await iService3.getService2();
    expect(iService2).toBeInstanceOf(Interface);
    expect((iService2 as any).$def.parentId).toBe((iService3 as any).$def.id);
    expect(peer.netron.services.size).toBe(1);
    expect(await iService2.name).toBe('Context2');
    expect(await iService2.addNumbers(1, 2)).toBe(3);
    svc3.getService2().name = 'name1';
    expect(await iService2.name).toBe('name1');
    iService2.name = 'name2';
    await (iService2 as any as Interface).waitForAssigned('name');
    expect(await iService2.name).toBe('name2');
    expect(peer.stubs.keys()).toContain((iService2 as any).$def.id);

    const iService1 = await iService2.getService1();
    expect(iService1).toBeInstanceOf(Interface);
    expect((iService1 as any).$def.parentId).toBe((iService2 as any).$def.id);
    expect(peer.netron.services.size).toBe(1);
    expect(await iService1.name).toBe('Context1');
    expect(await iService1.greet()).toBe('Hello, Context1!');
    expect(await iService1.addNumbers(1, 2)).toBe(3);
    expect(await iService1.concatenateStrings('Hello, ', 'World!')).toBe('Hello, World!');
    expect(await iService1.getBooleanValue(true)).toBe(true);
    expect(await iService1.getObjectProperty({ key: 'value' })).toBe('value');
    expect(await iService1.getArrayElement([1, 2, 3], 1)).toBe(2);
    svc3.getService2().getService1().description = 'testd1';
    expect(await iService1.description).toBe('testd1');
    iService1.description = 'testd2';
    await (iService1 as any as Interface).waitForAssigned('description');
    expect(await iService1.description).toBe('testd2');
    expect(peer.stubs.keys()).toContain((iService1 as any).$def.id);

    expect((iService2 as unknown as Interface).$def?.id).toBeDefined();
    expect([...peer.stubs.keys()]).toHaveLength(3);

    expect(peer.getServiceNames()).toEqual(['service3']);
    // expect(peer.netron.services.get("service3")?.services.size).toBe(1);

    const defId = (iService2 as any).$def.id;
    await peer.releaseInterface(iService2);
    expect(peer.stubs.keys()).not.toContain(defId);
    try {
      await iService2.addNumbers(1, 2);
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid interface/);
    }

    expect([...peer.stubs.keys()]).toEqual([(iService3 as unknown as Interface).$def?.id]);
    // expect(peer.netron.services.get("service3")?.services.size).toBe(0);
  });

  it('when unexpose service all child services should be released', async () => {
    const svc3 = new Service3();
    const peer = netron.peer;
    await peer.exposeService(svc3);

    const iService3 = await peer.queryInterface<IService3>('service3');
    const iService2 = await iService3.getService2();
    const iService1 = await iService2.getService1();

    expect(peer.netron.services.size).toBe(1);
    expect(peer.stubs.size).toBe(3);

    peer.unexposeService('service3');
    expect(peer.netron.services.size).toBe(0);
    expect(peer.stubs.size).toBe(0);
  });

  it.skip('send exposed service to another service through argument', async () => {
    const svc1 = new Service1();
    const svc4 = new Service4();
    const peer = netron.peer;
    await peer.exposeService(svc1);
    await peer.exposeService(svc4);

    const iService1 = await peer.queryInterface<IService1>('service1');
    const iService4 = await peer.queryInterface<IService4>('service4');

    expect(await iService4.addNumbers(1, 2)).toBe(0);
    expect(await iService4.setService(iService1)).toBe(true);
    expect(await iService4.addNumbers(1, 2)).toBe(3);

    await peer.releaseInterface(iService1);
    expect(await iService4.addNumbers(1, 2)).toBe(3);
    await peer.releaseInterface(iService1);

    try {
      await iService4.addNumbers(1, 2);
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid interface/);
    }
  });

  it.skip('should release interface when service is unexposed', async () => {
    const svc2 = new Service2();
    const srv4 = new Service4();
    const peer = netron.peer;
    await peer.exposeService(svc2);
    await peer.exposeService(srv4);

    const iService2 = await peer.queryInterface<IService2>('service2');
    const iService4 = await peer.queryInterface<IService4>('service4');
    const iService1 = await iService2.getService1();

    expect(await iService4.addNumbers(1, 2)).toBe(0);
    expect(await iService4.setService(iService1)).toBe(true);
    expect(await iService4.addNumbers(1, 2)).toBe(3);

    await peer.releaseInterface(iService2);
    try {
      await iService2.getService1();
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid interface/);
    }

    expect(await iService4.addNumbers(11, 2)).toBe(13);

    await peer.releaseInterface(iService1);
    try {
      await iService4.addNumbers(1, 2);
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid interface/);
    }
  });

  it('should throw error if not supported', async () => {
    const ctx1 = new Service5();
    const peer = netron.peer;
    await peer.exposeService(ctx1);

    const iface = await peer.queryInterface<IService5>('service5');

    try {
      await iface.generateCustomError('CustomError', 400, { detail: 'Some detail', abc: [1, 2, 3] });
    } catch (error: any) {
      expect(error.name).toBe('CustomError');
      expect(error.message).toBe('This is a custom error');
      expect(error.code).toBe(400);
      expect(error.meta).toEqual({ detail: 'Some detail', abc: [1, 2, 3] });
    }

    await peer.releaseInterface(iface);
  });

  it('should return same instance', async () => {
    const svc2 = new Service2();
    const peer = netron.peer;
    await peer.exposeService(svc2);

    expect(peer.serviceInstances.size).toBe(1);

    const iService2 = await peer.queryInterface<IService2>('service2');
    const iService1_1 = await iService2.getService1();
    expect(peer.serviceInstances.size).toBe(2);
    expect(iService1_1).toBeInstanceOf(Interface);
    const iService1_2 = await iService2.getService1();
    expect(peer.serviceInstances.size).toBe(2);
    expect(iService1_2).toBeInstanceOf(Interface);
    expect(iService1_1).toBe(iService1_2);
    expect(peer.stubs.size).toBe(2);
    await peer.releaseInterface(iService1_1);
    await peer.releaseInterface(iService1_2);
    expect(peer.stubs.size).toBe(1);
  });

  it('should return new instances', async () => {
    const svc2 = new Service2();
    const peer = netron.peer;
    await peer.exposeService(svc2);

    const iService2 = await peer.queryInterface<IService2>('service2');
    const iService1 = await iService2.getNewService1('test', 'test descr');
    expect(peer.serviceInstances.size).toBe(2);
    expect(peer.stubs.size).toBe(2);
    expect(iService1).toBeInstanceOf(Interface);
    expect(await iService1.name).toBe('test');
    expect(await iService1.description).toBe('test descr');

    const iService1_2 = await iService2.getNewService1('test2', 'test descr 2');
    expect(peer.serviceInstances.size).toBe(3);
    expect(peer.stubs.size).toBe(3);
    expect(iService1_2).toBeInstanceOf(Interface);
    expect(iService1).not.toBe(iService1_2);
    expect(await iService1_2.name).toBe('test2');
    expect(await iService1_2.description).toBe('test descr 2');

    await peer.releaseInterface(iService1);
    await peer.releaseInterface(iService1_2);
    expect(peer.stubs.size).toBe(1);
    expect(peer.serviceInstances.size).toBe(1);
  });

  it('should throw if release interface with invalid interface', async () => {
    const peer = netron.peer;
    const svc1 = new Service1();
    await peer.exposeService(svc1);
    const iface = await peer.queryInterface<IService1>('service1');
    await peer.releaseInterface(iface);
    await expect(async () => peer.releaseInterface(iface)).rejects.toThrow(/Invalid interface/);
  });

  it('should be able to release and re-query interface', async () => {
    const svc1 = new Service1();
    const peer = netron.peer;
    await peer.exposeService(svc1);

    // Запрашиваем интерфейс в первый раз
    let iface = await peer.queryInterface<IService1>('service1');
    expect(iface).toBeInstanceOf(Interface);

    // Вызываем метод
    const result = await iface.echo('test');
    expect(result).toBe('test');

    // Релизим интерфейс
    await peer.releaseInterface(iface);

    // Запрашиваем интерфейс повторно
    iface = await peer.queryInterface<IService1>('service1');
    expect(iface).toBeInstanceOf(Interface);

    // Проверяем что методы работают
    const result2 = await iface.echo('test2');
    expect(result2).toBe('test2');

    await peer.releaseInterface(iface);
  });
});
