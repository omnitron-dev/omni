import os from 'os';
import { pack } from 'msgpackr';
import { createHash } from 'crypto';

/**
 * Parses an array of field-value pairs into an object.
 * The input array should contain alternating field names and values.
 * @param {string[]} raw - Array of field-value pairs
 * @returns {Record<string, string>} Object with field-value pairs
 * @example
 * parseFields(['field1', 'value1', 'field2', 'value2'])
 * // Returns: { field1: 'value1', field2: 'value2' }
 */
export function parseFields(raw: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < raw.length; i += 2) {
    const key = raw[i];
    const value = raw[i + 1];
    if (key !== undefined && value !== undefined) {
      obj[key] = value;
    }
  }
  return obj;
}

/**
 * Generates a Redis stream key from a channel name.
 * @param {string} channel - Channel name
 * @returns {string} Redis stream key
 */
export function getStreamKey(channel: string): string {
  return `rotif:stream:${channel}`;
}

export function getLoopKey(stream: string, group: string): string {
  return `${stream}:${group}`;
}

export function splitLoopKey(loopKey: string): [string, string] {
  const parts = loopKey.split(':');
  return [parts[0], parts.slice(1).join(':')] as [string, string];
}

/**
 * Generates a default consumer group name from a pattern.
 * @param {string} pattern - Channel pattern
 * @returns {string} Default group name
 */
export function getGroupName(pattern: string, customName?: string): string {
  return customName ?? `grp:${pattern}`;
}

/**
 * Generates a default consumer name.
 * Uses hostname, process ID, and a random number for uniqueness.
 * @returns {string} Default consumer name
 */
export function defaultConsumerName(): string {
  return `${os.hostname()}:${process.pid}:${Math.floor(Math.random() * 10000)}`;
}

/**
 * Generates a deduplication key for a given channel and payload.
 * Supports both automatic (hash-based) and explicit key generation.
 *
 * @param {string} channel - Channel name
 * @param {any} payload - Payload to deduplicate (used only if explicitKey not provided)
 * @param {string} group - Optional group name for consumer-side dedup
 * @param {string} pattern - Optional pattern for publisher-side dedup
 * @param {string} side - 'pub' for publisher, 'con' for consumer
 * @param {string} explicitKey - Optional explicit key to use instead of hash
 * @returns {string} Deduplication key
 *
 * @example
 * // Automatic deduplication based on payload hash
 * generateDedupKey({ channel: 'orders', payload: orderData, side: 'pub' })
 *
 * @example
 * // Explicit deduplication by order ID (business logic based)
 * generateDedupKey({ channel: 'orders', payload: orderData, side: 'pub', explicitKey: `order-${orderId}` })
 */
export function generateDedupKey({
  channel,
  payload,
  group,
  pattern,
  side = 'pub',
  explicitKey,
}: {
  channel: string;
  payload: any;
  group?: string;
  pattern?: string;
  side?: 'pub' | 'con';
  /** Explicit deduplication key. When provided, skips payload hashing. */
  explicitKey?: string;
}): string {
  // Use explicit key if provided, otherwise hash the payload
  let id: string;

  if (explicitKey) {
    // Use explicit key directly (sanitized for Redis key safety)
    id = explicitKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  } else {
    // Create a unique serialization for the payload
    // Include the type to ensure different types with same value get different hashes
    const typePrefix = typeof payload === 'object' && payload === null ? 'null:' : `${typeof payload}:`;

    let dataToHash: Buffer;
    if (payload === null || payload === undefined) {
      // Handle null and undefined explicitly
      dataToHash = Buffer.from(typePrefix + String(payload));
    } else if (typeof payload === 'object') {
      // Use msgpackr for objects
      dataToHash = pack(payload);
    } else {
      // For primitives, combine type and value
      dataToHash = Buffer.from(typePrefix + JSON.stringify(payload));
    }

    id = createHash('sha256').update(dataToHash).digest('hex');
  }

  // Use different prefixes for publisher and consumer deduplication
  const prefix = side === 'pub' ? 'rotif:dedup:pub' : 'rotif:dedup:con';
  return `${prefix}:${channel}:${id}:${group ? `${group}` : '*'}:${pattern ? `${pattern}` : '*'}`;
}
