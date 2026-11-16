import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { OMNITRON_HOME } from '../../src/config/defaults.js';
import { releasesRoot } from '../../src/release/load.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-storage-'));
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

describe('host-owned release storage', () => {
  it('preserves the instance store when no override is selected', () => {
    vi.stubEnv('OMNITRON_RELEASES_DIR', undefined);
    expect(releasesRoot()).toBe(path.join(OMNITRON_HOME, 'releases'));
  });

  it('resolves the selected existing directory', () => {
    vi.stubEnv('OMNITRON_RELEASES_DIR', directory);
    expect(releasesRoot()).toBe(fs.realpathSync(directory));
  });

  it.each(['', 'relative/path'])('rejects invalid storage %j', value => {
    vi.stubEnv('OMNITRON_RELEASES_DIR', value);
    expect(() => releasesRoot()).toThrow(/absolute directory/);
  });

  it('refuses an unavailable disk without creating a directory or falling back', () => {
    const missing = path.join(directory, 'unmounted', 'releases');
    vi.stubEnv('OMNITRON_RELEASES_DIR', missing);
    expect(() => releasesRoot()).toThrow();
    expect(fs.existsSync(path.dirname(missing))).toBe(false);
  });

  it('refuses a file as the store', () => {
    const file = path.join(directory, 'file');
    fs.writeFileSync(file, 'not a directory');
    vi.stubEnv('OMNITRON_RELEASES_DIR', file);
    expect(() => releasesRoot()).toThrow(/existing directory/);
  });
});
