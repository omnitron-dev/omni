import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readManagedOwnerServiceFile } from '../../src/daemon/managed-owner-build.js';

const unit = '/etc/systemd/system/omnitron-owner.service';
const serviceUid = 992;

function fixture(owner: number, mode = 0o644, parentUid = 0, parentMode = 0o755) {
  vi.spyOn(process, 'getuid').mockReturnValue(serviceUid);
  vi.spyOn(fs, 'realpath').mockResolvedValue(unit);
  vi.spyOn(fs, 'lstat').mockImplementation(async file => {
    const isUnit = file === unit;
    return {
      uid: isUnit ? owner : parentUid, mode: isUnit ? mode : parentMode,
      isFile: () => isUnit, isDirectory: () => !isUnit,
    } as Stats;
  });
}

afterEach(() => vi.restoreAllMocks());

describe('native execution owner service definition', () => {
  const installedUnit = '/usr/lib/systemd/system/systemd-journald.service';
  it.runIf(process.platform === 'linux' && process.getuid?.() !== 0 && existsSync(installedUnit))(
    'reads an actual systemd unit from an unprivileged Linux process', async () => {
      const file = await fs.realpath(installedUnit);
      expect((await readManagedOwnerServiceFile(file, 'system')).uid).toBe(0);
      await expect(readManagedOwnerServiceFile(file, 'user')).rejects.toThrow('another account');
    },
  );

  it('accepts the administrator-installed system unit for a dedicated execution account', async () => {
    fixture(0);
    await expect(readManagedOwnerServiceFile(unit, 'system')).resolves.toMatchObject({ uid: 0 });
  });

  it('requires the service account itself for a user unit', async () => {
    fixture(serviceUid);
    await expect(readManagedOwnerServiceFile(unit, 'user')).resolves.toMatchObject({ uid: serviceUid });
    await expect(readManagedOwnerServiceFile(unit, 'system')).rejects.toThrow('owned by root');
  });

  it('rejects a root-owned unit for a different user manager', async () => {
    fixture(0);
    await expect(readManagedOwnerServiceFile(unit, 'user')).rejects.toThrow('another account');
  });

  it.each([0o664, 0o646])('rejects writable service files even when root owns them', async mode => {
    fixture(0, mode);
    await expect(readManagedOwnerServiceFile(unit, 'system')).rejects.toThrow('writable service file');
  });

  it.each([[serviceUid, 0o755], [0, 0o775], [0, 0o777]])('checks the authority of the enclosing system directory', async (uid, mode) => {
    fixture(0, 0o644, uid, mode);
    await expect(readManagedOwnerServiceFile(unit, 'system')).rejects.toThrow('system service directory');
  });

  it('requires the canonical file reported by the native manager', async () => {
    fixture(0);
    vi.mocked(fs.realpath).mockResolvedValue('/other/owner.service');
    await expect(readManagedOwnerServiceFile(unit, 'system')).rejects.toThrow('noncanonical');
  });
});
