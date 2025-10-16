/**
 * Permissions System
 * Defines and checks permissions for environment operations
 */

export type Permission =
  | 'environment:read'
  | 'environment:write'
  | 'environment:delete'
  | 'environment:admin'
  | 'config:read'
  | 'config:write'
  | 'secret:read'
  | 'secret:write'
  | 'variable:read'
  | 'variable:write'
  | 'task:read'
  | 'task:execute'
  | 'target:read'
  | 'target:execute';

export type Action = 'read' | 'write' | 'delete' | 'execute' | 'admin';
export type Resource = 'environment' | 'config' | 'secret' | 'variable' | 'task' | 'target';

export interface PermissionCheck {
  resource: Resource;
  action: Action;
  context?: Record<string, unknown>;
}

export class PermissionManager {
  private permissions: Set<Permission>;

  constructor(permissions: Permission[] = []) {
    this.permissions = new Set(permissions);
  }

  /**
   * Add a permission
   */
  addPermission(permission: Permission): void {
    this.permissions.add(permission);
  }

  /**
   * Remove a permission
   */
  removePermission(permission: Permission): void {
    this.permissions.delete(permission);
  }

  /**
   * Check if has permission
   */
  hasPermission(permission: Permission): boolean {
    return this.permissions.has(permission) || this.hasAdminPermission();
  }

  /**
   * Check if has admin permission
   */
  hasAdminPermission(): boolean {
    return this.permissions.has('environment:admin');
  }

  /**
   * Check if can perform action on resource
   */
  can(check: PermissionCheck): boolean {
    const permission: Permission = `${check.resource}:${check.action}` as Permission;
    return this.hasPermission(permission);
  }

  /**
   * Assert permission (throws if not allowed)
   */
  assert(permission: Permission): void {
    if (!this.hasPermission(permission)) {
      throw new PermissionError(`Permission denied: ${permission}`);
    }
  }

  /**
   * Assert action on resource (throws if not allowed)
   */
  assertAction(check: PermissionCheck): void {
    if (!this.can(check)) {
      throw new PermissionError(`Permission denied: ${check.resource}:${check.action}`);
    }
  }

  /**
   * Get all permissions
   */
  getPermissions(): Permission[] {
    return Array.from(this.permissions);
  }

  /**
   * Check if has all permissions
   */
  hasAll(permissions: Permission[]): boolean {
    return permissions.every((p) => this.hasPermission(p));
  }

  /**
   * Check if has any of the permissions
   */
  hasAny(permissions: Permission[]): boolean {
    return permissions.some((p) => this.hasPermission(p));
  }

  /**
   * Clear all permissions
   */
  clear(): void {
    this.permissions.clear();
  }
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}
