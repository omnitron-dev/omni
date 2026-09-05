/**
 * Connection lifecycle is debug, not info.
 *
 * Measured by omni-4b on a live omnitron log table: netron's own plumbing
 * accounted for 83.9% of every line, with 93,273 rows of "Initializing remote
 * peer" in a single day and roughly ten info lines per connect/disconnect
 * cycle. None of it reports a change an operator acts on — it reports that the
 * transport is working.
 *
 * This is the quiet half of the same failure as a million identical error
 * lines: a message emitted often enough stops being a message. The level is
 * the only thing separating "the system changed state" from "the plumbing is
 * plumbing", so it is worth pinning.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src/netron');

/** Messages that must never be emitted above debug. */
const LIFECYCLE = [
  ['connection-manager.ts', 'Connection manager started'],
  ['connection-manager.ts', 'Stopping connection manager'],
  ['connection-manager.ts', 'Connection manager stopped'],
  ['netron.ts', 'Stopping Netron instance'],
  ['netron.ts', 'Netron instance stopped'],
  ['netron.ts', 'Connecting to remote peer'],
  ['remote-peer.ts', 'Initializing remote peer'],
  ['remote-peer.ts', 'Remote interface queried successfully'],
] as const;

describe('netron connection lifecycle logging', () => {
  for (const [file, message] of LIFECYCLE) {
    it(`logs "${message}" at debug`, () => {
      const source = readFileSync(join(SRC, file), 'utf8');
      const index = source.indexOf(`'${message}`);
      expect(index, `"${message}" is no longer logged from ${file}`).toBeGreaterThan(-1);

      // Walk back to the logger call that carries this message.
      const call = source.lastIndexOf('this.logger.', index);
      expect(call).toBeGreaterThan(-1);
      const level = source.slice(call + 'this.logger.'.length, source.indexOf('(', call));

      expect(level, `${file}: "${message}" should be debug, not ${level}`).toBe('debug');
    });
  }

  it('never logs an error under a key no serializer reads', () => {
    // `{ value: err }` put the cause under a name pino does not serialize as
    // an error, and the messages ended in a dangling colon that promised a
    // continuation the log never carried:
    //   {"msg":"Error running task:","value":{"name":"TitanError",...}}
    const source = readFileSync(join(SRC, 'remote-peer.ts'), 'utf8');

    expect(source).not.toMatch(/logger\.\w+\(\{\s*value:\s*(err|error)/);
    // No logger message may end in a colon — it reads as truncated output.
    expect(source).not.toMatch(/logger\.\w+\([^)]*['"][^'"]*:['"]\s*\)/);
  });
});
