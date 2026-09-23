/**
 * `rollback` and `deploy app` refused — with exit 0, false statements, and
 * advice that led into another refusal.
 *
 * Measured 2026-09-23 against the development master:
 *
 *   - `omnitron rollback main` opened with «`omnitron rollback` does not roll
 *     back: it restarted the running version of 'main'.» The command does
 *     nothing — log calls only — and the line reads as a report that `main`
 *     had just been restarted.
 *   - It said the stack deployer «has itself never been executed in any
 *     known configuration». The audit trail held 28 `stack.start daos/test`
 *     rows with `source: operator`, 5 of them that day.
 *   - It said artifacts «are kept per version on the node». The node path is
 *     `/opt/omnitron/artifacts/<project>/<app>/<version>`, the version is the
 *     app's package.json version, and every app in all 23 release manifests
 *     on the master is 0.0.1: one directory per app, overwritten by each
 *     deployment.
 *   - Its advice, `omnitron stack start <project> <stack>`, is refused
 *     without `--release` by `daos/test`: «takes releases only».
 *   - `omnitron deploy app main` said «No project config declares
 *     `stacks.nodes`» — `daos/test` declares one — and sent the reader to
 *     `omnitron remote restart <alias> main`, a restart rather than a
 *     deployment, on a registry that answered «No remote servers registered».
 *   - Both exited 0. `-t, --target` was accepted by both; `rollback` read it
 *     into `_opts` and nothing else read it at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const logged: Array<{ level: string; text: string }> = [];

vi.mock('@xec-sh/kit', () => ({
  log: {
    error: (t: string) => logged.push({ level: 'error', text: t }),
    info: (t: string) => logged.push({ level: 'info', text: t }),
    success: (t: string) => logged.push({ level: 'success', text: t }),
    warn: (t: string) => logged.push({ level: 'warn', text: t }),
  },
  table: () => {},
}));

/** Neither command may reach for a daemon: they do nothing, and say so. */
const reached = vi.fn(() => {
  throw new Error('a command that does nothing must not open a connection');
});
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createRemoteDaemonClient: reached,
  createDaemonClient: reached,
}));

vi.mock('../../src/config/loader.js', () => ({
  loadEcosystemConfig: async () => ({ apps: [{ name: 'main', bootstrap: 'apps/main/src/bootstrap.ts' }] }),
}));

const { deployCommand, rollbackCommand, projectBuildCommand } = await import('../../src/commands/deploy.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = stripComments(fs.readFileSync(path.join(here, '../../src/cli/omnitron.ts'), 'utf8'));

const said = () => logged.map((l) => l.text).join('\n');
const firstError = () => logged.find((l) => l.level === 'error')?.text ?? '';

/** One command's definition in the CLI source: from `.command(` to its `.action(`. */
function definitionOf(command: string): string {
  const at = cli.indexOf(`.command('${command}')`);
  expect(at, `the CLI defines '${command}'`).toBeGreaterThanOrEqual(0);
  return cli.slice(at, cli.indexOf('.action(', at));
}

let exitCodeBefore: typeof process.exitCode;
beforeEach(() => {
  logged.length = 0;
  reached.mockClear();
  exitCodeBefore = process.exitCode;
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = exitCodeBefore;
});

describe('omnitron rollback', () => {
  it('exits 1 — a script must not take it for a rollback', async () => {
    await rollbackCommand('main');
    expect(process.exitCode).toBe(1);
  });

  it('says plainly that nothing was done, and not that anything was restarted', async () => {
    await rollbackCommand('main');

    expect(firstError()).toMatch(/not implemented/);
    expect(firstError()).toMatch(/nothing was done/);
    expect(said()).not.toMatch(/restarted/);
    expect(reached).not.toHaveBeenCalled();
  });

  it('makes neither false statement', async () => {
    await rollbackCommand('main');

    expect(said()).not.toMatch(/never been executed/);
    expect(said()).not.toMatch(/kept per version/);
  });

  it('names the way back that works: the previous release, by id', async () => {
    await rollbackCommand('main');

    expect(said()).toContain('omnitron release list');
    expect(said()).toContain('omnitron stack start <project> <stack> --release <previous-release-id>');
    // Not the bare form, which a stack that takes releases only refuses.
    expect(said()).not.toMatch(/omnitron stack start <project> <stack>\s*$/m);
  });
});

describe('omnitron deploy app', () => {
  it('exits 1 — a script must not take it for a deployment', async () => {
    await deployCommand('main');
    expect(process.exitCode).toBe(1);
  });

  it('says plainly that nothing was deployed', async () => {
    await deployCommand('main');

    expect(firstError()).toMatch(/not implemented/);
    expect(firstError()).toMatch(/nothing was deployed/);
    expect(reached).not.toHaveBeenCalled();
  });

  it('makes neither false statement', async () => {
    await deployCommand('main');

    expect(said()).not.toMatch(/No project config declares/);
    expect(said()).not.toMatch(/never been executed/);
  });

  it('does not send the reader to a restart on an empty registry', async () => {
    await deployCommand('main');
    expect(said()).not.toMatch(/omnitron remote restart/);
  });

  it('names deployment as it works today, releases included', async () => {
    await deployCommand('main');

    expect(said()).toContain('omnitron stack start <project> <stack>');
    expect(said()).toContain('omnitron release build <project> --for <stack>');
    expect(said()).toContain('omnitron stack start <project> <stack> --release <id>');
  });
});

describe('omnitron deploy build', () => {
  it('exits 1 for an app it cannot build', async () => {
    await projectBuildCommand('no-such-app');

    expect(firstError()).toContain('Unknown app: no-such-app');
    expect(process.exitCode).toBe(1);
  });
});

describe('the CLI definitions', () => {
  it('accepts no --target on either command: nothing reads it', () => {
    expect(definitionOf('rollback <app>')).not.toMatch(/--target/);
    expect(definitionOf('app <app>')).not.toMatch(/--target/);
  });

  it('every command the advice names exists, with the option it names', () => {
    // Advice that leads into a refusal is the defect this court is about, so
    // the commands the two messages print are checked against the CLI.
    expect(cli).toMatch(/release\s*\.command\('list'\)/);
    expect(cli).toMatch(/release\s*\.command\('show <id>'\)/);
    expect(definitionOf('build <project>')).toContain("'--for <stack>'");
    expect(definitionOf('start <project> <stack>')).toContain("'--release <id>'");
  });
});
