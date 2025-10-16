/**
 * Role-Based Access Control (RBAC) with ABAC support
 * Manages roles and permissions for environment access
 */

import { Permission, PermissionManager } from './permissions.js';
import { Policy, PolicyContext, PolicyCondition, PolicyConditions } from '../types/operations.js';

export interface Role {
  name: string;
  permissions: Permission[];
  description?: string;
}

export interface User {
  id: string;
  roles: string[];
  permissions?: Permission[];
}

export class RBAC {
  private roles: Map<string, Role>;
  private users: Map<string, User>;
  private userRoles: Map<string, Set<string>>;
  private policies: Map<string, Policy>;

  constructor() {
    this.roles = new Map();
    this.users = new Map();
    this.userRoles = new Map();
    this.policies = new Map();
    this.initializeDefaultRoles();
  }

  /**
   * Initialize default roles
   */
  private initializeDefaultRoles(): void {
    this.defineRole({
      name: 'admin',
      permissions: ['environment:admin'],
      description: 'Full access to all resources',
    });

    this.defineRole({
      name: 'developer',
      permissions: [
        'environment:read',
        'environment:write',
        'config:read',
        'config:write',
        'variable:read',
        'variable:write',
        'task:read',
        'task:execute',
        'target:read',
        'target:execute',
      ],
      description: 'Development access',
    });

    this.defineRole({
      name: 'operator',
      permissions: [
        'environment:read',
        'config:read',
        'variable:read',
        'task:read',
        'task:execute',
        'target:read',
        'target:execute',
      ],
      description: 'Operations access',
    });

    this.defineRole({
      name: 'viewer',
      permissions: ['environment:read', 'config:read', 'variable:read', 'task:read', 'target:read'],
      description: 'Read-only access',
    });
  }

  /**
   * Define a new role
   */
  defineRole(role: Role): void {
    this.roles.set(role.name, role);
  }

  /**
   * Get a role by name
   */
  getRole(name: string): Role | undefined {
    return this.roles.get(name);
  }

  /**
   * Get all roles
   */
  getAllRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * Delete a role
   */
  deleteRole(name: string): boolean {
    return this.roles.delete(name);
  }

  /**
   * Register a user
   */
  registerUser(user: User): void {
    this.users.set(user.id, user);
  }

  /**
   * Get a user by ID
   */
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * Assign role to user
   */
  assignRole(userId: string, roleName: string): void {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const role = this.roles.get(roleName);
    if (!role) {
      throw new Error(`Role not found: ${roleName}`);
    }

    if (!user.roles.includes(roleName)) {
      user.roles.push(roleName);
    }
  }

  /**
   * Remove role from user
   */
  revokeRole(userId: string, roleName: string): void {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    user.roles = user.roles.filter((r) => r !== roleName);
  }

  /**
   * Get permissions for a user
   */
  getUserPermissions(userId: string): Permission[] {
    const user = this.users.get(userId);
    if (!user) {
      return [];
    }

    const permissions = new Set<Permission>();

    // Add role-based permissions
    for (const roleName of user.roles) {
      const role = this.roles.get(roleName);
      if (role) {
        for (const permission of role.permissions) {
          permissions.add(permission);
        }
      }
    }

    // Add user-specific permissions
    if (user.permissions) {
      for (const permission of user.permissions) {
        permissions.add(permission);
      }
    }

    return Array.from(permissions);
  }

  /**
   * Get permission manager for a user
   */
  getPermissionManager(userId: string): PermissionManager {
    const permissions = this.getUserPermissions(userId);
    return new PermissionManager(permissions);
  }

  /**
   * Check if user has permission
   */
  hasPermission(userId: string, permission: Permission): boolean {
    const permissions = this.getUserPermissions(userId);
    return permissions.includes(permission) || permissions.includes('environment:admin');
  }

  /**
   * Grant permission directly to user
   */
  grantPermission(userId: string, permission: Permission): void {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    if (!user.permissions) {
      user.permissions = [];
    }

    if (!user.permissions.includes(permission)) {
      user.permissions.push(permission);
    }
  }

  /**
   * Revoke permission from user
   */
  revokePermission(userId: string, permission: Permission): void {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    if (user.permissions) {
      user.permissions = user.permissions.filter((p) => p !== permission);
    }
  }

  /**
   * Get all users
   */
  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  /**
   * Unregister a user
   */
  unregisterUser(userId: string): boolean {
    this.userRoles.delete(userId);
    return this.users.delete(userId);
  }

  /**
   * Grant role to user (operational method)
   */
  grantRole(userId: string, role: string): void {
    if (!this.userRoles.has(userId)) {
      this.userRoles.set(userId, new Set());
    }
    this.userRoles.get(userId)!.add(role);

    // Also update the user object if registered
    const user = this.users.get(userId);
    if (user && !user.roles.includes(role)) {
      user.roles.push(role);
    }
  }

  /**
   * Get all roles for user
   */
  getUserRoles(userId: string): string[] {
    const rolesSet = this.userRoles.get(userId);
    if (rolesSet) {
      return Array.from(rolesSet);
    }

    // Fallback to user object
    const user = this.users.get(userId);
    return user ? user.roles : [];
  }

  /**
   * Check permission for user on action and path
   */
  async checkPermission(userId: string, action: string, path: string): Promise<boolean> {
    // Get user's permissions
    const permissions = this.getUserPermissions(userId);

    // Check if user has admin permission
    if (permissions.includes('environment:admin')) {
      return true;
    }

    // Extract resource type from path (first segment after leading slash)
    const pathParts = path.split('/').filter((p) => p.length > 0);
    const resourceType = pathParts[0] || 'environment';

    // Build permission string
    const permission = `${resourceType}:${action}` as Permission;

    // Check if user has direct permission
    if (permissions.includes(permission)) {
      return true;
    }

    // Check path-specific permissions using glob patterns
    return this.checkPathPermission(userId, action, path);
  }

  /**
   * Check if user has permission for specific path pattern
   */
  private checkPathPermission(userId: string, action: string, path: string): boolean {
    const roles = this.getUserRoles(userId);

    for (const roleName of roles) {
      const role = this.roles.get(roleName);
      if (!role) continue;

      // Check if any role permission matches
      for (const permission of role.permissions) {
        const [resource, permAction] = permission.split(':');

        // Match action
        if (permAction === action || permAction === 'admin') {
          // Simple path matching (can be enhanced with glob patterns)
          if (path.startsWith(`/${resource}`) || resource === 'environment') {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Define an ABAC policy
   */
  definePolicy(name: string, policy: Policy): void {
    this.policies.set(name, policy);
  }

  /**
   * Get a policy by name
   */
  getPolicy(name: string): Policy | undefined {
    return this.policies.get(name);
  }

  /**
   * Get all policies
   */
  getAllPolicies(): Map<string, Policy> {
    return new Map(this.policies);
  }

  /**
   * Delete a policy
   */
  deletePolicy(name: string): boolean {
    return this.policies.delete(name);
  }

  /**
   * Evaluate ABAC policy with context
   */
  async evaluatePolicy(name: string, context: PolicyContext): Promise<boolean> {
    const policy = this.policies.get(name);
    if (!policy) {
      throw new Error(`Policy not found: ${name}`);
    }

    // Check principal (roles and attributes)
    if (!this.matchesPrincipal(policy, context)) {
      return policy.effect === 'deny';
    }

    // Check resource (paths and types)
    if (!this.matchesResource(policy, context)) {
      return policy.effect === 'deny';
    }

    // Check actions
    if (!policy.actions.includes(context.action)) {
      return policy.effect === 'deny';
    }

    // Check conditions
    if (policy.conditions && !this.evaluateConditions(policy.conditions, context)) {
      return policy.effect === 'deny';
    }

    // All checks passed
    return policy.effect === 'allow';
  }

  /**
   * Check if principal matches policy
   */
  private matchesPrincipal(policy: Policy, context: PolicyContext): boolean {
    // Check roles
    if (policy.principal.roles && policy.principal.roles.length > 0) {
      const userRoles = this.getUserRoles(context.principal.id);
      const hasRole = policy.principal.roles.some((role) => userRoles.includes(role));
      if (!hasRole) {
        return false;
      }
    }

    // Check attributes
    if (policy.principal.attributes) {
      for (const [key, value] of Object.entries(policy.principal.attributes)) {
        if (context.principal[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if resource matches policy
   */
  private matchesResource(policy: Policy, context: PolicyContext): boolean {
    const resourcePath = context.resource.path;

    // Check excluded paths first
    if (policy.resource.exclude) {
      for (const excludePath of policy.resource.exclude) {
        if (this.matchesPath(resourcePath, excludePath)) {
          return false;
        }
      }
    }

    // Check if path matches any allowed path
    const pathMatches = policy.resource.paths.some((path) => this.matchesPath(resourcePath, path));
    if (!pathMatches) {
      return false;
    }

    // Check resource types if specified
    if (policy.resource.types && policy.resource.types.length > 0) {
      const resourceType = context.resource.type;
      if (!resourceType || !policy.resource.types.includes(resourceType)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Match path with pattern (supports wildcards)
   */
  private matchesPath(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Evaluate policy conditions
   */
  private evaluateConditions(conditions: PolicyConditions, context: PolicyContext): boolean {
    // Handle AND conditions
    if (conditions.and) {
      return conditions.and.every((condition) => this.evaluateCondition(condition, context));
    }

    // Handle OR conditions
    if (conditions.or) {
      return conditions.or.some((condition) => this.evaluateCondition(condition, context));
    }

    // Handle NOT condition
    if (conditions.not) {
      return !this.evaluateCondition(conditions.not, context);
    }

    return true;
  }

  /**
   * Evaluate a single policy condition
   */
  private evaluateCondition(condition: PolicyCondition, context: PolicyContext): boolean {
    // Get attribute value from context
    const attributeValue = this.getAttributeValue(condition.attribute, context);

    switch (condition.operator) {
      case 'equals':
        return attributeValue === condition.value;

      case 'notEquals':
        return attributeValue !== condition.value;

      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(attributeValue);

      case 'notIn':
        return Array.isArray(condition.value) && !condition.value.includes(attributeValue);

      case 'greaterThan':
        return typeof attributeValue === 'number' && attributeValue > condition.value;

      case 'lessThan':
        return typeof attributeValue === 'number' && attributeValue < condition.value;

      case 'matches':
        return typeof attributeValue === 'string' && new RegExp(condition.value).test(attributeValue);

      case 'exists':
        return attributeValue !== undefined && attributeValue !== null;

      default:
        return false;
    }
  }

  /**
   * Get attribute value from context
   */
  private getAttributeValue(attribute: string, context: PolicyContext): any {
    const parts = attribute.split('.');

    if (parts[0] === 'principal') {
      return this.getNestedValue(context.principal, parts.slice(1));
    }

    if (parts[0] === 'resource') {
      return this.getNestedValue(context.resource, parts.slice(1));
    }

    if (parts[0] === 'context' && context.context) {
      return this.getNestedValue(context.context, parts.slice(1));
    }

    return undefined;
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: any, path: string[]): any {
    let value = obj;
    for (const key of path) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }
    return value;
  }
}
