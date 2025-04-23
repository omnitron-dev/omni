import { Redis } from 'ioredis';

/**
 * Trims a Redis stream to maintain its size.
 * Can trim by maximum length or minimum ID.
 * @param {Redis} redis - Redis client
 * @param {string} stream - Stream name
 * @param {number} [maxLen] - Maximum length to keep
 * @param {string} [minId] - Minimum ID to keep
 */
export async function trimStream(
  redis: Redis,
  stream: string,
  maxLen?: number,
  minId?: string
) {
  if (maxLen !== undefined) {
    await redis.xtrim(stream, 'MAXLEN', '~', maxLen);
  } else if (minId !== undefined) {
    await redis.xtrim(stream, 'MINID', '~', minId);
  }
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
  return `${stream}::${group}`;
}