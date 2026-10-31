import { defineConfig } from 'vitest/config';
import path from 'node:path';
import base from '../vitest.config.ts';

/** The Console command and the package suite exercise the same UI tests and aliases. */
export default defineConfig({
  ...base,
  root: path.resolve(import.meta.dirname, '..'),
  test: {
    ...base.test,
    include: [
      'test/webapp/**/*.test.ts',
      'test/webapp/**/*.test.tsx',
      'webapp/src/**/*.test.ts',
      'webapp/src/**/*.test.tsx',
    ],
  },
});
