/**
 * The daemon exposed the service and the CLI could not find it.
 *
 * `omnitron secret set` reached the secrets service by reaching into the
 * client's privates — `client['netron']`, `getPeers()` — walking the peers
 * itself and swallowing every error with `continue`. Every failure ended as
 * one sentence with nothing behind it:
 *
 *     Daemon is running but its secrets RPC failed: OmnitronSecrets service not found
 *     Falling back to direct file access — these two can disagree
 *
 * on a daemon that exposes `OmnitronSecrets` unconditionally at startup,
 * before anything else it exposes.
 *
 * The fallback is the part that made it expensive. It writes the same
 * encrypted file from the CLI's own process, and the warning beside it says
 * exactly what that costs: the daemon's answer is what the console and the
 * MCP tools see. Measured while populating the vault for the test server —
 * six `secret set` calls in one sequence, every one reporting
 * `set (direct mode)`, and `secret list` afterwards showing none of them.
 *
 * Through `client.service()`, which is how every other command in this
 * directory reaches a service, the same nine secrets come back from the
 * daemon with no warning at all.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = stripComments(
  fs.readFileSync(path.join(here, '../../src/commands/secret.ts'), 'utf8'),
);

describe('a command asks the client for a service', () => {
  it('goes through the client, not around it', () => {
    expect(source).toContain("client.service<IOmnitronSecretsService>('OmnitronSecrets')");
  });

  it('does not reach into the client\'s privates', () => {
    for (const reach of ["client['netron']", "client['ensureConnected']", 'getPeers()']) {
      expect(source, reach).not.toContain(reach);
    }
  });

  it('does not swallow a lookup failure per peer', () => {
    // `catch { continue }` inside the walk turned every cause — a wrong
    // name, an auth refusal, a peer still connecting — into the same
    // sentence, and that sentence named the service as missing.
    expect(source).not.toMatch(/catch \{\s*continue;?\s*\}/);
  });

  it('still keeps the fallback for a daemon that is not running', () => {
    // The two modes are the point of this command; what changed is that the
    // first one works.
    expect(source).toContain('createDirectService');
    expect(source).toContain('warnIfHidingAFailure');
  });

  it('calls the four methods the contract declares', () => {
    for (const call of ['.set({ key, value })', '.get({ key })', '.list()', '.delete({ key })']) {
      expect(source, call).toContain(call);
    }
  });
});
