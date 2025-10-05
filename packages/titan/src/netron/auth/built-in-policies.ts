/**
 * Built-in policies for common authorization scenarios
 * @module @omnitron-dev/titan/netron/auth
 */

import type { PolicyDefinition } from './types.js';

/**
 * Helper function to get nested value from object by path
 * Example: getNestedValue({ a: { b: { c: 1 } } }, 'a.b.c') => 1
 */
function getNestedValue(obj: any, path: string): any {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Built-in policies for common use cases
 */
export const BuiltInPolicies = {
  /**
   * RBAC: Require specific role
   */
  requireRole: (role: string): PolicyDefinition => ({
    name: `role:${role}`,
    description: `Requires ${role} role`,
    tags: ['rbac', 'role'],
    evaluate: (context) => {
      const hasRole = context.auth?.roles.includes(role);
      return {
        allowed: hasRole ?? false,
        reason: hasRole
          ? `Has required role: ${role}`
          : `Missing role: ${role}`,
      };
    },
  }),

  /**
   * RBAC: Require any of the specified roles
   */
  requireAnyRole: (roles: string[]): PolicyDefinition => ({
    name: `role:any:${roles.join(',')}`,
    description: `Requires any of: ${roles.join(', ')}`,
    tags: ['rbac', 'role'],
    evaluate: (context) => {
      const hasAnyRole = roles.some((role) =>
        context.auth?.roles.includes(role),
      );
      return {
        allowed: hasAnyRole,
        reason: hasAnyRole
          ? `Has one of required roles`
          : `Missing all roles: ${roles.join(', ')}`,
      };
    },
  }),

  /**
   * RBAC: Require all of the specified roles
   */
  requireAllRoles: (roles: string[]): PolicyDefinition => ({
    name: `role:all:${roles.join(',')}`,
    description: `Requires all of: ${roles.join(', ')}`,
    tags: ['rbac', 'role'],
    evaluate: (context) => {
      const hasAllRoles = roles.every((role) =>
        context.auth?.roles.includes(role),
      );
      const missingRoles = roles.filter(
        (role) => !context.auth?.roles.includes(role),
      );
      return {
        allowed: hasAllRoles,
        reason: hasAllRoles
          ? `Has all required roles`
          : `Missing roles: ${missingRoles.join(', ')}`,
      };
    },
  }),

  /**
   * RBAC: Require permission
   */
  requirePermission: (permission: string): PolicyDefinition => ({
    name: `permission:${permission}`,
    description: `Requires ${permission} permission`,
    tags: ['rbac', 'permission'],
    evaluate: (context) => {
      const hasPermission = context.auth?.permissions.includes(permission);
      return {
        allowed: hasPermission ?? false,
        reason: hasPermission
          ? `Has required permission: ${permission}`
          : `Missing permission: ${permission}`,
      };
    },
  }),

  /**
   * RBAC: Require any of the specified permissions
   */
  requireAnyPermission: (permissions: string[]): PolicyDefinition => ({
    name: `permission:any:${permissions.join(',')}`,
    description: `Requires any of: ${permissions.join(', ')}`,
    tags: ['rbac', 'permission'],
    evaluate: (context) => {
      const hasAnyPermission = permissions.some((perm) =>
        context.auth?.permissions.includes(perm),
      );
      return {
        allowed: hasAnyPermission,
        reason: hasAnyPermission
          ? `Has one of required permissions`
          : `Missing all permissions: ${permissions.join(', ')}`,
      };
    },
  }),

  /**
   * ABAC: Resource owner check
   */
  requireResourceOwner: (): PolicyDefinition => ({
    name: 'resource:owner',
    description: 'Requires user to be resource owner',
    tags: ['abac', 'resource'],
    evaluate: (context) => {
      const userId = context.auth?.userId;
      const ownerId = context.resource?.owner;

      if (!userId || !ownerId) {
        return {
          allowed: false,
          reason: 'Missing user or resource owner information',
        };
      }

      const isOwner = userId === ownerId;
      return {
        allowed: isOwner,
        reason: isOwner
          ? 'User is resource owner'
          : 'User is not resource owner',
      };
    },
  }),

  /**
   * ABAC: Time-based access (business hours)
   * @param start Start time in HH:MM format (e.g., "09:00")
   * @param end End time in HH:MM format (e.g., "17:00")
   */
  requireTimeWindow: (start: string, end: string): PolicyDefinition => ({
    name: `time:${start}-${end}`,
    description: `Requires access between ${start} and ${end}`,
    tags: ['abac', 'time'],
    evaluate: (context) => {
      const now = context.environment?.timestamp || new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();

      const [startHour, startMin] = start.split(':').map(Number);
      const [endHour, endMin] = end.split(':').map(Number);
      const startTime = startHour * 60 + startMin;
      const endTime = endHour * 60 + endMin;

      const allowed = currentTime >= startTime && currentTime <= endTime;
      return {
        allowed,
        reason: allowed ? 'Within time window' : 'Outside time window',
      };
    },
  }),

  /**
   * ABAC: IP whitelist
   */
  requireIP: (allowedIPs: string[]): PolicyDefinition => ({
    name: `ip:whitelist:${allowedIPs.join(',')}`,
    description: `Requires IP in: ${allowedIPs.join(', ')}`,
    tags: ['abac', 'ip'],
    evaluate: (context) => {
      const clientIP = context.environment?.ip;
      if (!clientIP) {
        return { allowed: false, reason: 'Client IP not available' };
      }

      const allowed = allowedIPs.includes(clientIP);
      return {
        allowed,
        reason: allowed ? 'IP in whitelist' : 'IP not in whitelist',
      };
    },
  }),

  /**
   * ABAC: IP blacklist
   */
  blockIP: (blockedIPs: string[]): PolicyDefinition => ({
    name: `ip:blacklist:${blockedIPs.join(',')}`,
    description: `Blocks IP from: ${blockedIPs.join(', ')}`,
    tags: ['abac', 'ip'],
    evaluate: (context) => {
      const clientIP = context.environment?.ip;
      if (!clientIP) {
        return { allowed: true, reason: 'Client IP not available' };
      }

      const blocked = blockedIPs.includes(clientIP);
      return {
        allowed: !blocked,
        reason: blocked ? 'IP is blacklisted' : 'IP not blacklisted',
      };
    },
  }),

  /**
   * PBAC: Custom attribute matching
   */
  requireAttribute: (path: string, value: any): PolicyDefinition => ({
    name: `attr:${path}:${value}`,
    description: `Requires ${path} = ${value}`,
    tags: ['abac', 'attribute'],
    evaluate: (context) => {
      const actualValue = getNestedValue(context, path);
      const matches = actualValue === value;
      return {
        allowed: matches,
        reason: matches
          ? `Attribute matches: ${path} = ${value}`
          : `Attribute mismatch: ${path} = ${actualValue}, expected ${value}`,
      };
    },
  }),

  /**
   * RBAC: Require authentication
   */
  requireAuth: (): PolicyDefinition => ({
    name: 'auth:required',
    description: 'Requires authentication',
    tags: ['auth'],
    evaluate: (context) => {
      const isAuth = !!context.auth;
      return {
        allowed: isAuth,
        reason: isAuth ? 'User authenticated' : 'Authentication required',
      };
    },
  }),

  /**
   * OAuth2: Require specific scope
   */
  requireScope: (scope: string): PolicyDefinition => ({
    name: `scope:${scope}`,
    description: `Requires OAuth2 scope: ${scope}`,
    tags: ['oauth2', 'scope'],
    evaluate: (context) => {
      const hasScope = context.auth?.scopes?.includes(scope);
      return {
        allowed: hasScope ?? false,
        reason: hasScope
          ? `Has required scope: ${scope}`
          : `Missing scope: ${scope}`,
      };
    },
  }),

  /**
   * OAuth2: Require any of the specified scopes
   */
  requireAnyScope: (scopes: string[]): PolicyDefinition => ({
    name: `scope:any:${scopes.join(',')}`,
    description: `Requires any of scopes: ${scopes.join(', ')}`,
    tags: ['oauth2', 'scope'],
    evaluate: (context) => {
      const hasAnyScope = scopes.some((scope) =>
        context.auth?.scopes?.includes(scope),
      );
      return {
        allowed: hasAnyScope,
        reason: hasAnyScope
          ? `Has one of required scopes`
          : `Missing all scopes: ${scopes.join(', ')}`,
      };
    },
  }),

  /**
   * Rate limiting policy
   * Note: This is a simple in-memory rate limiter
   * For production, use a distributed rate limiter (Redis)
   */
  rateLimit: (
    maxRequests: number,
    windowMs: number,
  ): PolicyDefinition => {
    const requests = new Map<string, number[]>();

    return {
      name: `ratelimit:${maxRequests}/${windowMs}`,
      description: `Max ${maxRequests} requests per ${windowMs}ms`,
      tags: ['ratelimit'],
      evaluate: (context) => {
        const userId =
          context.auth?.userId || context.environment?.ip || 'anonymous';
        const now = Date.now();

        const userRequests = requests.get(userId) || [];
        const recentRequests = userRequests.filter((t) => now - t < windowMs);

        if (recentRequests.length >= maxRequests) {
          return {
            allowed: false,
            reason: `Rate limit exceeded: ${recentRequests.length}/${maxRequests}`,
            metadata: {
              retryAfter: Math.min(...recentRequests) + windowMs - now,
            },
          };
        }

        recentRequests.push(now);
        requests.set(userId, recentRequests);

        return {
          allowed: true,
          reason: `Within rate limit: ${recentRequests.length}/${maxRequests}`,
          metadata: {
            remaining: maxRequests - recentRequests.length,
          },
        };
      },
    };
  },

  /**
   * Multi-tenant isolation
   * Ensures users can only access resources from their tenant
   */
  requireTenantIsolation: (): PolicyDefinition => ({
    name: 'tenant:isolation',
    description: 'Requires tenant isolation',
    tags: ['abac', 'tenant'],
    evaluate: (context) => {
      const userTenant = context.auth?.metadata?.tenantId;
      const resourceTenant = context.resource?.attributes?.tenantId;

      if (!userTenant) {
        return {
          allowed: false,
          reason: 'User tenant not specified',
        };
      }

      if (!resourceTenant) {
        // Resource has no tenant - allow (could be a global resource)
        return {
          allowed: true,
          reason: 'Resource has no tenant restriction',
        };
      }

      const allowed = userTenant === resourceTenant;
      return {
        allowed,
        reason: allowed
          ? 'User belongs to resource tenant'
          : 'User does not belong to resource tenant',
      };
    },
  }),

  /**
   * Environment check (production, staging, development)
   */
  requireEnvironment: (env: string): PolicyDefinition => ({
    name: `env:${env}`,
    description: `Requires environment: ${env}`,
    tags: ['abac', 'environment'],
    evaluate: (context) => {
      const currentEnv = context.environment?.env || 'unknown';
      const allowed = currentEnv === env;
      return {
        allowed,
        reason: allowed
          ? `Environment matches: ${env}`
          : `Environment mismatch: ${currentEnv}, expected ${env}`,
      };
    },
  }),

  /**
   * Feature flag check
   */
  requireFeatureFlag: (
    flag: string,
    enabled = true,
  ): PolicyDefinition => ({
    name: `feature:${flag}:${enabled}`,
    description: `Requires feature flag ${flag} to be ${enabled}`,
    tags: ['abac', 'feature'],
    evaluate: (context) => {
      const flagValue = context.auth?.metadata?.featureFlags?.[flag];
      const allowed = flagValue === enabled;
      return {
        allowed,
        reason: allowed
          ? `Feature flag ${flag} is ${enabled}`
          : `Feature flag ${flag} is not ${enabled}`,
      };
    },
  }),
};
