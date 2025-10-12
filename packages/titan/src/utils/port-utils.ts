/**
 * Network port utilities
 */

import net from 'net';

/**
 * Get an available port
 */
export async function getAvailablePort(startPort = 10000, maxPort = 65535): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const server = net.createServer();

      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // Port in use, try next
          if (port < maxPort) {
            tryPort(port + 1);
          } else {
            reject(new Error('No available ports'));
          }
        } else {
          reject(err);
        }
      });

      server.once('listening', () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address !== null ? address.port : port;
        server.close(() => {
          resolve(actualPort);
        });
      });

      server.listen(port);
    };

    // Try finding a random port first
    const server = net.createServer();
    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });

    server.once('error', () => {
      // Fallback to sequential search
      tryPort(startPort);
    });

    // Listen on random port (0 means OS assigns)
    server.listen(0);
  });
}

/**
 * Check if a port is available
 */
export async function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, host);
  });
}

/**
 * Wait for a port to become available
 */
export async function waitForPort(port: number, host = '127.0.0.1', timeout = 30000, interval = 100): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ port, host });

        socket.once('connect', () => {
          socket.end();
          resolve();
        });

        socket.once('error', () => {
          reject(new Error('Connection failed'));
        });
      });

      // Successfully connected
      return;
    } catch (error) {
      // Connection failed, wait and retry
      if (Date.now() - startTime >= timeout) {
        throw new Error(`Port ${port} not available after ${timeout}ms`);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  throw new Error(`Timeout waiting for port ${port}`);
}
