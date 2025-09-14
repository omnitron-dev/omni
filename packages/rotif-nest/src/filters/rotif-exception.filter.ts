import { RotifMessage } from '@omnitron-dev/rotif';
import { Catch, Logger, ArgumentsHost, ExceptionFilter } from '@nestjs/common';

import { RotifException } from '../exceptions/rotif.exception';

/**
 * Exception filter that handles errors occurring during Rotif message processing.
 * This filter catches both RotifException and standard Error instances, providing
 * appropriate error handling and message recovery strategies based on the exception type.
 *
 * The filter implements two main recovery strategies:
 * 1. Move to DLQ - For RotifExceptions with moveToDlq=true
 * 2. Retry - For other errors or RotifExceptions with moveToDlq=false
 *
 * @implements {ExceptionFilter}
 *
 * @example
 * // Register globally in module
 * RotifModule.register({
 *   globalExceptionFilters: [RotifExceptionFilter]
 * });
 *
 * @example
 * // Register for specific handler
 * ＠UseFilters(RotifExceptionFilter)
 * ＠RotifSubscribe('orders.created')
 * async handleOrder(msg: RotifMessage) {
 *   // Handler implementation
 * }
 */
@Catch(RotifException, Error)
export class RotifExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RotifExceptionFilter.name);

  /**
   * Handles exceptions thrown during message processing.
   * This method implements the core error handling logic:
   * - For RotifException with moveToDlq=true: Acknowledges the message and lets
   *   Rotif move it to DLQ
   * - For other errors: Attempts to retry message processing
   *
   * @param exception - The caught exception (RotifException or Error)
   * @param host - Arguments host containing the message context
   * 
   * @example
   * // Example of how exceptions are handled:
   * try {
   *   await processMessage(msg);
   * } catch (error) {
   *   if (error instanceof RotifException && error.moveToDlq) {
   *     // Message will be moved to DLQ
   *     await msg.ack();
   *   } else {
   *     // Message will be retried
   *     await msg.retry();
   *   }
   * }
   */
  async catch(exception: Error | RotifException, host: ArgumentsHost): Promise<void> {
    const context = host.getArgByIndex<RotifMessage>(0);

    const moveToDlq = exception instanceof RotifException && exception.moveToDlq;

    this.logger.error(
      `Error processing message "${context.id}" on "${context.channel}": ${exception.message}`,
      exception.stack,
    );

    if (moveToDlq && context.ack) {
      this.logger.warn(`Message "${context.id}" is being acknowledged and moved to DLQ.`);
      await context.ack(); // Acknowledge the message, Rotif will handle DLQ.
    }
  }
}
