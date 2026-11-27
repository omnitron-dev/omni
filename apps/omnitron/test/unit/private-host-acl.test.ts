import { ExecutionEngine } from '@xec-sh/core';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { requireModeOnly } from '../../src/infrastructure/private-host-config.js';

afterEach(() => vi.restoreAllMocks());

it.each([
  { stdout: '', stderr: '', exitCode: 0, clean: true },
  { stdout: 'system.posix_acl_access\n', stderr: '', exitCode: 0, clean: false },
  { stdout: 'system.posix_acl_default\n', stderr: '', exitCode: 0, clean: false },
  { stdout: '', stderr: 'incomplete', exitCode: 0, clean: false },
  { stdout: '', stderr: '', exitCode: 1, clean: false },
])('requires a complete successful read of attribute names ($exitCode/$clean)', async ({ stdout, stderr, exitCode, clean }) => {
  const execute = vi.spyOn(ExecutionEngine.prototype, 'execute').mockResolvedValue(
    { stdout, stderr, exitCode } as Awaited<ReturnType<ExecutionEngine['execute']>>);
  const paths = ['/private/example path', '/private/another'];
  const check = requireModeOnly(paths);
  if (clean) await expect(check).resolves.toBeUndefined();
  else await expect(check).rejects.toThrow('ACL');
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({
    command: '/usr/bin/getfattr', adapter: 'local', shell: false, envMode: 'replace',
    args: ['--no-dereference', '--absolute-names', '--match=^system[.]posix_acl_(access|default)$', '--', ...paths],
  }));
});

it('rejects an unavailable inspector and empty path lists', async () => {
  const run = vi.spyOn(ExecutionEngine.prototype, 'execute').mockRejectedValue(Error('unavailable'));
  await expect(requireModeOnly([])).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
  await expect(requireModeOnly(['/private/example'])).rejects.toThrow('getfattr');
});

it.skipIf(process.env['OMNITRON_LINUX_ACL_TEST'] !== '1')('detects real access and inherited default ACLs on Linux', async () => {
  expect(process.platform).toBe('linux');
  const root = await mkdtemp(join(tmpdir(), 'host-acl-'));
  const dir = join(root, 'new config parent');
  const file = join(root, 'public fixture');
  const engine = new ExecutionEngine();
  try {
    await mkdir(dir);
    await writeFile(file, 'fixture', { mode: 0o600 });
    await requireModeOnly([dir, file]);
    for (const [path, acl] of [[dir, 'default:user:65534:r-x'], [file, 'user:65534:r--']] as const) {
      await engine.execute({ command: '/usr/bin/setfacl', args: ['-m', acl, '--', path], adapter: 'local', shell: false });
      await expect(requireModeOnly([path])).rejects.toThrow('ACL');
    }
    await expect(requireModeOnly([join(root, 'absent')])).rejects.toThrow('getfattr');
  } finally {
    try { await engine.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
  }
});
