/**
 * Mock for @kysera/audit package
 */

export interface AuditOptions {
  auditTable?: string;
  captureOldValues?: boolean;
  captureNewValues?: boolean;
}

export function withAudit(_config?: any) {
  return function withAuditDecorator(target: any) {
    return target;
  };
}

export class AuditPlugin {
  name = 'audit';
  extendRepository: (repository: any) => any;

  constructor(private options: AuditOptions = {}) {
    // Define extendRepository as an own property so it survives object spread
    this.extendRepository = (repository: any): any => ({
      ...repository,
      // Audit methods
      getAuditLog: async (entityId: any) => [],
      clearAuditLog: async (entityId: any) => true,
    });
  }

  transformQuery(args: any) {
    return args.node;
  }

  async transformResult(args: any) {
    return args;
  }
}

/**
 * Factory function to create AuditPlugin instance
 * This is the primary export used by repository.factory.ts and plugin.manager.ts
 */
export function auditPlugin(options?: AuditOptions): AuditPlugin {
  return new AuditPlugin(options);
}

export interface AuditLogEntry {
  id?: number;
  entity_id: unknown;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  timestamp: string;
  actor_id?: unknown;
}

export interface ParsedAuditLogEntry extends AuditLogEntry {
  parsed_old_values?: Record<string, unknown>;
  parsed_new_values?: Record<string, unknown>;
}

export interface AuditPaginationOptions {
  limit?: number;
  offset?: number;
}

export interface AuditFilters extends AuditPaginationOptions {
  action?: 'INSERT' | 'UPDATE' | 'DELETE';
  from?: Date;
  to?: Date;
  actorId?: unknown;
}

export interface AuditRepositoryExtensions<T = unknown> {
  getAuditLog: (entityId: unknown, options?: AuditFilters) => Promise<AuditLogEntry[]>;
  clearAuditLog: (entityId: unknown) => Promise<boolean>;
  getAuditLogCount: (entityId: unknown) => Promise<number>;
  restoreFromAudit: (entityId: unknown, auditEntryId: number) => Promise<T | null>;
}

/**
 * PostgreSQL-specific audit plugin
 */
export function auditPluginPostgreSQL(options?: AuditOptions): AuditPlugin {
  return new AuditPlugin(options);
}

/**
 * MySQL-specific audit plugin
 */
export function auditPluginMySQL(options?: AuditOptions): AuditPlugin {
  return new AuditPlugin(options);
}

/**
 * SQLite-specific audit plugin
 */
export function auditPluginSQLite(options?: AuditOptions): AuditPlugin {
  return new AuditPlugin(options);
}

// Default export for compatibility
export default {
  withAudit,
  AuditPlugin,
  auditPlugin,
  auditPluginPostgreSQL,
  auditPluginMySQL,
  auditPluginSQLite,
};
