/**
 * Example: RPC Services with Netron in Titan
 *
 * This example shows how to create and expose RPC services
 * using Netron's built-in capabilities.
 */

import { Application, Module, Injectable, Inject, NETRON_TOKEN, PostConstruct } from '../src/index.js';
import type { Netron } from '@omnitron-dev/netron';
import { Service as NetronService, Public } from '@omnitron-dev/netron';

// Define a calculation service exposed via Netron
@NetronService('calculator@1.0.0')
@Injectable()
class CalculatorService {
  @Public()
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  @Public()
  async multiply(a: number, b: number): Promise<number> {
    return a * b;
  }

  @Public()
  async divide(a: number, b: number): Promise<number> {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    return a / b;
  }
}

// Client service that can call remote services
@Injectable()
class RpcClient {
  constructor(@Inject(NETRON_TOKEN) private netron: Netron) {}

  async callRemoteCalculator(peerAddress: string): Promise<void> {
    try {
      // Connect to remote peer
      const peer = await this.netron.connect(peerAddress);
      console.log(`Connected to calculator service at ${peerAddress}`);

      // Get reference to remote service
      const calculator = await peer.getService('calculator@1.0.0');

      // Call remote methods
      const sum = await calculator.add(10, 20);
      console.log(`10 + 20 = ${sum}`);

      const product = await calculator.multiply(5, 6);
      console.log(`5 * 6 = ${product}`);

      const quotient = await calculator.divide(100, 4);
      console.log(`100 / 4 = ${quotient}`);
    } catch (error) {
      console.error('RPC call failed:', error);
    }
  }
}

// Module that provides RPC services
@Module({
  providers: [CalculatorService, RpcClient],
  exports: [CalculatorService, RpcClient],
})
class RpcModule {
  constructor(
    @Inject(NETRON_TOKEN) private netron: Netron,
    private calculator: CalculatorService,
    private client: RpcClient
  ) {}

  @PostConstruct()
  async onInit(): Promise<void> {
    // Register the calculator service with Netron
    // This happens automatically via the @Service decorator
    console.log('RPC services registered');
    console.log('Available services:', this.netron.getServiceNames());
  }

  async onStart(): Promise<void> {
    console.log('RPC module started');

    // Example: Connect to another instance and call remote services
    // Uncomment to test with another running instance
    // await this.client.callRemoteCalculator('ws://localhost:9002');
  }
}

// Create first instance (server)
async function createServer() {
  const app = await Application.create(RpcModule, {
    name: 'rpc-server',
    version: '1.0.0',
    config: {
      netron: {
        id: 'server-node',
        port: 9001,
        // Enable WebSocket server
        server: true,
      },
      logging: {
        level: 'info',
        pretty: true,
      },
    },
  });

  await app.start();
  console.log('RPC Server running on port 9001');
  return app;
}

// Create second instance (client)
async function createClient() {
  const app = await Application.create(RpcModule, {
    name: 'rpc-client',
    version: '1.0.0',
    config: {
      netron: {
        id: 'client-node',
        port: 9002,
        server: true,
      },
      logging: {
        level: 'info',
        pretty: true,
      },
    },
  });

  await app.start();
  console.log('RPC Client running on port 9002');

  // Get the RPC client service
  const rpcClient = app.container.resolve(RpcClient);

  // Connect to server and make RPC calls
  await rpcClient.callRemoteCalculator('ws://localhost:9001');

  return app;
}

// Main function - run both server and client
async function main() {
  // Start server
  const server = await createServer();

  // Wait a bit for server to fully initialize
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Start client and make RPC calls
  const client = await createClient();

  // Keep running for demonstration
  setTimeout(async () => {
    console.log('\nShutting down...');
    await client.stop();
    await server.stop();
    process.exit(0);
  }, 10000);
}

// Handle errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
