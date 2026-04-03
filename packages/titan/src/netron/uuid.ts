import { generateUuidV7 } from '../utils/id.js';

/** Default UUID generator — UUIDv7 (RFC 9562, monotonic, B-tree friendly) */
export const uuid = generateUuidV7;
