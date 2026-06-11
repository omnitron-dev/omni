/**
 * NT-3 regression — verifyWebhookSignature must compare HMACs in constant time
 * (no `===` short-circuit timing oracle) and must not throw on a length
 * mismatch (the timingSafeEqual length guard).
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../src/channel/channels/webhook.channel.js';

function sign(body: string, secret: string, algo: 'sha256' = 'sha256'): string {
  return `${algo}=${createHmac(algo, secret).update(body).digest('hex')}`;
}

describe('verifyWebhookSignature (NT-3 constant-time)', () => {
  const body = '{"event":"payment.completed"}';
  const secret = 's3cr3t-key';

  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it('rejects a tampered signature of equal length', () => {
    const good = sign(body, secret);
    const tampered = good.slice(0, -1) + (good.slice(-1) === '0' ? '1' : '0');
    expect(tampered.length).toBe(good.length);
    expect(verifyWebhookSignature(body, tampered, secret)).toBe(false);
  });

  it('rejects a signature of different length WITHOUT throwing (timingSafeEqual guard)', () => {
    expect(() => verifyWebhookSignature(body, 'sha256=deadbeef', secret)).not.toThrow();
    expect(verifyWebhookSignature(body, 'sha256=deadbeef', secret)).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    expect(verifyWebhookSignature(body, sign(body, 'wrong-secret'), secret)).toBe(false);
  });
});
