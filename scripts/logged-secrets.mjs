#!/usr/bin/env node
/**
 * Find log calls that carry a secret.
 *
 * Two shapes: a field NAMED from the secret vocabulary (password, token,
 * secret, key, signature, cookie…), and a WHOLESALE dump of a request payload
 * or credentials object, where the secret is whatever the caller put in it.
 *
 * Ported from the downstream copy; the triage below is about this repo.
 *
 * TRIAGE (2026-09-12, first run on omni): 1 named hit, 0 wholesale.
 *
 *   - `netron/transport/http/middleware/http-builtin.ts`
 *     `requestLoggingMiddleware` logged `ctx.request.url` whole on all three
 *     of its lines plus `ip` and `user-agent` on the request line. A query
 *     string is where share tokens and signed-URL signatures travel, and
 *     ip+user-agent is an identity on a platform reached over Tor. Fixed in
 *     ebb1c9a: path only, both omissions opt-in.
 *
 *     THE HIT REMAINS, and should. The opt-in branch still names `ip` and
 *     `userAgent` in the source, which is all this scan can see. A field name
 *     under a flag is not the same as a field logged; read the line before
 *     concluding the fix was reverted.
 *
 * Zero wholesale dumps is the result that matters most, and it is the one the
 * scan is weakest at — a payload reaches a log under many names. Two secrets
 * this scan did NOT find, both real and both fixed by reading the code around
 * its hits, are worth remembering as the shapes it misses:
 *
 *   - a denylist redaction (`{ ...credentials, password: '***' }`) over a type
 *     with an open index signature — the field names present are all clean, so
 *     nothing in the vocabulary fires;
 *   - a value that is a secret without a secret-sounding name.
 *
 * Usage: node scripts/logged-secrets.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SECRET_FIELD = new RegExp(
  '\\b(' + [
    // presentation secrets
    'password', 'passwordHash', 'passphrase', 'secret', 'privateKey', 'seed', 'mnemonic',
    'accessToken', 'refreshToken', 'apiKey', 'csrfToken', 'stepUpToken', 'mfaToken',
    'totpSecret', 'otp',
    // conversation and post content
    'plaintext', 'ciphertext', 'armored', 'messageText', 'messageBody', 'decrypted',
    // place
    'coords', 'coordinates', 'latitude', 'longitude', 'geohash', 'postalAddress',
    // tracking. A bare `fingerprint` was deliberately removed from the
    // vocabulary: in this repository it means a PGP key fingerprint — a public
    // identifier that exists precisely to be said out loud. Browser
    // fingerprinting does not exist here by the closed-platform invariant, so
    // there is nothing of that kind to print.
    'ipAddress', 'clientIp', 'userAgent', 'browserFingerprint', 'deviceFingerprint',
    // Bearer codes. A bare `code` is unusable as a vocabulary word — this
    // repository is full of `statusCode`, `countryCode`, `coinCode`,
    // `reasonCode` — but a code that is QUALIFIED by what it opens is
    // unambiguous, and each of these is a credential someone can present.
    // `inviteCode` is what found the first hit: messaging logged the
    // `randomBytes(8)` invite-link code at creation AND at redemption, and
    // that code is the whole of what someone needs to walk into a private
    // room.
    'inviteCode', 'pickupCode', 'verificationCode', 'confirmationCode',
    'recoveryCode', 'backupCode', 'resetCode', 'otpCode', 'smsCode', 'authCode',
  ].join('|') + ')\\b', 'i');

/**
 * A bare `code` binding, in a file whose subject is a credential.
 *
 * The vocabulary above cannot include `code` globally. But inside
 * `invite.service.ts` the local named `code` IS the invite credential, and
 * that is where it was being logged — destructured from a parameter, so it
 * never appears in a qualified form anywhere. Files are listed rather than
 * inferred: a heuristic guessing which `code` is a secret would be wrong in
 * both directions.
 */
const BEARER_CODE_FILES = /\/(invite|pickup-confirmation|recovery|step-up)[.-]/;

/**
 * TRIAGE, 2026-09-10. Clean at 0/1487 — but it was clean before the invite
 * leak was found too, and that is the lesson worth keeping.
 *
 * `invite.service.ts` logged the `randomBytes(8)` invite-link code at
 * creation AND at redemption. That code is a 64-bit BEARER credential: the
 * whole of what someone needs to walk into a private room, on a platform
 * where every room is private by the closed-platform invariant. Logs travel
 * further than the row the code lives in — shipped, aggregated, retained —
 * so every reader of them was one join away.
 *
 * The scan could not see it, for the same reason `secret-verification-budget`
 * could not see `verifyPickupCode`: the field was a bare `code`, destructured
 * from a parameter, and never appeared in any qualified form. A bare `code`
 * cannot go in the vocabulary — this repository is full of `statusCode`,
 * `countryCode`, `coinCode` — so the rule is two-part: qualified names
 * (`inviteCode`, `pickupCode`, …) count anywhere, and a bare `code` counts
 * only inside a file whose subject is a credential (`BEARER_CODE_FILES`).
 * That list is enumerated rather than inferred, because a heuristic guessing
 * which `code` is a secret would be wrong in both directions.
 *
 * Verified against the real defect, not a synthetic probe: the pre-fix line
 * was restored, the scan reported it, and the file was put back.
 *
 * Both log lines already carried `linkId`, which identifies the same link for
 * every operational purpose — revoke, audit, support — without being usable.
 * When a log needs to name a credential, it almost always needs its ID.
 */
/** The whole request payload at once. */
const WHOLE_PAYLOAD = /[{,]\s*(data|input|payload|request|body|args|dto|params)\s*[,}]/;

const LOG_CALL = /\b(?:logger|log|console)\s*\.\s*(?:info|warn|error|debug|trace|log|fatal)\s*\(/;

const files = execSync(`git ls-files 'apps/*/src/**/*.ts' 'packages/*/src/**/*.ts' | grep -v '\\.spec\\.ts$' | grep -v '\\.test\\.ts$'`,
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim().split('\n').filter(Boolean);

const named = [], whole = [];
let calls = 0;

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!LOG_CALL.test(lines[i])) continue;
    const t = lines[i].trim();
    if (t.startsWith('//') || t.startsWith('*')) continue;
    calls++;
    // a call can span several lines — collect to the matching bracket
    let text = '', depth = 0, started = false;
    outer: for (let j = i; j < Math.min(i + 12, lines.length); j++) {
      for (const ch of j === i ? lines[j].slice(lines[j].search(LOG_CALL)) : lines[j]) {
        if (ch === '(') { depth++; started = true; }
        else if (ch === ')') { depth--; if (started && depth === 0) { text += ch; break outer; } }
        text += ch;
      }
      text += ' ';
    }
    const payload = text.replace(/\s+/g, ' ');
    // Vocabulary words are searched for ONLY outside string literals.
    // Otherwise `logger.info({ userId }, 'Password changed')` reads as a
    // password leak, and twenty rows like that bury one real one.
    const withoutStrings = payload.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
    const bareCode = BEARER_CODE_FILES.test(file) && /[{,]\s*code\s*[,}]/.test(withoutStrings);
    if (SECRET_FIELD.test(withoutStrings) || bareCode) {
      named.push({ file, line: i + 1, text: payload.slice(0, 118) });
    }
    else if (WHOLE_PAYLOAD.test(payload)) whole.push({ file, line: i + 1, text: payload.slice(0, 118) });
  }
}

// --- self-check
{
  const s = (t) => SECRET_FIELD.test(t), w = (t) => WHOLE_PAYLOAD.test(t);
  const checks = [
    s("logger.debug({ ciphertext }, 'x')") === true,
    s("logger.info({ userId, roomId }, 'x')") === false,
    // a vocabulary word inside the message TEXT is not a leak
    SECRET_FIELD.test("logger.info({ userId }, 'Password changed')".replace(/'[^']*'|\"[^\"]*\"|`[^`]*`/g, "''")) === false,
    SECRET_FIELD.test("logger.debug({ ciphertext }, 'sent')".replace(/'[^']*'|\"[^\"]*\"|`[^`]*`/g, "''")) === true,
    w("logger.debug({ data }, 'x')") === true,
    w("logger.info({ userId }, 'x')") === false,
    LOG_CALL.test("this.logger.warn({ a }, 'b')") === true,
    // The bearer-code rule: qualified names read as secrets anywhere, and a
    // bare `code` reads as one only inside a file whose subject is a
    // credential — the exact shape that hid the invite-link leak, where the
    // local was destructured and never appeared qualified.
    s("logger.info({ inviteCode }, 'x')") === true,
    s("logger.info({ statusCode }, 'x')") === false,
    s("logger.info({ countryCode, coinCode }, 'x')") === false,
    BEARER_CODE_FILES.test('apps/messaging/src/modules/invite/invite.service.ts') === true,
    BEARER_CODE_FILES.test('apps/main/src/modules/geolocation/geolocation.service.ts') === false,
    /[{,]\s*code\s*[,}]/.test("logger.info({ linkId, code, roomId }, 'x')") === true,
    /[{,]\s*code\s*[,}]/.test("logger.info({ statusCode }, 'x')") === false,
  ];
  if (checks.some((c) => !c)) { console.error('SELF-CHECK FAILED', checks); process.exit(2); }
}

console.log(`# log calls examined: ${calls} in ${files.length} files`);
console.log(`# named — a field from the secret vocabulary: ${named.length}`);
console.log(`# whole — the entire request payload is logged: ${whole.length}\n`);
console.log('=== NAMED ===');
for (const h of named) console.log(`${h.file}:${h.line}\n    ${h.text}`);
console.log('\n=== WHOLESALE ===');
for (const h of whole) console.log(`${h.file}:${h.line}\n    ${h.text}`);
