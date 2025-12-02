/**
 * Mock for @kysera/audit package
 */

export function withAudit(config?: any) {
  return function (target: any) {
    return target;
  };
}

export class AuditPlugin {
  constructor(private options: any = {}) {}

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
export function auditPlugin(options?: any): AuditPlugin {
  return new AuditPlugin(options);
}

// Default export for compatibility
export default {
  withAudit,
  AuditPlugin,
  auditPlugin,
};
