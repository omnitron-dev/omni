import 'reflect-metadata';

import { Netron, Public, Service } from '../../src/netron/index.js';
import { createMockLogger } from './test-utils.js';

// Simple service with async generator
@Service('test@1.0.0')
class TestService {
  @Public()
  async *generate(): AsyncGenerator<number> {
    yield 1;
    yield 2;
    yield 3;
  }
}

describe('AsyncGenerator Basic Test', () => {
  let server: Netron;
  let client: Netron;
  let serverPort: number;

  beforeEach(async () => {
    serverPort = 9000 + Math.floor(Math.random() * 1000);

    // Create and start server with logger
    const serverLogger = createMockLogger();
    server = await Netron.create(serverLogger, {
      listenHost: 'localhost',
      listenPort: serverPort,
    });

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Expose service
    const service = new TestService();
    await server.peer.exposeService(service);
  });

  afterEach(async () => {
    if (client) await client.stop();
    if (server) await server.stop();
  });

  it('should stream numbers from async generator', async () => {
    // Create client and connect with logger
    const clientLogger = createMockLogger();
    client = await Netron.create(clientLogger, {});
    const peer = await client.connect(`ws://localhost:${serverPort}`);

    // Query the service
    const testService = await peer.queryInterface<TestService>('test@1.0.0');

    // Call the generator method
    const stream = await testService.generate();

    // Collect results
    const results: number[] = [];
    for await (const num of stream as any) {
      results.push(num);
    }

    // Verify results
    expect(results).toEqual([1, 2, 3]);
  });
});
