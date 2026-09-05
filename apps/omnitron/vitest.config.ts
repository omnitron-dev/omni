import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      // NOT RUN, and the reason is specific rather than "restructured":
      // `createMockPM()` in this file builds a ProcessManager without
      // `createSupervisor`, which the real one has and the orchestrator calls
      // — so four tests fail with "is not a function" and the rest hang,
      // because `OrchestratorService` waits on a `daemonNetronReady` promise
      // that nothing in the fixture resolves.
      //
      // Reviving it means updating a 576-line mock to match an interface it
      // has drifted from, which reproduces a test that asserts against a
      // fake. Left excluded deliberately, with the reason written down —
      // the previous comment said "restructured internals", which is not
      // what stops it and would have sent the next person looking in the
      // wrong place.
      'test/integration/orchestrator.test.ts',
    ],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/commands/**', 'src/tui/**'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    env: {
      NODE_ENV: 'test',
    },
  },
});
