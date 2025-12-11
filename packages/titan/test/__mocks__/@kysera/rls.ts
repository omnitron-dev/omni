/**
 * Mock for @kysera/rls
 */

export const defineRLSSchema = jest.fn().mockImplementation((config) => config);
export const mergeRLSSchemas = jest.fn().mockImplementation((...schemas) => Object.assign({}, ...schemas));

export const allow = jest.fn().mockReturnValue({ type: 'allow' });
export const deny = jest.fn().mockReturnValue({ type: 'deny' });
export const filter = jest.fn().mockReturnValue({ type: 'filter' });
export const validate = jest.fn().mockReturnValue({ type: 'validate' });

export const rlsPlugin = jest.fn().mockReturnValue({
  name: '@kysera/rls',
  version: '0.7.0',
  interceptQuery: jest.fn((qb) => qb),
  extendRepository: jest.fn((repo) => repo),
});

export class PolicyRegistry {
  constructor(schema: any) {}
  validate(): void {}
  hasTable(name: string): boolean { return false; }
}

export const rlsContext = {
  getContextOrNull: jest.fn().mockReturnValue(null),
  getContext: jest.fn().mockReturnValue(null),
};

export const createRLSContext = jest.fn().mockImplementation((options) => ({
  auth: options.auth || {},
  request: options.request || {},
}));

export const withRLSContext = jest.fn().mockImplementation((context, fn) => fn());
export const withRLSContextAsync = jest.fn().mockImplementation(async (context, fn) => fn());

export const createEvaluationContext = jest.fn();
export const normalizeOperations = jest.fn().mockImplementation((ops) => ops);
export const isAsyncFunction = jest.fn().mockReturnValue(false);
export const safeEvaluate = jest.fn();
export const deepMerge = jest.fn().mockImplementation((a, b) => ({ ...a, ...b }));
export const hashString = jest.fn().mockImplementation((str) => str);

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

export const RLSErrorCodes = {
  CONTEXT_NOT_FOUND: 'CONTEXT_NOT_FOUND',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
};
