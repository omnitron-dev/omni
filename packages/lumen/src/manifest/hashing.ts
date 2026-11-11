import { createHash } from 'node:crypto';

export function computeContentHash(content: string | Uint8Array, length: number = 8): string {
  const hash = createHash('sha256').update(content).digest('hex');
  return length > 0 ? hash.slice(0, length) : hash;
}

export function computeSriHash(content: string | Uint8Array): string {
  const base64 = createHash('sha256').update(content).digest('base64');
  return `sha256-${base64}`;
}
