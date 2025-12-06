import { RotifLogger } from '../types.js';

/**
 * Default logger implementation for Rotif.
 * Uses console methods for logging with a 'rotif' prefix.
 * @type {RotifLogger}
 */
export const defaultLogger: RotifLogger = {
  /**
   * Logs a debug message.
   * @param {string} msg - Message to log
   * @param {any} [meta] - Additional metadata
   */
  debug: (msg, meta) => {
    if (meta instanceof Error) {
      console.debug(`[rotif] DEBUG: ${msg}`, meta.stack || meta);
    } else {
      console.debug(`[rotif] DEBUG: ${msg}`, meta ?? '');
    }
  },

  /**
   * Logs an info message.
   * @param {string} msg - Message to log
   * @param {any} [meta] - Additional metadata
   */
  info: (msg, meta) => {
    if (meta instanceof Error) {
      console.info(`[rotif] INFO: ${msg}`, meta.stack || meta);
    } else {
      console.info(`[rotif] INFO: ${msg}`, meta ?? '');
    }
  },

  /**
   * Logs a warning message.
   * @param {string} msg - Message to log
   * @param {any} [meta] - Additional metadata
   */
  warn: (msg, meta) => {
    if (meta instanceof Error) {
      console.warn(`[rotif] WARN: ${msg}`, meta.stack || meta);
    } else {
      console.warn(`[rotif] WARN: ${msg}`, meta ?? '');
    }
  },

  /**
   * Logs an error message.
   * @param {string} msg - Message to log
   * @param {any} [meta] - Additional metadata
   */
  error: (msg, meta) => {
    if (meta instanceof Error) {
      console.error(`[rotif] ERROR: ${msg}`, meta.stack || meta);
    } else {
      console.error(`[rotif] ERROR: ${msg}`, meta ?? '');
    }
  },
};
