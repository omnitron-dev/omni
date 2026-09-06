/**
 * Error sanitization in the auth forms.
 *
 * These forms are the only surface where a person finds out why they could
 * not sign in, register or reset a password. Everything the sanitizer
 * suppresses is replaced by "An error occurred. Please try again." — a
 * sentence that carries no way forward. So the filter being too broad is not
 * a cosmetic problem: it is the difference between "Password must contain at
 * least 2 digits" and a user who cannot register at all.
 *
 * The two corpora below are not invented. `PASSES` is taken from the messages
 * the DAOS `AuthService` and the Omnitron `AuthService` actually throw;
 * `SUPPRESSED` is the shapes an internal error takes when it escapes a server.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { sanitizeErrorMessage, LoginForm } from './auth-block.js';

const DEFAULT = 'An error occurred. Please try again.';

// Real messages from internal/daos/apps/main/src/modules/auth/auth.service.ts
// and apps/omnitron/src/services/auth.service.ts. Twenty of these were
// replaced by DEFAULT before the keyword pattern was narrowed.
const PASSES = [
  'Invalid credentials',
  'Invalid current password',
  'Password required',
  'Password must be at least 8 characters',
  'Password must contain at least 2 digits',
  'Password must contain at least 2 uppercase letters',
  'Password must contain at least 3 lowercase letters',
  'Password must contain at least 1 special character: !@_-^%#$&+*',
  'Refresh token expired',
  'Refresh token revoked',
  'Refresh token reuse detected',
  'Invalid refresh token',
  'Invalid or expired TOTP setup token',
  'Invalid or expired PGP setup token',
  'Withdrawal step-up token required',
  'PGP key not configured',
  'PGP public key not set. Update your profile with a PGP key first.',
  'Failed to encrypt with PGP key. Ensure the key is valid.',
  'TOTP code required (TOTP is enabled for this account)',
  'Account has been deleted',
  'Registration is currently disabled',
  'The platform is in maintenance mode',
];

const SUPPRESSED = [
  ['stack frame', 'boom\n    at Object.login (/app/src/auth.ts:42:11)'],
  ['system errno', 'connect ECONNREFUSED 127.0.0.1:5432'],
  ['SQL fragment', 'error in SELECT id, email FROM users WHERE id = $1'],
  ['unix path', 'ENOENT: no such file /var/lib/omni/keys.json'],
  ['windows path', 'cannot read C:\\omni\\config\\secrets.json'],
  ['assigned secret', 'login failed: password=hunter2 rejected by policy'],
  ['connection URL', 'connection to postgres://omni:s3cr3tpw@db.internal:5432/omni failed'],
  ['bearer header', 'upstream rejected Authorization: Bearer sk-ant-api03-AAAABBBBCCCCDDDD'],
  ['JWT', 'could not verify eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.4f3aQ'],
  ['vendor api key', 'Invalid API key: sk_live_EXAMPLE_NOT_A_REAL_KEY'],
  ['hex blob', 'session lookup failed for 9f8e7d6c5b4a39281706f5e4d3c2b1a0'],
  ['base64 blob', 'secret: aGVsbG8gd29ybGQgdGhpcyBpcyBhIHNlY3JldCB2YWx1ZQ=='],
  ['server env var', 'FATAL: JWT_SECRET environment variable is required'],
];

describe('sanitizeErrorMessage', () => {
  it.each(PASSES)('shows the user %j', (message) => {
    expect(sanitizeErrorMessage(new Error(message))).toBe(message);
  });

  it.each(SUPPRESSED)('suppresses a %s', (_kind, message) => {
    expect(sanitizeErrorMessage(new Error(message))).toBe(DEFAULT);
  });

  it('keeps the word that names a secret when no value follows it', () => {
    // The distinction the narrowed pattern rests on: `password` next to a
    // credential-shaped value is a leak; `password` in a sentence is advice.
    expect(sanitizeErrorMessage(new Error('Password: too short'))).toBe('Password: too short');
    expect(sanitizeErrorMessage(new Error('Password: hunter2'))).toBe(DEFAULT);
  });

  it('falls back for a non-Error rejection', () => {
    expect(sanitizeErrorMessage('Invalid credentials')).toBe(DEFAULT);
    expect(sanitizeErrorMessage(undefined)).toBe(DEFAULT);
  });

  it('falls back for a message too long to be meant for a person', () => {
    // Built from words: an unbroken run of 40+ alphanumerics is itself one of
    // the suppressed shapes, so `'a'.repeat(200)` would prove the wrong rule.
    const long = 'the request could not be completed right now '.repeat(5).trim(); // 224
    const short = long.slice(0, 200);
    expect(long.length).toBeGreaterThan(200);
    expect(sanitizeErrorMessage(new Error(long))).toBe(DEFAULT);
    expect(sanitizeErrorMessage(new Error(short))).toBe(short);
  });

  it('uses the caller-supplied fallback', () => {
    expect(sanitizeErrorMessage(new Error('ECONNREFUSED'), 'Failed to resend code')).toBe(
      'Failed to resend code'
    );
  });
});

describe('LoginForm', () => {
  it('puts the sanitized message on screen', async () => {
    // Guards the wiring, not the predicate: a correct sanitizer is worth
    // nothing if the rejection never reaches the alert.
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Password must contain at least 2 digits'));

    render(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Password must contain at least 2 digits')).toBeTruthy();
  });

  it('replaces an internal error with the generic message', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

    render(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(DEFAULT)).toBeTruthy();
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
  });
});
