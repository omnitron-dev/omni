/**
 * Input validation utilities for HTTP handlers
 */

import { TitanError, ErrorCode } from '../../../../errors/index.js';
import type { MethodContract } from '../../../../validation/contract.js';
import type { LocalPeer } from '../../../local-peer.js';

/**
 * Validate method input against contract
 * @returns The validated and transformed input (with defaults applied), or original input if no validation
 */
export function validateMethodInput(
  input: unknown,
  contract?: MethodContract,
  logger?: LocalPeer['logger']
): unknown {
  // DEFENSIVE: Check if contract is still valid (race condition prevention)
  if (!contract) {
    return input;
  }

  // DEFENSIVE: Check if input schema exists and is valid
  if (!contract.input) {
    return input;
  }

  // DEFENSIVE: Verify contract.input has safeParse method (Zod schema)
  // This guards against "_zod" undefined errors during contract lifecycle changes
  if (
    typeof contract.input !== 'object' ||
    !contract.input ||
    typeof (contract.input as { safeParse?: unknown }).safeParse !== 'function'
  ) {
    // Log warning if logger is available
    logger?.warn(
      { contractType: typeof contract.input },
      'Invalid contract schema detected - contract.input is not a Zod schema. Skipping validation.'
    );
    return input;
  }

  // For HTTP transport, input comes as an array of arguments
  // Most methods take a single object parameter, so extract it
  let valueToValidate = input;
  let isArrayInput = false;
  if (Array.isArray(input)) {
    isArrayInput = true;
    // If it's a single-element array, validate the first element
    // This handles the common case of methods with a single object parameter
    if (input.length === 1) {
      valueToValidate = input[0];
    } else if (input.length === 0) {
      // Empty array - let validation handle it (will fail if input is required)
      valueToValidate = undefined;
    }
    // For multiple arguments, pass the array as-is
    // The contract should handle array validation if needed
  }

  // DEFENSIVE: Wrap validation in try-catch to handle contract lifecycle issues
  let validation: { success: boolean; data?: unknown; error?: { issues: Array<{ path: (string | number)[] }> } };
  try {
    validation = (contract.input as { safeParse: (v: unknown) => typeof validation }).safeParse(valueToValidate);
  } catch (error) {
    // Log contract lifecycle issue
    logger?.error(
      { error, contractInput: String(contract.input) },
      'Contract validation failed unexpectedly - possible contract lifecycle race condition. Allowing request without validation.'
    );
    // Allow request to proceed without validation rather than failing
    return input;
  }

  if (!validation.success) {
    // Only expose minimal validation error info to prevent schema disclosure
    throw new TitanError({
      code: ErrorCode.INVALID_ARGUMENT,
      message: 'Input validation failed',
      details: {
        message: 'Request data does not match expected format',
        // In development, include field paths but not schema structure
        ...(process.env['NODE_ENV'] === 'development' && {
          fields: validation.error?.issues.map((i) => i.path.join('.')),
        }),
      },
    });
  }

  // Return the validated data (with defaults applied by Zod)
  // If input was an array, wrap the validated value back in an array
  return isArrayInput && Array.isArray(input) && input.length === 1 ? [validation.data] : validation.data;
}
