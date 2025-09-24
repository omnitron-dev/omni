/**
 * Validation module exports
 */

export {
  ValidationEngine,
  ValidationError,
  ServiceError,
  ValidationOptions,
  CompiledValidator
} from './validation-engine.js';

export {
  Contract,
  MethodContract,
  ContractMetadata,
  ContractDefinition,
  ContractTypes,
  Contracts,
  contract,
  contractBuilder,
  ContractBuilder
} from './contract.js';

export {
  ValidationMiddleware,
  MethodWrapper,
  WrappedService
} from './validation-middleware.js';

// Re-export zod for convenience
export { z } from 'zod';