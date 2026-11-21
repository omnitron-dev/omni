import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectBareMetal } from '../../src/infrastructure/bare-metal-plan.js';

const release = {
  name: 'indexer',
  version: '1.5',
  archives: { x86_64: { url: 'https://example.org/indexer.tgz', sha256: '1'.repeat(64), directory: 'bin' } },
  executables: ['indexer'],
};

describe('versioned bare-metal binaries', () => {
  it('uses the release for both installation and inventory on the selected network', () => {
    const requirement = { bareMetal: { variants: { mainnet: { binaryRelease: release } } } };
    const spec = selectBareMetal('indexer', requirement, { networkMode: 'mainnet', provisioning: 'bareMetal' });
    for (const [command, action] of [[spec?.validateCommand, 'check'], [spec?.installCommand, 'stage']]) {
      expect(command).toContain(`'${action}'`);
      expect(command).toContain(JSON.stringify(release));
    }
    expect(selectBareMetal('indexer', requirement, { networkMode: 'testnet' })?.installCommand).toBeUndefined();
  });

  it('refuses competing install methods', () => {
    expect(() => selectBareMetal('indexer', { bareMetal: { binaryRelease: release, installCommand: 'false' } }))
      .toThrow(/both binaryRelease and installCommand/);
  });

  it.skipIf(process.platform === 'win32')('validates installation, selective extraction and retry in the target helper', () => {
    const suite = fileURLToPath(new URL('../runtime/host_binary_release_test.py', import.meta.url));
    execFileSync('python3', ['-I', '-B', suite], { stdio: 'pipe', timeout: 10_000 });
  });
});
