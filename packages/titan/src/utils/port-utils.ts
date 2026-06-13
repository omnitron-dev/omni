/**
 * Network port utilities
 */

import net from 'node:net';
import { Errors } from '../errors/index.js';

/**
 * Get an available port at or after `startPort`.
 *
 * XC-12: an EXPLICIT `startPort` is honoured by searching sequentially upward
 * from it (binding each candidate to verify it is free, advancing on
 * EADDRINUSE) — the previous code tried a random port first and ignored the
 * argument.
 *
 * XC-12-fix: with NO argument, bind port `0` so the OS assigns a unique free
 * port. The interim default of `10000` made consecutive no-arg calls all return
 * 10000 (each probe binds+closes, freeing it for the next call), so callers that
 * grab several ports in a row — e.g. a server registering ws + tcp transports —
 * got the SAME port for both and collided with EADDRINUSE on start. "Any free
 * port" must be unique per call, which only `listen(0)` guarantees.
 */
export async function getAvailablePort(startPort?: number, maxPort = 65535): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const server = net.createServer();

      server.once('error', (err: any) => {
        // Only walk upward when searching an explicit range; port 0 is
        // OS-assigned and should never EADDRINUSE.
        if (err.code === 'EADDRINUSE' && port !== 0) {
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

    tryPort(startPort ?? 0);
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
