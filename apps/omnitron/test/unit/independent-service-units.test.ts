import { expect, it } from 'vitest';
import { environmentLine, renderLaunchdPlist, renderSystemdUnit, unitValue, type UnitInputs } from '../../src/commands/service-units.js';
import { assertCleanOwnerBoot } from '../../src/daemon/managed-runtime.js';

const inputs: UnitInputs = { scope: 'user', execPath: '/opt/omni/node', entryPath: '/opt/omni/managed-entry.js',
  workdir: '/opt/omni', path: '/usr/bin:/bin', stderrLog: '/opt/omni/supervisor.log' };

it('separates owner and backend restart behavior while retaining OS group cleanup', () => {
  const owner = { ...inputs, label: 'dev.omnitron.owner', args: ['owner'], restart: false };
  const backend = { ...inputs, label: 'dev.omnitron.daemon', args: ['backend'] };
  expect(renderSystemdUnit(owner)).toContain('Restart=no');
  expect(renderSystemdUnit(backend)).toContain('Restart=on-failure');
  expect(renderSystemdUnit(backend)).toContain('KillMode=control-group');
  expect(renderLaunchdPlist(owner)).toContain('<key>KeepAlive</key>\n  <false/>');
  expect(renderLaunchdPlist(backend)).toContain('<key>AbandonProcessGroup</key>\n  <false/>');
  expect(renderLaunchdPlist(owner)).toContain('<string>dev.omnitron.owner</string>');
  expect(renderLaunchdPlist(backend)).toContain('<string>backend</string>');
  expect(renderSystemdUnit({ ...backend, nodeArgs: [] })).not.toContain('--import');
});

it('preserves quotes, literal dollar signs, backslashes and systemd specifiers', () => {
  expect(unitValue('/opt/a"b\\c/$NAME%h')).toBe('"/opt/a\\"b\\\\c/$$NAME%%h"');
  expect(environmentLine('PATH', '/opt/a"b\\c/$NAME%h')).toBe('Environment="PATH=/opt/a\\"b\\\\c/$NAME%%h"');
  expect(() => unitValue('x\nExecStart=bad')).toThrow();
  expect(() => environmentLine('X\nExecStart', 'bad')).toThrow();
  expect(() => renderSystemdUnit({ ...inputs, workdir: '/opt/omni\nExecStart=bad' })).toThrow();
});

it('refuses uncertain owner restart on the same boot and any malformed shutdown receipt', () => {
  expect(() => assertCleanOwnerBoot({ pid: 123, bootId: 'boot-a', clean: false }, 'boot-a')).toThrow('did not shut down cleanly');
  for (const invalid of [{}, { pid: 123, bootId: 'boot-a', clean: 'true' }, false, 'corrupt', { pid: 0, bootId: 'boot-a', clean: true }]) {
    expect(() => assertCleanOwnerBoot(invalid, 'boot-a')).toThrow('Invalid owner shutdown receipt');
  }
  expect(() => assertCleanOwnerBoot({ pid: 123, bootId: 'boot-a', clean: true }, 'boot-a')).not.toThrow();
  expect(() => assertCleanOwnerBoot({ pid: 123, bootId: 'boot-a', clean: false }, 'boot-b')).not.toThrow();
});
