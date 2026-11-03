import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPackageGates, runPackageGates } from '../../src/release/package-gates.js';

describe('declared package release gates', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'package-gates-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (gates: unknown) => fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: { build: 'tsc', 'test:unit': 'vitest run' }, omnitron: { release: { gates } },
  }));
  it('preserves script order and rejects conflicting authorities', () => {
    write(['test:unit', 'build']);
    expect(readPackageGates(root)).toEqual(['test:unit', 'build']);
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts/gates.mjs'), '');
    expect(() => readPackageGates(root)).toThrow(/Choose one/);
    write(undefined);
    expect(readPackageGates(root)).toBeUndefined();
  });
  it.each([[], ['missing'], ['build','build'], ['--if-present'], ['../build'], ['build; true'], ['__proto__']])('rejects invalid declarations', (...gates) => {
    write(gates); expect(() => readPackageGates(root)).toThrow();
  });
  it('keeps killed, timed-out and never-started work separate from success', async () => {
    const states = await runPackageGates(['build','unit','integration','bundle'], async (_name, index) => ({
      code: [0, 1, null, 0][index]!, timedOut: index === 3,
    }));
    expect(states.map(gate => gate.status)).toEqual(['passed','failed','killed','timed-out']);
    const cancel = new AbortController();
    const stopped = await runPackageGates(['first','second'], async () => {
      cancel.abort(); return { code: 0, timedOut: false };
    }, cancel.signal);
    expect(stopped.map(gate => gate.status)).toEqual(['killed','not-run']);
  });
});
