import { Inject } from '@nestjs/common';
import { Netron } from '@devgrid/netron';

import { NETRON_INSTANCE } from '../constants';

/**
 * A dependency injection decorator that provides access to the Netron instance within NestJS components.
 *
 * This decorator is used to inject the Netron instance into services, controllers, and other NestJS components.
 * It leverages NestJS's dependency injection system to provide a singleton instance of Netron throughout the application.
 *
 * @remarks
 * The decorator uses the `NETRON_INSTANCE` token to identify the Netron instance in the dependency injection container.
 * This ensures type-safe injection and proper scoping of the Netron instance.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(
 *     @InjectNetron()
 *     private readonly netron: Netron
 *   ) {}
 * }
 * ```
 *
 * @returns A parameter decorator that marks a constructor parameter for Netron instance injection
 */
export const InjectNetron = () => Inject(NETRON_INSTANCE);

/**
 * Re-exports the Netron type from '@devgrid/netron' to ensure consistent type definitions
 * across the application when using the Netron instance.
 *
 * @remarks
 * This export enables proper type checking and IDE support when working with the injected
 * Netron instance, ensuring type safety throughout the application.
 */
export type { Netron };
