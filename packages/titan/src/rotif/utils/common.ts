import os from 'node:os';
import { pack } from 'msgpackr';
import { createHash } from 'node:crypto';

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
  return loopKey.split('::') as [string, string];
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
 * @param {string} channel - Channel name
 * @param {any} payload - Payload to deduplicate
 * @param {string} group - Optional group name
 * @returns {string} Deduplication key
 */
export function generateDedupKey({ channel, payload, group, pattern }: { channel: string, payload: any, group?: string, pattern?: string }): string {
  const id = createHash('sha256').update(pack(payload)).digest('hex');
  return `rotif:dedup:${channel}:${id}:${group ? `${group}` : '*'}:${pattern ? `${pattern}` : '*'}`;
}
