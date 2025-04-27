import { SetMetadata } from '@nestjs/common';
import { Service as NetronServiceDecorator } from '@devgrid/netron';

/**
 * A constant that serves as a unique identifier for Netron service metadata within the NestJS
 * dependency injection system. This token is used to store and retrieve service qualification
 * information during runtime.
 */
export const NETRON_SERVICE_METADATA = 'NETRON_SERVICE_METADATA';

/**
 * A NestJS-compatible class decorator that integrates the original Netron service decorator
 * with NestJS's dependency injection system.
 * 
 * This decorator serves as a bridge between Netron's service registration system and NestJS's
 * dependency injection container. It applies both the original Netron service decorator and
 * adds necessary metadata for NestJS to properly handle the service.
 * 
 * @param qualifiedName - A string representing the fully qualified service name in the format
 *                       'serviceName@version'. This name is used for service discovery and
 *                       version management within the Netron ecosystem.
 * 
 * @returns A class decorator that applies both Netron and NestJS metadata to the target class.
 * 
 * @remarks
 * The decorator performs two main operations:
 * 1. Applies the original Netron service decorator to register the service with Netron
 * 2. Adds NestJS metadata using SetMetadata to enable proper dependency injection
 * 
 * @example
 * ```typescript
 * @Injectable()
 * @Service('auth@1.0.0')
 * export class AuthService {
 *   // Service implementation
 * }
 * ```
 * 
 * @throws {Error} If the qualifiedName parameter is not provided or is invalid
 */
export function Service(qualifiedName: string): ClassDecorator {
  const netronDecorator = NetronServiceDecorator(qualifiedName);

  return (target: any) => {
    // Apply the original Netron service decorator to register the service
    // with Netron's service discovery system
    netronDecorator(target);

    // Add NestJS metadata to enable proper dependency injection
    // and service resolution within the NestJS container
    SetMetadata(NETRON_SERVICE_METADATA, qualifiedName)(target);
  };
}
