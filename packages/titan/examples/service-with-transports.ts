/**
 * Example demonstrating how to use the Service decorator with transport configuration
 */

import { Service, Public, Method } from '../src/decorators/index.js';
import { WebSocketTransport, TcpTransport } from '../src/netron/transport/index.js';
import { LocalPeer } from '../src/netron/local-peer.js';
import { Netron } from '../src/netron/netron.js';
import type { ITransport } from '../src/netron/transport/types.js';

/**
 * Example 1: Simple service with WebSocket transport
 */
@Service({
  name: 'chat@1.0.0',
  transports: [new WebSocketTransport({ port: 8080 })],
})
class ChatService {
  @Public()
  async sendMessage(from: string, message: string): Promise<void> {
    console.log(`[${from}]: ${message}`);
  }

  @Public()
  async getHistory(limit: number = 10): Promise<string[]> {
    // Return mock history
    return Array(limit)
      .fill(null)
      .map((_, i) => `Message ${i + 1}`);
  }
}

/**
 * Example 2: Service with multiple transports
 */
@Service({
  name: 'calculator@2.0.0',
  transports: [new WebSocketTransport({ port: 8080 }), new TcpTransport({ port: 3000 })],
  transportConfig: {
    timeout: 5000,
    compression: true,
    maxMessageSize: 1024 * 1024, // 1MB
  },
})
class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }

  @Public()
  subtract(a: number, b: number): number {
    return a - b;
  }

  @Method()
  multiply(a: number, b: number): number {
    return a * b;
  }

  @Method()
  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    return a / b;
  }
}

/**
 * Example 3: Service with dynamic transport selection
 */
function createServiceTransports(config: { useWebSocket?: boolean; useTcp?: boolean }): ITransport[] {
  const transports: ITransport[] = [];

  if (config.useWebSocket) {
    transports.push(new WebSocketTransport({ port: 8080 }));
  }

  if (config.useTcp) {
    transports.push(new TcpTransport({ port: 3000 }));
  }

  return transports;
}

@Service({
  name: 'api@1.0.0',
  transports: createServiceTransports({
    useWebSocket: true,
    useTcp: process.platform !== 'win32', // Use TCP on non-Windows platforms
  }),
})
class ApiService {
  @Public()
  async fetchData(id: string): Promise<any> {
    return {
      id,
      data: 'Sample data',
      timestamp: Date.now(),
    };
  }

  @Public()
  async updateData(id: string, data: any): Promise<boolean> {
    console.log(`Updating ${id} with`, data);
    return true;
  }
}

/**
 * Example 4: Platform-specific transports
 */
function getPlatformTransports(): ITransport[] {
  if (process.platform === 'win32') {
    // Use Named Pipes on Windows
    const { NamedPipeTransport } = require('../src/netron/transport/unix-transport.js');
    return [new NamedPipeTransport({ pipeName: 'omnitron-service' }), new WebSocketTransport({ port: 8080 })];
  } else {
    // Use Unix sockets on Linux/Mac
    const { UnixSocketTransport } = require('../src/netron/transport/unix-transport.js');
    return [new UnixSocketTransport({ path: '/tmp/omnitron.sock' }), new WebSocketTransport({ port: 8080 })];
  }
}

@Service({
  name: 'platform@1.0.0',
  transports: getPlatformTransports(),
})
class PlatformService {
  @Public()
  getPlatform(): string {
    return process.platform;
  }

  @Public()
  getSystemInfo(): any {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
    };
  }
}

/**
 * Main function demonstrating how to expose services
 */
async function main() {
  // Create a Netron instance with logger
  const netron = new Netron({
    id: 'example-netron',
    logger: {
      level: 'info',
      child: () => ({
        info: console.log,
        debug: console.log,
        error: console.error,
        warn: console.warn,
      }),
    } as any,
  });

  // Create a local peer
  const localPeer = new LocalPeer(netron);

  // Create and expose services
  const chatService = new ChatService();
  const calculatorService = new CalculatorService();
  const apiService = new ApiService();
  const platformService = new PlatformService();

  try {
    // Expose each service
    const chatDef = await localPeer.exposeService(chatService);
    console.log('Chat service exposed:', chatDef.meta.name);

    const calcDef = await localPeer.exposeService(calculatorService);
    console.log('Calculator service exposed:', calcDef.meta.name);

    const apiDef = await localPeer.exposeService(apiService);
    console.log('API service exposed:', apiDef.meta.name);

    const platformDef = await localPeer.exposeService(platformService);
    console.log('Platform service exposed:', platformDef.meta.name);

    // Access transport information from metadata
    const { SERVICE_ANNOTATION } = require('../src/decorators/core.js');
    const { ExtendedServiceMetadata } = require('../src/decorators/core.js');

    // Check each service's transport configuration
    for (const service of [chatService, calculatorService, apiService, platformService]) {
      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, service.constructor) as ExtendedServiceMetadata;

      console.log(`\nService: ${metadata.name}@${metadata.version}`);
      console.log(`  Transports: ${metadata.transports?.length || 0}`);

      if (metadata.transports) {
        for (const transport of metadata.transports) {
          console.log(`    - ${transport.name}`);
        }
      }

      if (metadata.transportConfig) {
        console.log('  Transport Config:');
        console.log(`    Timeout: ${metadata.transportConfig.timeout}ms`);
        console.log(`    Compression: ${metadata.transportConfig.compression}`);
        console.log(`    Max Message Size: ${metadata.transportConfig.maxMessageSize} bytes`);
      }
    }

    // Note: In a real application, you would:
    // 1. Create transport servers using the transports from metadata
    // 2. Start listening on those transports
    // 3. Handle incoming connections and route them to services
    // 4. Manage the lifecycle of transport servers

    console.log('\nAll services exposed successfully!');
    console.log('\nNote: The transports are configured but not automatically started.');
    console.log('The application should decide when and how to use these transports.');
  } catch (error) {
    console.error('Error exposing services:', error);
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { ChatService, CalculatorService, ApiService, PlatformService };
