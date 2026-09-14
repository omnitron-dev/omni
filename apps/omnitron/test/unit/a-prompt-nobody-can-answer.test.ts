/**
 * `omnitron up` asked a question where nobody could answer it.
 *
 * On a machine with no `~/.omnitron/config.json`, `up` runs first-time setup
 * and prompts for the daemon's role. With a terminal that is right. Without
 * one it is the worst of the available failures: the command does not fail,
 * it WAITS — and whatever is driving it sits there until its own timeout and
 * then reports something unrelated.
 *
 * Measured 2026-09-14, activating a locally built omnitron on a remote node
 * over SSH. `omnitron up --no-infra` printed
 *
 *     Welcome to Omnitron! Running first-time setup.
 *     ◆  Select daemon role
 *       ● master (Primary control plane …)
 *       ○ slave
 *
 * and waited. The upgrade reported a daemon that would not start. The daemon
 * had never been asked to start: the process before it was holding a menu
 * open for a terminal that did not exist.
 *
 * `--master` and `--slave <addr>` already skip the prompt — provisioning
 * passes one — so the fix is not a new way to say it, it is refusing to ask
 * when the answer cannot arrive.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(root, 'src/commands/up.ts'), 'utf8');

describe('first-time setup without a terminal', () => {
  it('checks for one before prompting', () => {
    // Asserted on the source because the prompt lives inside a function that
    // writes `~/.omnitron/config.json` and starts a daemon; reaching it in a
    // test would mean doing both. What matters is that the guard is there and
    // precedes the prompt.
    const guardAt = source.indexOf('process.stdin.isTTY');
    const promptAt = source.indexOf('Select daemon role');

    expect(guardAt, 'no TTY check in up.ts').toBeGreaterThan(0);
    expect(guardAt, 'the prompt is reachable before the guard').toBeLessThan(promptAt);
  });

  it('exits rather than falling through to a default role', () => {
    // A default would be worse than the hang it replaces: a node silently
    // configured as a master is a node that never syncs, and nothing about it
    // looks wrong until someone asks why the fleet has no data from it.
    const between = source.slice(
      source.indexOf('process.stdin.isTTY'),
      source.indexOf('Select daemon role'),
    );

    expect(between).toContain('process.exit(1)');
  });

  it('names the flags that make it unnecessary', () => {
    const between = source.slice(
      source.indexOf('process.stdin.isTTY'),
      source.indexOf('Select daemon role'),
    );

    expect(between).toContain('--master');
    expect(between).toContain('--slave');
  });

  it('still prompts when there is a terminal', () => {
    // The guard must not remove the interactive path — an operator running
    // `omnitron up` by hand on a new machine is the case it was written for.
    expect(source).toContain("message: 'Select daemon role'");
  });
});

// =============================================================================
// The other half: a command that reported failure and exited zero
// =============================================================================

const pingSource = fs.readFileSync(path.join(root, 'src/commands/daemon-cmd.ts'), 'utf8');

describe('omnitron ping', () => {
  it('says in its exit code what it says in its output', () => {
    // The same measurement found this. Verification ran `omnitron ping`, got
    // exit 0 with output, and reported the node upgraded and serving — while
    // the text it had captured was "Daemon is not running. Start it with
    // `omnitron up`." Every word true, the verdict wrong, and the caller had
    // no way to tell: the exit code is the only part a script reads.
    const failurePath = pingSource.slice(
      pingSource.indexOf('export async function daemonPing'),
      pingSource.indexOf('export async function daemonKill'),
    );

    expect(failurePath).toContain('reportAbsence');
    expect(failurePath, 'ping reports failure in prose and success in its exit code')
      .toContain('process.exitCode = 1');
  });

  it('leaves the success path alone', () => {
    const failurePath = pingSource.slice(
      pingSource.indexOf('export async function daemonPing'),
      pingSource.indexOf('export async function daemonKill'),
    );
    const successAt = failurePath.indexOf('Daemon is running');
    const exitAt = failurePath.indexOf('process.exitCode = 1');

    // The exit code is set in the catch, after the success line — a `ping`
    // that worked must exit 0.
    expect(successAt).toBeGreaterThan(0);
    expect(exitAt).toBeGreaterThan(successAt);
  });
});
