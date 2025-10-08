/**
 * HTTP Interface - Standard RPC Interface for HTTP Transport (Browser Version)
 *
 * This is the standard HTTP interface that provides simple RPC functionality,
 * similar to interfaces in other transports (WebSocket, TCP, Unix).
 *
 * For advanced HTTP-specific features (caching, retry, optimistic updates, etc.),
 * use FluentInterface via peer.queryFluentInterface().
 *
 * Browser-specific:
 * - SSR-safe implementation
 * - Compatible with Aether reactivity
 */

import type { Definition } from '../../definition.js';
import type { IPeer } from '../../types.js';
import { HttpTransportClient } from './client.js';

/**
 * HTTP Interface - Standard RPC API
 *
 * Provides a simple proxy-based RPC interface compatible with other Netron transports.
 * Methods are called directly on the interface and proxied to the remote service.
 *
 * For advanced HTTP features, use FluentInterface via peer.queryFluentInterface().
 *
 * @template T - Service interface type
 *
 * @example
 * ```typescript
 * const userService = await peer.queryInterface<IUserService>('UserService@1.0.0');
 * const user = await userService.getUser('user-123');
 * const users = await userService.listUsers({ page: 1, limit: 10 });
 * ```
 */
export class HttpInterface<T = any> {
  /**
   * Definition metadata (for compatibility with standard Interface)
   * @internal
   */
  public $def?: Definition;

  /**
   * Peer reference (for compatibility with standard Interface)
   * @internal
   */
  public $peer?: IPeer;

  constructor(
    private transport: HttpTransportClient,
    private definition: Definition
  ) {
    // Set compatibility properties
    this.$def = definition;

    // Return proxy that intercepts method calls
    return new Proxy(this, {
      get: (target: HttpInterface<T>, prop: string | symbol) => {
        // Handle symbols (for inspection)
        if (typeof prop === 'symbol') {
          if (prop === Symbol.asyncIterator) return undefined;
          return undefined;
        }

        // Return definition for compatibility
        if (prop === '$def') {
          return target.definition;
        }

        // Return peer for compatibility
        if (prop === '$peer') {
          return target.$peer;
        }

        // Internal properties
        if (prop === 'transport' || prop === 'definition') {
          return Reflect.get(target, prop);
        }

        // Check if it's a method in the service definition
        if (target.definition.meta.methods && target.definition.meta.methods[prop]) {
          // Return async function that calls the remote method
          return async (...args: any[]) => {
            const serviceName = target.definition.meta.name;
            const methodName = prop;

            // Call remote method via HTTP transport
            const result = await target.transport.invoke(
              serviceName,
              methodName,
              args
            );

            return result;
          };
        }

        // Unknown property
        return undefined;
      }
    }) as any;
  }
}
