/**
 * Mock for @kysera/rls
 */

import { vi } from 'vitest';

export const defineRLSSchema = vi.fn().mockImplementation((config) => config);
export const mergeRLSSchemas = vi.fn().mockImplementation((...schemas) => Object.assign({}, ...schemas));

export const allow = vi.fn().mockReturnValue({ type: 'allow' });
export const deny = vi.fn().mockReturnValue({ type: 'deny' });
export const filter = vi.fn().mockReturnValue({ type: 'filter' });
export const validate = vi.fn().mockReturnValue({ type: 'validate' });

export const rlsPlugin = vi.fn().mockReturnValue({
  name: '@kysera/rls',
  version: '0.7.0',
  interceptQuery: vi.fn((qb) => qb),
  extendRepository: vi.fn((repo) => repo),
});

export class PolicyRegistry {
  constructor(schema: any) {}
  validate(): void {}
  hasTable(name: string): boolean {
    return false;
  }
}

export const rlsContext = {
  getContextOrNull: vi.fn().mockReturnValue(null),
  getContext: vi.fn().mockReturnValue(null),
};

export const createRLSContext = vi.fn().mockImplementation((options) => ({
  auth: options.auth || {},
  request: options.request || {},
}));

export const withRLSContext = vi.fn().mockImplementation((context, fn) => fn());
export const withRLSContextAsync = vi.fn().mockImplementation(async (context, fn) => fn());

export const createEvaluationContext = vi.fn();
export const normalizeOperations = vi.fn().mockImplementation((ops) => ops);
export const isAsyncFunction = vi.fn().mockReturnValue(false);
export const safeEvaluate = vi.fn();
export const deepMerge = vi.fn().mockImplementation((a, b) => ({ ...a, ...b }));
export const hashString = vi.fn().mockImplementation((str) => str);

export class RLSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RLSError';
  }
}

export class RLSContextError extends RLSError {
  constructor(message: string) {
    super(message);
    this.name = 'RLSContextError';
  }
}

export class RLSPolicyViolation extends RLSError {
  constructor(message: string) {
    super(message);
    this.name = 'RLSPolicyViolation';
  }
}

export class RLSSchemaError extends RLSError {
  constructor(message: string) {
    super(message);
    this.name = 'RLSSchemaError';
  }
}

export class RLSContextValidationError extends RLSError {
  constructor(message: string) {
    super(message);
    this.name = 'RLSContextValidationError';
  }
}

export class RLSPolicyEvaluationError extends RLSError {
  constructor(message: string) {
    super(message);
    this.name = 'RLSPolicyEvaluationError';
  }
}

export const RLSErrorCodes = {
  CONTEXT_NOT_FOUND: 'CONTEXT_NOT_FOUND',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  CONTEXT_VALIDATION_ERROR: 'CONTEXT_VALIDATION_ERROR',
  POLICY_EVALUATION_ERROR: 'POLICY_EVALUATION_ERROR',
};

export const RLSPluginOptionsSchema = {};

// Additional policy builders
export const whenEnvironment = vi.fn().mockReturnValue({ type: 'whenEnvironment' });
export const whenFeature = vi.fn().mockReturnValue({ type: 'whenFeature' });
export const whenTimeRange = vi.fn().mockReturnValue({ type: 'whenTimeRange' });
export const whenCondition = vi.fn().mockReturnValue({ type: 'whenCondition' });

// ============================================================================
// Context Resolvers
// ============================================================================

export class InMemoryCacheProvider {
  private cache = new Map<string, unknown>();
  get(key: string): unknown {
    return this.cache.get(key);
  }
  set(key: string, value: unknown, _ttl?: number): void {
    this.cache.set(key, value);
  }
  delete(key: string): void {
    this.cache.delete(key);
  }
  clear(): void {
    this.cache.clear();
  }
}

export class ResolverManager {
  constructor(_options?: any) {}
  register(_name: string, _resolver: any): void {}
  async resolve(_context: any): Promise<any> {
    return {};
  }
}

export const createResolverManager = vi.fn().mockImplementation((options) => new ResolverManager(options));
export const createResolver = vi.fn().mockImplementation((fn) => fn);

// ============================================================================
// ReBAC
// ============================================================================

export const orgMembershipPath = vi.fn().mockReturnValue([]);
export const shopOrgMembershipPath = vi.fn().mockReturnValue([]);
export const teamHierarchyPath = vi.fn().mockReturnValue([]);

export class ReBAcRegistry {
  constructor() {}
  register(_name: string, _config: any): void {}
}

export const createReBAcRegistry = vi.fn().mockImplementation(() => new ReBAcRegistry());

export class ReBAcTransformer {
  constructor(_registry: any) {}
  transform(_query: any, _context: any): any {
    return _query;
  }
}

export const createReBAcTransformer = vi.fn().mockImplementation((registry) => new ReBAcTransformer(registry));
export const allowRelation = vi.fn().mockReturnValue({ type: 'allowRelation' });
export const denyRelation = vi.fn().mockReturnValue({ type: 'denyRelation' });

// ============================================================================
// Field-Level Access
// ============================================================================

export const neverAccessible = vi.fn().mockReturnValue({ type: 'neverAccessible' });
export const ownerOnly = vi.fn().mockReturnValue({ type: 'ownerOnly' });
export const ownerOrRoles = vi.fn().mockReturnValue({ type: 'ownerOrRoles' });
export const rolesOnly = vi.fn().mockReturnValue({ type: 'rolesOnly' });
export const readOnly = vi.fn().mockReturnValue({ type: 'readOnly' });
export const publicReadRestrictedWrite = vi.fn().mockReturnValue({ type: 'publicReadRestrictedWrite' });
export const maskedField = vi.fn().mockReturnValue({ type: 'maskedField' });

export class FieldAccessRegistry {
  constructor() {}
  register(_table: string, _config: any): void {}
}

export const createFieldAccessRegistry = vi.fn().mockImplementation(() => new FieldAccessRegistry());

export class FieldAccessProcessor {
  constructor(_registry: any) {}
  process(_row: any, _context: any): any {
    return _row;
  }
}

export const createFieldAccessProcessor = vi.fn().mockImplementation((registry) => new FieldAccessProcessor(registry));

// ============================================================================
// Policy Composition
// ============================================================================

export const definePolicy = vi.fn().mockReturnValue({});
export const defineFilterPolicy = vi.fn().mockReturnValue({});
export const defineAllowPolicy = vi.fn().mockReturnValue({});
export const defineDenyPolicy = vi.fn().mockReturnValue({});
export const defineValidatePolicy = vi.fn().mockReturnValue({});
export const defineCombinedPolicy = vi.fn().mockReturnValue({});

export const createTenantIsolationPolicy = vi.fn().mockReturnValue({});
export const createOwnershipPolicy = vi.fn().mockReturnValue({});
export const createSoftDeletePolicy = vi.fn().mockReturnValue({});
export const createStatusAccessPolicy = vi.fn().mockReturnValue({});
export const createAdminPolicy = vi.fn().mockReturnValue({});

export const composePolicies = vi.fn().mockReturnValue({});
export const extendPolicy = vi.fn().mockReturnValue({});
export const overridePolicy = vi.fn().mockReturnValue({});

// ============================================================================
// Audit Trail
// ============================================================================

export class ConsoleAuditAdapter {
  constructor(_options?: any) {}
  log(_event: any): void {}
}

export class InMemoryAuditAdapter {
  private events: any[] = [];
  log(event: any): void {
    this.events.push(event);
  }
  getEvents(): any[] {
    return [...this.events];
  }
  clear(): void {
    this.events = [];
  }
}

export class AuditLogger {
  constructor(_adapter: any) {}
  log(_event: any): void {}
}

export const createAuditLogger = vi.fn().mockImplementation((adapter) => new AuditLogger(adapter));

// ============================================================================
// Testing Utilities
// ============================================================================

export class PolicyTester {
  constructor(_schema: any) {}
  async evaluate(_context: any, _operation: any): Promise<any> {
    return { allowed: true };
  }
}

export const createPolicyTester = vi.fn().mockImplementation((schema) => new PolicyTester(schema));
export const createTestAuthContext = vi.fn().mockImplementation((overrides) => ({
  userId: 1,
  roles: ['user'],
  ...overrides,
}));
export const createTestRow = vi.fn().mockImplementation((overrides) => ({
  id: 1,
  ...overrides,
}));
export const policyAssertions = {
  assertAllowed: vi.fn(),
  assertDenied: vi.fn(),
  assertFiltered: vi.fn(),
};
