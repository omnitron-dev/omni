import { RotifMessage } from './types.js';

/**
 * Context object passed to middleware functions.
 * @interface MiddlewareContext
 */
export type MiddlewareContext = {
  /** The message being processed */
  message: RotifMessage;
  /** Function to call the next middleware in the chain */
  next: () => Promise<void>;
};

/**
 * Interface for middleware functions.
 * @interface Middleware
 */
export type Middleware = {
  /**
   * Called before publishing a message.
   * @param {string} channel - Channel name
   * @param {any} payload - Message payload
   * @param {any} [options] - Publishing options
   */
  beforePublish?: (channel: string, payload: any, options?: any) => void | Promise<void>;

  /**
   * Called after publishing a message.
   * @param {string} channel - Channel name
   * @param {any} payload - Message payload
   * @param {string | null} id - Message ID or null if scheduled
   * @param {any} [options] - Publishing options
   */
  afterPublish?: (channel: string, payload: any, id: string[] | string | null, options?: any) => void | Promise<void>;

  /**
   * Called before processing a message.
   * @param {RotifMessage} msg - Message to process
   */
  beforeProcess?: (msg: RotifMessage) => void | Promise<void>;

  /**
   * Called after processing a message.
   * @param {RotifMessage} msg - Processed message
   */
  afterProcess?: (msg: RotifMessage) => void | Promise<void>;

  /**
   * Called when an error occurs during message processing.
   * @param {RotifMessage} msg - Message that caused the error
   * @param {Error} error - Error that occurred
   */
  onError?: (msg: RotifMessage, error: Error) => void | Promise<void>;
};

/**
 * Manages middleware execution for message processing.
 * @class MiddlewareManager
 */
export class MiddlewareManager {
  /** Array of registered middleware */
  private middleware: Middleware[] = [];

  /**
   * Adds a middleware to the chain.
   * @param {Middleware} mw - Middleware to add
   */
  use(mw: Middleware) {
    this.middleware.push(mw);
  }

  /**
   * Runs all beforePublish middleware.
   * @param {string} channel - Channel name
   * @param {any} payload - Message payload
   * @param {any} [options] - Publishing options
   */
  async runBeforePublish(channel: string, payload: any, options?: any) {
    for (const mw of this.middleware) {
      if (mw.beforePublish) await mw.beforePublish(channel, payload, options);
    }
  }

  /**
   * Runs all afterPublish middleware.
   * @param {string} channel - Channel name
   * @param {any} payload - Message payload
   * @param {string | null} id - Message ID or null if scheduled
   * @param {any} [options] - Publishing options
   */
  async runAfterPublish(channel: string, payload: any, id: string[] | string | null, options?: any) {
    for (const mw of this.middleware) {
      if (mw.afterPublish) await mw.afterPublish(channel, payload, id, options);
    }
  }

  /**
   * Runs all beforeProcess middleware.
   * @param {RotifMessage} msg - Message to process
   */
  async runBeforeProcess(msg: RotifMessage) {
    for (const mw of this.middleware) {
      if (mw.beforeProcess) await mw.beforeProcess(msg);
    }
  }

  /**
   * Runs all afterProcess middleware.
   * @param {RotifMessage} msg - Processed message
   */
  async runAfterProcess(msg: RotifMessage) {
    for (const mw of this.middleware) {
      if (mw.afterProcess) await mw.afterProcess(msg);
    }
  }

  /**
   * Runs all onError middleware.
   * @param {RotifMessage} msg - Message that caused the error
   * @param {Error} err - Error that occurred
   */
  async runOnError(msg: RotifMessage, err: Error) {
    for (const mw of this.middleware) {
      if (mw.onError) await mw.onError(msg, err);
    }
  }
}
