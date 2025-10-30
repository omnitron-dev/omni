import 'reflect-metadata';

import { Public, Service } from '../../src/netron/index.js';
import { createNetronServer, createNetronClient } from './test-utils.js';

// Simple service with async generator
@Service('test@1.0.0')
class TestService {
  @Method()
  async *generate(): AsyncGenerator<number> {
    yield 1;
    yield 2;
    yield 3;
  }
}

describe('AsyncGenerator Basic Test', () => {
  let server: any;
  let client: any;
  let serverPort: number;

  beforeEach(async () => {
    serverPort = 9000 + Math.floor(Math.random() * 1000);

    // Create server
    server = await createNetronServer({ port: serverPort });

    // Expose service
    const service = new TestService();
    await server.peer.exposeService(service);

    // Start server
    await server.start();

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    if (client) await client.stop();
    if (server) await server.stop();
  });

  it('should stream numbers from async generator', async () => {
    // Create client
    client = await createNetronClient();

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
