import 'reflect-metadata';

import { delay } from '@omnitron-dev/common';

import { Netron, Public, Service, NetronReadableStream } from '../../src/netron';

// Example service with async generator methods
@Service('calculator@1.0.0')
class CalculatorService {
  @Public()
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  @Public()
  async *fibonacci(n: number): AsyncGenerator<number> {
    let [a, b] = [0, 1];
    for (let i = 0; i < n; i++) {
      yield a;
      [a, b] = [b, a + b];
    }
  }

  @Public()
  async *streamNumbers(count: number, delayMs: number = 0): AsyncGenerator<number> {
    for (let i = 0; i < count; i++) {
      if (delayMs > 0) {
        await delay(delayMs);
      }
      yield i;
    }
  }

  @Public()
  async *infiniteStream(): AsyncGenerator<number> {
    let i = 0;
    while (true) {
      yield i++;
    }
  }

  @Public()
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

    // Create server with both host and port
    server = new Netron({
      listenHost: 'localhost',
      listenPort: serverPort,
    });
    await server.start();

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Expose the calculator service
    const service = new CalculatorService();
    await server.peer.exposeService(service);
  });

  afterEach(async () => {
    await client?.stop();
    await server?.stop();
  });

  it('should support basic async methods', async () => {
    // Create client and connect
    client = new Netron();
    await client.start();
    const peer = await client.connect(`ws://localhost:${serverPort}`);

    // Query the service
    const calc = await peer.queryInterface<CalculatorService>('calculator@1.0.0');

    // Test regular async method
    const result = await calc.add(5, 3);
    expect(result).toBe(8);
  });

  it('should stream fibonacci numbers via async generator', async () => {
    // Create client and connect
    client = new Netron();
    await client.start();
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
    client = new Netron();
    await client.start();
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

  it.skip('should handle stream errors gracefully', async () => {
    // TODO: Implement proper error propagation through streams
    // Currently, errors thrown in async generators are not properly propagated to the client
    // Create client and connect
    client = new Netron();
    await client.start();
    const peer = await client.connect(`ws://localhost:${serverPort}`);

    // Query the service
    const calc = await peer.queryInterface<CalculatorService>('calculator@1.0.0');

    // Stream that throws an error
    const numbers: number[] = [];
    const stream = await calc.errorStream();

    // Expect the iteration to throw
    let errorThrown: Error | null = null;
    try {
      for await (const num of stream as any) {
        numbers.push(num);
      }
    } catch (error: any) {
      errorThrown = error;
    }

    // Should have thrown an error
    expect(errorThrown).toBeTruthy();
    expect(errorThrown?.message).toContain('Stream error');

    // Should have received the first two values before the error
    expect(numbers).toEqual([1, 2]);
  });

  it.skip('should allow early termination of infinite streams', async () => {
    // TODO: Implement proper cleanup for infinite generators
    // Currently, breaking out of the for-await loop doesn't signal the server-side generator to stop
    // Create client and connect
    client = new Netron();
    await client.start();
    const peer = await client.connect(`ws://localhost:${serverPort}`);

    // Query the service
    const calc = await peer.queryInterface<CalculatorService>('calculator@1.0.0');

    // Start infinite stream
    const numbers: number[] = [];
    const stream = await calc.infiniteStream();

    // Only take first 5 numbers
    for await (const num of stream as any) {
      numbers.push(num);
      if (numbers.length >= 5) {
        // Break out of the loop
        break;
      }
    }

    // Verify we got exactly 5 numbers
    expect(numbers).toEqual([0, 1, 2, 3, 4]);

    // The stream should be properly closed or generator returned
    // For remote connections, it's a NetronReadableStream
    // For local calls, it's the AsyncGenerator itself
  });

  it('should support multiple concurrent async generator calls', async () => {
    // Create client and connect
    client = new Netron();
    await client.start();
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
    netron = new Netron();
    await netron.start();

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
