/**
 * HTTP Interface - Standard RPC Interface for HTTP Transport
 *
 * This is the standard HTTP interface that provides simple RPC functionality,
 * similar to interfaces in other transports (WebSocket, TCP, Unix).
 *
 * CRITICAL: HTTP transport is stateless - the client doesn't need service definitions.
 * Each request contains full information (serviceName, method, args) and the server
 * resolves everything from the request data.
 *
 * For advanced HTTP-specific features (caching, retry, optimistic updates, etc.),
 * use FluentInterface via peer.queryFluentInterface().
 */

import type { Definition } from '../../definition.js';
import type { IPeer } from '../../types.js';
import type { HttpRemotePeer } from './peer.js';

/**
 * HTTP Interface - Standard RPC API
 *
 * Provides a simple proxy-based RPC interface compatible with other Netron transports.
 * Methods are called directly on the interface and proxied to the remote service.
 *
 * IMPORTANT: This is a stateless proxy. No definitions are fetched on the client side.
 * The Proxy intercepts ANY property access as a method call and sends it to the server.
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
   * NOTE: For HTTP transport, this is undefined since we don't fetch definitions
   */
  public $def?: Definition;

  /**
   * Peer reference (for compatibility with standard Interface)
   * @internal
   */
  public $peer?: IPeer;

  constructor(
    private peer: HttpRemotePeer,
    private serviceName: string
  ) {
    // Return proxy that intercepts method calls
    return new Proxy(this, {
      get: (target: HttpInterface<T>, prop: string | symbol) => {
        // Handle symbols (for inspection)
        if (typeof prop === 'symbol') {
          if (prop === Symbol.asyncIterator) return undefined;
          return undefined;
        }

        // Return undefined for $def (no definitions on client side)
        if (prop === '$def') {
          return undefined;
        }

        // Return peer for compatibility
        if (prop === '$peer') {
          return target.$peer;
        }

        // Internal properties
        if (prop === 'peer' || prop === 'serviceName') {
          return Reflect.get(target, prop);
        }

        // CRITICAL: Don't intercept promise-like properties
        // When JavaScript checks if object is a Promise, it looks for 'then'
        // If we return a function, it thinks this is a Promise and tries to await it
        if (prop === 'then' || prop === 'catch' || prop === 'finally' || prop === 'constructor') {
          return undefined;
        }

        // Treat ANY other property access as a method call
        // This is the key difference: we don't check if the method exists in a definition
        // The server will validate and return an error if the method doesn't exist
        return async (...args: any[]) => {
          // Call remote method directly via peer.call()
          // Pass serviceName instead of defId
          const result = await target.peer.call(
            target.serviceName,
            prop,
            args
          );

          return result;
        };
      }
    }) as any;
  }
}
