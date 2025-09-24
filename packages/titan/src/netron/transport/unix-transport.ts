/**
 * Unix Socket Transport Implementation
 *
 * High-performance Unix domain socket transport for local inter-process communication.
 */

import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TcpConnection, TcpServer, TcpTransport, TcpOptions } from './tcp-transport.js';
import {
  TransportCapabilities,
  ITransportConnection,
  ITransportServer
} from './types.js';

/**
 * Unix socket specific options
 */
export interface UnixSocketOptions extends TcpOptions {
  /** Socket file permissions (octal) */
  mode?: number;
  /** Force overwrite existing socket file */
  force?: boolean;
  /** Socket directory */
  socketDir?: string;
}

/**
 * Unix Socket Connection
 *
 * Extends TcpConnection to properly handle Unix socket addresses
 */
export class UnixSocketConnection extends TcpConnection {
  private socketPath: string;

  constructor(socket: net.Socket, options: UnixSocketOptions, path: string) {
    super(socket, options);
    this.socketPath = path;
  }

  override get remoteAddress(): string | undefined {
    return this.socketPath;
  }
}

/**
 * Unix Socket Server
 *
 * Extends TcpServer to properly handle Unix socket connections
 */
export class UnixSocketServer extends TcpServer {
  private socketPath: string;

  constructor(server: net.Server, options: UnixSocketOptions, path: string) {
    super(server, options);
    this.socketPath = path;

    // Override the connection handler
    server.removeAllListeners('connection');
    server.on('connection', (socket: net.Socket) => {
      const connection = new UnixSocketConnection(socket, options, this.socketPath);
      this.handleConnection(connection);
    });
  }

  override get address(): string | undefined {
    return this.socketPath;
  }
}

/**
 * Unix Socket Transport
 *
 * Extends TCP transport since Unix sockets use the same Node.js net module
 */
export class UnixSocketTransport extends TcpTransport {
  override readonly name: any = 'unix';
  override readonly capabilities: TransportCapabilities = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: true,
    multiplexing: false,
    server: true
  };

  /**
   * Connect to a Unix socket
   */
  override async connect(address: string, options: UnixSocketOptions = {}): Promise<ITransportConnection> {
    const parsed = this.parseAddress(address);

    // Reject non-Unix addresses
    if (parsed.protocol && parsed.protocol !== 'unix') {
      throw new Error(`Invalid Unix socket address: ${address}. Protocol '${parsed.protocol}' is not supported.`);
    }

    const socketPath = parsed.path || address;

    // Ensure socket path is absolute
    const absolutePath = path.isAbsolute(socketPath) ?
                        socketPath :
                        path.join(process.cwd(), socketPath);

    // Check if socket exists
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isSocket()) {
        throw new Error(`Path ${absolutePath} is not a Unix socket`);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // Socket doesn't exist yet, which is fine for connecting
    }

    const socket = net.createConnection({
      path: absolutePath
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      }, options.connectTimeout ?? 10000);

      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve(new UnixSocketConnection(socket, options, absolutePath));
      });

      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Create a Unix socket server
   */
  override async createServer(pathOrOptions?: string | UnixSocketOptions): Promise<ITransportServer> {
    let options: UnixSocketOptions = {};
    let socketPath: string;

    // Parse path if string provided
    if (typeof pathOrOptions === 'string') {
      socketPath = pathOrOptions;
    } else if (pathOrOptions) {
      options = pathOrOptions;
      socketPath = (options as any).path;
      if (!socketPath) {
        throw new Error('Unix socket server requires a path');
      }
    } else {
      throw new Error('Unix socket server requires a path');
    }

    // Ensure socket path is absolute
    const absolutePath = path.isAbsolute(socketPath) ?
                        socketPath :
                        path.join(process.cwd(), socketPath);

    // Ensure directory exists
    const socketDir = path.dirname(absolutePath);
    try {
      await fs.mkdir(socketDir, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }

    // Remove existing socket if force option is set
    if (options.force) {
      try {
        await fs.unlink(absolutePath);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    const server = net.createServer();

    // Start listening
    await new Promise<void>((resolve, reject) => {
      server.listen(absolutePath, () => {
        // Set socket permissions if specified
        if (options.mode !== undefined) {
          fs.chmod(absolutePath, options.mode).catch(error => {
            console.error('Failed to set socket permissions:', error);
          });
        }
        resolve();
      });

      server.once('error', reject);
    });

    // Wrap in UnixSocketServer
    const unixServer = new UnixSocketServer(server, options, absolutePath);

    // Clean up socket file on close
    const originalClose = unixServer.close.bind(unixServer);
    unixServer.close = async () => {
      await originalClose();
      try {
        await fs.unlink(absolutePath);
      } catch (error) {
        // Ignore errors during cleanup
      }
    };

    return unixServer;
  }

  /**
   * Parse Unix socket address
   */
  override parseAddress(address: string): any {
    if (address.startsWith('unix://')) {
      return {
        protocol: 'unix',
        path: address.substring(7),
        params: {}
      };
    }

    if (address.startsWith('unix:')) {
      return {
        protocol: 'unix',
        path: address.substring(5),
        params: {}
      };
    }

    // If it looks like a URL with protocol, use base implementation
    if (address.includes('://')) {
      return super.parseAddress(address);
    }

    // Assume it's a path
    return {
      protocol: 'unix',
      path: address,
      params: {}
    };
  }

  /**
   * Check if address is valid Unix socket path
   */
  override isValidAddress(address: string): boolean {
    try {
      const parsed = this.parseAddress(address);
      return parsed.protocol === 'unix' && !!parsed.path;
    } catch {
      return false;
    }
  }
}

/**
 * Named Pipe Transport for Windows
 *
 * Windows implementation of Unix-like sockets
 */
export class NamedPipeTransport extends TcpTransport {
  override readonly name: any = 'pipe';
  override readonly capabilities: TransportCapabilities = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: true,
    multiplexing: false,
    server: true
  };

  /**
   * Connect to a named pipe
   */
  override async connect(address: string, options: TcpOptions = {}): Promise<ITransportConnection> {
    const parsed = this.parseAddress(address);

    // Reject non-pipe addresses
    if (parsed.protocol && parsed.protocol !== 'pipe') {
      throw new Error(`Invalid named pipe address: ${address}. Protocol '${parsed.protocol}' is not supported.`);
    }

    const pipeName = parsed.path || address;

    // Build Windows pipe path
    const pipePath = pipeName.startsWith('\\\\.\\pipe\\') ?
                    pipeName :
                    `\\\\.\\pipe\\${pipeName}`;

    const socket = net.createConnection({
      path: pipePath
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      }, options.connectTimeout ?? 10000);

      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve(new UnixSocketConnection(socket, options as UnixSocketOptions, pipePath));
      });

      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Create a named pipe server
   */
  override async createServer(pathOrOptions?: string | TcpOptions): Promise<ITransportServer> {
    let options: TcpOptions = {};
    let pipeName: string;

    // Parse name if string provided
    if (typeof pathOrOptions === 'string') {
      pipeName = pathOrOptions;
    } else if (pathOrOptions) {
      options = pathOrOptions;
      pipeName = (options as any).name || (options as any).path;
      if (!pipeName) {
        throw new Error('Named pipe server requires a name');
      }
    } else {
      throw new Error('Named pipe server requires a name');
    }

    // Build Windows pipe path
    const pipePath = pipeName.startsWith('\\\\.\\pipe\\') ?
                    pipeName :
                    `\\\\.\\pipe\\${pipeName}`;

    const server = net.createServer();

    // Start listening
    await new Promise<void>((resolve, reject) => {
      server.listen(pipePath, () => {
        resolve();
      });

      server.once('error', reject);
    });

    return new UnixSocketServer(server, options as UnixSocketOptions, pipePath);
  }

  /**
   * Parse named pipe address
   */
  override parseAddress(address: string): any {
    if (address.startsWith('pipe://')) {
      const path = address.substring(7);
      return {
        protocol: 'pipe',
        path: path.startsWith('\\\\.\\pipe\\') ? path : `\\\\.\\pipe\\${path}`,
        params: {}
      };
    }

    if (address.startsWith('pipe:')) {
      const path = address.substring(5);
      return {
        protocol: 'pipe',
        path: path.startsWith('\\\\.\\pipe\\') ? path : `\\\\.\\pipe\\${path}`,
        params: {}
      };
    }

    // Assume it's a pipe name
    return {
      protocol: 'pipe',
      path: address.startsWith('\\\\.\\pipe\\') ? address : `\\\\.\\pipe\\${address}`,
      params: {}
    };
  }

  /**
   * Check if address is valid pipe name
   */
  override isValidAddress(address: string): boolean {
    try {
      const parsed = this.parseAddress(address);
      return parsed.protocol === 'pipe' && !!parsed.path;
    } catch {
      return false;
    }
  }
}
// Export alias for compatibility
export { UnixSocketTransport as UnixTransport };
