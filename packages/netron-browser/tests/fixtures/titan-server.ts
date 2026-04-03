/**
 * Titan server fixture for E2E testing
 * Creates a minimal Titan application with Netron and test services
 */

import { Netron } from '@omnitron-dev/titan/netron';
import { HttpTransport } from '@omnitron-dev/titan/netron/transport/http';
import { WebSocketTransport } from '@omnitron-dev/titan/netron/transport/websocket';
import pino from 'pino';
import { CalculatorService, UserService, EchoService, StreamService } from './test-services.js';

export interface TitanServerFixture {
  netron: Netron;
  httpUrl: string;
  wsUrl: string;
  port: number;
  serviceDefinitions: Map<string, string>; // serviceName -> definitionId
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
export async function createTitanServer(options: TitanServerOptions = {}): Promise<TitanServerFixture> {
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

  // Expose test services and collect definition IDs
  const serviceDefinitions = new Map<string, string>();
  const calcDef = await netron.peer.exposeService(new CalculatorService());
  serviceDefinitions.set('calculator@1.0.0', calcDef.id);

  const userDef = await netron.peer.exposeService(new UserService());
  serviceDefinitions.set('user@1.0.0', userDef.id);

  const echoDef = await netron.peer.exposeService(new EchoService());
  serviceDefinitions.set('echo@1.0.0', echoDef.id);

  const streamDef = await netron.peer.exposeService(new StreamService());
  serviceDefinitions.set('stream@1.0.0', streamDef.id);

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
  // Note: When both HTTP and WS are enabled, WS needs to run on a different port
  // or share the HTTP server. For now, we use different ports.
  if (enableWebSocket) {
    netron.registerTransportServer('ws', {
      name: 'ws',
      options: {
        host: 'localhost',
        port: enableHttp && port === 0 ? 0 : port, // Use 0 to get a different random port when HTTP is also enabled with port 0
      },
    });
  }

  // Start Netron - this will start all registered transport servers
  await netron.start();

  // Get the actual ports after starting (in case we used 0 for random port)
  let httpPort = port;
  let wsPort = port;

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
          httpPort = address.port;
        }
      } else if (httpServer.port && httpServer.port !== 0) {
        // Fallback to httpServer.port if not using port 0
        httpPort = httpServer.port;
      }
    }
  }

  if (enableWebSocket) {
    const wsServer = netron.transportServers.get('ws');
    if (wsServer) {
      const nodeServer = (wsServer as any).server;
      if (nodeServer && typeof nodeServer.address === 'function') {
        const address = nodeServer.address();
        if (address && typeof address === 'object') {
          wsPort = address.port;
        }
      } else if (wsServer.port && wsServer.port !== 0) {
        wsPort = wsServer.port;
      }
    }
  }

  const httpUrl = `http://localhost:${httpPort}`;
  const wsUrl = `ws://localhost:${wsPort}`;

  // Cleanup function
  const cleanup = async () => {
    try {
      await netron.stop();
      // Give time for port to be released (longer delay for integration tests)
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      logger.error({ error }, 'Error during cleanup');
    }
  };

  return {
    netron,
    httpUrl,
    wsUrl,
    port: httpPort || wsPort, // Return the primary port (HTTP if available, otherwise WS)
    serviceDefinitions,
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
