/**
 * Role-Based Access Control (RBAC)
 * Manages roles and permissions for environment access
 */

import { Permission, PermissionManager } from './permissions.js';

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

  constructor() {
    this.roles = new Map();
    this.users = new Map();
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
      permissions: [
        'environment:read',
        'config:read',
        'variable:read',
        'task:read',
        'target:read',
      ],
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
    return this.users.delete(userId);
  }
}
