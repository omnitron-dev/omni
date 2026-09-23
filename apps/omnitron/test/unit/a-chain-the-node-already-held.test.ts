/**
 * A chain the node already held.
 *
 * The test node keeps mainnet Bitcoin — 149 GB, pruned — in a snap's home,
 * `/root/snap/bitcoin-core/common/.bitcoin`, run by a unit a person wrote,
 * `bitcoin.service`, enabled and stopped (`infra inspect`, 2026-09-23).
 * Declared as a system service, the planner saw a `dataDir` that did not
 * exist, would create it empty and start the daemon on it: the same chain
 * synced a second time, for days, beside the first. The stack now says which
 * chain to keep, and the plan takes it over — or says why it will not.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  planBareMetal,
  selectBareMetal,
  type AdoptionObservation,
  type BareMetalObservation,
  type BareMetalSpec,
} from '../../src/infrastructure/bare-metal-plan.js';
import {
  applyBareMetal,
  localHost,
  observeBareMetal,
  type CommandResult,
  type HostRunner,
} from '../../src/infrastructure/bare-metal-runner.js';

const SNAP = '/root/snap/bitcoin-core/common/.bitcoin';

const spec: BareMetalSpec = {
  name: 'bitcoin',
  systemdUnit: 'bitcoind',
  dataDir: '/var/lib/bitcoind',
  user: 'bitcoin',
  configFile: '/etc/bitcoin/bitcoin.conf',
  configContent: 'server=1\nprune=131072\n',
  unitContent:
    '[Service]\nExecStart=/usr/local/bin/bitcoind -conf=/etc/bitcoin/bitcoin.conf -datadir=/var/lib/bitcoind\n',
  adopt: { from: SNAP, replaces: 'bitcoin.service' },
};

/** The test node as measured: the snap's chain, its unit enabled and stopped, nothing of ours yet. */
function asMeasured(adoption: Partial<AdoptionObservation> = {}, host: Partial<BareMetalObservation> = {}) {
  const observed: BareMetalObservation = {
    installed: true,
    userExists: true,
    dataDirExists: false,
    unitKnown: false,
    unitActive: false,
    unitEnabled: false,
    configContent: null,
    unitContent: null,
    adoption: {
      sourceHeld: true,
      targetHeld: false,
      sameFilesystem: true,
      configBeside: true,
      replaced: { known: true, active: false, enabled: true },
      ...adoption,
    },
    ...host,
  };
  return observed;
}

const types = (observed: BareMetalObservation) => planBareMetal(spec, observed).actions.map((a) => a.type);

describe('a chain the stack says the node holds', () => {
  it('is taken over: the old unit disabled first, the chain renamed, the new unit started last', () => {
    const plan = planBareMetal(spec, asMeasured());

    expect(plan.refusals).toEqual([]);
    expect(plan.actions.map((a) => a.type)).toEqual([
      'disable-unit',
      'adopt-data-dir',
      'write-config',
      'write-unit',
      'daemon-reload',
      'enable-unit',
      'start-unit',
    ]);
    expect(plan.actions[0]).toMatchObject({ unit: 'bitcoin.service' });
    expect(plan.actions[1]).toEqual({
      type: 'adopt-data-dir',
      from: SNAP,
      to: '/var/lib/bitcoind',
      owner: 'bitcoin',
      setAside: { file: 'bitcoin.conf', as: 'bitcoin.conf.before-omnitron' },
    });
  });

  it('asks nothing more once taken over', () => {
    const after = asMeasured(
      { sourceHeld: false, replaced: { known: true, active: false, enabled: false } },
      {
        dataDirExists: true,
        unitKnown: true,
        unitActive: true,
        unitEnabled: true,
        configContent: `# managed-by: omnitron\n${spec.configContent}`,
        unitContent: `# managed-by: omnitron\n${spec.unitContent}`,
      }
    );

    expect(planBareMetal(spec, after)).toEqual({ actions: [], refusals: [] });
  });
});

describe('a takeover refused leaves the host as it is and starts nothing', () => {
  const untouched = ['disable-unit', 'adopt-data-dir', 'create-data-dir', 'enable-unit', 'start-unit'];

  it.each([
    [
      'while the old unit runs it',
      asMeasured({ replaced: { known: true, active: true, enabled: true } }),
      'stop it first',
    ],
    [
      'when the data directory holds something already',
      asMeasured({ targetHeld: true }, { dataDirExists: true }),
      'both hold data',
    ],
    ['across filesystems', asMeasured({ sameFilesystem: false }), 'copy the whole chain'],
    [
      'when `replaces` names no unit',
      asMeasured({ replaced: { known: false, active: false, enabled: false } }),
      'knows no unit',
    ],
    ['when there is no chain to take and no data directory', asMeasured({ sourceHeld: false }), 'from nothing'],
  ])('%s', (_, observed, why) => {
    const plan = planBareMetal(spec, observed);

    expect(plan.refusals).toHaveLength(1);
    expect(plan.refusals[0]).toContain(why);
    expect(types(observed).filter((type) => untouched.includes(type))).toEqual([]);
  });
});

describe('who may say it', () => {
  const requirement = {
    networkMode: 'mainnet',
    bareMetal: { systemdUnit: 'bitcoind', dataDir: '/var/lib/bitcoind', adopt: { from: SNAP } },
  };

  it('the stack, which knows the node', () => {
    expect(
      selectBareMetal('bitcoin', requirement, { bareMetal: { adopt: { from: SNAP, replaces: 'bitcoin.service' } } })
        ?.adopt
    ).toEqual({
      from: SNAP,
      replaces: 'bitcoin.service',
    });
  });

  it('not the application, which is the same on every node', () => {
    expect(selectBareMetal('bitcoin', requirement)?.adopt).toBeUndefined();
  });
});

/** A host that answers from a table and records every call. */
function recordingHost(answers: Record<string, string> = {}, renameFails?: string) {
  const calls: string[] = [];
  const ok = (stdout: string): CommandResult => ({ ok: true, stdout, stderr: '' });
  const host: HostRunner = {
    run: async (argv) => {
      calls.push(argv.join(' '));
      const answer = answers[argv.join(' ')];
      return answer === undefined ? { ok: false, stdout: '', stderr: 'no' } : ok(answer);
    },
    shell: async (command) => {
      calls.push(command);
      return ok('');
    },
    readFile: async () => null,
    writeFile: async (path) => void calls.push(`write ${path}`),
    exists: async (path) => path in answers,
    rename: async (from, to) => {
      calls.push(`rename ${from} ${to}`);
      if (renameFails) throw new Error(renameFails);
    },
  };
  return { host, calls };
}

const logger = { info: () => undefined, error: () => undefined } as never;

describe('carrying it out', () => {
  const planned = planBareMetal(spec, asMeasured()).actions.slice(0, 2);

  it('disables, renames, sets the old configuration aside, and gives the chain to the service account', async () => {
    const { host, calls } = recordingHost({
      'systemctl disable bitcoin.service': '',
      'chown -R bitcoin:bitcoin /var/lib/bitcoind': '',
      'chmod 750 /var/lib/bitcoind': '',
    });

    expect((await applyBareMetal(planned, host, logger, 'bitcoin')).failed).toBeNull();
    expect(calls).toEqual([
      'systemctl disable bitcoin.service',
      `rename ${SNAP} /var/lib/bitcoind`,
      'rename /var/lib/bitcoind/bitcoin.conf /var/lib/bitcoind/bitcoin.conf.before-omnitron',
      'chown -R bitcoin:bitcoin /var/lib/bitcoind',
      'chmod 750 /var/lib/bitcoind',
    ]);
  });

  it('stops at a rename the filesystem refuses, and copies nothing', async () => {
    const { host, calls } = recordingHost(
      { 'systemctl disable bitcoin.service': '' },
      'EXDEV: cross-device link not permitted'
    );

    const result = await applyBareMetal(planned, host, logger, 'bitcoin');

    expect(result.failed?.error).toContain('EXDEV');
    expect(calls.filter((call) => /^(mv|cp|rsync|chown) /.test(call))).toEqual([]);
  });
});

describe('what the node is asked', () => {
  it('both ends, their filesystems, a second configuration, and the unit that ran the chain', async () => {
    const { host, calls } = recordingHost({
      [`find ${SNAP} -mindepth 1 -maxdepth 1 -print -quit`]: `${SNAP}/blocks\n`,
      [`stat -c %d ${SNAP}`]: '2049\n',
      'stat -c %d /var/lib': '2049\n',
      [`${SNAP}/bitcoin.conf`]: '',
      'systemctl show bitcoin.service -p LoadState -p ActiveState -p UnitFileState':
        'LoadState=loaded\nActiveState=inactive\nUnitFileState=enabled\n',
    });

    expect((await observeBareMetal(spec, host)).adoption).toEqual({
      sourceHeld: true,
      targetHeld: false,
      sameFilesystem: true,
      configBeside: true,
      replaced: { known: true, active: false, enabled: true },
    });
    expect(calls.filter((call) => /^(rename|write|mv|chown|systemctl (disable|stop|start))/.test(call))).toEqual([]);
  });
});

describe('the rename it relies on', () => {
  it('puts a directory in place of an empty one, and refuses one that holds something', async () => {
    const root = await mkdtemp(join(tmpdir(), 'a-chain-the-node-already-held-'));
    try {
      const chain = join(root, 'chain');
      await mkdir(join(chain, 'blocks'), { recursive: true });
      await writeFile(join(chain, 'blocks', 'blk00000.dat'), 'x');
      const empty = join(root, 'empty');
      await mkdir(empty);
      const held = join(root, 'held');
      await mkdir(held);
      await writeFile(join(held, 'peers.dat'), 'y');

      await localHost().rename(chain, empty);
      expect(await readdir(empty)).toEqual(['blocks']);

      await expect(localHost().rename(empty, held)).rejects.toThrow(/ENOTEMPTY|EEXIST/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
