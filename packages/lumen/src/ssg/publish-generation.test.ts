import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishGeneration } from './publish-generation.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it('replaces the complete generation and retains the prior build when validation fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-publish-'));
  roots.push(root);
  const output = join(root, 'out');
  publishGeneration(
    output,
    new Map([
      ['index.html', 'one'],
      ['retired.md', 'old public text'],
    ])
  );
  expect(() =>
    publishGeneration(
      output,
      new Map([
        ['index.html', 'two'],
        ['../escape', 'unsafe'],
      ])
    )
  ).toThrow('Unsafe output');
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('one');
  expect(existsSync(join(root, 'escape'))).toBe(false);
  publishGeneration(output, new Map([['index.html', 'two']]));
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('two');
  expect(existsSync(join(output, 'retired.md'))).toBe(false);
  const inventory = JSON.parse(readFileSync(join(output, '.lumen-generation.json'), 'utf8'));
  expect(Object.keys(inventory.files)).toEqual(['index.html']);
  expect(inventory.files['index.html'].sha256).toMatch(/^[a-f0-9]{64}$/);
});
it('refuses to replace an existing directory without Lumen ownership evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-unowned-'));
  roots.push(root);
  expect(() => publishGeneration(root, new Map([['index.html', 'new']]))).toThrow('not a Lumen generation');
});
