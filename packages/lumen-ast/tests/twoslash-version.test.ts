import { expect, it, vi } from 'vitest';
import { parseTwoslashAnnotations } from '../src/highlight/twoslash.js';

vi.mock('typescript', () => ({ default: { version: '0.0.0' } }));

it('refuses analysis before using a compiler that differs from its bundled libraries', () => {
  expect(() => parseTwoslashAnnotations('const value = 1;')).toThrow(/compiler 0\.0\.0 differs from bundled libraries/);
});
