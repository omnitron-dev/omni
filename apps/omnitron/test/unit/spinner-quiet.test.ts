/**
 * A spinner writing to something that cannot repaint.
 *
 * `@xec-sh/kit`'s spinner animates unconditionally: every tick rewrites its
 * frame with cursor-movement escapes. On a terminal those overwrite each
 * other. Redirected — a log file, a CI job, `2>&1 | tail`, a script reading
 * the output — nothing overwrites anything, so every frame survives as text.
 *
 * Measured: one `omnitron restart paysys` emitted several hundred lines of
 * spinner frames around a command whose real output is one line. The answer
 * ends up buried, and a script grepping for it may miss it entirely.
 *
 * `--json` already suppressed this, but only for commands honouring the flag,
 * and the problem has nothing to do with JSON: a human tailing a log has it
 * too. The test is the terminal, not the flag.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

async function spinnerWith(isTTY: boolean) {
  vi.resetModules();
  const originalIsTTY = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
  const mod = await import('../../src/commands/spinner.js');
  const restore = () =>
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  return { spinner: mod.spinner, restore };
}

/** Capture what a spinner writes to stdout. */
function captureStdout(): { written: string[]; restore: () => void } {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write;
  return { written, restore: () => { process.stdout.write = original; } };
}

afterEach(() => vi.restoreAllMocks());

describe('spinner without a terminal', () => {
  it('writes one line per state change and no escape codes', async () => {
    const { spinner, restore } = await spinnerWith(false);
    const cap = captureStdout();

    try {
      const s = spinner();
      s.start('Restarting paysys...');
      s.message('still going');
      s.stop('done');
    } finally {
      cap.restore();
      restore();
    }

    const output = cap.written.join('');
    expect(output).toBe('Restarting paysys...\nstill going\ndone\n');
    // The specific thing that flooded the log: cursor moves and line erases.
    expect(output).not.toContain(String.fromCharCode(27));
  });

  it('says nothing when given nothing', async () => {
    // A `stop()` with no message must not emit a blank line — several call
    // sites use it purely to end the animation.
    const { spinner, restore } = await spinnerWith(false);
    const cap = captureStdout();

    try {
      const s = spinner();
      s.start();
      s.stop();
    } finally {
      cap.restore();
      restore();
    }

    expect(cap.written.join('')).toBe('');
  });

  it('offers the same three methods a terminal spinner does', async () => {
    // Call sites must not have to branch; that is the whole point of
    // wrapping rather than conditionally skipping the spinner.
    const { spinner, restore } = await spinnerWith(false);
    try {
      const s = spinner();
      for (const method of ['start', 'stop', 'message'] as const) {
        expect(typeof s[method], method).toBe('function');
      }
    } finally {
      restore();
    }
  });
});
