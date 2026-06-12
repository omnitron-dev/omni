/**
 * Network port utilities
 */

import net from 'node:net';
import { Errors } from '../errors/index.js';

/**
 * Get an available port at or after `startPort`.
 *
 * XC-12: the previous implementation tried a RANDOM OS-assigned port first and
 * only fell back to `startPort` on error — so `getAvailablePort(8080)` almost
 * always returned some unrelated random port, silently ignoring the argument.
 * It now searches sequentially upward from `startPort` (binding each candidate
 * to verify it is free, advancing on EADDRINUSE), honouring the documented
 * contract. Callers who want any free port can still pass `0` (OS-assigned).
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

    tryPort(startPort);
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
          reject(Errors.unavailable('Port', 'Connection failed'));
        });
      });

      // Successfully connected
      return;
    } catch (_error) {
      // Connection failed, wait and retry
      if (Date.now() - startTime >= timeout) {
        throw Errors.timeout(`Port ${port} availability check`, timeout);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  throw Errors.timeout(`Waiting for port ${port}`, timeout);
}
