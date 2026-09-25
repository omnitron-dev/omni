/**
 * The 5xx log line carried the mask and threw away the fault.
 *
 * `toTitanError` deliberately replaces a driver or programming error with a
 * generic sentence — "An unexpected error occurred", "A database error
 * occurred" — so the wire does not carry schema names, file paths or internal
 * fields. It says three separate times that this is safe because "the full
 * error still travels as `cause`, so server-side logs lose nothing".
 *
 * The server-side log lost everything. `HttpServer` logged
 * `titanError.stack`, which is the stack of the WRAPPER, so every 5xx read:
 *
 *     error: An unexpected error occurred
 *     stack: TitanError: An unexpected error occurred
 *         at toTitanError (…/errors/factories.js:257)
 *         at HttpServer.handleInvocationRequest (…)
 *
 * — the masked sentence, then the function that masked it, and nothing about
 * what actually happened. Measured on the dev stand 2026-09-16 against a
 * `sendMessage` answering 500: the log named the service, the method and the
 * duration, and could not say why.
 *
 * The masking is correct and unchanged. What these pin is that the thing it
 * promises to keep is written down.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The real function, not a copy reconstructed out of the source. The first
// version of this test stripped TypeScript annotations with regexes and
// rebuilt it through `new Function` — a test running on its own approximation
// of the code it is checking.
import { causeFields } from '../../src/netron/transport/http/server.js';

const SERVER = readFileSync(
  new URL('../../src/netron/transport/http/server.ts', import.meta.url),
  'utf8',
);

describe('causeFields', () => {
  it('names the fault the mask was hiding', () => {
    const real = new TypeError("Cannot read properties of undefined (reading 'findById')");
    const masked = Object.assign(new Error('An unexpected error occurred'), { cause: real });

    const fields = causeFields(masked);

    expect(fields['cause']).toBe("TypeError: Cannot read properties of undefined (reading 'findById')");
    expect(String(fields['causeStack'])).toContain('TypeError');
  });

  it('walks a chain, because a driver error arrives wrapped twice', () => {
    const driver = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    const repo = Object.assign(new Error('insert failed'), { cause: driver });
    const masked = Object.assign(new Error('The request conflicts with existing data'), { cause: repo });

    const fields = causeFields(masked);

    expect(fields['cause']).toBe('Error: insert failed ← Error: duplicate key value violates unique constraint');
    // The DEEPEST stack is the useful one — that is where the fault is.
    expect(String(fields['causeStack'])).toContain('duplicate key');
  });

  it('reads an AggregateError, whose own message is the empty string', () => {
    // The shape that already cost this repository 29 099 log lines naming no
    // cause: `AggregateError.message` is '' and the reasons live in `.errors`.
    const agg = new AggregateError(
      [new Error('connect ECONNREFUSED ::1:6379'), new Error('connect ECONNREFUSED 127.0.0.1:6379')],
      '',
    );
    const masked = Object.assign(new Error('An unexpected error occurred'), { cause: agg });

    const fields = causeFields(masked);

    expect(String(fields['cause'])).toContain('ECONNREFUSED ::1:6379');
    expect(String(fields['cause'])).toContain('127.0.0.1:6379');
  });

  it('adds no field at all when there is no cause', () => {
    // A hand-written business error is its own explanation; an empty `cause:`
    // in every such line would be noise.
    expect(causeFields(new Error('Shop is closed'))).toEqual({});
  });

  it('cannot loop on an error that is its own cause', () => {
    const loop: { cause?: unknown } & Error = new Error('round');
    loop.cause = loop;
    const masked = Object.assign(new Error('An unexpected error occurred'), { cause: loop });

    expect(() => causeFields(masked)).not.toThrow();
    expect(String(causeFields(masked)['cause'])).toBe('Error: round');
  });
});

/** Every block that ends in a `'Netron error'` line, not just the first. */
function errorLogBlocks(): string[] {
  const blocks: string[] = [];
  const needle = "this.netronPeer.logger.error(logFields, 'Netron error')";
  for (let at = SERVER.indexOf(needle); at !== -1; at = SERVER.indexOf(needle, at + 1)) {
    blocks.push(SERVER.slice(Math.max(0, at - 2600), at));
  }
  return blocks;
}

describe('the 5xx log line', () => {
  it('writes the cause beside the wrapper stack, not instead of it', () => {
    // Anchored on EVERY such block rather than the first one found. This
    // assertion used to read `SERVER.indexOf(...)` and check the 2600
    // characters before it, which was the right block for exactly as long as
    // there was one of them. A second copy — the fast path, taught to log in
    // 377f1f79 — inserted itself ABOVE the first and the court started
    // reporting on a block it was never written about. It went red for the
    // right reason by luck: had the copy been added below, it would have
    // stayed green over a path that logged the mask and nothing else.
    const blocks = errorLogBlocks();
    expect(blocks.length, 'both copies of this operation are checked').toBeGreaterThanOrEqual(2);

    for (const [i, block] of blocks.entries()) {
      // Both: the wrapper stack locates the boundary, the cause says what broke.
      expect(block, `5xx log block #${i + 1}`).toContain('stack: titanError.stack');
      expect(block, `5xx log block #${i + 1}`).toContain('causeFields(titanError)');
      // And only on 5xx, or on a refusal the DATABASE made — any other 4xx is
      // the caller's own doing and needs no internals, while a 409 from a
      // unique index is the server's invariant, and its cause names the
      // constraint (see a-conflict-the-server-kept-to-itself).
      expect(block, `5xx log block #${i + 1}`).toMatch(
        /\(httpError\.status >= 500 \|\| isDatabaseRefusal\(errorCode\)\) && causeFields/
      );
    }
  });
});
