/**
 * TCP Transport Implementation
 *
 * High-performance TCP transport for internal service communication.
 */

import net from 'node:net';
import { BaseTransport, BaseConnection, BaseServer } from './base-transport.js';
import {
  TransportCapabilities,
  TransportOptions,
  ITransportConnection,
  ITransportServer,
  ConnectionState
} from './types.js';
import { NetronErrors, Errors } from '../../errors/index.js';

/**
 * TCP-specific options
 */
export interface TcpOptions extends TransportOptions {
  /** TCP no delay (disable Nagle's algorithm) */
  noDelay?: boolean;
  /** TCP keep-alive delay in milliseconds */
  keepAliveDelay?: number;
  /** Socket timeout in milliseconds */
  timeout?: number;
  /** Allow half-open connections */
  allowHalfOpen?: boolean;
}

/**
 * TCP connection implementation
 */
export class TcpConnection extends BaseConnection {
  private socket: net.Socket;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(socket: net.Socket, options: TcpOptions = {}) {
    super(options);
    this.socket = socket;
    this.setupSocket();
    this.setupEventHandlers();
  }

  get remoteAddress(): string | undefined {
    return `${this.socket.remoteAddress}:${this.socket.remotePort}`;
  }

  get localAddress(): string | undefined {
    return `${this.socket.localAddress}:${this.socket.localPort}`;
  }

  /**
   * Configure socket options
   */
  private setupSocket(): void {
    const options = this.options as TcpOptions;

    // Set TCP no delay
    if (options.noDelay !== undefined) {
      this.socket.setNoDelay(options.noDelay);
    }

    // Set keep-alive
    if (options.keepAlive?.enabled || options.keepAliveDelay) {
      this.socket.setKeepAlive(
        true,
        options.keepAliveDelay ?? options.keepAlive?.interval ?? 60000
      );
    }

    // Set timeout
    if (options.timeout) {
      this.socket.setTimeout(options.timeout);
    }
  }

  /**
   * Setup socket event handlers
   */
  private setupEventHandlers(): void {
    // Handle connection
    if (this.socket.readyState === 'open') {
      this.handleConnect();
    } else {
      this.setState(ConnectionState.CONNECTING);
      this.socket.once('connect', () => {
        this.handleConnect();
      });
    }

    // Handle incoming data
    this.socket.on('data', (data: Buffer) => {
      // Buffer data for packet parsing
      this.buffer = Buffer.concat([this.buffer, data]);
      this.processBuffer();
    });

    // Handle errors
    this.socket.on('error', (error: Error) => {
      this.setState(ConnectionState.ERROR);
      this.emit('error', error);
    });

    // Handle close
    this.socket.on('close', (hadError: boolean) => {
      this.cleanup();
      this.handleDisconnect(hadError ? 'Connection error' : 'Connection closed');
    });

    // Handle timeout
    this.socket.on('timeout', () => {
      this.emit('error', NetronErrors.connectionTimeout('tcp', this.remoteAddress || 'unknown'));
      this.socket.destroy();
    });
  }

  /**
   * Process buffered data to extract packets
   */
  private processBuffer(): void {
    // Check if we have enough data for a packet header
    while (this.buffer.length >= 4) {
      // Read packet length (first 4 bytes, big-endian)
      const packetLength = this.buffer.readUInt32BE(0);

      // Check if we have the full packet
      if (this.buffer.length >= packetLength + 4) {
        // Extract packet data
        const packetData = this.buffer.subarray(4, packetLength + 4);

        // Remove processed data from buffer
        this.buffer = this.buffer.subarray(packetLength + 4);

        // Handle the packet
        this.handleData(packetData);
      } else {
        // Wait for more data
        break;
      }
    }
  }

  /**
   * Send data through TCP socket with length prefix
   */
  async send(data: Buffer | ArrayBuffer | Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== 'open') {
        reject(NetronErrors.connectionClosed('tcp', 'Socket is not open'));
        return;
      }

      // Convert to Buffer if needed
      let buffer: Buffer;
      if (Buffer.isBuffer(data)) {
        buffer = data;
      } else if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(new Uint8Array(data));
      } else {
        buffer = Buffer.from(data);
      }

      // Create packet with length prefix
      const lengthBuffer = Buffer.allocUnsafe(4);
      lengthBuffer.writeUInt32BE(buffer.length, 0);
      const packet = Buffer.concat([lengthBuffer, buffer]);

      // Send with callback
      this.socket.write(packet, (error) => {
        if (error) {
          reject(error);
        } else {
          this.metrics.bytesSent += packet.length;
          resolve();
        }
      });
    });
  }

  /**
   * Close the TCP connection
   */
  async close(code?: number, reason?: string): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.destroyed) {
        resolve();
        return;
      }

      this.setState(ConnectionState.DISCONNECTING);

      const closeHandler = () => {
        this.socket.removeListener('close', closeHandler);
        resolve();
      };

      this.socket.once('close', closeHandler);
      this.socket.end();

      // Force destroy after timeout
      setTimeout(() => {
        if (!this.socket.destroyed) {
          this.socket.destroy();
        }
        resolve();
      }, 5000);
    });
  }

  /**
   * Reconnect the TCP socket
   */
  protected async doReconnect(): Promise<void> {
    const { remoteAddress, remotePort } = this.socket;
    if (!remoteAddress || !remotePort) {
      throw NetronErrors.connectionFailed('tcp', 'unknown', new Error('Cannot reconnect: no remote address'));
    }

    const newSocket = net.createConnection({
      host: remoteAddress,
      port: remotePort
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        newSocket.destroy();
        reject(NetronErrors.connectionTimeout('tcp', `${remoteAddress}:${remotePort}`));
      }, this.options.connectTimeout ?? 10000);

      newSocket.once('connect', () => {
        clearTimeout(timeout);
        // Replace old socket with new one
        this.socket.destroy();
        this.socket = newSocket;
        this.setupSocket();
        this.setupEventHandlers();
        resolve();
      });

      newSocket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Clean up resources
   */
  protected override cleanup(): void {
    super.cleanup();
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * TCP server implementation
 */
export class TcpServer extends BaseServer {
  private server: net.Server;

  constructor(server: net.Server, options: TcpOptions = {}) {
    super(options);
    this.server = server;
    this.setupEventHandlers();
  }

  get address(): string | undefined {
    const addr = this.server.address();
    if (typeof addr === 'string') return addr;
    return addr?.address;
  }

  get port(): number | undefined {
    const addr = this.server.address();
    if (typeof addr === 'object' && addr !== null) {
      return addr.port;
    }
    return undefined;
  }

  /**
   * Setup server event handlers
   */
  private setupEventHandlers(): void {
    // Handle new connections
    this.server.on('connection', (socket: net.Socket) => {
      const connection = new TcpConnection(socket, this.options as TcpOptions);
      this.handleConnection(connection);
    });

    // Handle server errors
    this.server.on('error', (error: Error) => {
      this.emit('error', error);
    });

    // Handle server close
    this.server.on('close', () => {
      this.handleClose();
    });

    // If server is already listening
    if (this.server.listening) {
      this.handleListening();
    }
  }

  /**
   * Start listening
   */
  async listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server.listening) {
        this.handleListening();
        resolve();
        return;
      }

      this.server.once('listening', () => {
        this.handleListening();
        resolve();
      });

      this.server.once('error', reject);
    });
  }

  /**
   * Close the TCP server
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close all connections
      for (const connection of this.connections.values()) {
        connection.close();
      }

      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

/**
 * TCP Transport
 */
export class TcpTransport extends BaseTransport {
  readonly name = 'tcp';
  readonly capabilities: TransportCapabilities = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: true,
    multiplexing: false,
    server: true
  };

  /**
   * Connect to a TCP server
   */
  async connect(address: string, options: TcpOptions = {}): Promise<ITransportConnection> {
    const parsed = this.parseAddress(address);

    if (!parsed.host || !parsed.port) {
      throw Errors.badRequest(`Invalid TCP address: ${address}`, { address, parsed });
    }

    const socket = net.createConnection({
      host: parsed.host,
      port: parsed.port,
      allowHalfOpen: options.allowHalfOpen
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(NetronErrors.connectionTimeout('tcp', address));
      }, options.connectTimeout ?? 10000);

      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve(new TcpConnection(socket, options));
      });

      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Create a TCP server
   */
  override async createServer(addressOrOptions?: string | TcpOptions): Promise<ITransportServer> {
    let options: TcpOptions = {};
    let port = 9000;
    let host = '0.0.0.0';

    // Parse address if string provided
    if (typeof addressOrOptions === 'string') {
      const parsed = this.parseAddress(addressOrOptions);
      port = parsed.port || 9000;
      host = parsed.host || '0.0.0.0';
    } else if (addressOrOptions) {
      options = addressOrOptions;
      port = (options as any).port ?? 9000;
      host = (options as any).host ?? '0.0.0.0';
    }

    const server = net.createServer({
      allowHalfOpen: options.allowHalfOpen
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      server.listen(port, host, () => {
        resolve();
      });

      server.once('error', reject);
    });

    return new TcpServer(server, options);
  }

  /**
   * Check if address is valid TCP address
   */
  override isValidAddress(address: string): boolean {
    try {
      const parsed = this.parseAddress(address);
      return parsed.protocol === 'tcp' &&
        !!parsed.host &&
        !!parsed.port &&
        !isNaN(parsed.port);
    } catch {
      return false;
    }
  }
}