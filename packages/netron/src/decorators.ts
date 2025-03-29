import { ServiceMetadata } from './types';
import { SERVICE_ANNOTATION } from './common';

/**
 * Decorator to define a service with metadata.
 *
 * @param {string} name - The name of the service.
 * @returns {Function} - A decorator function.
 */
export const Service = (name: string) => (target: any) => {
  const metadata: ServiceMetadata = { name, properties: {}, methods: {} };

  // Extract method information
  for (const key of Object.getOwnPropertyNames(target.prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(target.prototype, key);
    if (!descriptor) continue;

    // Check if the method is public
    const isPublic = Reflect.getMetadata('public', target.prototype, key);
    if (!isPublic) continue;

    // If it is a method
    if (typeof descriptor.value === 'function') {
      const paramTypes = Reflect.getMetadata('design:paramtypes', target.prototype, key) || [];
      const returnType = Reflect.getMetadata('design:returntype', target.prototype, key)?.name || 'void';

      metadata.methods[key] = {
        type: returnType,
        arguments: paramTypes.map((type: any) => type?.name || 'unknown'),
      };
    }
  }

  // Extract property information
  for (const key of Object.keys(new target())) {
    // Check if the property is public
    const isPublic = Reflect.getMetadata('public', target.prototype, key);
    if (!isPublic) continue;

    const type = Reflect.getMetadata('design:type', target.prototype, key)?.name || 'unknown';
    const isReadonly = Reflect.getMetadata('readonly', target.prototype, key);

    metadata.properties[key] = {
      type,
      readonly: !!isReadonly,
    };
  }

  // Store the metadata
  Reflect.defineMetadata(SERVICE_ANNOTATION, metadata, target);
};

/**
 * Decorator to mark a property or method as public.
 *
 * @param {Object} [options] - Options for the decorator.
 * @param {boolean} [options.readonly] - Indicates if the property is read-only.
 * @returns {Function} - A decorator function.
 */
export const Public =
  (options?: { readonly?: boolean }) =>
  (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata('public', true, target, propertyKey);
    if (!descriptor) {
      // For properties
      Reflect.defineMetadata('readonly', options?.readonly, target, propertyKey);
    }
  };
