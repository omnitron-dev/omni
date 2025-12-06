/**
 * Authorization Manager for Netron
 * Handles ACL management and access control
 * @module @omnitron-dev/titan/netron/auth
 */

import { Injectable } from '../../decorators/index.js';
import type { ILogger } from '../../modules/logger/logger.types.js';
import type { AuthContext, ServiceACL } from './types.js';

/**
 * Options for pattern matching
 */
export interface PatternMatchOptions {
  /** Case-insensitive matching */
  caseInsensitive?: boolean;
}

/**
 * Authorization Manager
 * Manages service ACLs and performs authorization checks
 */
@Injectable()
export class AuthorizationManager {
  private acls: ServiceACL[] = [];
  private superAdminRole = 'superadmin';
  private patternMatchOptions: PatternMatchOptions = {};

  constructor(private logger: ILogger) {
    this.logger = logger.child({ component: 'AuthorizationManager' });
  }

  /**
   * Set the super admin role that bypasses all ACL checks
   * @param role Role name for super admin
   */
  setSuperAdminRole(role: string): void {
    this.superAdminRole = role;
    this.logger.debug({ role }, 'Super admin role updated');
  }

  /**
   * Get the current super admin role
   * @returns Super admin role name
   */
  getSuperAdminRole(): string {
    return this.superAdminRole;
  }

  /**
   * Set pattern matching options
   * @param options Pattern matching options
   */
  setPatternMatchOptions(options: PatternMatchOptions): void {
    this.patternMatchOptions = { ...options };
    this.logger.debug({ options }, 'Pattern match options updated');
  }

  /**
   * Register a service ACL
   * @param acl Service ACL configuration
   */
  registerACL(acl: ServiceACL): void {
    // Check if ACL for this service already exists
    const existingIndex = this.acls.findIndex((existing) => existing.service === acl.service);

    if (existingIndex >= 0) {
      // Update existing ACL
      this.acls[existingIndex] = acl;
      this.logger.debug({ service: acl.service }, 'ACL updated');
    } else {
      // Add new ACL
      this.acls.push(acl);
      this.logger.debug({ service: acl.service }, 'ACL registered');
    }
  }

  /**
   * Register multiple ACLs
   * @param acls Array of service ACLs
   */
  registerACLs(acls: ServiceACL[]): void {
    for (const acl of acls) {
      this.registerACL(acl);
    }
  }

  /**
   * Remove a service ACL
   * @param serviceName Service name or pattern to remove
   * @returns True if ACL was removed, false if not found
   */
  removeACL(serviceName: string): boolean {
    const initialLength = this.acls.length;
    this.acls = this.acls.filter((acl) => acl.service !== serviceName);
    const removed = this.acls.length < initialLength;

    if (removed) {
      this.logger.debug({ serviceName }, 'ACL removed');
    } else {
      this.logger.debug({ serviceName }, 'ACL not found for removal');
    }

    return removed;
  }

  /**
   * Check if user can access a service
   * @param serviceName Service name
   * @param auth Authentication context
   * @returns True if access is allowed
   */
  canAccessService(serviceName: string, auth?: AuthContext): boolean {
    // Check for super admin bypass
    if (auth && this.isSuperAdmin(auth)) {
      this.logger.debug({ serviceName, userId: auth.userId }, 'Super admin access granted (bypass)');
      return true;
    }

    // Find matching ACL
    const acl = this.findMatchingACL(serviceName);

    if (!acl) {
      // No ACL defined - allow access by default
      this.logger.debug({ serviceName }, 'No ACL defined for service, allowing access');
      return true;
    }

    // If ACL exists but no auth context, deny access
    if (!auth) {
      this.logger.debug({ serviceName }, 'ACL defined but no auth context, denying access');
      return false;
    }

    // Check roles
    if (acl.allowedRoles && acl.allowedRoles.length > 0) {
      const hasRole = acl.allowedRoles.some((role) => auth.roles.includes(role));
      if (!hasRole) {
        this.logger.debug(
          { serviceName, requiredRoles: acl.allowedRoles, userRoles: auth.roles },
          'User lacks required role for service'
        );
        return false;
      }
    }

    // Check permissions
    if (acl.requiredPermissions && acl.requiredPermissions.length > 0) {
      const hasAllPermissions = acl.requiredPermissions.every((perm) => auth.permissions.includes(perm));
      if (!hasAllPermissions) {
        this.logger.debug(
          {
            serviceName,
            requiredPermissions: acl.requiredPermissions,
            userPermissions: auth.permissions,
          },
          'User lacks required permissions for service'
        );
        return false;
      }
    }

    this.logger.debug({ serviceName, userId: auth.userId }, 'Service access granted');
    return true;
  }

  /**
   * Check if user can access a specific method
   * @param serviceName Service name
   * @param methodName Method name
   * @param auth Authentication context
   * @returns True if access is allowed
   */
  canAccessMethod(serviceName: string, methodName: string, auth?: AuthContext): boolean {
    // Check for super admin bypass
    if (auth && this.isSuperAdmin(auth)) {
      this.logger.debug({ serviceName, methodName, userId: auth.userId }, 'Super admin method access granted (bypass)');
      return true;
    }

    // Find matching ACL
    const acl = this.findMatchingACL(serviceName);

    if (!acl) {
      // No ACL defined - allow access by default
      this.logger.debug({ serviceName, methodName }, 'No ACL defined for service, allowing method access');
      return true;
    }

    // Check method-specific ACL if defined
    const methodACL = acl.methods?.[methodName];

    // If method ACL exists without auth context, deny access
    if (methodACL && !auth) {
      this.logger.debug({ serviceName, methodName }, 'Method ACL defined but no auth context, denying access');
      return false;
    }

    // No method-specific ACL - service-level access is sufficient
    if (!methodACL) {
      // Check service-level access
      if (!this.canAccessServiceDirect(serviceName, auth, acl)) {
        return false;
      }
      return true;
    }

    if (!auth) {
      // This should not happen due to earlier check, but for type safety
      return false;
    }

    // Determine if method ACL overrides service ACL
    const override = methodACL.__override === true;

    // Build effective ACL
    // For method-level ACLs: if method defines roles/permissions, they REPLACE service-level ones (more restrictive)
    // If method doesn't define them, inherit from service level
    // If override is true, completely ignore service-level ACL
    const effectiveRoles = override || methodACL.allowedRoles ? methodACL.allowedRoles : acl.allowedRoles;

    const effectivePermissions =
      override || methodACL.requiredPermissions ? methodACL.requiredPermissions : acl.requiredPermissions;

    // Check effective roles
    if (effectiveRoles && effectiveRoles.length > 0) {
      const hasRole = effectiveRoles.some((role) => auth.roles.includes(role));
      if (!hasRole) {
        this.logger.debug(
          {
            serviceName,
            methodName,
            requiredRoles: effectiveRoles,
            userRoles: auth.roles,
          },
          'User lacks required role for method'
        );
        return false;
      }
    }

    // Check effective permissions
    if (effectivePermissions && effectivePermissions.length > 0) {
      const hasAllPermissions = effectivePermissions.every((perm) => auth.permissions.includes(perm));
      if (!hasAllPermissions) {
        this.logger.debug(
          {
            serviceName,
            methodName,
            requiredPermissions: effectivePermissions,
            userPermissions: auth.permissions,
          },
          'User lacks required permissions for method'
        );
        return false;
      }
    }

    this.logger.debug({ serviceName, methodName, userId: auth.userId }, 'Method access granted');
    return true;
  }

  /**
   * Filter service definition based on user permissions
   * Removes methods that user cannot access
   * @param serviceName Service name
   * @param definition Service definition
   * @param auth Authentication context
   * @returns Filtered definition
   */
  filterDefinition(serviceName: string, definition: any, auth?: AuthContext): any {
    // If user has no access to service at all, return null
    if (!this.canAccessService(serviceName, auth)) {
      this.logger.debug({ serviceName }, 'User has no access to service, returning null definition');
      return null;
    }

    // Clone definition to avoid mutating original
    const filtered = structuredClone(definition);

    // Find matching ACL
    const acl = this.findMatchingACL(serviceName);

    // If no ACL or no method-specific restrictions, return full definition
    if (!acl || !acl.methods || Object.keys(acl.methods).length === 0) {
      return filtered;
    }

    // Filter methods based on access
    if (filtered.methods) {
      const accessibleMethods: any = {};

      for (const [methodName, methodDef] of Object.entries(filtered.methods)) {
        if (this.canAccessMethod(serviceName, methodName, auth)) {
          accessibleMethods[methodName] = methodDef;
        } else {
          this.logger.debug({ serviceName, methodName }, 'Method filtered out due to access restrictions');
        }
      }

      filtered.methods = accessibleMethods;
    }

    return filtered;
  }

  /**
   * Get all registered ACLs
   */
  getACLs(): ServiceACL[] {
    return [...this.acls];
  }

  /**
   * Clear all ACLs
   */
  clearACLs(): void {
    this.acls = [];
    this.logger.debug('All ACLs cleared');
  }

  /**
   * Find ACL matching the service name
   * Supports wildcard patterns (e.g., "userService*")
   * @param serviceName Service name to match
   * @returns Matching ACL or undefined
   */
  private findMatchingACL(serviceName: string): ServiceACL | undefined {
    return this.acls.find((acl) => this.matchesPattern(serviceName, acl.service));
  }

  /**
   * Check if service name matches ACL pattern
   * Supports wildcards (* for any characters)
   * @param serviceName Actual service name
   * @param pattern ACL pattern
   * @returns True if matches
   */
  private matchesPattern(serviceName: string, pattern: string): boolean {
    // Apply case-insensitive matching if enabled
    const name = this.patternMatchOptions.caseInsensitive ? serviceName.toLowerCase() : serviceName;
    const pat = this.patternMatchOptions.caseInsensitive ? pattern.toLowerCase() : pattern;

    // Exact match
    if (name === pat) {
      return true;
    }

    // No wildcards - no match
    if (!pat.includes('*')) {
      return false;
    }

    // Validate pattern - ensure wildcards are not adjacent
    if (pat.includes('**')) {
      this.logger.debug({ pattern }, 'Invalid pattern: adjacent wildcards not allowed');
      return false;
    }

    // Convert pattern to regex
    const regexPattern = pat
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*'); // Replace * with .*

    const flags = this.patternMatchOptions.caseInsensitive ? 'i' : '';
    const regex = new RegExp(`^${regexPattern}$`, flags);
    return regex.test(name);
  }

  /**
   * Check if user is super admin
   * @param auth Authentication context
   * @returns True if user has super admin role
   */
  private isSuperAdmin(auth: AuthContext): boolean {
    return auth.roles.includes(this.superAdminRole);
  }

  /**
   * Check service access directly without super admin check
   * Used internally by canAccessMethod to avoid duplicate super admin checks
   */
  private canAccessServiceDirect(serviceName: string, auth: AuthContext | undefined, acl: ServiceACL): boolean {
    // If ACL exists but no auth context, deny access
    if (!auth) {
      return false;
    }

    // Check roles
    if (acl.allowedRoles && acl.allowedRoles.length > 0) {
      const hasRole = acl.allowedRoles.some((role) => auth.roles.includes(role));
      if (!hasRole) {
        return false;
      }
    }

    // Check permissions
    if (acl.requiredPermissions && acl.requiredPermissions.length > 0) {
      const hasAllPermissions = acl.requiredPermissions.every((perm) => auth.permissions.includes(perm));
      if (!hasAllPermissions) {
        return false;
      }
    }

    return true;
  }

}
