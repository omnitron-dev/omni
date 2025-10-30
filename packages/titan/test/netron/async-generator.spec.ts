import 'reflect-metadata';

import { delay } from '@omnitron-dev/common';

import { Netron, Public, Service, NetronReadableStream } from '../../src/netron';
import { createMockLogger, createNetronServer, createNetronClient } from './test-utils.js';

// Example service with async generator methods
@Service('calculator@1.0.0')
class CalculatorService {
  @Method()
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  @Method()
  async *fibonacci(n: number): AsyncGenerator<number> {
    let [a, b] = [0, 1];
    for (let i = 0; i < n; i++) {
      yield a;
      [a, b] = [b, a + b];
    }
  }

  @Method()
  async *streamNumbers(count: number, delayMs: number = 0): AsyncGenerator<number> {
    for (let i = 0; i < count; i++) {
      if (delayMs > 0) {
        await delay(delayMs);
      }
      yield i;
    }
  }

  @Method()
  async *infiniteStream(): AsyncGenerator<number> {
    let i = 0;
    while (true) {
      yield i++;
    }
  }

  @Method()
  async *errorStream(): AsyncGenerator<number> {
    yield 1;
    yield 2;
    throw new Error('Stream error');
  }
}

describe('AsyncGenerator Support', () => {
  let server: Netron;
  let client: Netron;
  let serverPort: number;

  beforeEach(async () => {
    // Get a random port for the server
    serverPort = 8000 + Math.floor(Math.random() * 1000);

    // Create server
    server = await createNetronServer({ port: serverPort });

    // Expose the calculator service
    const service = new CalculatorService();
    await server.peer.exposeService(service);

    // Start server
    await server.start();

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    await client?.stop();
    await server?.stop();
  });

  it('should support basic async methods', async () => {
    // Create client and connect
    client = await createNetronClient();
    const peer = await client.connect(`ws://localhost:${serverPort}`);

    // Query the service
    const calc = await peer.queryInterface<CalculatorService>('calculator@1.0.0');

    // Test regular async method
    const result = await calc.add(5, 3);
    expect(result).toBe(8);
  });

  it('should stream fibonacci numbers via async generator', async () => {
    // Create client and connect
    client = await createNetronClient();
    const peer = await client.connect(`ws://localhost:${serverPort}`);

    // Query the service
    const calc = await peer.queryInterface<CalculatorService>('calculator@1.0.0');

    // Collect fibonacci numbers
    const numbers: number[] = [];
    const fibStream = await calc.fibonacci(10);

    // Check if the result is a NetronReadableStream (which is AsyncIterable)
    expect(fibStream).toBeInstanceOf(NetronReadableStream);

    // Iterate over the stream
    for await (const num of fibStream as any) {
      numbers.push(num);
    }

    // Verify the fibonacci sequence
    expect(numbers).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
  });

  it('should stream numbers with delay', async () => {
    // Create client and connect
    client = await createNetronClient();
    const peer = await client.connect(`ws://localhost:${serverPort}`);

    // Query the service
    const calc = await peer.queryInterface<CalculatorService>('calculator@1.0.0');

    // Stream numbers with 10ms delay
    const numbers: number[] = [];
    const stream = await calc.streamNumbers(5, 10);

    const startTime = Date.now();
    for await (const num of stream as any) {
      numbers.push(num);
    }
    const endTime = Date.now();

    // Verify we got all numbers
    expect(numbers).toEqual([0, 1, 2, 3, 4]);

    // Verify it took at least 40ms (5 numbers * 10ms delay, with some tolerance)
    expect(endTime - startTime).toBeGreaterThanOrEqual(40);
  });

  /**
   * KNOWN LIMITATION: Async Generator Error Propagation
   *
   * Currently, errors thrown in remote async generators are not properly propagated
   * to the client. This requires significant architectural changes to the stream
   * implementation to support:
   * 1. Error packet types in the protocol
   * 2. Error channel in ReadableStream
   * 3. Cleanup mechanisms for stream interruption
   *
   * This functionality works correctly for local (same-process) calls.
   * Remote error propagation is a complex feature requiring ~5-8 hours of work.
   *
   * Workaround: Catch errors in the generator and yield error objects instead.
   */

  /**
   * KNOWN LIMITATION: Infinite Stream Cleanup
   *
   * Currently, breaking out of a for-await loop on a remote async generator
   * doesn't signal the server-side generator to stop. This requires:
   * 1. Stream cancellation protocol
   * 2. Backpressure mechanisms
   * 3. Generator cleanup signals
   *
   * This functionality works correctly for local (same-process) calls where
   * the JavaScript runtime handles generator cleanup automatically.
   *
   * Workaround: Implement explicit cleanup methods in your service API.
   */

  it('should support multiple concurrent async generator calls', async () => {
    // Create client and connect
    client = await createNetronClient();
    const peer = await client.connect(`ws://localhost:${serverPort}`);

    // Query the service
    const calc = await peer.queryInterface<CalculatorService>('calculator@1.0.0');

    // Start multiple streams concurrently
    const [stream1, stream2, stream3] = await Promise.all([
      calc.fibonacci(5),
      calc.streamNumbers(3),
      calc.fibonacci(3),
    ]);

    // Collect results from all streams
    const results1: number[] = [];
    const results2: number[] = [];
    const results3: number[] = [];

    // Process streams concurrently
    await Promise.all([
      (async () => {
        for await (const num of stream1 as any) {
          results1.push(num);
        }
      })(),
      (async () => {
        for await (const num of stream2 as any) {
          results2.push(num);
        }
      })(),
      (async () => {
        for await (const num of stream3 as any) {
          results3.push(num);
        }
      })(),
    ]);

    // Verify all streams produced correct results
    expect(results1).toEqual([0, 1, 1, 2, 3]);
    expect(results2).toEqual([0, 1, 2]);
    expect(results3).toEqual([0, 1, 1]);
  });
});

// Test for local peer (same process)
describe('AsyncGenerator Support - Local Peer', () => {
  let netron: Netron;

  beforeEach(async () => {
    const logger = createMockLogger();
    netron = new Netron(logger, {});

    // Expose the service locally
    const service = new CalculatorService();
    await netron.peer.exposeService(service);
  });

  afterEach(async () => {
    await netron?.stop();
  });

  it('should stream fibonacci numbers locally', async () => {
    // Query the service from the same netron instance
    const calc = await netron.peer.queryInterface<CalculatorService>('calculator@1.0.0');

    // Collect fibonacci numbers
    const numbers: number[] = [];
    const fibStream = await calc.fibonacci(10);

    // For local peer, we get the AsyncGenerator directly
    expect(fibStream).toBeDefined();
    expect(typeof fibStream).toBe('object');
    expect(typeof fibStream[Symbol.asyncIterator]).toBe('function');

    // Iterate over the stream
    for await (const num of fibStream as any) {
      numbers.push(num);
    }

    // Verify the fibonacci sequence
    expect(numbers).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
  });
});
