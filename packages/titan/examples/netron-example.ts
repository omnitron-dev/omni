/**
 * Example: Using Netron in Titan Application
 *
 * This example demonstrates how Netron is automatically available
 * as a core service in Titan applications.
 */

import {
  Application,
  Module,
  Injectable,
  Inject,
  NETRON_TOKEN,
  PostConstruct
} from '../src/index.js';
import type { Netron } from '@omnitron-dev/netron';

// Service that uses Netron
@Injectable()
class DistributedService {
  constructor(
    @Inject(NETRON_TOKEN) private netron: Netron
  ) {}

  @PostConstruct()
  async onInit(): Promise<void> {
    // Netron is already initialized and ready to use
    console.log(`Netron ID: ${this.netron.id}`);
    console.log(`Available services: ${this.netron.getServiceNames().join(', ')}`);

    // Register event handlers
    this.netron.on('peer:connected', (peer) => {
      console.log(`Peer connected: ${peer.id}`);
    });

    this.netron.on('peer:disconnected', (peerId) => {
      console.log(`Peer disconnected: ${peerId}`);
    });
  }

  async connectToPeer(address: string): Promise<void> {
    try {
      const peer = await this.netron.connect(address);
      console.log(`Connected to peer: ${peer.id}`);
    } catch (error) {
      console.error('Failed to connect to peer:', error);
    }
  }
}

// Module that provides the service
@Module({
  providers: [DistributedService],
  exports: [DistributedService]
})
class NetworkModule {
  constructor(private service: DistributedService) {}

  async onStart(): Promise<void> {
    console.log('Network module started');
    // Example: Connect to another Titan instance
    // await this.service.connectToPeer('ws://localhost:9001');
  }
}

// Main application
async function main() {
  const app = await Application.create(NetworkModule, {
    name: 'netron-example',
    version: '1.0.0',
    
    // Configure Netron through application config
    config: {
      netron: {
        id: 'example-node',
        port: 9000,
        discovery: {
          enabled: false // Set to true to enable Redis discovery
        }
      },
      logging: {
        level: 'info',
        pretty: true
      }
    }
  });

  // Start the application
  await app.start();

  // Access Netron directly from the application
  const netron = app.netron;
  if (netron) {
    console.log('Netron is available:', netron.id);
    console.log('Netron peers:', netron.peers.size);
  }

  // Graceful shutdown after 30 seconds
  setTimeout(async () => {
    console.log('Shutting down...');
    await app.stop();
    process.exit(0);
  }, 30000);
}

// Handle errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

main().catch(console.error);
