import semver from 'semver';

import { ServiceMetadata } from './types';
import { SERVICE_ANNOTATION } from './constants';

/**
 * Service decorator factory that creates a class decorator for defining Netron services.
 * This decorator processes the service class to extract metadata about its public methods
 * and properties, validates the service name and version, and stores the metadata using
 * reflection.
 *
 * @param {string} qualifiedName - The fully qualified name of the service in the format 'name[@version]'
 *                                where version is optional and must follow semantic versioning.
 * @returns {ClassDecorator} A decorator function that processes the target class
 *
 * @throws {Error} If the service name is invalid or doesn't match the required pattern
 * @throws {Error} If the version string is provided but doesn't follow semantic versioning
 *
 * @example
 * @Service('auth@1.0.0')
 * class AuthService {
 *   @Public()
 *   async login(username: string, password: string): Promise<string> {
 *     // Implementation
 *   }
 * }
 */
export const Service = (qualifiedName: string) => (target: any) => {
  // Parse the qualified name into name and version components
  const [name, version] = qualifiedName.split('@');

  // Regular expression to validate service names
  // Allows alphanumeric characters and dots for namespacing
  const nameRegex = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/;

  // Validate service name format
  if (!name || !nameRegex.test(name)) {
    throw new Error(`Invalid service name "${name}". Only latin letters and dots are allowed.`);
  }

  // Validate version string if provided
  if (version && !semver.valid(version)) {
    throw new Error(`Invalid version "${version}". Version must follow semver.`);
  }

  // Initialize metadata structure
  const metadata: ServiceMetadata = {
    name,
    version: version ?? '',
    properties: {},
    methods: {},
  };

  // Process class methods to extract metadata
  for (const key of Object.getOwnPropertyNames(target.prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(target.prototype, key);
    if (!descriptor) continue;

    // Skip non-public methods
    const isPublic = Reflect.getMetadata('public', target.prototype, key);
    if (!isPublic) continue;

    // Process method metadata
    if (typeof descriptor.value === 'function') {
      // Extract parameter types and return type using reflection
      const paramTypes = Reflect.getMetadata('design:paramtypes', target.prototype, key) || [];
      const returnType = Reflect.getMetadata('design:returntype', target.prototype, key)?.name || 'void';

      // Store method metadata
      metadata.methods[key] = {
        type: returnType,
        arguments: paramTypes.map((type: any) => type?.name || 'unknown'),
      };
    }
  }

  // Process class properties to extract metadata
  for (const key of Object.keys(new target())) {
    // Skip non-public properties
    const isPublic = Reflect.getMetadata('public', target.prototype, key);
    if (!isPublic) continue;

    // Extract property type and readonly status
    const type = Reflect.getMetadata('design:type', target.prototype, key)?.name || 'unknown';
    const isReadonly = Reflect.getMetadata('readonly', target.prototype, key);

    // Store property metadata
    metadata.properties[key] = {
      type,
      readonly: !!isReadonly,
    };
  }

  // Store the complete metadata on the class using reflection
  Reflect.defineMetadata(SERVICE_ANNOTATION, metadata, target);
};

/**
 * Public decorator factory that creates a property or method decorator.
 * This decorator marks class members as publicly accessible in the Netron service
 * and can optionally mark properties as read-only.
 *
 * @param {Object} [options] - Configuration options for the decorator
 * @param {boolean} [options.readonly] - If true, marks the property as read-only
 * @returns {PropertyDecorator | MethodDecorator} A decorator function that processes the target member
 *
 * @example
 * class ExampleService {
 *   @Public({ readonly: true })
 *   public readonly value: string;
 *
 *   @Public()
 *   public method(): void {
 *     // Implementation
 *   }
 * }
 */
export const Public =
  (options?: { readonly?: boolean }) =>
  (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => {
    // Mark the member as public
    Reflect.defineMetadata('public', true, target, propertyKey);

    // For properties (when descriptor is undefined), handle readonly flag
    if (!descriptor) {
      Reflect.defineMetadata('readonly', options?.readonly, target, propertyKey);
    }
  };

/**
 * Alias for the Service decorator, providing an alternative naming convention.
 * @see Service
 */
export const NetronService = Service;

/**
 * Alias for the Public decorator, providing an alternative naming convention.
 * @see Public
 */
export const NetronMethod = Public;
