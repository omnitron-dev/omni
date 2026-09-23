/**
 * A command's stdout as DATA, past the transport's masker.
 *
 * Every result the execution engine (xec) returns has passed through its
 * sensitive-data masker: stdout, stderr and the command, for display. That
 * is right for a message and wrong for data. A holder record of a node's
 * deploy lease, `{"token":"<uuid>",…}`, came back as `"token": [REDACTED]` —
 * no longer JSON — on EVERY read, so a refused deployment could never say who
 * held the node. An attestation line whose probe output said `password=…`
 * was cut through its closing quote and refused as «printed no JSON», or
 * edited and stored as evidence. And the first operator account made on
 * daos/test (2026-09-23) arrived as `"password": [REDACTED]` and was lost.
 *
 * The engine has no switch for one call — masking is set per adapter, and
 * turning it off around a call would unmask whatever else runs meanwhile.
 * So the data is carried in a form no rule can match: the node hex-encodes
 * the command's stdout and this side decodes it. Every rule the masker has
 * needs a character outside `[0-9a-f]` — `:` or `=` after a key, `_` or a
 * letter past `f` in a token prefix, `://`, `-----BEGIN` — which is a
 * property of today's rules, not a law: the court that holds this sends a
 * payload carrying every trigger through the real engine and requires it
 * back byte for byte, and a rule that learns long hex strings turns it red.
 * If the channel ever does come back rewritten, it does not decode, and that
 * is said — never read as data.
 *
 * Stderr is not touched: it is words, and stays masked.
 *
 * Use it where stdout is data a caller parses or stores, and name the caller:
 * what comes out of it is unmasked, and a log line that printed it whole
 * would be the masker's bypass.
 */

import { shellEscape } from '../shared/shell-escape.js';

/**
 * The command, run by `sh`, its stdout hex-encoded on the way out and its own
 * exit code kept — `od`'s would say the encoding worked, not that the command
 * did. `-v`: without it `od` folds repeated lines into `*`. Command
 * substitution drops trailing newlines, which no reader of these outputs
 * depends on.
 */
export function throughDataChannel(command: string): string {
  return `out=$(sh -c ${shellEscape(command)}); code=$?; printf '%s' "$out" | od -An -v -tx1 | tr -d ' \\n'; exit $code`;
}

/** The stdout the command printed, or why the channel cannot be read. */
export function fromDataChannel(stdout: string): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly because: string } {
  const hex = stdout.trim();
  if (/^(?:[0-9a-f]{2})*$/.test(hex)) return { ok: true, text: Buffer.from(hex, 'hex').toString('utf8') };
  const stray = hex.replace(/[0-9a-f]/g, '').length;
  return {
    ok: false,
    because:
      `the data channel came back as something other than its encoding (${hex.length} characters, ${stray} of them not hex` +
      `${hex.length % 2 === 1 ? ', odd length' : ''}) — rewritten or cut on the way; it was not read as data`,
  };
}
