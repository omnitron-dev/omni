/**
 * Netron-Discovery Integration Service
 *
 * Automatically registers/unregisters services with Discovery when they are
 * exposed/unexposed via Netron. This provides seamless service discovery
 * for all Netron services without manual configuration.
 *
 * @module modules/discovery/netron-integration
 */

import { Injectable, Inject, Optional, PostConstruct, PreDestroy } from '../../decorators/index.js';
import { NETRON_TOKEN } from '../../application/application.js';
import { DISCOVERY_SERVICE_TOKEN, type IDiscoveryService, type ServiceInfo } from './types.js';
import { NETRON_EVENT_SERVICE_EXPOSE, NETRON_EVENT_SERVICE_UNEXPOSE } from '../../netron/constants.js';
import type { Netron } from '../../netron/netron.js';
import type { ServiceExposeEvent, ServiceUnexposeEvent } from '../../netron/types.js';
import type { ILogger } from '../logger/logger.types.js';
import { LOGGER_TOKEN } from './types.js';

/**
 * Configuration options for Netron-Discovery integration
 */
export interface NetronDiscoveryIntegrationOptions {
  /**
   * Whether to enable the integration. Default: true
   */
  enabled?: boolean;

  /**
   * Whether to register existing services when integration starts.
   * Default: true
   */
  registerExisting?: boolean;

  /**
   * Whether to include service metadata in discovery registration.
   * Default: false
   */
  includeMetadata?: boolean;
}

/**
 * Service that integrates Netron service exposure with Discovery registration.
 *
 * When a service is exposed via Netron, it is automatically registered with
 * the Discovery service. When a service is unexposed, it is automatically
 * unregistered.
 *
 * This integration is optional - if either Netron or Discovery is not available,
 * the integration gracefully does nothing.
 *
 * @example
 * ```typescript
 * // The integration is automatically enabled when both Netron and Discovery
 * // modules are present. Services exposed via Netron are automatically
 * // registered with Discovery.
 *
 * await app.expose(myService); // Auto-registered with Discovery
 * ```
 */
@Injectable()
export class NetronDiscoveryIntegration {
  private enabled = true;
  private serviceExposeHandler: (event: ServiceExposeEvent) => void;
  private serviceUnexposeHandler: (event: ServiceUnexposeEvent) => void;
  private initialized = false;

  constructor(
    @Optional() @Inject(NETRON_TOKEN) private netron: Netron | null,
    @Optional() @Inject(DISCOVERY_SERVICE_TOKEN) private discovery: IDiscoveryService | null,
    @Optional() @Inject(LOGGER_TOKEN) private logger?: ILogger
  ) {
    // Bind handlers in constructor to ensure they're always defined
    this.serviceExposeHandler = this.handleServiceExpose.bind(this);
    this.serviceUnexposeHandler = this.handleServiceUnexpose.bind(this);
  }

  /**
   * Initialize the integration by setting up event listeners.
   * Called automatically after construction when used with Titan's lifecycle.
   */
  @PostConstruct()
  async onModuleInit(): Promise<void> {
    // Skip if already initialized
    if (this.initialized) {
      return;
    }

    // Skip if either dependency is missing
    if (!this.netron) {
      this.logger?.debug?.('NetronDiscoveryIntegration: Netron not available, skipping integration');
      return;
    }

    if (!this.discovery) {
      this.logger?.debug?.('NetronDiscoveryIntegration: Discovery service not available, skipping integration');
      return;
    }

    this.logger?.info?.('NetronDiscoveryIntegration: Initializing Netron-Discovery integration');

    // Listen for service expose events
    this.netron.on(NETRON_EVENT_SERVICE_EXPOSE, this.serviceExposeHandler);

    // Listen for service unexpose events
    this.netron.on(NETRON_EVENT_SERVICE_UNEXPOSE, this.serviceUnexposeHandler);

    // Register any existing services
    await this.registerExistingServices();

    this.initialized = true;
    this.logger?.info?.('NetronDiscoveryIntegration: Integration initialized successfully');
  }

  /**
   * Clean up event listeners when the module is destroyed.
   */
  @PreDestroy()
  async onModuleDestroy(): Promise<void> {
    if (!this.initialized || !this.netron) {
      return;
    }

    this.logger?.debug?.('NetronDiscoveryIntegration: Cleaning up event listeners');

    // Remove event listeners
    this.netron.off(NETRON_EVENT_SERVICE_EXPOSE, this.serviceExposeHandler);
    this.netron.off(NETRON_EVENT_SERVICE_UNEXPOSE, this.serviceUnexposeHandler);

    this.initialized = false;
  }

  /**
   * Handle service expose event by registering with Discovery
   */
  private async handleServiceExpose(event: ServiceExposeEvent): Promise<void> {
    if (!this.enabled || !this.discovery) {
      return;
    }

    try {
      const serviceInfo: ServiceInfo = {
        name: event.name,
        version: event.version,
      };

      this.logger?.debug?.(
        { service: event.name, version: event.version },
        'NetronDiscoveryIntegration: Registering service with Discovery'
      );

      await this.discovery.registerService(serviceInfo);

      this.logger?.info?.(
        { service: event.name, version: event.version },
        'NetronDiscoveryIntegration: Service registered with Discovery'
      );
    } catch (error) {
      this.logger?.error?.(
        { error, service: event.name },
        'NetronDiscoveryIntegration: Failed to register service with Discovery'
      );
    }
  }

  /**
   * Handle service unexpose event by unregistering from Discovery
   */
  private async handleServiceUnexpose(event: ServiceUnexposeEvent): Promise<void> {
    if (!this.enabled || !this.discovery) {
      return;
    }

    try {
      this.logger?.debug?.({ service: event.name }, 'NetronDiscoveryIntegration: Unregistering service from Discovery');

      await this.discovery.unregisterService(event.name);

      this.logger?.info?.({ service: event.name }, 'NetronDiscoveryIntegration: Service unregistered from Discovery');
    } catch (error) {
      this.logger?.error?.(
        { error, service: event.name },
        'NetronDiscoveryIntegration: Failed to unregister service from Discovery'
      );
    }
  }

  /**
   * Register any existing Netron services with Discovery.
   * This handles the case where services were exposed before the integration was initialized.
   */
  private async registerExistingServices(): Promise<void> {
    if (!this.netron || !this.discovery) {
      return;
    }

    const existingServices = this.netron.services;
    if (existingServices.size === 0) {
      return;
    }

    this.logger?.debug?.({ count: existingServices.size }, 'NetronDiscoveryIntegration: Registering existing services');

    for (const [qualifiedName, stub] of existingServices) {
      try {
        const meta = stub.definition.meta;
        const serviceInfo: ServiceInfo = {
          name: meta.name,
          version: meta.version,
        };

        await this.discovery.registerService(serviceInfo);

        this.logger?.debug?.(
          { service: meta.name, version: meta.version },
          'NetronDiscoveryIntegration: Existing service registered'
        );
      } catch (error) {
        this.logger?.error?.(
          { error, qualifiedName },
          'NetronDiscoveryIntegration: Failed to register existing service'
        );
      }
    }
  }

  /**
   * Enable or disable the integration at runtime.
   * When disabled, new service expose/unexpose events will not be forwarded to Discovery.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.logger?.info?.({ enabled }, 'NetronDiscoveryIntegration: Integration enabled state changed');
  }

  /**
   * Check if the integration is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if the integration is initialized and active
   */
  isActive(): boolean {
    return this.initialized && this.enabled && !!this.netron && !!this.discovery;
  }

  /**
   * Manually trigger registration of all current Netron services.
   * Useful for re-syncing state after network issues.
   */
  async resyncServices(): Promise<void> {
    if (!this.isActive()) {
      this.logger?.warn?.('NetronDiscoveryIntegration: Cannot resync - integration not active');
      return;
    }

    this.logger?.info?.('NetronDiscoveryIntegration: Resyncing services');
    await this.registerExistingServices();
  }
}
