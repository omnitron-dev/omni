/**
 * Mock for @kysera/audit package
 */

export interface AuditOptions {
  auditTable?: string;
  captureOldValues?: boolean;
  captureNewValues?: boolean;
}

export function withAudit(config?: any) {
  return function (target: any) {
    return target;
  };
}

export class AuditPlugin {
  name = 'audit';
  extendRepository: (repository: any) => any;

  constructor(private options: AuditOptions = {}) {
    // Define extendRepository as an own property so it survives object spread
    this.extendRepository = (repository: any): any => {
      return {
        ...repository,
        // Audit methods
        getAuditLog: async (entityId: any) => [],
        clearAuditLog: async (entityId: any) => true,
      };
    };
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

// Default export for compatibility
export default {
  withAudit,
  AuditPlugin,
  auditPlugin,
};
