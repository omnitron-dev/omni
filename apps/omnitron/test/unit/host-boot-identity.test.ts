import { describe, expect, it, vi, afterEach } from 'vitest';
const native = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), execFileSync: native }));
import { readHostBootIdentity, provesDifferentHostBoot, compareProcessLifetimes, isLegacyDarwinBootIdentity } from '@omnitron-dev/common/process-identity';
import { assertCleanOwnerBoot, OwnerReconciliationRequiredError } from '../../src/daemon/managed-runtime.js';
const boot = 'darwin:119bd1eb-252d-4be8-ad83-69e325fbd927';
const next = 'darwin:219bd1eb-252d-4be8-ad83-69e325fbd927';
const legacy = '{ sec = 1791430683, usec = 746863 } Thu Oct  8 06:38:03 2026';
afterEach(() => native.mockReset());
describe('stable native boot and legacy crash evidence', () => {
  it.skipIf(process.platform !== 'darwin')('reads only bootsessionuuid, normalizes it and refuses unknown native answers', () => {
    native.mockReturnValue('119BD1EB-252D-4BE8-AD83-69E325FBD927\n');
    expect(readHostBootIdentity()).toBe(boot); expect(readHostBootIdentity()).toBe(boot);
    for (const call of native.mock.calls) expect(call.slice(0, 2)).toEqual(['/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']]);
    native.mockReturnValue(legacy); expect(() => readHostBootIdentity()).toThrow('boot session');
    native.mockReturnValue(''); expect(() => readHostBootIdentity()).toThrow('boot session');
  });
  it('never infers a reboot from any legacy dirty receipt, including raw microsecond drift', () => {
    for (const previous of [legacy, legacy.replace('746863', '728557'), 'unknown']) {
      expect(() => assertCleanOwnerBoot({ pid: 123, clean: false, bootId: previous }, boot)).toThrow(OwnerReconciliationRequiredError);
      expect(provesDifferentHostBoot(previous, boot)).toBe(false);
    }
    expect(() => assertCleanOwnerBoot({ pid: 123, clean: false, bootId: legacy }, legacy.replace('746863', '728557'))).toThrow('current host boot');
  });
  it('admits a genuinely clean legacy receipt and a verified stable-UUID reboot', () => {
    expect(() => assertCleanOwnerBoot({ pid: 123, clean: true, bootId: legacy }, boot)).not.toThrow();
    expect(() => assertCleanOwnerBoot({ pid: 123, clean: false, bootId: boot }, next)).not.toThrow();
    expect(() => assertCleanOwnerBoot({ pid: 123, clean: false, bootId: boot }, boot)).toThrow(OwnerReconciliationRequiredError);
    expect(provesDifferentHostBoot(boot.toUpperCase().replace('DARWIN:', 'darwin:'), boot)).toBe(false);
  });
  it('treats legacy writer drift or mixed identity formats as incomparable, never dead/reused', () => {
    expect(compareProcessLifetimes(legacy + ':birth', boot + ':Mon Nov  2 01:00:00 2026')).toBe('unknown');
    expect(compareProcessLifetimes(legacy + ':birth', legacy.replace('746863', '728557') + ':birth')).toBe('unknown');
    expect(compareProcessLifetimes(boot + ':Mon Nov  2 01:00:00 2026', boot + ':Mon Nov  2 01:00:00 2026')).toBe('same');
    expect(compareProcessLifetimes(boot + ':Mon Nov  2 01:00:00 2026', boot + ':Mon Nov  2 01:00:01 2026')).toBe('unknown');
    expect(compareProcessLifetimes(boot + ':Mon Nov  2 01:00:00 2026', boot.toUpperCase().replace('DARWIN:', 'darwin:') + ':Mon Nov 2 01:00:00 2026')).toBe('same');
    for (const invalid of ['corrupt', 'darwin:bad:birth', boot + ':birth', boot + ':Mon Nov  2 99:00:00 2026', boot + ':Tue Nov  2 01:00:00 2026'])
      expect(compareProcessLifetimes(invalid, boot + ':Mon Nov  2 01:00:00 2026')).toBe('unknown');
    expect(isLegacyDarwinBootIdentity(legacy)).toBe(true);
    expect(isLegacyDarwinBootIdentity(legacy + ':another field')).toBe(false);
    expect(isLegacyDarwinBootIdentity(legacy.replace('746863', '1000000'))).toBe(false);
    expect(compareProcessLifetimes('11111111-1111-4111-8111-111111111111:18446744073709551616', '11111111-1111-4111-8111-111111111111:1')).toBe('unknown');
  });
  it('compares explicitly UTC process births while retaining ambiguous legacy timezone records', () => {
    const birth = ':utc:Mon Nov  2 01:00:00 2026';
    expect(compareProcessLifetimes(boot + birth, boot + birth)).toBe('same');
    expect(compareProcessLifetimes(boot + birth, boot + ':utc:Mon Nov  2 01:00:01 2026')).toBe('different');
    expect(compareProcessLifetimes(boot + birth, boot + ':Mon Nov  2 01:00:00 2026')).toBe('unknown');
    expect(compareProcessLifetimes(boot + ':Mon Nov  2 01:00:00 2026', boot + birth)).toBe('unknown');
    expect(compareProcessLifetimes(boot + ':Mon Nov  2 01:00:00 2026', next + birth)).toBe('different');
    expect(compareProcessLifetimes(boot + birth, next + ':Mon Nov  2 01:00:00 2026')).toBe('different');
    for (const invalid of [':utc:birth', ':utc:Tue Nov  2 01:00:00 2026', ':utc:Mon Nov  2 99:00:00 2026']) {
      expect(compareProcessLifetimes(boot + invalid, boot + birth)).toBe('unknown');
    }
  });
  it('preserves the former rollout Linux boot/ticks delimiter without accepting unknown identities', () => {
    const id = '119bd1eb-252d-4be8-ad83-69e325fbd927';
    expect(compareProcessLifetimes(id + '/00123', id + ':123')).toBe('same');
    expect(compareProcessLifetimes(id + ':123', id + '/124')).toBe('different');
    expect(compareProcessLifetimes(id + '/oops', id + ':123')).toBe('unknown');
    expect(compareProcessLifetimes('Mon Nov 2 01:00:00 2026', boot + ':utc:Mon Nov 2 01:00:00 2026')).toBe('unknown');
  });
});
