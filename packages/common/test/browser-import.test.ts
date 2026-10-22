import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isWindows, linux, freebsd, openbsd, darwin, sunos, aix, isNodejs } from '../src/predicates.js';

const flags = ['isWindows', 'linux', 'freebsd', 'openbsd', 'darwin', 'sunos', 'aix'] as const;
type Probe = {
  flags: Record<(typeof flags)[number], boolean>;
  isNodejs: boolean;
  sourceGlobals: string[];
  limitedResult: string;
  decimalSum: string;
  buffer: boolean;
};
describe('browser-safe public entry', () => {
  it('imports the complete module graph without Node globals, including pLimit used by EventEmitter/Netron', () => {
    // Fresh VM contexts, not deleting globals from Vitest's Node environment.
    // SourceTextModule gives real ESM linking/re-exports and evaluation; the Node
    // parser removes TypeScript annotations without rewriting feature checks.
    const raw = execFileSync(
      process.execPath,
      [
        '--experimental-vm-modules',
        fileURLToPath(new URL('./fixtures/browser-import.mjs', import.meta.url)),
        fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      ],
      { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } }
    );
    const probes: Record<string, Probe> = JSON.parse(raw);
    for (const name of ['absent', 'undefined', 'null', 'browser-shim', 'invalid-platform']) {
      expect(probes[name]?.flags).toEqual(Object.fromEntries(flags.map((flag) => [flag, false])));
      expect(probes[name]?.isNodejs).toBe(false);
      expect(probes[name]?.limitedResult).toBe('completed');
      expect(probes[name]?.decimalSum).toBe('0.300000000000');
      expect(probes[name]?.buffer).toBe(false);
    }
    expect(probes['absent']?.sourceGlobals).toEqual(['undefined', 'undefined', 'undefined']);
    for (const [i, platform] of ['win32', 'linux', 'freebsd', 'openbsd', 'darwin', 'sunos', 'aix'].entries()) {
      expect(probes[platform]?.flags).toEqual(Object.fromEntries(flags.map((flag, index) => [flag, i === index])));
    }
  });
  it('preserves platform detection in the actual Node runtime', () => {
    expect({ isWindows, linux, freebsd, openbsd, darwin, sunos, aix }).toEqual({
      isWindows: process.platform === 'win32',
      linux: process.platform === 'linux',
      freebsd: process.platform === 'freebsd',
      openbsd: process.platform === 'openbsd',
      darwin: process.platform === 'darwin',
      sunos: process.platform === 'sunos',
      aix: process.platform === 'aix',
    });
    expect(isNodejs).toBe(true);
  });
});
