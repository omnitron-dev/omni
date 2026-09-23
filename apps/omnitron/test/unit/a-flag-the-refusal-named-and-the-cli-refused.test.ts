/**
 * A flag the refusal named and the command line refused.
 *
 * `release prune --yes` refuses when the daemon cannot say which releases the
 * stacks run, and its message tells the operator the way past it:
 * `--allow-unprotected`. The command read `options.allowUnprotected`; the CLI
 * never registered the flag, so commander rejected it as an unknown option —
 * with the daemon stopped there was no way through the refusal at all, and
 * the advice printed beside it led into a second error.
 *
 * Every option `releasePruneCommand` reads must be one the CLI accepts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(here, '../../src', rel), 'utf8');

describe('release prune', () => {
  it('accepts every option the command reads, including the one its refusal names', () => {
    const command = read('commands/release.ts');
    const body = command.slice(command.indexOf('export async function releasePruneCommand'));
    const read_ = new Set([...body.slice(0, body.indexOf('\nexport ')).matchAll(/options\.(\w+)/g)].map((m) => m[1]!));
    expect(read_).toContain('allowUnprotected');

    const cli = read('cli/omnitron.ts');
    const start = cli.indexOf(".command('prune')");
    const block = cli.slice(start, cli.indexOf('.action(', start));
    const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    for (const name of read_) {
      // The flag itself, not a longer flag that starts with it: `'--x'` or `'--x <arg>'`.
      expect(block, `--${kebab(name)} is read by the command but not registered`).toMatch(new RegExp(`'--${kebab(name)}(?:'| )`));
    }
  });
});
