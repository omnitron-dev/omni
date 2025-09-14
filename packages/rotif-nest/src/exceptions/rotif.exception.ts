/**
 * Custom exception class for Rotif-specific errors.
 * This exception class extends the standard Error class and adds
 * functionality to control whether a failed message should be moved
 * to the Dead Letter Queue (DLQ).
 *
 * When thrown during message processing, this exception can be caught
 * by the RotifExceptionFilter, which will handle the message according
 * to the moveToDlq flag.
 *
 * @example
 * // Move message to DLQ on failure
 * throw new RotifException('Invalid message format', true);
 *
 * @example
 * // Retry message processing
 * throw new RotifException('Temporary network error', false);
 */
export class RotifException extends Error {
  /**
   * Creates a new RotifException instance.
   *
   * @param message - Error message describing what went wrong
   * @param moveToDlq - Whether the message should be moved to DLQ (true)
   *                    or retried (false). Defaults to false.
   * 
   * @example
   * throw new RotifException(
   *   'Failed to process payment: insufficient funds',
   *   true // Move to DLQ as this is a business logic error
   * );
   */
  constructor(message: string, public readonly moveToDlq: boolean = false) {
    super(message);
  }
}