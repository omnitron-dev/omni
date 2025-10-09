/**
 * Built-in policies for common authorization scenarios
 * @module @omnitron-dev/titan/netron/auth
 */

import ipaddr from 'ipaddr.js';
import type { PolicyDefinition } from './types.js';
import { RateLimiter, type RateLimitConfig } from './rate-limiter.js';

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
 * Helper function to match permission pattern with wildcards
 * Supports wildcards: "users:*" matches "users:read", "users:write", etc.
 * Example: matchPermissionPattern("users:*", "users:read") => true
 */
function matchPermissionPattern(pattern: string, permission: string): boolean {
  // Exact match
  if (pattern === permission) return true;

  // Convert pattern to regex (escape special chars except *)
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
    .replace(/\*/g, '.*'); // Replace * with .*

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(permission);
}

/**
 * Helper function to check if an IP is in a CIDR range
 */
function isIPInRange(ip: string, cidr: string): { match: boolean; error?: string } {
  try {
    const addr = ipaddr.parse(ip);
    const range = ipaddr.parseCIDR(cidr);

    // Check if address matches the range type (IPv4 or IPv6)
    if (addr.kind() !== range[0].kind()) {
      return { match: false };
    }

    return { match: addr.match(range) };
  } catch (error) {
    return {
      match: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Helper function to convert timezone-aware time to UTC minutes
 */
function getUTCMinutes(date: Date, timezone?: string): number {
  if (!timezone) {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }

  // Use Intl.DateTimeFormat to get time in specific timezone
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const hour = parseInt(
      parts.find((p) => p.type === 'hour')?.value || '0',
      10,
    );
    const minute = parseInt(
      parts.find((p) => p.type === 'minute')?.value || '0',
      10,
    );

    return hour * 60 + minute;
  } catch {
    // Fallback to UTC if timezone is invalid
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

/**
 * Helper function to get day of week in specific timezone
 */
function getDayOfWeek(date: Date, timezone?: string): number {
  if (!timezone) {
    return date.getUTCDay();
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });

    const dayStr = formatter.format(date);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days.indexOf(dayStr);
  } catch {
    return date.getUTCDay();
  }
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
   * @param timezone Optional IANA timezone (e.g., "America/New_York", "Europe/London")
   * @example
   * // UTC time window
   * requireTimeWindow("09:00", "17:00")
   *
   * // EST time window
   * requireTimeWindow("09:00", "17:00", "America/New_York")
   */
  requireTimeWindow: (
    start: string,
    end: string,
    timezone?: string,
  ): PolicyDefinition => ({
    name: timezone ? `time:${start}-${end}:${timezone}` : `time:${start}-${end}`,
    description: timezone
      ? `Requires access between ${start} and ${end} (${timezone})`
      : `Requires access between ${start} and ${end}`,
    tags: ['abac', 'time'],
    evaluate: (context) => {
      const now = context.environment?.timestamp || new Date();
      const currentTime = getUTCMinutes(now, timezone);

      const [startHour = 0, startMin = 0] = start.split(':').map(Number);
      const [endHour = 23, endMin = 59] = end.split(':').map(Number);
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
   * Rate limiting policy (simple version)
   * Uses RateLimiter internally with automatic cleanup
   * For advanced features (tiers, queuing, burst), use requireRateLimit()
   */
  rateLimit: (
    maxRequests: number,
    windowMs: number,
  ): PolicyDefinition => {
    // Create a minimal logger for RateLimiter
    const minimalLogger: any = {
      debug: () => {},
      warn: () => {},
      error: () => {},
      child: () => minimalLogger,
    };

    // Use production-ready RateLimiter internally
    const limiter = new RateLimiter(minimalLogger, {
      strategy: 'sliding', // Keep sliding window as original implementation
      window: windowMs,
      defaultTier: { name: 'default', limit: maxRequests },
    });

    return {
      name: `ratelimit:${maxRequests}/${windowMs}`,
      description: `Max ${maxRequests} requests per ${windowMs}ms`,
      tags: ['ratelimit'],
      evaluate: async (context) => {
        const userId =
          context.auth?.userId || context.environment?.ip || 'anonymous';

        try {
          // Check and consume in one operation
          const checkResult = await limiter.check(userId);

          if (!checkResult.allowed) {
            return {
              allowed: false,
              reason: `Rate limit exceeded: ${maxRequests}/${windowMs}ms`,
              metadata: {
                retryAfter: checkResult.retryAfter,
              },
            };
          }

          // Consume the request
          await limiter.consume(userId);

          // Calculate remaining AFTER consume (so it's accurate)
          const remaining = checkResult.remaining - 1;

          return {
            allowed: true,
            reason: `Within rate limit: ${remaining} remaining`,
            metadata: {
              remaining: remaining,
            },
          };
        } catch (error) {
          // If consume throws (rate limit exceeded), return denied
          return {
            allowed: false,
            reason: `Rate limit exceeded: ${maxRequests}/${windowMs}ms`,
            metadata: {
              retryAfter: windowMs,
            },
          };
        }
      },
      onDestroy: () => {
        limiter.destroy();
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
      const userTenant = context.auth?.metadata?.['tenantId'];
      const resourceTenant = context.resource?.attributes?.['tenantId'];

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
      const currentEnv = context.environment?.['env'] || 'unknown';
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
      const flagValue = context.auth?.metadata?.['featureFlags']?.[flag];
      const allowed = flagValue === enabled;
      return {
        allowed,
        reason: allowed
          ? `Feature flag ${flag} is ${enabled}`
          : `Feature flag ${flag} is not ${enabled}`,
      };
    },
  }),

  /**
   * RBAC: Require permission pattern with wildcards
   * Supports wildcards in permission matching
   * @param pattern Permission pattern (e.g., "users:*" matches "users:read", "users:write")
   * @example
   * // Match all user permissions
   * requirePermissionPattern("users:*")
   *
   * // Match all admin permissions
   * requirePermissionPattern("admin:*")
   *
   * // Match specific pattern
   * requirePermissionPattern("documents:*:read")
   */
  requirePermissionPattern: (pattern: string): PolicyDefinition => ({
    name: `permission:pattern:${pattern}`,
    description: `Requires permission matching pattern: ${pattern}`,
    tags: ['rbac', 'permission', 'pattern'],
    evaluate: (context) => {
      const permissions = context.auth?.permissions || [];
      const hasMatch = permissions.some((perm) =>
        matchPermissionPattern(pattern, perm),
      );

      return {
        allowed: hasMatch,
        reason: hasMatch
          ? `Has permission matching pattern: ${pattern}`
          : `No permission matches pattern: ${pattern}`,
      };
    },
  }),

  /**
   * ABAC: IP range check with CIDR notation
   * Supports both IPv4 and IPv6 CIDR ranges
   * @param cidr CIDR notation (e.g., "192.168.1.0/24", "2001:db8::/32")
   * @example
   * // IPv4 range
   * requireIPRange("192.168.1.0/24")
   *
   * // IPv6 range
   * requireIPRange("2001:db8::/32")
   *
   * // Multiple ranges (use with policy combinators)
   * requireIPRange("10.0.0.0/8")
   */
  requireIPRange: (cidr: string): PolicyDefinition => ({
    name: `ip:range:${cidr}`,
    description: `Requires IP in range: ${cidr}`,
    tags: ['abac', 'ip', 'cidr'],
    evaluate: (context) => {
      const clientIP = context.environment?.ip;

      if (!clientIP) {
        return {
          allowed: false,
          reason: 'Client IP not available',
        };
      }

      const result = isIPInRange(clientIP, cidr);

      if (result.error) {
        return {
          allowed: false,
          reason: `Invalid IP or CIDR format: ${result.error}`,
        };
      }

      return {
        allowed: result.match,
        reason: result.match
          ? `IP ${clientIP} is in range ${cidr}`
          : `IP ${clientIP} is not in range ${cidr}`,
      };
    },
  }),

  /**
   * ABAC: Business hours policy
   * Allows access only during specified business hours and weekdays
   * @param config Business hours configuration
   * @example
   * // Standard business hours (Mon-Fri, 9-5 EST)
   * requireBusinessHours({
   *   timezone: "America/New_York",
   *   start: "09:00",
   *   end: "17:00",
   *   weekdays: [1, 2, 3, 4, 5]
   * })
   *
   * // 24/7 except weekends
   * requireBusinessHours({
   *   timezone: "UTC",
   *   start: "00:00",
   *   end: "23:59",
   *   weekdays: [1, 2, 3, 4, 5]
   * })
   */
  requireBusinessHours: (config: {
    timezone: string;
    start: string;
    end: string;
    weekdays: number[];
  }): PolicyDefinition => ({
    name: `businesshours:${config.timezone}:${config.start}-${config.end}`,
    description: `Requires business hours: ${config.start}-${config.end} (${config.timezone}) on ${config.weekdays.join(',')}`,
    tags: ['abac', 'time', 'business'],
    evaluate: (context) => {
      const now = context.environment?.timestamp || new Date();

      // Check day of week
      const currentDay = getDayOfWeek(now, config.timezone);
      if (!config.weekdays.includes(currentDay)) {
        const dayNames = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ];
        return {
          allowed: false,
          reason: `Not a business day (current: ${dayNames[currentDay]})`,
        };
      }

      // Check time window
      const currentTime = getUTCMinutes(now, config.timezone);
      const [startHour = 0, startMin = 0] = config.start.split(':').map(Number);
      const [endHour = 23, endMin = 59] = config.end.split(':').map(Number);
      const startTime = startHour * 60 + startMin;
      const endTime = endHour * 60 + endMin;

      const inTimeWindow = currentTime >= startTime && currentTime <= endTime;

      return {
        allowed: inTimeWindow,
        reason: inTimeWindow
          ? 'Within business hours'
          : 'Outside business hours',
      };
    },
  }),

  /**
   * Rate limiting policy (advanced)
   * Uses the RateLimiter class for sophisticated rate limiting
   * Supports multiple strategies, tiered limits, and queuing
   *
   * @param config Rate limit configuration
   * @param logger Logger instance (required for RateLimiter)
   * @example
   * // Simple rate limit
   * requireRateLimit(logger, {
   *   defaultTier: { name: 'default', limit: 100 },
   *   window: 60000 // 1 minute
   * })
   *
   * // Tiered rate limiting with queue
   * requireRateLimit(logger, {
   *   strategy: 'sliding',
   *   window: 60000,
   *   queue: true,
   *   defaultTier: { name: 'free', limit: 100 },
   *   tiers: {
   *     premium: { name: 'premium', limit: 1000, burst: 50, priority: 5 },
   *     enterprise: { name: 'enterprise', limit: 10000, burst: 200, priority: 10 }
   *   },
   *   getTier: (ctx) => ctx.auth?.roles.includes('enterprise') ? 'enterprise' :
   *                      ctx.auth?.roles.includes('premium') ? 'premium' : 'free'
   * })
   */
  requireRateLimit: (
    logger: any,
    config: RateLimitConfig
  ): PolicyDefinition => {
    const limiter = new RateLimiter(logger, config);

    return {
      name: `ratelimit:advanced:${config.strategy ?? 'sliding'}`,
      description: `Rate limiting with ${config.strategy ?? 'sliding'} strategy`,
      tags: ['ratelimit', 'advanced'],
      evaluate: async (context) => {
        try {
          // Determine key (user ID or IP)
          const key = context.auth?.userId || context.environment?.ip || 'anonymous';

          // Determine tier
          let tier: string | undefined;
          if (config.getTier) {
            tier = config.getTier(context);
          }

          // Check rate limit
          const result = await limiter.check(key, tier);

          if (!result.allowed) {
            return {
              allowed: false,
              reason: `Rate limit exceeded for tier ${result.tier}. Retry after ${result.retryAfter}ms`,
              metadata: {
                retryAfter: result.retryAfter,
                resetAt: result.resetAt,
                tier: result.tier,
              },
            };
          }

          // Consume the request
          await limiter.consume(key, tier);

          return {
            allowed: true,
            reason: `Within rate limit (${result.remaining} remaining)`,
            metadata: {
              remaining: result.remaining,
              resetAt: result.resetAt,
              tier: result.tier,
            },
          };
        } catch (error) {
          // Handle queue scenario
          if (error instanceof Error && error.message.includes('queued')) {
            return {
              allowed: false,
              reason: 'Request queued due to rate limit',
              metadata: {
                queued: true,
              },
            };
          }

          return {
            allowed: false,
            reason: error instanceof Error ? error.message : 'Rate limit error',
          };
        }
      },
    };
  },
};
