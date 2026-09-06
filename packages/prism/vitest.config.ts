import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'src/__tests__/',
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        'src/cli/**', // CLI tested separately
      ],
      /**
       * The floor, not the goal.
       *
       * These read 70 across the board and were never once enforced: `test`
       * is `vitest run` without `--coverage`, and no script passed it. The
       * first run that did produced 62.42 / 50.37 / 51.57 / 62.64 — all four
       * below the declared number, so the config was both unwired and untrue.
       *
       * Set to the measured values rounded down. A number nobody checks says
       * nothing about the code; a number set to what the code actually does
       * is a ratchet, and the next person to delete tests has to notice.
       * Raise these when coverage rises, and treat a required lowering as the
       * finding it is.
       */
      thresholds: {
        statements: 62,
        branches: 50,
        functions: 51,
        lines: 62,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
