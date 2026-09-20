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
 *     16f3dd5a  daos-test  37.27.130.185:22  ○ down  ○ offline
 *
 * beside a second row for the same machine that did have one and was green.
 *
 * From stdin rather than a flag: an argument is visible to every process on
 * the machine for as long as the command runs, and this one is a root
 * password.
 */

import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSecretFromStdin } from '../../src/commands/node.js';
import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = stripComments(fs.readFileSync(path.join(here, '../../src/cli/omnitron.ts'), 'utf8'));
const command = stripComments(fs.readFileSync(path.join(here, '../../src/commands/node.ts'), 'utf8'));

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

  it('stores it in the field the auth method reads', () => {
    // A password stored as a passphrase is a secret nothing reads, and the
    // node stays unreachable with a vault that looks populated.
    expect(command).toContain("options.sshAuthMethod === 'password' ? 'sshPassword' : 'sshPassphrase'");
    expect(command).toContain("options.sshAuthMethod === 'key' ? 'sshPassphrase' : 'sshPassword'");
  });
});
