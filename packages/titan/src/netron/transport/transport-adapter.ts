/**
 * Transport Adapter for Netron
 *
 * Provides a high-level interface for managing multiple transport types
 * through a unified API.
 */

import { WebSocket } from 'ws';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import {
  ITransportConnection,
  ITransportServer,
  ITransportRegistry,
  TransportOptions,
  ConnectionState,
  TransportCapabilities,
  TransportAddress
} from './types.js';
import { TransportRegistry, getTransportForAddress } from './transport-registry.js';
import { Packet, encodePacket } from '../packet/index.js';

/**
 * WebSocket compatibility adapter
 *
 * Wraps a transport connection to provide WebSocket-like interface
 * for compatibility with existing RemotePeer implementation.
 */
export class WebSocketCompatibilityAdapter extends EventEmitter {
  // WebSocket readyState constants
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  private connection: ITransportConnection;
  private _readyState: number = WebSocketCompatibilityAdapter.CONNECTING;
  private _url?: string;
  private _binaryType: 'nodebuffer' | 'arraybuffer' = 'nodebuffer';

  constructor(connection: ITransportConnection, url?: string) {
    super();
    this.connection = connection;
    this._url = url;
    this.setupEventHandlers();
  }

  /**
   * WebSocket-compatible readyState property
   */
  get readyState(): number {
    switch (this.connection.state) {
      case ConnectionState.CONNECTING:
        return WebSocketCompatibilityAdapter.CONNECTING;
      case ConnectionState.CONNECTED:
        return WebSocketCompatibilityAdapter.OPEN;
      case ConnectionState.DISCONNECTING:
        return WebSocketCompatibilityAdapter.CLOSING;
      case ConnectionState.DISCONNECTED:
      case ConnectionState.ERROR:
        return WebSocketCompatibilityAdapter.CLOSED;
      default:
        return WebSocketCompatibilityAdapter.CLOSED;
    }
  }

  /**
   * WebSocket-compatible properties
   */
  get url(): string | undefined {
    return this._url;
  }

  get binaryType(): string {
    return this._binaryType;
  }

  set binaryType(type: string) {
    if (type !== 'nodebuffer' && type !== 'arraybuffer') {
      throw new Error('Invalid binary type');
    }
    this._binaryType = type as 'nodebuffer' | 'arraybuffer';
  }

  /**
   * Remote address (for compatibility with ws WebSocket)
   */
  get _socket(): any {
    return {
      remoteAddress: this.connection.remoteAddress?.split(':')[0],
      remotePort: this.connection.remoteAddress?.split(':')[1],
      localAddress: this.connection.localAddress?.split(':')[0],
      localPort: this.connection.localAddress?.split(':')[1]
    };
  }

  /**
   * Setup event handlers to map transport events to WebSocket events
   */
  private setupEventHandlers(): void {
    // Map connect event to open
    this.connection.on('connect', () => {
      this._readyState = WebSocketCompatibilityAdapter.OPEN;
      this.emit('open');
    });

    // Map packet/data events to message
    this.connection.on('packet', (packet: Packet) => {
      const encoded = encodePacket(packet);
      const data = this._binaryType === 'arraybuffer' ?
                  encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) :
                  Buffer.from(encoded);
      // Packets are always binary
      this.emit('message', data, true);
    });

    this.connection.on('data', (data: Buffer | ArrayBuffer) => {
      const buffer = this._binaryType === 'arraybuffer' && Buffer.isBuffer(data) ?
                    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) :
                    data;
      // Raw data is treated as non-binary (text) for handshake messages
      this.emit('message', buffer, false);
    });

    // Map error event
    this.connection.on('error', (error: Error) => {
      this.emit('error', error);
    });

    // Map disconnect event to close
    this.connection.on('disconnect', (reason?: string) => {
      this._readyState = WebSocketCompatibilityAdapter.CLOSED;
      this.emit('close', 1000, Buffer.from(reason || ''));
    });
  }

  /**
   * WebSocket-compatible send method
   */
  send(data: any, callback?: (err?: Error) => void): void {
    // Convert data to Buffer
    let buffer: Buffer;
    if (Buffer.isBuffer(data)) {
      buffer = data;
    } else if (data instanceof ArrayBuffer) {
      buffer = Buffer.from(data);
    } else if (data instanceof Uint8Array) {
      buffer = Buffer.from(data);
    } else if (typeof data === 'string') {
      buffer = Buffer.from(data);
    } else {
      const error = new Error('Invalid data type');
      if (callback) callback(error);
      else throw error;
      return;
    }

    this.connection.send(buffer)
      .then(() => {
        if (typeof callback === 'function') callback();
      })
      .catch(err => {
        if (typeof callback === 'function') callback(err);
        // Log error if no callback provided
        else console.error('WebSocketCompatibilityAdapter send error:', err);
      });
  }

  /**
   * WebSocket-compatible close method
   */
  close(code?: number, reason?: string): void {
    this._readyState = WebSocketCompatibilityAdapter.CLOSING;
    this.connection.close(code, reason)
      .catch(error => this.emit('error', error));
  }

  /**
   * WebSocket-compatible ping method
   */
  ping(data?: any, mask?: boolean, callback?: (err?: Error) => void): void {
    if (this.connection.ping) {
      this.connection.ping()
        .then(() => callback?.())
        .catch(err => callback?.(err));
    } else {
      callback?.(new Error('Ping not supported by transport'));
    }
  }

  /**
   * WebSocket-compatible pong method
   */
  pong(data?: any, mask?: boolean, callback?: (err?: Error) => void): void {
    // Most transports don't support explicit pong
    callback?.();
  }

  /**
   * WebSocket-compatible terminate method
   */
  terminate(): void {
    this._readyState = WebSocketCompatibilityAdapter.CLOSED;
    this.connection.close(1006, 'Terminated')
      .catch(() => { /* Ignore errors on terminate */ });
  }
}

/**
 * Transport-based connection factory
 *
 * Creates connections using the transport abstraction layer
 * while maintaining WebSocket compatibility.
 */
export class TransportConnectionFactory {
  /**
   * Create a connection to a remote endpoint
   *
   * @param address - Address to connect to (can be any transport URL)
   * @param options - Connection options
   * @returns WebSocket-compatible connection
   */
  static async connect(address: string, options: TransportOptions = {}): Promise<WebSocketCompatibilityAdapter> {
    // Get appropriate transport for address
    const transport = getTransportForAddress(address);
    if (!transport) {
      throw new Error(`No transport available for address: ${address}`);
    }

    // Create connection using transport
    const connection = await transport.connect(address, options);

    // Wrap in WebSocket adapter
    return new WebSocketCompatibilityAdapter(connection, address);
  }

  /**
   * Create a WebSocket-compatible connection from an existing transport connection
   */
  static fromConnection(connection: ITransportConnection, url?: string): WebSocketCompatibilityAdapter {
    return new WebSocketCompatibilityAdapter(connection, url);
  }

  /**
   * Check if we can use native WebSocket (for backward compatibility)
   */
  static isNativeWebSocket(socket: any): socket is WebSocket {
    return socket instanceof WebSocket ||
           (typeof socket === 'object' &&
            'readyState' in socket &&
            'send' in socket &&
            'close' in socket &&
            !('connection' in socket)); // Exclude our adapter
  }

  /**
   * Get WebSocket adapter from either native WebSocket or transport connection
   */
  static getAdapter(socket: WebSocket | ITransportConnection): WebSocketCompatibilityAdapter {
    if (this.isNativeWebSocket(socket)) {
      // Create minimal adapter for native WebSocket
      return this.fromNativeWebSocket(socket);
    }
    return this.fromConnection(socket as ITransportConnection);
  }

  /**
   * Create adapter from native WebSocket
   */
  private static fromNativeWebSocket(ws: WebSocket): WebSocketCompatibilityAdapter {
    // Create a minimal transport connection wrapper
    const connection = new NativeWebSocketWrapper(ws);
    return new WebSocketCompatibilityAdapter(connection, ws.url);
  }
}

/**
 * Wrapper for native WebSocket to implement ITransportConnection
 */
class NativeWebSocketWrapper extends EventEmitter implements ITransportConnection {
  readonly id: string = Math.random().toString(36).substring(7);
  private ws: WebSocket;

  constructor(ws: WebSocket) {
    super();
    this.ws = ws;
    this.setupHandlers();
  }

  get state(): ConnectionState {
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return ConnectionState.CONNECTING;
      case WebSocket.OPEN:
        return ConnectionState.CONNECTED;
      case WebSocket.CLOSING:
        return ConnectionState.DISCONNECTING;
      case WebSocket.CLOSED:
      default:
        return ConnectionState.DISCONNECTED;
    }
  }

  get remoteAddress(): string | undefined {
    // @ts-expect-error
    return this.ws._socket?.remoteAddress;
  }

  get localAddress(): string | undefined {
    // @ts-expect-error
    return this.ws._socket?.localAddress;
  }

  private setupHandlers(): void {
    this.ws.on('open', () => this.emit('connect'));
    this.ws.on('message', (data) => {
      const buffer = Buffer.isBuffer(data) ? data :
                    data instanceof ArrayBuffer ? Buffer.from(data) :
                    Buffer.concat(data as Buffer[]);
      this.emit('data', buffer);
    });
    this.ws.on('error', (err) => this.emit('error', err));
    this.ws.on('close', (code, reason) => this.emit('disconnect', reason?.toString()));
  }

  async send(data: Buffer | ArrayBuffer | Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.send(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async sendPacket(packet: Packet): Promise<void> {
    const encoded = encodePacket(packet);
    return this.send(encoded);
  }

  async close(code?: number, reason?: string): Promise<void> {
    this.ws.close(code, reason);
  }

  async ping(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.ping((err: Error | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

/**
 * Main transport adapter for managing multiple transport types
 */
export class TransportAdapter {
  private registry: ITransportRegistry;

  constructor(registry?: ITransportRegistry) {
    this.registry = registry || TransportRegistry.createWithDefaults();
  }

  /**
   * Connect to an address using appropriate transport
   */
  async connect(address: string, options?: TransportOptions): Promise<ITransportConnection> {
    // First try to detect the protocol from the address format
    const match = address.match(/^([a-z]+):\/\//i);
    if (!match || !match[1]) {
      throw new Error(`Invalid address format: ${address}`);
    }

    const protocol = match[1].toLowerCase();

    // Then check if we have a transport for this protocol
    const transport = this.registry.getByProtocol(protocol);
    if (!transport) {
      throw new Error(`No transport found for protocol: ${protocol}`);
    }

    return transport.connect(address, options);
  }

  /**
   * Create a server for the specified transport type
   */
  async createServer(transportName: string, options?: TransportOptions): Promise<ITransportServer> {
    const transport = this.registry.get(transportName);
    if (!transport) {
      throw new Error(`Transport not found: ${transportName}`);
    }

    if (!transport.createServer) {
      throw new Error(`Transport ${transportName} does not support server mode`);
    }

    return transport.createServer(options);
  }

  /**
   * Get list of available transport names
   */
  getAvailableTransports(): string[] {
    return this.registry.list();
  }

  /**
   * Check if address is valid for any registered transport
   */
  isValidAddress(address: string): boolean {
    const protocol = this.detectProtocol(address);
    if (!protocol) {
      return false;
    }

    const transport = this.registry.getByProtocol(protocol);
    return transport ? transport.isValidAddress(address) : false;
  }

  /**
   * Parse address using appropriate transport
   */
  parseAddress(address: string): TransportAddress {
    const protocol = this.detectProtocol(address);
    if (!protocol) {
      throw new Error(`Invalid address format: ${address}`);
    }

    const transport = this.registry.getByProtocol(protocol);
    if (!transport) {
      throw new Error(`No transport found for protocol: ${protocol}`);
    }

    return transport.parseAddress(address);
  }

  /**
   * Detect protocol from address
   */
  detectProtocol(address: string): string | null {
    if (!address || typeof address !== 'string') {
      return null;
    }

    // Check for malformed URLs (protocol without host/path)
    if (address.match(/^[a-z]+:\/?\/?$/i)) {
      return null;
    }

    const match = address.match(/^([a-z]+):\/\//i);
    if (!match || !match[1]) {
      return null;
    }

    const protocol = match[1].toLowerCase();

    // Check if this protocol is actually supported
    const transport = this.registry.getByProtocol(protocol);
    return transport ? protocol : null;
  }

  /**
   * Get transport capabilities
   */
  getTransportCapabilities(transportName: string): TransportCapabilities | null {
    const transport = this.registry.get(transportName);
    return transport ? transport.capabilities : null;
  }
}