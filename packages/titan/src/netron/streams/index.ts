/**
 * Netron Streams Module
 *
 * This module provides streaming capabilities for the Netron distributed system.
 * It includes readable and writable stream implementations, stream references
 * for network serialization, and utility functions.
 *
 * @module @omnitron-dev/titan/netron/streams
 */

export { NetronReadableStream } from './readable-stream.js';
export type { NetronReadableStreamOptions } from './readable-stream.js';

export { NetronWritableStream } from './writable-stream.js';
export type { NetronWritableStreamOptions } from './writable-stream.js';

export { StreamReference } from './stream-reference.js';
export type { StreamReferenceType } from './stream-reference.js';

export { isNetronStream } from './utils.js';
