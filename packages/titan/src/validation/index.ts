/**
 * Validation module exports
 *
 * This module provides high-performance validation utilities built on Zod.
 *
 * ## Error Classes
 *
 * There are two versions of ValidationError and ServiceError:
 *
 * 1. **Canonical (Rich) Implementation** - `@omnitron-dev/titan/errors`
 *    - ValidationError: Extends TitanError with rich features (fromZodError, fromFieldErrors,
 *      hasFieldError, getFieldErrors, getSimpleFormat, getDetailedFormat)
 *    - ServiceError: Extends TitanError with withValidation static method
 *
 * 2. **Validation Engine Implementation** - `@omnitron-dev/titan/validation`
 *    - ValidationError: Lightweight adapter with code/statusCode properties for ValidationEngine
 *    - ServiceError: Simple wrapper with statusCode and data properties
 *
 * For new code, prefer importing from `@omnitron-dev/titan/errors` for the rich implementation.
 * The validation module exports are maintained for backward compatibility with existing code
 * that uses ValidationEngine.
 *
 * @example
 * ```typescript
 * // For ValidationEngine usage
 * import { ValidationEngine, ValidationError } from '@omnitron-dev/titan/validation';
 *
 * // For rich error handling
 * import { ValidationError, ServiceError } from '@omnitron-dev/titan/errors';
 * ```
 *
 * For usage guide and examples, see ./README.md
 * For Netron integration details, see ./INTEGRATION.md
 *
 * @module validation
 */

export { ValidationEngine, ValidationError, ServiceError } from './validation-engine.js';

export type { ValidationOptions, CompiledValidator } from './validation-engine.js';

export { Contract, Contracts, contract, contractBuilder, ContractBuilder } from './contract.js';

export type { MethodContract, ContractMetadata, ContractDefinition, ContractTypes } from './contract.js';

export { ValidationMiddleware } from './validation-middleware.js';

export type { MethodWrapper, WrappedService } from './validation-middleware.js';

// Re-export zod for convenience
export { z } from 'zod';

/**
 * Re-export canonical error classes for convenience.
 * These are the rich implementations from errors/validation.ts.
 *
 * @see {@link ../errors/validation.js} for the canonical implementations
 */
export {
  ValidationError as CanonicalValidationError,
  ServiceError as CanonicalServiceError,
} from '../errors/validation.js';
