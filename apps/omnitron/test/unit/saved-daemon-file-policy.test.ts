import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readSavedDaemonConfig } from '../../src/commands/up.js';
import { configuredFileRoots } from '../../src/files/file-config.js';

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'daemon-file-policy-'));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('persisted daemon file policy', () => {
  it('uses defaults only when the configuration file is absent', () => {
    expect(readSavedDaemonConfig(path.join(directory, 'absent.json'))).toBeNull();
    expect(() => readSavedDaemonConfig(directory)).toThrow('refusing');
  });
  it.each(['{', 'null', '[]'])(
    'does not grant default filesystem access for malformed configuration %s',
    async (raw) => {
      const file = path.join(directory, 'config.json');
      await fs.writeFile(file, raw);
      expect(() => readSavedDaemonConfig(file)).toThrow('refusing');
    }
  );
  it('retains disabled and read-only policies through the saved configuration boundary', async () => {
    const file = path.join(directory, 'config.json');
    for (const files of [
      { enabled: false },
      { roots: [] },
      { roots: [{ id: 'logs', label: 'Logs', path: '/var/log', readOnly: true }] },
    ]) {
      await fs.writeFile(
        file,
        JSON.stringify({ role: 'master', initialized: true, initializedAt: '2026-10-30', files })
      );
      const saved = readSavedDaemonConfig(file)!;
      expect(saved.files).toEqual(files);
      expect(configuredFileRoots(saved.files)).toEqual('enabled' in files ? [] : files.roots);
    }
  });
});
