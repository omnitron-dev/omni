/**
 * Audit redaction must key on the secret, not on words that name secrets.
 *
 * The previous rule was
 *
 *     lowerKey.includes('password' | 'secret' | 'token' | 'key')
 *
 * and measured against a corpus of realistic field names it went wrong in both
 * directions at once: it redacted 18 of 18 benign names — `cacheKey`,
 * `routingKey`, `idempotencyKey`, `keyword`, `tokenCount`, `primaryKey`,
 * `monkeyId`, and `publicKey`, which is not a secret and is often the one
 * identifier that makes an entry traceable — while still missing `passwd`,
 * `credentials`, `authorization`, `passphrase` and `set-cookie`.
 *
 * Over-redaction is not the safe side in an audit log. The record exists to
 * hold the evidence; erasing arguments wholesale destroys what it is for while
 * looking like caution.
 *
 * Both corpora are asserted, because a change that only tightened would be
 * indistinguishable from one that also started leaking.
 */
import { describe, it, expect } from 'vitest';

import { isSensitiveFieldName } from '../../../src/netron/auth/audit-logger.js';

const SECRETS = [
  'password', 'userPassword', 'passwd', 'pwd', 'passphrase',
  'secret', 'clientSecret', 'sharedSecret',
  'token', 'accessToken', 'refreshToken', 'authToken', 'csrf_token',
  'apiKey', 'api_key', 'secretKey', 'privateKey', 'encryptionKey',
  'sessionKey', 'signingKey', 'masterKey',
  'credentials', 'authorization', 'set-cookie',
];

const BENIGN = [
  'cacheKey', 'routingKey', 'partitionKey', 'idempotencyKey', 'sortKey',
  'primaryKey', 'foreignKey', 'keyPath', 'keySpace', 'keyName', 'keyCount',
  'publicKey',
  'keyword', 'keywords', 'monkeyId',
  'tokenizer', 'tokenCount', 'tokenType',
];

describe('isSensitiveFieldName', () => {
  it('redacts every name in the secret corpus', () => {
    const missed = SECRETS.filter((name) => !isSensitiveFieldName(name));
    expect(missed, `secrets that would reach the audit log: ${missed.join(', ')}`).toEqual([]);
  });

  it('leaves every name in the benign corpus alone', () => {
    const erased = BENIGN.filter((name) => isSensitiveFieldName(name));
    expect(erased, `evidence the audit log would have destroyed: ${erased.join(', ')}`).toEqual([]);
  });

  it('treats `key` as secret only when something qualifies it', () => {
    // The distinction the substring rule could not make.
    expect(isSensitiveFieldName('privateKey')).toBe(true);
    expect(isSensitiveFieldName('publicKey')).toBe(false);
  });
});
