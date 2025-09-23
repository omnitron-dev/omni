import { Netron, Public, Service, RemotePeer } from '../../src/netron';

describe('Interface Lifecycle Tests', () => {
  let netron: Netron;
  let remoteNetron: Netron;
  let remotePeer: RemotePeer;

  interface ITestService {
    data: string;
    getData(): string;
    setData(value: string): void;
    getNestedService(): INestedService;
  }

  interface INestedService {
    value: number;
    increment(): number;
  }

  @Service('testService@1.0.0')
  class TestService implements ITestService {
    @Public()
    data = 'initial';

    @Public()
    getData() {
      return this.data;
    }

    @Public()
    setData(value: string) {
      this.data = value;
    }

    @Public()
    getNestedService() {
      return new NestedService();
    }
  }

  @Service('nestedService@1.0.0')
  class NestedService implements INestedService {
    @Public()
    value = 42;

    @Public()
    increment() {
      return ++this.value;
    }
  }

  beforeAll(async () => {
    netron = await Netron.create({ id: 'local', listenHost: 'localhost', listenPort: 7070, allowServiceEvents: true });
    await netron.peer.exposeService(new TestService());

    remoteNetron = await Netron.create({ id: 'remote' });
    remotePeer = await remoteNetron.connect('ws://localhost:7070');
  });

  afterAll(async () => {
    remotePeer.disconnect();
    await remoteNetron.stop();
    await netron.stop();
  });

  it('should correctly handle parallel queryInterface calls', async () => {
    const [iface1, iface2] = await Promise.all([
      remotePeer.queryInterface<ITestService>('testService@1.0.0'),
      remotePeer.queryInterface<ITestService>('testService@1.0.0'),
    ]);

    expect(iface1).toBe(iface2);

    await remotePeer.releaseInterface(iface1);
    await remotePeer.releaseInterface(iface2);

    // Интерфейс должен быть удалён после обоих освобождений
    expect(async () => iface1.getData()).rejects.toThrow('Invalid interface');
  });

  it('should handle cyclic nested interface releases gracefully', async () => {
    const iface = await remotePeer.queryInterface<ITestService>('testService@1.0.0');
    const nestedIface = await iface.getNestedService();

    expect(await nestedIface.increment()).toBe(43);

    await remotePeer.releaseInterface(iface);

    // Проверка, что вложенный интерфейс был автоматически освобождён
    expect(async () => nestedIface.increment()).rejects.toThrow('Invalid interface');
  });

  it('should throw when accessing released interface', async () => {
    const iface = await remotePeer.queryInterface<ITestService>('testService@1.0.0');
    await remotePeer.releaseInterface(iface);

    await expect(async () => iface.getData()).rejects.toThrow('Invalid interface');
  });
});
