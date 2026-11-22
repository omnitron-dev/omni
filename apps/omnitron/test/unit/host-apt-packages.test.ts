import { readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  inspectAptPackages,
  installAptPackages,
  previewAptTransaction,
  withFreshAptPackages,
} from '../../src/infrastructure/apt-packages.js';
import { planBareMetal, selectBareMetal, type BareMetalObservation } from '../../src/infrastructure/bare-metal-plan.js';
import type { CommandResult } from '../../src/infrastructure/bare-metal-runner.js';

const repository = 'https://packages.example.org/releases';
const policy = { latest: ['proxy'], repository };
const observed: BareMetalObservation = {
  installed: true,
  userExists: true,
  dataDirExists: true,
  unitKnown: true,
  unitActive: true,
  unitEnabled: true,
  configContent: null,
};
const ok = (stdout = ''): CommandResult => ({ ok: true, stdout, stderr: '' });
const failed = (stderr = ''): CommandResult => ({ ok: false, stdout: '', stderr });

function fixture() {
  const state = {
    installed: '1',
    candidate: '2',
    held: false,
    configured: true,
    source: repository,
    suite: 'noble/main',
    extraVersions: '',
    simulation: 'Inst proxy [1] (2 stable [amd64])\nConf proxy (2 stable [amd64])',
    download: repository + '/pool/proxy.deb',
    apply: true,
    refresh: true,
    uid: '0',
    sourceFile: '/apt-test-fixture.list',
    sourceContent: 'deb [signed-by=/public/key.gpg] https://packages.example.org noble main\n',
  };
  const calls: string[][] = [];
  const host = {
    readFile: async (path: string) =>
      path === state.sourceFile ? state.sourceContent : 'NAME="Ubuntu"\nVERSION_CODENAME=noble\n',
    run: async (argv: readonly string[]) => {
      calls.push([...argv]);
      if (argv[0] === 'id') return ok(state.uid);
      if (argv.includes('apt-config'))
        return ok("MAIN='" + state.sourceFile + "'\nPARTS='/absent-apt-qualification-dir/'\n");
      if (argv.includes('policy'))
        return ok(
          'proxy:\n  Installed: ' +
            (state.installed || '(none)') +
            '\n  Candidate: ' +
            state.candidate +
            '\n  Version table:\n'
        );
      if (argv.includes('madison'))
        return ok(
          '     proxy | ' +
            state.candidate +
            ' | ' +
            state.source +
            ' ' +
            state.suite +
            ' amd64 Packages\n' +
            state.extraVersions
        );
      if (argv.includes('showhold')) return ok(state.held ? 'proxy\n' : '');
      if (argv.includes('dpkg-query')) return ok(state.configured ? 'installed' : 'half-configured');
      if (argv.includes('--compare-versions')) {
        const [a, op, b] = argv.slice(-3);
        return (op === 'lt' ? Number(a) < Number(b) : Number(a) <= Number(b)) ? ok() : failed();
      }
      if (argv.includes('--simulate')) return ok(state.simulation);
      if (argv.includes('--print-uris')) return ok("'" + state.download + "' proxy.deb 42 hash");
      if (argv.includes('install') && argv.includes('-y')) {
        if (state.apply) state.installed = state.candidate;
        return ok();
      }
      if (argv.includes('update'))
        return state.refresh ? ok() : failed('offline at https://user:credential@example.org/secret');
      throw Error('unexpected host command: ' + argv.join(' '));
    },
  };
  return { state, calls, host };
}

describe('declared host packages', () => {
  it('selects the network variant only for a host-provisioned service', () => {
    const req = { docker: {}, bareMetal: { variants: { production: { apt: policy } } } };
    expect(selectBareMetal('service', req, { provisioning: 'bareMetal', networkMode: 'production' })?.apt).toEqual(
      policy
    );
    expect(selectBareMetal('service', req, { provisioning: 'bareMetal', networkMode: 'dev' })?.apt).toBeUndefined();
    expect(selectBareMetal('service', req, { provisioning: 'docker', networkMode: 'production' })).toBeNull();
  });

  it('exposes drift even when the main executable is present and the unit is running, without writing', async () => {
    const { host, calls } = fixture();
    const packages = await inspectAptPackages(policy, host);
    expect(packages).toEqual([
      { name: 'proxy', installed: '1', candidate: '2', state: 'upgrade', detail: repository + ' noble/main' },
    ]);
    expect(
      planBareMetal({ name: 'service', apt: policy }, { ...observed, packages, aptTransaction: { dependencies: [] } })
    ).toMatchObject({
      actions: [{ type: 'install-packages', changes: [{ name: 'proxy', installed: '1', candidate: '2' }] }],
      refusals: [],
    });
    expect(calls.flat()).not.toContain('update');
    expect(calls.flat()).not.toContain('install');
  });

  it('refuses a distro fallback, nightly suite, hold, incomplete installation, pin or downgrade', async () => {
    for (const patch of [
      { source: 'https://distro.example.org' },
      { suite: 'nightly-noble/main' },
      { held: true },
      { configured: false },
      { extraVersions: 'proxy | 3 | ' + repository + ' noble/main amd64 Packages' },
      { installed: '3' },
    ]) {
      const { state, host } = fixture();
      Object.assign(state, patch);
      const packages = await inspectAptPackages(policy, host);
      expect(packages[0]?.state).toBe('blocked');
      const plan = planBareMetal({ name: 'service', apt: policy }, { ...observed, packages });
      expect(plan.actions).toHaveLength(0);
      expect(plan.refusals).toHaveLength(1);
    }
  });

  it('keeps a missing index distinct from an absent package and rejects unsafe declarations without running commands', async () => {
    const { state, host, calls } = fixture();
    state.installed = '';
    expect((await inspectAptPackages(policy, host))[0]?.state).toBe('install');
    state.candidate = '(none)';
    expect((await inspectAptPackages(policy, host))[0]?.state).toBe('blocked');
    const n = calls.length;
    for (const invalid of [
      { latest: ['--allow-unauthenticated'] },
      { latest: ['proxy', 'proxy'] },
      { latest: ['proxy'], repository: 'https://user:pass@example.org' },
    ]) {
      expect((await inspectAptPackages(invalid, host))[0]?.state).toBe('blocked');
    }
    expect(calls).toHaveLength(n);
  });

  it('installs the reviewed version, preserves holds and conffiles, confirms dpkg and is idempotent', async () => {
    const { state, host, calls } = fixture();
    const changes = [{ name: 'proxy', installed: '1', candidate: '2' }];
    await installAptPackages(changes, policy, host);
    expect(calls.find((cmd) => cmd.includes('-y'))).toEqual(
      expect.arrayContaining(['--no-remove', 'Dpkg::Options::=--force-confold', '--', 'proxy=2'])
    );
    expect(state.installed).toBe('2');
    await installAptPackages(changes, policy, host);
    expect(calls.filter((cmd) => cmd.includes('-y'))).toHaveLength(1);
  });

  it('aborts on solver expansion, a changed version or origin, and never reports an unconfirmed install', async () => {
    for (const patch of [
      { simulation: 'Inst extra (4 stable)' },
      { simulation: 'Remv proxy [1]' },
      { simulation: 'Inst proxy [1] (3 stable)' },
      { candidate: '3' },
      { download: 'https://another.example.org/pool/proxy' },
      { apply: false },
    ]) {
      const { state, host, calls } = fixture();
      Object.assign(state, patch);
      await expect(
        installAptPackages([{ name: 'proxy', installed: '1', candidate: '2' }], policy, host)
      ).rejects.toThrow();
      expect(calls.filter((cmd) => cmd.includes('-y'))).toHaveLength('apply' in patch ? 1 : 0);
    }
  });

  it('previews new transitive dependencies and refuses a changed solver result or an unrelated upgrade', async () => {
    const { state, host } = fixture();
    const changes = [{ name: 'proxy', installed: '1', candidate: '2' }];
    state.simulation += '\nInst libsupport (3 stable)\nConf libsupport (3 stable)';
    const preview = await previewAptTransaction(changes, host);
    expect(preview).toEqual({ dependencies: [{ name: 'libsupport', version: '3' }] });
    await expect(installAptPackages(changes, policy, host)).rejects.toThrow('dependency selection changed');
    await installAptPackages(changes, policy, host, preview.dependencies);
    state.simulation = 'Inst proxy [1] (2 stable)\nInst libsupport [1] (3 stable)';
    expect((await previewAptTransaction(changes, host)).error).toContain('Unplanned APT change');
  });

  it('does not present stale metadata as a successful refresh or disclose repository credentials', async () => {
    const { host, state } = fixture();
    state.refresh = false;
    await expect(withFreshAptPackages(host, (read) => read(policy))).rejects.toThrow(
      'Cannot refresh APT indices: offline at https://example.org'
    );
    state.source = 'https://user:credential@example.org/private';
    expect((await inspectAptPackages({ latest: ['proxy'] }, host))[0]?.detail).not.toContain('credential');
  });

  it('shares one private signed refresh and refuses an exact installation outside the administrator account', async () => {
    const { host, state, calls } = fixture();
    state.uid = '1234';
    state.installed = state.candidate;
    let file: string;
    await withFreshAptPackages(host, async (read) => {
      const current = await Promise.all([read(policy), read(policy)]);
      expect(current.map((rows) => rows[0]?.state)).toEqual(['current', 'current']);
      const updates = calls.filter((argv) => argv.includes('update'));
      expect(updates).toHaveLength(1);
      const options = updates[0]!.slice(updates[0]!.indexOf('-c'), -2);
      file = options[1]!;
      expect(options).toEqual([
        '-c',
        file,
        '-o',
        'Dir::State::lists=' + dirname(file) + '/lists',
        '-o',
        'Dir::Etc::sourcelist=' + dirname(file) + '/main.list',
        '-o',
        'Dir::Etc::sourceparts=' + dirname(file) + '/sources.list.d',
      ]);
      expect(await readFile(dirname(file) + '/main.list', 'utf8')).toBe(state.sourceContent);
      expect((await stat(dirname(file))).mode & 0o777).toBe(0o700);
      expect(await readFile(file, 'utf8')).toContain('Acquire::Check-Valid-Until "true";');
      expect(
        calls
          .filter((argv) => argv.includes('apt-cache') || argv.includes('apt-mark'))
          .every((argv) => JSON.stringify(argv.slice(3, 3 + options.length)) === JSON.stringify(options))
      ).toBe(true);
      state.installed = '';
      expect((await read(policy))[0]).toMatchObject({
        state: 'blocked',
        installed: null,
        candidate: '2',
        detail: expect.stringContaining('proxy=2'),
      });
      expect(calls.flat()).not.toContain('install');
    });
    await expect(stat(file!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects per-source exceptions before using either .list or deb822 metadata', async () => {
    for (const [ext, content] of [
      ['list', 'deb [trusted="yes"] https://packages.example.org stable main'],
      ['list', 'deb [check-valid-until=no] https://packages.example.org stable main'],
      ['sources', 'Types: deb\nURIs: https://packages.example.org\nTrusted: yes\n'],
      ['sources', 'Types: deb\nURIs: https://packages.example.org\nValid-Until-Min: 3600\n'],
    ]) {
      const { host, state, calls } = fixture();
      state.uid = '1234';
      state.sourceFile = '/apt-test-fixture.' + ext;
      state.sourceContent = content!;
      await expect(withFreshAptPackages(host, (read) => read(policy))).rejects.toThrow(
        'disables signature or validity checks'
      );
      expect(calls.flat()).not.toContain('update');
    }
  });

  it('does not consult older indices when the unprivileged refresh fails', async () => {
    const { host, state, calls } = fixture();
    state.uid = '1234';
    state.refresh = false;
    await expect(withFreshAptPackages(host, (read) => read(policy))).rejects.toThrow('Cannot refresh APT indices');
    expect(calls.flat()).not.toContain('policy');
    const update = calls.find((argv) => argv.includes('update'))!;
    await expect(stat(update[update.indexOf('-c') + 1]!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains the administrative system refresh and reviewed upgrade', async () => {
    const { host, calls } = fixture();
    const readings = await withFreshAptPackages(host, (read) => read(policy));
    expect(readings[0]?.state).toBe('upgrade');
    expect(calls.find((argv) => argv.includes('update'))).toEqual([
      'env',
      'LC_ALL=C',
      'apt-get',
      '--error-on=any',
      'update',
    ]);
    expect(calls.flat()).not.toContain('-c');
  });
});
