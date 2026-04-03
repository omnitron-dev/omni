/**
 * Auth Guard Decorators
 *
 * Method decorators that read from @kysera/rls context directly,
 * without requiring DI injection of a service.
 *
 * @module @omnitron-dev/titan/netron/auth
 */

import { rlsContext } from '@kysera/rls';
import { hasPermission } from './utils.js';

/**
 * Metadata key for storing RLS requirements.
 */
export const RLS_GUARD_METADATA_KEY = Symbol.for('titan:rls:guard:requirements');

/**
 * Options for @RequireRlsContext decorator.
 */
export interface RequireRlsContextOptions {
  requireUser?: boolean;
  requireTenant?: boolean;
  roles?: string[];
  permissions?: string[];
  message?: string;
}

/**
 * Error thrown when RLS guard requirements are not met.
 */
export class RlsGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RlsGuardError';
  }
}

/**
 * Decorator to require RLS context on a method.
 * Reads directly from @kysera/rls rlsContext singleton.
 */
export function RequireRlsContext(options: RequireRlsContextOptions = {}): MethodDecorator {
  return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value as (...args: unknown[]) => unknown;

    descriptor.value = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const ctx = rlsContext.getContextOrNull();

      if (!ctx) {
        throw new RlsGuardError(options.message ?? 'RLS context required');
      }

      // System users bypass all checks
      if (ctx.auth.isSystem) {
        return originalMethod.apply(this, args);
      }

      if (options.requireUser && !ctx.auth.userId) {
        throw new RlsGuardError(options.message ?? 'User authentication required');
      }

      if (options.requireTenant && !ctx.auth.tenantId) {
        throw new RlsGuardError(options.message ?? 'Tenant context required');
      }

      if (options.roles && options.roles.length > 0) {
        const hasRole = options.roles.some((role) => ctx.auth.roles.includes(role));
        if (!hasRole) {
          throw new RlsGuardError(options.message ?? `Required role: ${options.roles.join(' or ')}`);
        }
      }

      if (options.permissions && options.permissions.length > 0) {
        const hasPerm = options.permissions.some((perm) => hasPermission(ctx.auth.permissions ?? [], perm));
        if (!hasPerm) {
          throw new RlsGuardError(options.message ?? `Required permission: ${options.permissions.join(' or ')}`);
        }
      }

      return originalMethod.apply(this, args);
    };

    Reflect.defineMetadata(RLS_GUARD_METADATA_KEY, options, target, propertyKey);
    return descriptor;
  };
}

/**
 * Require authenticated user in RLS context.
 */
export function RequireUser(): MethodDecorator {
  return RequireRlsContext({
    requireUser: true,
    message: 'User authentication required',
  });
}

/**
 * Require tenant context.
 */
export function RequireTenant(): MethodDecorator {
  return RequireRlsContext({
    requireTenant: true,
    message: 'Tenant context required',
  });
}

/**
 * Require a specific role.
 */
export function RequireRole(role: string): MethodDecorator {
  return RequireRlsContext({
    requireUser: true,
    roles: [role],
    message: `Role required: ${role}`,
  });
}

/**
 * Require a specific permission.
 */
export function RequirePermission(permission: string): MethodDecorator {
  return RequireRlsContext({
    requireUser: true,
    permissions: [permission],
    message: `Permission required: ${permission}`,
  });
}

/**
 * Require admin/system privileges.
 */
export function RequireAdmin(): MethodDecorator {
  return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value as (...args: unknown[]) => unknown;

    descriptor.value = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const ctx = rlsContext.getContextOrNull();

      if (!ctx) {
        throw new RlsGuardError('RLS context required');
      }

      if (!ctx.auth.isSystem) {
        throw new RlsGuardError('Admin privileges required');
      }

      return originalMethod.apply(this, args);
    };

    Reflect.defineMetadata(RLS_GUARD_METADATA_KEY, { requireAdmin: true }, target, propertyKey);
    return descriptor;
  };
}

/**
 * Require any RLS context to be present.
 */
export function RlsProtected(message?: string): MethodDecorator {
  return RequireRlsContext({
    message: message ?? 'RLS context required for this operation',
  });
}

/**
 * Get RLS guard requirements metadata from a method.
 */
export function getRlsGuardRequirements(
  target: object,
  propertyKey: string | symbol
): RequireRlsContextOptions | undefined {
  return Reflect.getMetadata(RLS_GUARD_METADATA_KEY, target, propertyKey);
}
