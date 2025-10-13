/**
 * @fileoverview NetronService base class for service implementations
 * @module @omnitron-dev/aether/netron
 */

import { inject } from '../../di/index.js';
import { NetronClient } from '../client.js';
import { getBackendName, getServiceName } from '../decorators/index.js';
import type {
  QueryOptions,
  MutationOptions,
  INetronService,
  MethodParameters,
  MethodReturnType,
} from '../types.js';

/**
 * NetronService - Base class for netron services with auto-configuration
 *
 * @template T - Service interface type
 *
 * @example
 * ```typescript
 * interface IUserService {
 *   getUsers(): Promise<User[]>;
 *   getUser(id: string): Promise<User>;
 *   updateUser(id: string, data: Partial<User>): Promise<User>;
 * }
 *
 * @Injectable()
 * @Backend('main')
 * @Service('users@1.0.0')
 * class UserService extends NetronService<IUserService> {
 *   // No boilerplate! Base class handles everything
 *
 *   // Optional: Add convenience methods
 *   async getActiveUsers() {
 *     const users = await this.query('getUsers', []);
 *     return users.filter(u => u.active);
 *   }
 * }
 * ```
 */
export abstract class NetronService<T> implements INetronService<T> {
  protected netron: NetronClient;
  protected backendName: string;
  protected serviceName: string;

  constructor() {
    // Auto-inject NetronClient
    this.netron = inject(NetronClient);

    // Get metadata from decorators
    this.backendName = getBackendName(this.constructor);
    this.serviceName = getServiceName(this.constructor);
  }

  /**
   * Get configured FluentInterface for this service
   *
   * @returns Promise with FluentInterface
   */
  async getService(): Promise<T> {
    const peer = this.netron.backend(this.backendName);
    return await peer.queryFluentInterface<T>(this.serviceName) as T;
  }

  /**
   * Execute a query with default options
   *
   * @param method - Method name
   * @param args - Method arguments
   * @param options - Query options
   * @returns Promise with result
   */
  protected async query<K extends keyof T>(
    method: K,
    args: MethodParameters<T, K>,
    options?: QueryOptions
  ): Promise<MethodReturnType<T, K>> {
    return await this.netron.query(
      this.serviceName,
      method as string,
      args as any[],
      options,
      this.backendName
    );
  }

  /**
   * Execute a mutation with default options
   *
   * @param method - Method name
   * @param args - Method arguments
   * @param options - Mutation options
   * @returns Promise with result
   */
  protected async mutate<K extends keyof T>(
    method: K,
    args: MethodParameters<T, K>,
    options?: MutationOptions
  ): Promise<MethodReturnType<T, K>> {
    return await this.netron.mutate(
      this.serviceName,
      method as string,
      args as any[],
      options,
      this.backendName
    );
  }

  /**
   * Invalidate cache for this service
   *
   * @param pattern - Cache key pattern or tags
   */
  protected invalidate(pattern: string | RegExp | string[]): void {
    this.netron.invalidate(pattern, this.backendName);
  }

  /**
   * Get cache statistics for this service
   *
   * @returns Cache statistics
   */
  protected getCacheStats() {
    return this.netron.getCacheStats();
  }
}