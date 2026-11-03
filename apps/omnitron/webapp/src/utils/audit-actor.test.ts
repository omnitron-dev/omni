/**
 * An audit trail that named the CLI «omnitron…» and called the daemon a
 * socket.
 *
 * Since 02815620 a call from the CLI is the account `omnitron-local`, and
 * `system` is the daemon acting on its own. The page cut `omnitron-local` to
 * «omnitron…» (every id over twelve characters, to eight) and said `system`
 * was «a local call over the unix socket».
 */

import { describe, it, expect } from 'vitest';

import { LOCAL_CALLER, actorWords } from './audit-actor';

describe('an audit trail that named the CLI «omnitron…»', () => {
  it('explains the local client without inventing a human or tool identity', () => {
    const words = actorWords(LOCAL_CALLER, 'user');
    expect(words.text).toBe('Local client');
    expect(words.title).toContain('omnitron-local');
    expect(words.title).toContain('does not identify a person');
    expect(words.title).toMatch(/CLI/);
  });

  it('still shortens a generated id, and only that', () => {
    expect(actorWords('019f2601-d65d-7b0b-9395-1f0d29385b1d', 'user').text).toBe('User: 019f2601…');
    expect(actorWords('a-long-account-name', 'user').text).toBe('User: a-long-account-name');
  });

  it('keeps a recorded system identity distinct from a local socket caller', () => {
    const words = actorWords(null, 'system');
    expect(words.title).toMatch(/Daemon system identity/);
    expect(words.title).toContain('Historical records');
    expect(words.title).not.toMatch(/socket/);
  });
});
