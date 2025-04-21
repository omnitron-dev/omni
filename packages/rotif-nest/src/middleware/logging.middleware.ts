import { Logger } from '@nestjs/common';
import { Middleware, RotifMessage } from '@devgrid/rotif';

/**
 * Middleware that provides comprehensive logging for all Rotif message operations.
 * This middleware logs various stages of message processing including publishing,
 * processing, and error handling. It uses NestJS's built-in Logger for consistent
 * logging across the application.
 *
 * @implements {Middleware}
 *
 * @example
 * // Register middleware globally in module
 * RotifModule.register({
 *   middleware: [LoggingMiddleware],
 * });
 *
 * @example
 * // Register middleware for specific subscription
 * ＠RotifSubscribe('orders.*', {
 *   middleware: [LoggingMiddleware]
 * })
 */
export class LoggingMiddleware implements Middleware {
  private readonly logger = new Logger(LoggingMiddleware.name);

  /**
   * Logs message publishing attempts before they occur.
   * This method is called before a message is published to Redis.
   *
   * @param channel - The channel the message is being published to
   * @param payload - The message payload being sent
   */
  async beforePublish(channel: string, payload: any): Promise<void> {
    this.logger.debug(`Publishing message to channel "${channel}": ${JSON.stringify(payload)}`);
  }

  /**
   * Logs successful message publications.
   * This method is called after a message has been successfully published to Redis.
   *
   * @param channel - The channel the message was published to
   * @param payload - The message payload that was sent
   * @param id - The message ID assigned by Redis (or null for Pub/Sub)
   */
  async afterPublish(channel: string, payload: any, id: string | null): Promise<void> {
    this.logger.debug(`Message published to "${channel}", ID: ${id}`);
  }

  /**
   * Logs message processing attempts before they begin.
   * This method is called before a message handler processes a message.
   *
   * @param msg - The message about to be processed
   */
  async beforeProcess(msg: RotifMessage): Promise<void> {
    this.logger.debug(`Processing message from channel "${msg.channel}": ${JSON.stringify(msg.payload)}`);
  }

  /**
   * Logs successful message processing completions.
   * This method is called after a message has been successfully processed.
   *
   * @param msg - The message that was processed
   */
  async afterProcess(msg: RotifMessage): Promise<void> {
    this.logger.debug(`Processed message "${msg.id}" from channel "${msg.channel}"`);
  }

  /**
   * Logs message processing errors.
   * This method is called when an error occurs during message processing.
   * It includes the error stack trace for debugging purposes.
   *
   * @param msg - The message that failed processing
   * @param error - The error that occurred during processing
   */
  async onError(msg: RotifMessage, error: Error): Promise<void> {
    this.logger.error(`Error processing message "${msg.id}" from channel "${msg.channel}": ${error.message}`, error.stack);
  }
}
