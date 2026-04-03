/**
 * Stream utility functions for browser
 * Provides utilities for working with Netron streams in the browser
 */

import { NetronReadableStream } from './readable-stream.js';
import { NetronWritableStream } from './writable-stream.js';

/**
 * Determines if an object is a Netron stream (readable or writable)
 *
 * @param obj - The object to check
 * @returns true if the object is a NetronReadableStream or NetronWritableStream
 */
export const isNetronStream = (obj: any): boolean =>
  obj instanceof NetronReadableStream || obj instanceof NetronWritableStream;

/**
 * Determines if an object is a NetronReadableStream
 *
 * @param obj - The object to check
 * @returns true if the object is a NetronReadableStream
 */
export const isNetronReadableStream = (obj: any): obj is NetronReadableStream => obj instanceof NetronReadableStream;

/**
 * Determines if an object is a NetronWritableStream
 *
 * @param obj - The object to check
 * @returns true if the object is a NetronWritableStream
 */
export const isNetronWritableStream = (obj: any): obj is NetronWritableStream => obj instanceof NetronWritableStream;
