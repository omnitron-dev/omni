/**
 * Netron Client for Process Manager
 *
 * Handles the client side of Netron communication with spawned processes
 */

import { Netron } from '../../netron/index.js';
import { RemotePeer } from '../../netron/remote-peer.js';
import { Errors } from '../../errors/index.js';
import type { ILogger } from '../logger/logger.types.js';

/**
 * Create a Netron client that can connect to a spawned process
 */
export class NetronClient {
  private netron: Netron;
  private remotePeer?: RemotePeer;
  private connected = false;

  constructor(
    private readonly processId: string,
    private readonly logger: ILogger
  ) {
    this.netron = new Netron(logger as any, {
      id: `pm-client-${processId}`,
      allowServiceEvents: true
    });
  }

  /**
   * Start the Netron client
   */
  async start(): Promise<void> {
    await this.netron.start();
  }

  /**
   * Connect to a remote process
   */
  async connect(transportUrl: string): Promise<void> {
    if (this.connected) {
      throw Errors.conflict('Already connected');
    }

    try {
      // Get transport based on URL
      const { getTransportForAddress } = await import('../../netron/transport/index.js');
      const transport = getTransportForAddress(transportUrl);

      if (!transport) {
        throw Errors.notFound('Transport for URL', transportUrl);
      }

      // Connect to the remote process
      const connection = await transport.connect(transportUrl);

      // Create remote peer with the connection
      this.remotePeer = new RemotePeer(this.netron, connection as any);

      // Add to netron's peer list
      this.netron.peers.set(this.remotePeer.id, this.remotePeer);

      this.connected = true;
      this.logger.info({ processId: this.processId, transportUrl }, 'Connected to process');
    } catch (error) {
      this.logger.error({ error, processId: this.processId, transportUrl }, 'Failed to connect to process');
      throw error;
    }
  }

  /**
   * Query a service interface from the remote process
   */
  async queryInterface<T>(serviceName: string): Promise<T | null> {
    if (!this.connected || !this.remotePeer) {
      throw Errors.conflict('Not connected to process');
    }

    try {
      // Query the interface from the remote peer
      const serviceStub = await this.remotePeer.queryInterface<T>(serviceName);
      return serviceStub;
    } catch (error) {
      this.logger.error({ error, serviceName }, 'Failed to query interface');
      return null;
    }
  }

  /**
   * Call a method on the remote process
   */
  async call(serviceName: string, methodName: string, args: any[]): Promise<any> {
    const service = await this.queryInterface(serviceName);
    if (!service) {
      throw Errors.notFound('Service', serviceName);
    }

    const method = (service as any)[methodName];
    if (typeof method !== 'function') {
      throw Errors.notFound('Method', `${serviceName}.${methodName}`);
    }

    return await method(...args);
  }

  /**
   * Disconnect from the remote process
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      if (this.remotePeer) {
        // Remove from peers
        this.netron.peers.delete(this.remotePeer.id);

        // Close transport if it has a close method
        const transport = (this.remotePeer as any).transport;
        if (transport && typeof transport.close === 'function') {
          await transport.close();
        }
      }

      await this.netron.stop();
      this.connected = false;
    } catch (error) {
      this.logger.error({ error, processId: this.processId }, 'Error during disconnect');
      throw error;
    }
  }

  /**
   * Get the Netron instance
   */
  getNetron(): Netron {
    return this.netron;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}