import { defineConfig } from 'vitest/config.js';

export default defineConfig({
  test: {
    snapshotSerializers: ['vitest-ansi-serializer'],
  },
});
