/**
 * A request the server refuses to parse is still somebody's credentials.
 *
 * `POST /netron/invoke` validates the envelope — `id`, `service`, `method`,
 * `input` — and on failure logged the parsed body whole. `input` is the call's
 * arguments, so for a signin that is the password, in plaintext, at error
 * level, in a file whose mode nobody chose.
 *
 * This is not hypothetical and it is not rare. Measured in a running
 * deployment on 2026-09-07: a signin sent with `nickname` where the schema
 * wanted `identifier` failed the guard, and pricing's and payments's
 * `error.log` each recorded
 *
 *     {"service":"Auth@1.0.0","method":"signin",
 *      "input":{"nickname":"user1","password":"<the real password>"}}
 *     "msg":"Invalid request format"
 *
 * Any client that gets the envelope slightly wrong takes this branch: an old
 * build, a renamed field, a proxy that rewrites, somebody probing. The correct
 * line was twelve lines below the wrong one — the success path already logs
 * `service`, `method` and `requestId` and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describeRequestShape } from '../../src/netron/transport/http/types.js';

const PASSWORD = 'Mer-Ka-Bah#789!';

describe('describeRequestShape keeps the payload out of the log', () => {
  it('says what is wrong without repeating the credentials', () => {
    // The exact body that produced the measured leak.
    const body = {
      service: 'Auth@1.0.0',
      method: 'signin',
      input: { nickname: 'user1', password: PASSWORD },
    };

    const described = describeRequestShape(body);
    const serialized = JSON.stringify(described);

    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain('user1');

    // And it still has to be useful: routing, plus which field was wrong.
    expect(described['service']).toBe('Auth@1.0.0');
    expect(described['method']).toBe('signin');
    expect(described['shape']).toMatchObject({ id: 'missing', input: 'object' });
  });

  it('names no value from a body of nothing but secrets', () => {
    const body = {
      id: 42, // wrong type — the reason this body is rejected
      service: { nested: 'not-a-string' },
      method: null,
      input: { token: 'tok-live-abcdef', privateKey: '-----BEGIN PRIVATE KEY-----' },
      apiKey: 'sk-do-not-log-me',
    };

    const serialized = JSON.stringify(describeRequestShape(body));

    for (const secret of ['tok-live-abcdef', 'BEGIN PRIVATE KEY', 'sk-do-not-log-me', 'not-a-string']) {
      expect(serialized, `${secret} reached the log`).not.toContain(secret);
    }
    // Key NAMES are shape, not payload, and they are what makes the line
    // diagnosable — an unexpected `apiKey` at the top level is the finding.
    expect(serialized).toContain('apiKey');
    expect(describeRequestShape(body)['shape']).toMatchObject({
      id: 'number',
      service: 'object',
      method: 'null',
    });
  });

  it('survives a body that is not an object at all', () => {
    expect(describeRequestShape(null)).toEqual({ bodyType: 'null' });
    expect(describeRequestShape('just a string')).toEqual({ bodyType: 'string' });
    expect(describeRequestShape(7)).toEqual({ bodyType: 'number' });
  });
});

describe('no transport path hands a whole request to the logger', () => {
  const read = (rel: string): string => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    // Comments explain the fix using the very words being searched for.
    return src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
  };

  it.each([
    ['../../src/netron/transport/http/server.ts', /logger\s*\.\s*\w+\(\s*\{\s*message\s*[,}]/],
    ['../../src/netron/transport/http/peer.ts', /logger\s*\.\s*\w+\(\s*\{\s*message\s*[,}]/],
    ['../../src/netron/remote-peer.ts', /logger\s*\.\s*\w+\(\s*\{\s*data\s*[,}]/],
  ])('%s does not log the message object', (file, pattern) => {
    expect(pattern.test(read(file))).toBe(false);
  });
});
