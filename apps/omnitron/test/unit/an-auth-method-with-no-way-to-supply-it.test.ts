/**
 * A node could be told to authenticate with a password it could not be given.
 *
 * `omnitron node add --ssh-auth password` and `node update --ssh-auth
 * password` set the method and handled no secret at all — no flag, no
 * prompt, nothing. So the row said `password` and carried none: the health
 * monitor reported the node down, `fleet upgrade` could not reach it, and
 * the registry looked correct. Measured on this console, on the row that
 * names the stack it serves:
 *
 *     16f3dd5a  sample-test  37.27.130.185:22  ○ down  ○ offline
 *
 * beside a second row for the same machine that did have one and was green.
 *
 * From stdin rather than a flag: an argument is visible to every process on
 * the machine for as long as the command runs, and this one is a root
 * password.
 */

import { describe, it, expect } from 'vitest';
import { PassThrough, Readable, Writable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSecretFromStdin } from '../../src/commands/node.js';
import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = stripComments(fs.readFileSync(path.join(here, '../../src/cli/omnitron.ts'), 'utf8'));

/** Run one read against a stdin of our own. */
async function withStdin<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const real = Object.getOwnPropertyDescriptor(process, 'stdin')!;
  Object.defineProperty(process, 'stdin', { value: Readable.from([text]), configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'stdin', real);
  }
}

describe('the secret comes in on stdin', () => {
  it('reads what was piped', async () => {
    const value = await withStdin('hunter2', () => readSecretFromStdin('password'));
    expect(value).toBe('hunter2');
  });

  it('strips the newline a shell adds', async () => {
    // `echo` adds one, and a password with a trailing newline authenticates
    // against nothing while looking right in every log.
    expect(await withStdin('hunter2\n', () => readSecretFromStdin('password'))).toBe('hunter2');
    expect(await withStdin('hunter2\r\n', () => readSecretFromStdin('password'))).toBe('hunter2');
  });

  it('keeps a password that happens to contain spaces', async () => {
    expect(await withStdin('two words \n', () => readSecretFromStdin('password'))).toBe('two words ');
  });

  it('bounds piped input without including the secret in errors', async () => {
    await expect(withStdin('s'.repeat(65537), () => readSecretFromStdin('password')))
      .rejects.toThrow('SSH secret exceeds 64 KiB');
  });

  it('refuses an empty stdin rather than storing nothing', async () => {
    // An empty secret stored is a node that cannot authenticate and a
    // registry that says it can.
    await expect(withStdin('', () => readSecretFromStdin('password'))).rejects.toThrow(/No password on stdin/);
  });
});

describe('both commands can supply one', () => {
  it('offers the option on add and on update', () => {
    expect(cli.match(/--ssh-secret-stdin/g)?.length, 'add and update').toBe(2);
  });

  it('never takes the secret as an argument', () => {
    // The whole reason for stdin.
    expect(cli).not.toMatch(/--ssh-password </);
    expect(cli).not.toMatch(/--ssh-passphrase </);
  });
});

describe('interactive secret input through the real terminal prompt', () => {
  it.each(['enter', 'cancel'] as const)('%s completes without EOF and never echoes the secret', async (action) => {
    const stdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    const stderr = Object.getOwnPropertyDescriptor(process, 'stderr')!;
    const rawModes: boolean[] = [];
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: (mode: boolean) => rawModes.push(mode),
    });
    let display = '';
    const output = Object.assign(new Writable({
      write(chunk, _encoding, done) {
        display += chunk.toString();
        done();
      },
    }), { columns: 120, rows: 24 });
    Object.defineProperty(process, 'stdin', { value: input, configurable: true });
    Object.defineProperty(process, 'stderr', { value: output, configurable: true });
    try {
      const pending = readSecretFromStdin('key passphrase');
      const outcome = action === 'cancel'
        ? expect(pending).rejects.toThrow('SSH secret input cancelled')
        : expect(pending).resolves.toBe('two secret words ');
      input.write('two secret words ');
      input.write(action === 'cancel' ? '\x03' : '\r');
      await outcome;
      expect(input.readableEnded).toBe(false);
      expect(display).not.toContain('two secret words');
      expect(rawModes[0]).toBe(true);
      expect(rawModes.at(-1)).toBe(false);
    } finally {
      input.destroy();
      output.destroy();
      Object.defineProperty(process, 'stdin', stdin);
      Object.defineProperty(process, 'stderr', stderr);
    }
  }, 3000);
});
