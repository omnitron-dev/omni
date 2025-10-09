/**
 * Validation module exports
 *
 * For usage guide and examples, see ./README.md
 * For Netron integration details, see ./INTEGRATION.md
 */

export { ValidationEngine, ValidationError, ServiceError } from './validation-engine.js';

export type { ValidationOptions, CompiledValidator } from './validation-engine.js';

export { Contract, Contracts, contract, contractBuilder, ContractBuilder } from './contract.js';

export type { MethodContract, ContractMetadata, ContractDefinition, ContractTypes } from './contract.js';

export { ValidationMiddleware } from './validation-middleware.js';

export type { MethodWrapper, WrappedService } from './validation-middleware.js';

// Re-export zod for convenience
export { z } from 'zod';
