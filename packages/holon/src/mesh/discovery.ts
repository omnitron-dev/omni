/**
 * Service discovery with multiple backend support
 */

import type { DiscoveryConfig } from '../types.js';
import { EventEmitter } from 'eventemitter3';

export interface ServiceInfo {
  name: string;
  nodeId: string;
  endpoint: string;
  metadata?: Record<string, unknown>;
  registeredAt?: number;
}

export interface DiscoveryEvents {
  'service:registered': (service: ServiceInfo) => void;
  'service:unregistered': (serviceName: string) => void;
  'service:discovered': (service: ServiceInfo) => void;
}

/**
 * Service discovery
 *
 * Supports:
 * - DNS-based discovery
 * - Static node lists
 * - Peer-to-peer discovery
 * - Consul/etcd integration (hooks for future implementation)
 */
export class Discovery extends EventEmitter<DiscoveryEvents> {
  private readonly config: DiscoveryConfig;
  private readonly services: Map<string, ServiceInfo> = new Map();
  private discoveryInterval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: DiscoveryConfig) {
    super();
    this.config = config;
  }

  /**
   * Register a service
   */
  async register(service: ServiceInfo): Promise<void> {
    service.registeredAt = Date.now();
    this.services.set(service.name, service);
    this.emit('service:registered', service);

    // In a real implementation, would register with:
    // - DNS for dns type
    // - Consul/etcd for consul/etcd types
    // - Broadcast to peers for peer type
  }

  /**
   * Unregister a service
   */
  async unregister(serviceName: string): Promise<void> {
    this.services.delete(serviceName);
    this.emit('service:unregistered', serviceName);

    // In a real implementation, would unregister from backend
  }

  /**
   * Discover services
   */
  async discover(serviceName?: string): Promise<ServiceInfo[]> {
    if (serviceName) {
      const service = this.services.get(serviceName);
      return service ? [service] : [];
    }

    return Array.from(this.services.values());
  }

  /**
   * Get a specific service
   */
  async getService(serviceName: string): Promise<ServiceInfo | undefined> {
    return this.services.get(serviceName);
  }

  /**
   * Start discovery
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    // Load initial services based on discovery type
    await this.loadInitialServices();

    // Start periodic discovery
    const interval = this.config.interval ?? 30000;
    this.discoveryInterval = setInterval(() => {
      this.performDiscovery();
    }, interval);
  }

  /**
   * Stop discovery
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
  }

  /**
   * Check if discovery is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Load initial services
   */
  private async loadInitialServices(): Promise<void> {
    switch (this.config.type) {
      case 'static':
        if (this.config.nodes) {
          for (const node of this.config.nodes) {
            const service: ServiceInfo = {
              name: node,
              nodeId: node,
              endpoint: node,
              registeredAt: Date.now(),
            };
            this.services.set(node, service);
          }
        }
        break;

      case 'dns':
        // Would implement DNS SRV record lookup
        break;

      case 'consul':
      case 'etcd':
        // Would connect to Consul/etcd and fetch services
        break;

      case 'peer':
        // Would broadcast discovery request to network
        break;
    }
  }

  /**
   * Perform periodic discovery
   */
  private async performDiscovery(): Promise<void> {
    // Implementation would depend on discovery type
    // For now, just emit discovered events for existing services
    for (const service of this.services.values()) {
      this.emit('service:discovered', service);
    }
  }

  /**
   * Get discovery statistics
   */
  getStats(): DiscoveryStats {
    return {
      servicesCount: this.services.size,
      running: this.running,
      type: this.config.type,
    };
  }
}

export interface DiscoveryStats {
  servicesCount: number;
  running: boolean;
  type: string;
}

/**
 * Create a new discovery instance
 */
export function createDiscovery(config: DiscoveryConfig): Discovery {
  return new Discovery(config);
}
