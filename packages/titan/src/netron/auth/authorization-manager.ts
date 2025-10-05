/**
 * Authorization Manager for Netron
 * Handles ACL management and access control
 * @module @omnitron-dev/titan/netron/auth
 */

import { Injectable } from '../../decorators/index.js';
import type { ILogger } from '../../modules/logger/logger.types.js';
import type { AuthContext, ServiceACL } from './types.js';

/**
 * Authorization Manager
 * Manages service ACLs and performs authorization checks
 */
@Injectable()
export class AuthorizationManager {
  private acls: ServiceACL[] = [];

  constructor(private logger: ILogger) {
    this.logger = logger.child({ component: 'AuthorizationManager' });
  }

  /**
   * Register a service ACL
   * @param acl Service ACL configuration
   */
  registerACL(acl: ServiceACL): void {
    // Check if ACL for this service already exists
    const existingIndex = this.acls.findIndex(
      (existing) => existing.service === acl.service,
    );

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
   * Check if user can access a service
   * @param serviceName Service name
   * @param auth Authentication context
   * @returns True if access is allowed
   */
  canAccessService(serviceName: string, auth?: AuthContext): boolean {
    // Find matching ACL
    const acl = this.findMatchingACL(serviceName);

    if (!acl) {
      // No ACL defined - allow access by default
      this.logger.debug(
        { serviceName },
        'No ACL defined for service, allowing access',
      );
      return true;
    }

    // If ACL exists but no auth context, deny access
    if (!auth) {
      this.logger.debug(
        { serviceName },
        'ACL defined but no auth context, denying access',
      );
      return false;
    }

    // Check roles
    if (acl.allowedRoles && acl.allowedRoles.length > 0) {
      const hasRole = acl.allowedRoles.some((role) =>
        auth.roles.includes(role),
      );
      if (!hasRole) {
        this.logger.debug(
          { serviceName, requiredRoles: acl.allowedRoles, userRoles: auth.roles },
          'User lacks required role for service',
        );
        return false;
      }
    }

    // Check permissions
    if (acl.requiredPermissions && acl.requiredPermissions.length > 0) {
      const hasAllPermissions = acl.requiredPermissions.every((perm) =>
        auth.permissions.includes(perm),
      );
      if (!hasAllPermissions) {
        this.logger.debug(
          {
            serviceName,
            requiredPermissions: acl.requiredPermissions,
            userPermissions: auth.permissions,
          },
          'User lacks required permissions for service',
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
  canAccessMethod(
    serviceName: string,
    methodName: string,
    auth?: AuthContext,
  ): boolean {
    // Find matching ACL
    const acl = this.findMatchingACL(serviceName);

    if (!acl) {
      // No ACL defined - allow access by default
      this.logger.debug(
        { serviceName, methodName },
        'No ACL defined for service, allowing method access',
      );
      return true;
    }

    // Check service-level access first
    if (!this.canAccessService(serviceName, auth)) {
      return false;
    }

    // Check method-specific ACL if defined
    const methodACL = acl.methods?.[methodName];
    if (!methodACL) {
      // No method-specific ACL - service-level access is sufficient
      return true;
    }

    if (!auth) {
      this.logger.debug(
        { serviceName, methodName },
        'Method ACL defined but no auth context, denying access',
      );
      return false;
    }

    // Check method-specific roles
    if (methodACL.allowedRoles && methodACL.allowedRoles.length > 0) {
      const hasRole = methodACL.allowedRoles.some((role) =>
        auth.roles.includes(role),
      );
      if (!hasRole) {
        this.logger.debug(
          {
            serviceName,
            methodName,
            requiredRoles: methodACL.allowedRoles,
            userRoles: auth.roles,
          },
          'User lacks required role for method',
        );
        return false;
      }
    }

    // Check method-specific permissions
    if (
      methodACL.requiredPermissions &&
      methodACL.requiredPermissions.length > 0
    ) {
      const hasAllPermissions = methodACL.requiredPermissions.every((perm) =>
        auth.permissions.includes(perm),
      );
      if (!hasAllPermissions) {
        this.logger.debug(
          {
            serviceName,
            methodName,
            requiredPermissions: methodACL.requiredPermissions,
            userPermissions: auth.permissions,
          },
          'User lacks required permissions for method',
        );
        return false;
      }
    }

    this.logger.debug(
      { serviceName, methodName, userId: auth.userId },
      'Method access granted',
    );
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
  filterDefinition(
    serviceName: string,
    definition: any,
    auth?: AuthContext,
  ): any {
    // If user has no access to service at all, return null
    if (!this.canAccessService(serviceName, auth)) {
      this.logger.debug(
        { serviceName },
        'User has no access to service, returning null definition',
      );
      return null;
    }

    // Clone definition to avoid mutating original
    const filtered = JSON.parse(JSON.stringify(definition));

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
          this.logger.debug(
            { serviceName, methodName },
            'Method filtered out due to access restrictions',
          );
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
    // Exact match
    if (serviceName === pattern) {
      return true;
    }

    // No wildcards - no match
    if (!pattern.includes('*')) {
      return false;
    }

    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*'); // Replace * with .*

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(serviceName);
  }
}
