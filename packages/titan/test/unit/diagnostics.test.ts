import { describe, expect, it } from 'vitest';
import { describeError, redactDiagnosticText, sanitizeDiagnostic, type DiagnosticEvent } from '../../src/diagnostics/index.js';

describe('operational diagnostic boundaries', () => {
  it('redacts credentials in nested driver causes and JSON fields', () => {
    const text = describeError(new Error('Connection failed', { cause: new Error('postgres://user:pass@db/app?access_token=abc {"client_secret":"hidden", "password": "hidden2"} Bearer qwerty') }));
    for (const secret of ['user:pass', '=abc', 'hidden', 'qwerty']) expect(text).not.toContain(secret);
    expect(text).toContain('Connection failed');
    expect(text).toContain('postgres://***@db');
    expect(redactDiagnosticText('-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----')).toBe('[redacted private key]');
  });

  it('bounds aggregate cause graphs and tolerates cycles and throwing getters', () => {
    const cyclic = new Error('cycle');
    cyclic.cause = cyclic;
    expect(describeError(cyclic)).toBe('cycle');
    expect(describeError({ get message() { throw new Error('getter'); } })).toBe('unreadable error');
    const wide = new AggregateError(Array.from({ length: 200 }, () => new Error('x'.repeat(10000))), 'many');
    expect(describeError(wide).length).toBeLessThanOrEqual(2048);
    expect(describeError({ message: 'write failed', code: '40001' })).toContain('40001');
  });

  it('forwards only the contract, validates it, and limits evidence', () => {
    const event = { eventId: 'e1', id: 'database.failure', source: 'test', timestamp: 1, state: 'raised', severity: 'error', title: 'Database',
      evidence: Array.from({ length: 30 }, () => 'password=private'), headers: { secret: 'private' } };
    const clean = sanitizeDiagnostic(event as DiagnosticEvent);
    expect(clean.evidence).toHaveLength(16);
    expect(JSON.stringify(clean)).not.toContain('private');
    expect(clean).not.toHaveProperty('headers');
    expect(() => sanitizeDiagnostic({ ...clean, state: 'surprise' } as unknown as DiagnosticEvent)).toThrow('state');
  });
});
