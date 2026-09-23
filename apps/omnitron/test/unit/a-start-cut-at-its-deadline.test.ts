/**
 * A start cut at its deadline, with no reason given.
 *
 * The first deployment of Bitcoin to the test node ran `systemctl start
 * bitcoind` and waited. At this pass's 120 s the command was killed, and the
 * step reported «could not start bitcoind: » — the reason empty, because a
 * killed command's stderr is `''` and `stderr ?? message` keeps an empty
 * string (2026-09-23). bitcoind came up regardless and its chain advanced,
 * but the unit did not read as `active`, and every later pass planned to
 * start it again.
 */

import { describe, it, expect } from 'vitest';

import { planBareMetal, type BareMetalSpec } from '../../src/infrastructure/bare-metal-plan.js';
import {
  applyBareMetal,
  localHost,
  observeBareMetal,
  type CommandResult,
  type HostRunner,
} from '../../src/infrastructure/bare-metal-runner.js';

/** A host that answers from a table and records every command. */
function recordingHost(answers: Record<string, string> = {}) {
  const calls: string[] = [];
  const host: HostRunner = {
    run: async (argv): Promise<CommandResult> => {
      calls.push(argv.join(' '));
      const answer = answers[argv.join(' ')];
      return answer === undefined ? { ok: true, stdout: '', stderr: '' } : { ok: true, stdout: answer, stderr: '' };
    },
    shell: async () => ({ ok: true, stdout: '', stderr: '' }),
    readFile: async () => null,
    writeFile: async () => undefined,
    exists: async () => true,
    rename: async () => undefined,
  };
  return { host, calls };
}

const logger = { info: () => undefined, error: () => undefined } as never;
const spec: BareMetalSpec = { name: 'bitcoin', systemdUnit: 'bitcoind' };
const unitIn = (activeState: string) =>
  recordingHost({
    'systemctl show bitcoind -p LoadState -p ActiveState -p UnitFileState': `LoadState=loaded\nActiveState=${activeState}\nUnitFileState=enabled\n`,
  });

describe('a start', () => {
  it('is queued, not waited for — and so is a restart', async () => {
    const { host, calls } = recordingHost();

    await applyBareMetal(
      [
        { type: 'start-unit', unit: 'bitcoind' },
        { type: 'restart-unit', unit: 'bitcoind', because: 'its configuration changed' },
      ],
      host,
      logger,
      'bitcoin'
    );

    expect(calls).toEqual(['systemctl start --no-block bitcoind', 'systemctl restart --no-block bitcoind']);
  });

  it.each(['activating', 'reloading'])('is not planned again for a unit %s', async (state) => {
    const plan = planBareMetal(spec, await observeBareMetal(spec, unitIn(state).host));
    expect(plan.actions.map((a) => a.type)).not.toContain('start-unit');
  });

  it('is planned for a unit that failed or stopped', async () => {
    for (const state of ['failed', 'inactive']) {
      const plan = planBareMetal(spec, await observeBareMetal(spec, unitIn(state).host));
      expect(plan.actions.map((a) => a.type)).toContain('start-unit');
    }
  });
});

describe('a command that did not succeed', () => {
  it('says it ran out of time when it did', async () => {
    expect(await localHost().run(['sleep', '5'], { timeoutMs: 200 })).toEqual({
      ok: false,
      stdout: '',
      stderr: 'no answer in 200 ms, stopped',
    });
  });

  it('never says nothing', async () => {
    const result = await localHost().run(['false']);

    expect(result.ok).toBe(false);
    expect(result.stderr).toBe('Command failed: false');
  });
});
