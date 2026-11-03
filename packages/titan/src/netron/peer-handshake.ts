import { NetronErrors } from '../errors/index.js';
import { CONNECT_TIMEOUT } from './constants.js';

export const MAX_GREETING_BYTES = 4096;

export function resolveHandshakeTimeout(value: unknown): number {
  if (value === undefined) return CONNECT_TIMEOUT;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
    throw NetronErrors.invalidRequest('connectTimeout must be a positive integer no greater than 2147483647');
  return value;
}

/** A routing identity, never a substitute for an authenticated principal. */
export function isPeerIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\p{Cc}\p{Cf}]/u.test(value);
}

export function parsePeerGreeting(data: Buffer | ArrayBuffer, type: 'id' | 'client-id', isBinary?: boolean): string {
  if (isBinary || data.byteLength > MAX_GREETING_BYTES) {
    throw NetronErrors.invalidRequest('Invalid peer greeting framing or size');
  }
  const message: unknown = JSON.parse((Buffer.isBuffer(data) ? data : Buffer.from(data)).toString('utf8'));
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== type ||
      !('id' in message) || !isPeerIdentity(message.id)) {
    throw NetronErrors.invalidRequest('Invalid peer greeting identity or type');
  }
  return message.id;
}
