import { describe, expect, it } from 'vitest';
import { MailDeliveryError, mailFailure } from '../src/errors.js';

describe('SMTP failure retry contract', () => {
  it.each(['EAUTH', 'ETLS', 'EENVELOPE', 'EMESSAGE'])(
    'retains temporary SMTP responses at the %s stage for durable retry', (code) => {
      for (const responseCode of [421, 450, 451, 452, 454]) {
        expect(mailFailure({ code, responseCode })).toMatchObject({ kind: 'transient', retryable: true });
      }
    },
  );
  it.each([
    { code: 'EAUTH', responseCode: 535 },
    { code: 'ETLS', responseCode: 500 },
    { code: 'EAUTH' },
    { code: 'ETLS' },
  ])('requires repair after a permanent or unspecified configuration refusal: %j', (failure) => {
    expect(mailFailure(failure)).toMatchObject({ kind: 'configuration', retryable: false });
  });
  it.each(['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT'])(
    'never retries or hides certificate validation failure %s', (code) => {
      expect(mailFailure({ code, responseCode: 454 })).toMatchObject({ kind: 'configuration', retryable: false });
      expect(mailFailure({ code: 'ETLS', originalCode: code })).toMatchObject({ kind: 'configuration', retryable: false });
    },
  );
  it('keeps recipient refusal permanent and preserves an already classified failure', () => {
    expect(mailFailure({ code: 'EENVELOPE', responseCode: 550 })).toMatchObject({ kind: 'permanent', retryable: false });
    const existing = new MailDeliveryError('capacity');
    expect(mailFailure(existing)).toBe(existing);
  });
  it('does not retain a server transcript or private cause in the public failure', () => {
    const failure = mailFailure(Object.assign(new Error('private server transcript'), {
      code: 'EAUTH', responseCode: 454, cause: new Error('private connection data'),
    }));
    expect(failure.message).toBe('Mail delivery failed (transient)');
    expect(failure.cause).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain('private');
  });
});
