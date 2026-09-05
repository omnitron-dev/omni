import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * The console had no tests at all — 63 source files, including the RPC client
 * every page depends on and the guards that decide what a signed-out operator
 * sees. Its build was also broken outright for a while without anyone
 * noticing, which is the same absence from a different angle.
 *
 * No jsdom here: what is worth pinning first is logic, not rendering. The
 * `src/` alias mirrors tsconfig's `paths` so tests import the same way the
 * app does.
 */
export default defineConfig({
  resolve: {
    alias: { src: path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
