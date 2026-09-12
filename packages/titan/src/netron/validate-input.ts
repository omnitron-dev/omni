/**
 * Contract input validation for netron invocations.
 *
 * One implementation, used by every transport that accepts a call from the
 * wire. It lived under `transport/http/handlers/` in two copies — a private
 * method on `HttpServer` that all three of its dispatch paths called, and an
 * exported twin that nothing imported — while the packet path (`TYPE_CALL`,
 * i.e. WebSocket, TCP and Unix sockets) validated nothing at all.
 */

import { TitanError, ErrorCode } from '../errors/index.js';
import type { MethodContract } from '../validation/contract.js';
import type { LocalPeer } from './local-peer.js';

/**
 * A declared contract that cannot be evaluated denies the request.
 *
 * The client is told only that the server could not check its input. Which
 * schema, which refinement and what it threw stay in the log: a caller who can
 * make the validator throw must not also be able to read what it tried to do.
 */
function validationUnavailable(): TitanError {
  return new TitanError({
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Input validation unavailable',
    details: { message: 'The server could not verify the request payload' },
  });
}

/**
 * Validate method input against contract
 * @returns The validated and transformed input (with defaults applied), or original input if no validation
 */
export function validateMethodInput(input: unknown, contract?: MethodContract, logger?: LocalPeer['logger']): unknown {
  // No contract, or a contract that declares no input schema: nothing was
  // promised, so nothing is skipped. These two are the only paths that may
  // return the input unchecked.
  if (!contract) {
    return input;
  }

  if (!contract.input) {
    return input;
  }

  // `MethodContract.input` is typed `z.ZodSchema`, so a value without
  // `safeParse` means the contract was built wrong or was swapped mid-flight.
  // This used to warn and return the input: the service declared a check, the
  // framework silently did not perform it, and the handler received whatever
  // arrived. A control that turns itself off when it is confused is worse than
  // no control, because the code still reads as though it is there.
  if (
    typeof contract.input !== 'object' ||
    !contract.input ||
    typeof (contract.input as { safeParse?: unknown }).safeParse !== 'function'
  ) {
    logger?.error(
      { contractType: typeof contract.input },
      'Invalid contract schema detected - contract.input is not a Zod schema. Refusing the request.'
    );
    throw validationUnavailable();
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

  let validation: { success: boolean; data?: unknown; error?: { issues: Array<{ path: (string | number)[] }> } };
  try {
    validation = (contract.input as { safeParse: (v: unknown) => typeof validation }).safeParse(valueToValidate);
  } catch (error) {
    // `safeParse` is not exception-free. Measured on the zod this package
    // depends on (4.5.4): an exception thrown inside a `.refine()` callback
    // propagates out of `safeParse` rather than becoming a failed result. So a
    // refinement that calls `JSON.parse`, `new URL` or `BigInt` on the value —
    // all ordinary things to write — hands the caller a way to choose which
    // requests get validated.
    //
    // The previous comment blamed a "contract lifecycle race condition" and
    // allowed the request through. Whatever the cause, allowing it is the one
    // answer that cannot be right: either the contract is broken, in which case
    // the request must not run, or the input triggered it, in which case the
    // input is exactly what needed checking.
    logger?.error(
      { error, contractInput: String(contract.input) },
      'Contract validation threw - refusing the request'
    );
    throw validationUnavailable();
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

/**
 * Find the contract a service declares for one method.
 *
 * `meta.contract` is either a `Contract` instance (with `getMethod`) or a bare
 * record keyed by method name. `HttpServer` resolved this inline while the
 * packet path never looked for a contract at all; both now ask here.
 */
export function resolveMethodContract(meta: unknown, methodName: string): MethodContract | undefined {
  const contractObj = (meta as { contract?: unknown } | undefined)?.contract as
    | { definition?: unknown; getMethod?: (name: string) => MethodContract; [key: string]: unknown }
    | undefined;
  if (!contractObj) return undefined;

  if (contractObj.definition && typeof contractObj.getMethod === 'function') {
    return contractObj.getMethod(methodName);
  }
  if (contractObj[methodName]) {
    return contractObj[methodName] as MethodContract;
  }
  return undefined;
}
