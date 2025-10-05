/**
 * Stream utility functions
 * This file contains predicates for stream type checking
 * Separated to avoid circular dependencies
 */

import { NetronReadableStream } from './readable-stream.js';
import { NetronWritableStream } from './writable-stream.js';

/**
 * Determines if an object is a Netron stream (readable or writable)
 *
 * @param obj - The object to check
 * @returns true if the object is a NetronReadableStream or NetronWritableStream
 */
export const isNetronStream = (obj: any): boolean => obj instanceof NetronReadableStream || obj instanceof NetronWritableStream;
