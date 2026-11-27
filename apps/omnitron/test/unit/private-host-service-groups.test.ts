import { ExecutionEngine } from '@xec-sh/core';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, expect, it, vi } from 'vitest';
import { serviceGroups } from '../../src/infrastructure/private-host-config.js';

const service = 'bitcoin:x:994:994::/:/bin/false';
const reader = 'omnitron:x:995:995::/:/bin/false';
const group = 'bitcoin:x:994:';

function directoryFixture(groups = group, users = [service, reader].join('\n')) {
  const execute = ExecutionEngine.prototype.execute;
  return vi.spyOn(ExecutionEngine.prototype, 'execute').mockImplementation(function nssLookup(this: ExecutionEngine, command) {
    const answers: Record<string, string> = {
      '/usr/bin/getent passwd bitcoin': service,
      '/usr/bin/getent passwd omnitron': reader,
      '/usr/bin/getent passwd': users,
      '/usr/bin/getent group': groups,
      '/usr/bin/id -G -- bitcoin': '994',
      '/usr/bin/id -G -- omnitron': '995 1000',
    };
    const key = [command.command, ...(command.args ?? [])].join(' ');
    const data = command.command === '/usr/bin/setpriv' ? '' : answers[key];
    if (data === undefined) throw Error('Unexpected fixture lookup');
    return execute.call(this, { ...command, command: '/usr/bin/printf', args: ['%s\n', data] });
  });
}

afterEach(() => vi.restoreAllMocks());

it('checks traversal with the verified numeric identities and groups in isolated local processes', async () => {
  const calls = directoryFixture();
  const path = '/directory with spaces/[literal]';
  await expect(serviceGroups('bitcoin', { directory: path, dedicated: true })).resolves.toEqual({
    serviceUid: 994n, serviceGid: 994n, readerUid: 995n, readerGid: 995n,
  });
  for (const [command] of calls.mock.calls) {
    expect(command).toMatchObject({ adapter: 'local', shell: false, envMode: 'replace', env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' } });
  }
  expect(calls.mock.calls.filter(([cmd]) => cmd.command === '/usr/bin/setpriv').map(([cmd]) => cmd.args)).toEqual([
    ['--reuid=994', '--regid=994', '--groups=994', '--', '/usr/bin/test', '-x', path],
    ['--reuid=995', '--regid=995', '--groups=995,1000', '--', '/usr/bin/test', '-x', path],
  ]);
});

it.each<[string, string, string[]]>([
  ['an alias group with an additional reader', group + '\nalias:x:994:observer', [service, reader]],
  ['a second primary group member', group, [service, reader, 'observer:x:996:994::/:/bin/false']],
  ['a second user with the same UID', group, [service, reader, 'observer:x:994:996::/:/bin/false']],
  ['an incomplete group enumeration', 'observer:x:996:', [service, reader]],
])('rejects %s before traversal', async (_reason, groups, users) => {
  const calls = directoryFixture(groups, users.join('\n'));
  await expect(serviceGroups('bitcoin', { dedicated: true, directory: '/isolated' })).rejects.toThrow('identity and group');
  expect(calls.mock.calls.some(([command]) => command.command === '/usr/bin/setpriv')).toBe(false);
});

it.skipIf(process.env['OMNITRON_DISPOSABLE_HOST_CONFIG_TEST'] !== '1')(
  'checks actual NSS membership and target-account directory access in a read-only Linux container', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'omni-nss-'));
    const engine = new ExecutionEngine({ defaultShell: false, quiet: true, enableEvents: false, retry: { retries: 0 } });
    try {
      const output = join(scratch, 'probe.cjs');
      await build({
        entryPoints: [fileURLToPath(new URL('../runtime/private-host-service-groups.ts', import.meta.url))],
        outfile: output, bundle: true, platform: 'node', target: 'node22', format: 'cjs',
        external: ['node-pty', 'cpu-features', 'ssh2'], logLevel: 'silent',
      });
      const passwd = join(scratch, 'passwd');
      await writeFile(passwd, ['root:x:0:0::/root:/bin/sh', service, reader, 'observer:x:996:996::/:/bin/false', ''].join('\n'));
      await Promise.all([chmod(output, 0o444), chmod(passwd, 0o444)]);
      const scenarios = await Promise.allSettled(['separate', 'alias'].map(async scenario => {
        const groups = join(scratch, scenario);
        const records = ['root:x:0:', group, 'omnitron:x:995:', 'observer:x:996:'];
        if (scenario === 'alias') records.push('alias:x:994:observer');
        await writeFile(groups, records.join('\n') + '\n');
        await chmod(groups, 0o444);
        const result = await engine.execute({
          // This outer deadline includes provisioning by the Docker daemon. The
          // NSS and directory probes inside the container keep their own 3s budget.
          command: 'docker', adapter: 'local', shell: false, timeout: 480_000,
          args: ['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--cap-add=SETUID', '--cap-add=SETGID',
            '--tmpfs', '/closed:mode=0700',
            '--mount', 'type=bind,source=' + passwd + ',target=/etc/passwd,readonly',
            '--mount', 'type=bind,source=' + groups + ',target=/etc/group,readonly',
            '--mount', 'type=bind,source=' + output + ',target=/probe.cjs,readonly',
            '--entrypoint', 'node', 'node:22.14.0-bookworm-slim', '/probe.cjs', scenario],
        });
        expect(result.exitCode).toBe(0);
      }));
      for (const result of scenarios) if (result.status === 'rejected') throw result.reason;
    } finally {
      await engine.dispose();
      await rm(scratch, { recursive: true, force: true });
    }
  }, 510_000);
