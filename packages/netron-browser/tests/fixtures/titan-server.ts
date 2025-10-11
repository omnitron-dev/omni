/**
 * Titan server fixture for E2E testing
 * Creates a minimal Titan application with Netron and test services
 */

import { Netron } from '@omnitron-dev/titan/netron';
import { HttpTransport } from '@omnitron-dev/titan/netron/transport/http';
import { WebSocketTransport } from '@omnitron-dev/titan/netron/transport/websocket';
import pino from 'pino';
import {
  CalculatorService,
  UserService,
  EchoService,
  StreamService,
} from './test-services.js';

export interface TitanServerFixture {
  netron: Netron;
  httpUrl: string;
  wsUrl: string;
  port: number;
  cleanup: () => Promise<void>;
}

export interface TitanServerOptions {
  port?: number;
  enableHttp?: boolean;
  enableWebSocket?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
}

/**
 * Create and start a Titan server with Netron for testing
 */
export async function createTitanServer(
  options: TitanServerOptions = {}
): Promise<TitanServerFixture> {
  const {
    port = 0, // Use 0 for random available port
    enableHttp = true,
    enableWebSocket = true,
    logLevel = 'silent',
  } = options;

  // Create logger
  const logger = pino({
    level: logLevel,
    transport:
      logLevel !== 'silent'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
            },
          }
        : undefined,
  });

  // Create Netron instance
  const netron = new Netron(logger, {
    id: 'test-server',
  });

  // Register transports
  if (enableHttp) {
    netron.registerTransport('http', () => new HttpTransport());
  }

  if (enableWebSocket) {
    netron.registerTransport('ws', () => new WebSocketTransport());
  }

  // Expose test services
  await netron.peer.exposeService(new CalculatorService());
  await netron.peer.exposeService(new UserService());
  await netron.peer.exposeService(new EchoService());
  await netron.peer.exposeService(new StreamService());

  // Register HTTP transport server if enabled
  if (enableHttp) {
    netron.registerTransportServer('http', {
      name: 'http',
      options: {
        host: 'localhost',
        port,
      },
    });
  }

  // Register WebSocket transport server if enabled
  if (enableWebSocket) {
    netron.registerTransportServer('ws', {
      name: 'ws',
      options: {
        host: 'localhost',
        port, // Use same port as HTTP
      },
    });
  }

  // Start Netron - this will start all registered transport servers
  await netron.start();

  // Get the actual port after starting (in case we used 0 for random port)
  let actualPort = port;
  if (enableHttp) {
    const httpServer = netron.transportServers.get('http');
    if (httpServer) {
      // For HTTP server, try to get the actual port from the underlying Node.js server
      // The HttpServer.port getter just returns the option, but when port 0 is used,
      // we need to get the actual assigned port from the Node.js server
      const nodeServer = (httpServer as any).server;
      if (nodeServer && typeof nodeServer.address === 'function') {
        const address = nodeServer.address();
        if (address && typeof address === 'object') {
          actualPort = address.port;
        }
      } else if (httpServer.port && httpServer.port !== 0) {
        // Fallback to httpServer.port if not using port 0
        actualPort = httpServer.port;
      }
    }
  } else if (enableWebSocket) {
    const wsServer = netron.transportServers.get('ws');
    if (wsServer && wsServer.port) {
      actualPort = wsServer.port;
    }
  }

  const httpUrl = `http://localhost:${actualPort}`;
  const wsUrl = `ws://localhost:${actualPort}`;

  // Cleanup function
  const cleanup = async () => {
    try {
      await netron.stop();
      // Give time for port to be released
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      logger.error({ error }, 'Error during cleanup');
    }
  };

  return {
    netron,
    httpUrl,
    wsUrl,
    port: actualPort,
    cleanup,
  };
}

/**
 * Get an available port for testing
 */
export async function getAvailablePort(basePort = 3000): Promise<number> {
  const http = await import('node:http');

  return new Promise((resolve, reject) => {
    const server = http.createServer();

    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get port')));
      }
    });

    server.on('error', reject);
  });
}
