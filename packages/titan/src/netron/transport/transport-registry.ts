/**
 * Transport Registry
 *
 * Manages registration and lookup of transport implementations.
 */

import { ITransport, ITransportRegistry, TransportFactory } from './types.js';
import { WebSocketTransport } from './websocket-transport.js';
import { TcpTransport } from './tcp-transport.js';
import { UnixSocketTransport } from './unix-transport.js';

/**
 * Global transport registry implementation
 */
export class TransportRegistry implements ITransportRegistry {
  private factories = new Map<string, TransportFactory>();
  private protocolMap = new Map<string, string>(); // protocol -> transport name

  constructor(registerDefaults = true) {
    // Register default transports
    if (registerDefaults) {
      this.registerDefaults();
    }
  }

  /**
   * Register default transport implementations
   */
  private registerDefaults(): void {
    // Register TCP transport
    this.register('tcp', () => new TcpTransport());
    this.mapProtocol('tcp', 'tcp');

    // Register WebSocket transport
    this.register('websocket', () => new WebSocketTransport());
    this.register('ws', () => new WebSocketTransport());
    this.mapProtocol('ws', 'websocket');
    this.mapProtocol('wss', 'websocket');

    // Register Unix socket transport
    this.register('unix', () => new UnixSocketTransport());
    this.mapProtocol('unix', 'unix');
  }

  /**
   * Create a registry with default transports
   */
  static createWithDefaults(): TransportRegistry {
    return new TransportRegistry(true);
  }

  /**
   * Register a transport factory
   */
  register(name: string, factory: TransportFactory): void {
    if (!name || name.trim() === '') {
      throw new Error('Transport name cannot be empty');
    }

    if (typeof factory !== 'function') {
      throw new Error('Transport factory must be a function');
    }

    // Allow overriding existing transport
    this.factories.set(name, factory);
  }

  /**
   * Map a protocol to a transport
   */
  mapProtocol(protocol: string, transportName: string): void {
    this.protocolMap.set(protocol.toLowerCase(), transportName);
  }

  /**
   * Get a transport by name
   */
  get(name: string): ITransport | undefined {
    // Check if factory exists
    const factory = this.factories.get(name);
    if (factory) {
      try {
        const transport = factory();
        if (transport) {
          return transport;
        }
      } catch (error) {
        // Factory failed, return undefined
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Get transport by protocol
   */
  getByProtocol(protocol: string): ITransport | undefined {
    const transportName = this.protocolMap.get(protocol.toLowerCase());
    if (transportName) {
      return this.get(transportName);
    }

    // Try using protocol as transport name
    return this.get(protocol);
  }

  /**
   * Check if transport is registered
   */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /**
   * Get all registered transport names
   */
  list(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Unregister a transport
   */
  unregister(name: string): boolean {
    const hadFactory = this.factories.delete(name);

    // Remove protocol mappings
    for (const [protocol, transportName] of this.protocolMap.entries()) {
      if (transportName === name) {
        this.protocolMap.delete(protocol);
      }
    }

    return hadFactory;
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.factories.clear();
    this.protocolMap.clear();

    // Re-register defaults
    this.registerDefaults();
  }

  /**
   * Get or create transport for address
   */
  getTransportForAddress(address: string): ITransport | undefined {
    // Try to extract protocol from address
    const protocolMatch = address.match(/^([a-z]+):/i);
    if (protocolMatch && protocolMatch[1]) {
      const protocol = protocolMatch[1].toLowerCase();
      return this.getByProtocol(protocol);
    }

    // Default to WebSocket
    return this.get('ws');
  }
}

// Global registry singleton
const globalRegistry = new TransportRegistry();

/**
 * Get the global transport registry
 */
export function getTransportRegistry(): ITransportRegistry {
  return globalRegistry;
}

/**
 * Register a transport in the global registry
 */
export function registerTransport(name: string, factory: TransportFactory): void {
  globalRegistry.register(name, factory);
}

/**
 * Get a transport from the global registry
 */
export function getTransport(name: string): ITransport | undefined {
  return globalRegistry.get(name);
}

/**
 * Get transport by address protocol
 */
export function getTransportForAddress(address: string): ITransport | undefined {
  return globalRegistry.getTransportForAddress(address);
}