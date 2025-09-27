/**
 * Tests for Base Transport Classes
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { EventEmitter } from 'events';
import {
  BaseTransport,
  BaseConnection,
  BaseServer
} from '../../../src/netron/transport/base-transport.js';
import type {
  ITransport,
  IConnection,
  IServer,
  TransportOptions,
  Message
} from '../../../src/netron/transport/types.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';

// Test implementations
class TestConnection extends BaseConnection {
  private _isConnected = false;
  public readonly mockSocket: EventEmitter = new EventEmitter();
  private _remoteAddress: string = 'test://remote';
  private _localAddress: string = 'test://local';

  constructor(options?: TransportOptions) {
    super(options);
  }

  get remoteAddress(): string | undefined {
    return this._remoteAddress;
  }

  get localAddress(): string | undefined {
    return this._localAddress;
  }

  async connect(): Promise<void> {
    if (this._isConnected) {
      throw new Error('Already connected');
    }
    this._isConnected = true;
    this.setState(ConnectionState.CONNECTED);
    this.emit('connect');
  }

  async disconnect(): Promise<void> {
    if (!this._isConnected) {
      return;
    }
    this._isConnected = false;
    this.setState(ConnectionState.DISCONNECTED);
    this.emit('disconnect');
  }

  async close(): Promise<void> {
    await this.disconnect();
  }

  async send(data: Buffer | ArrayBuffer | Uint8Array | Message): Promise<void> {
    if (!this._isConnected) {
      throw new Error('Not connected');
    }

    // Handle both raw data and Message objects for testing
    if (data instanceof Buffer || data instanceof ArrayBuffer || data instanceof Uint8Array) {
      this.emit('data', data);
      // Echo back raw data
      setTimeout(() => {
        this.emit('data', data);
      }, 10);
    } else {
      // Handle as Message
      this.emit('send', data);
      setTimeout(() => {
        this.emit('message', data);
      }, 10);
    }
  }

  async sendPacket(packet: any): Promise<void> {
    await this.send(packet as any);
  }

  protected async doReconnect(): Promise<void> {
    await this.connect();
  }

  getMetrics(): any {
    return this.metrics;
  }
}

class TestServer extends BaseServer {
  private _isListening = false;
  private _address: string;
  private _port: number = 8080;

  constructor(address: string = 'test://0.0.0.0:8080') {
    super();
    this._address = address;
  }

  get address(): string {
    return this._address;
  }

  get port(): number {
    return this._port;
  }

  get isListening(): boolean {
    return this._isListening;
  }

  async listen(): Promise<void> {
    if (this._isListening) {
      throw new Error('Already listening');
    }
    this._isListening = true;
    this.emit('listening');
  }

  async close(): Promise<void> {
    if (!this._isListening) {
      return;
    }

    // Close all connections
    for (const conn of this.connections.values()) {
      await (conn as TestConnection).disconnect();
    }
    this.connections.clear();

    this._isListening = false;
    this.emit('close');
  }

  // Helper method to simulate incoming connection
  simulateConnection(id: string = `conn-${Date.now()}`): TestConnection {
    const connection = new TestConnection();
    this.handleConnection(connection); // This already emits 'connection' event
    return connection;
  }
}

class TestTransport extends BaseTransport {
  readonly name = 'test';
  readonly capabilities = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: true,
    multiplexing: false,
    server: true
  };

  async connect(address: string, options?: TransportOptions): Promise<IConnection> {
    const conn = new TestConnection(options);
    await conn.connect();
    return conn;
  }

  async createServer(options?: TransportOptions): Promise<IServer> {
    const server = new TestServer('test://0.0.0.0:8080');
    await server.listen();
    return server;
  }

  isValidAddress(address: string): boolean {
    return address.startsWith('test://');
  }

  parseAddress(address: string): any {
    return { protocol: 'test', address };
  }
}

describe('BaseTransport Classes', () => {
  describe('BaseConnection', () => {
    let connection: TestConnection;

    beforeEach(() => {
      connection = new TestConnection();
    });

    afterEach(async () => {
      if (connection.state === ConnectionState.CONNECTED) {
        await connection.disconnect();
      }
    });

    it('should have initial state', () => {
      expect(connection.id).toBeDefined();
      expect(connection.id).toHaveLength(36); // UUID length
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should connect and disconnect', async () => {
      const connectSpy = jest.fn();
      const disconnectSpy = jest.fn();

      connection.on('connect', connectSpy);
      connection.on('disconnect', disconnectSpy);

      await connection.connect();
      expect(connection.state).toBe(ConnectionState.CONNECTED);
      expect(connectSpy).toHaveBeenCalledTimes(1);

      await connection.disconnect();
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('should send and receive messages', async () => {
      const messageSpy = jest.fn();
      const sendSpy = jest.fn();

      connection.on('message', messageSpy);
      connection.on('send', sendSpy);

      await connection.connect();

      const message: Message = {
        type: 'test',
        payload: { data: 'hello' }
      };

      await connection.send(message);
      expect(sendSpy).toHaveBeenCalledWith(message);

      // Wait for echo response
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(messageSpy).toHaveBeenCalledWith(message);
    });

    it('should throw when sending without connection', async () => {
      const message: Message = {
        type: 'test',
        payload: { data: 'hello' }
      };

      await expect(connection.send(message)).rejects.toThrow('Not connected');
    });


    it('should emit events', async () => {
      const events: string[] = [];

      connection.on('connect', () => events.push('connect'));
      connection.on('disconnect', () => events.push('disconnect'));
      connection.on('error', (err) => events.push(`error:${err.message}`));

      await connection.connect();
      await connection.disconnect();
      connection.emit('error', new Error('test-error'));

      expect(events).toEqual(['connect', 'disconnect', 'error:test-error']);
    });

    it('should remove all listeners', async () => {
      const spy = jest.fn();
      connection.on('connect', spy);
      connection.on('disconnect', spy);

      connection.removeAllListeners();

      await connection.connect();
      await connection.disconnect();

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('BaseServer', () => {
    let server: TestServer;

    beforeEach(() => {
      server = new TestServer('test://0.0.0.0:8080');
    });

    afterEach(async () => {
      if (server.isListening) {
        await server.close();
      }
    });

    it('should have initial state', () => {
      expect(server.address).toBe('test://0.0.0.0:8080');
      expect(server.isListening).toBe(false);
    });

    it('should listen and close', async () => {
      const listeningSpy = jest.fn();
      const closeSpy = jest.fn();

      server.on('listening', listeningSpy);
      server.on('close', closeSpy);

      await server.listen();
      expect(server.isListening).toBe(true);
      expect(listeningSpy).toHaveBeenCalledTimes(1);

      await server.close();
      expect(server.isListening).toBe(false);
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('should accept connections', async () => {
      const connectionSpy = jest.fn();
      server.on('connection', connectionSpy);

      await server.listen();

      const conn1 = server.simulateConnection('client-1');
      const conn2 = server.simulateConnection('client-2');

      expect(connectionSpy).toHaveBeenCalledTimes(2);
      expect(connectionSpy).toHaveBeenCalledWith(conn1);
      expect(connectionSpy).toHaveBeenCalledWith(conn2);
    });

    it('should close all connections when server closes', async () => {
      await server.listen();

      const conn1 = server.simulateConnection('client-1');
      const conn2 = server.simulateConnection('client-2');

      const disconnect1Spy = jest.fn();
      const disconnect2Spy = jest.fn();

      conn1.on('disconnect', disconnect1Spy);
      conn2.on('disconnect', disconnect2Spy);

      await conn1.connect();
      await conn2.connect();

      await server.close();

      expect(disconnect1Spy).toHaveBeenCalled();
      expect(disconnect2Spy).toHaveBeenCalled();
      expect(conn1.state).toBe(ConnectionState.DISCONNECTED);
      expect(conn2.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should emit error events', () => {
      const errorSpy = jest.fn();
      server.on('error', errorSpy);

      const error = new Error('Server error');
      server.emit('error', error);

      expect(errorSpy).toHaveBeenCalledWith(error);
    });

  });

  describe('BaseTransport', () => {
    let transport: TestTransport;

    beforeEach(() => {
      transport = new TestTransport();
    });

    it('should create connections', async () => {
      const conn = await transport.connect('test://localhost:8080');

      expect(conn).toBeInstanceOf(TestConnection);
      expect(conn.state).toBe(ConnectionState.CONNECTED);
      expect(conn.id).toBeDefined();

      await conn.close();
    });

    it('should create servers', async () => {
      const server = await transport.createServer();

      expect(server).toBeInstanceOf(TestServer);
      expect(server.isListening).toBe(true);
      expect(server.address).toBe('test://0.0.0.0:8080');

      await server.close();
    });

    it('should check address support', async () => {
      expect(transport.isValidAddress('test://localhost')).toBe(true);
      expect(transport.isValidAddress('tcp://localhost')).toBe(false);
      expect(transport.isValidAddress('ws://localhost')).toBe(false);
    });

    it('should handle multiple connections', async () => {
      const connections: IConnection[] = [];

      for (let i = 0; i < 5; i++) {
        const conn = await transport.connect(`test://host-${i}`);
        connections.push(conn);
        expect(conn.state).toBe(ConnectionState.CONNECTED);
      }

      // Clean up
      await Promise.all(connections.map(c => c.close()));
    });

    it('should handle multiple servers', async () => {
      const servers: IServer[] = [];

      for (let i = 0; i < 3; i++) {
        const server = await transport.createServer();
        servers.push(server);
        expect(server.isListening).toBe(true);
      }

      // Clean up
      await Promise.all(servers.map(s => s.close()));
    });
  });

  describe('Event Handling', () => {
    it('should handle connection lifecycle events', async () => {
      const connection = new TestConnection();
      const events: string[] = [];

      connection.on('connect', () => events.push('connect'));
      connection.on('disconnect', () => events.push('disconnect'));
      connection.on('error', () => events.push('error'));
      connection.on('message', () => events.push('message'));

      await connection.connect();
      await connection.send({ type: 'test', payload: {} });
      await new Promise(resolve => setTimeout(resolve, 20));
      await connection.disconnect();

      expect(events).toEqual(['connect', 'message', 'disconnect']);
    });

    it('should handle server lifecycle events', async () => {
      const server = new TestServer('test://0.0.0.0:9090');
      const events: string[] = [];

      server.on('listening', () => events.push('listening'));
      server.on('connection', () => events.push('connection'));
      server.on('close', () => events.push('close'));
      server.on('error', () => events.push('error'));

      await server.listen();
      server.simulateConnection();
      server.simulateConnection();
      await server.close();

      expect(events).toEqual(['listening', 'connection', 'connection', 'close']);
    });

    it('should propagate errors correctly', () => {
      const connection = new TestConnection();
      const server = new TestServer('test://0.0.0.0:9090');

      const connErrorSpy = jest.fn();
      const serverErrorSpy = jest.fn();

      connection.on('error', connErrorSpy);
      server.on('error', serverErrorSpy);

      const connError = new Error('Connection failed');
      const serverError = new Error('Server failed');

      connection.emit('error', connError);
      server.emit('error', serverError);

      expect(connErrorSpy).toHaveBeenCalledWith(connError);
      expect(serverErrorSpy).toHaveBeenCalledWith(serverError);
    });
  });
});
