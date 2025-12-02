import type { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  globalSetup: '<rootDir>/globalSetup.ts',
  globalTeardown: '<rootDir>/globalTeardown.ts',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  forceExit: true,
  verbose: true,
  clearMocks: true,

  // Limit workers to prevent resource exhaustion and port conflicts
  // Each worker gets dedicated port ranges via JEST_WORKER_ID
  // Use 1 worker for database tests to avoid concurrency issues
  maxWorkers: process.env.TEST_DATABASE ? 1 : 3,

  // Increase timeout for Docker-based tests
  testTimeout: 30000, // 30 seconds (default is 5s)

  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  // Coverage thresholds temporarily disabled for multi-runtime compatibility
  // coverageThreshold: {
  //   global: {
  //     branches: 48,
  //     functions: 52,
  //     lines: 57,
  //     statements: 57
  //   }
  // },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/**/*.spec.ts', '<rootDir>/src/**/*.spec.ts', '<rootDir>/e2e/**/*.e2e.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/test/runtime/'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          module: 'esnext',
          moduleResolution: 'node',
          isolatedModules: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
        useESM: true,
      },
    ],
    '^.+\\.(js|jsx|mjs)$': ['babel-jest'],
  },
  transformIgnorePatterns: ['node_modules/(?!(@omnitron-dev|@kysera|long|uuid)/)'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^(\\.{1,2}/.*)\\.ts$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@netron$': '<rootDir>/src/netron/index.ts',
    '^@netron/(.*)$': '<rootDir>/src/netron/$1',
    '^@nexus$': '<rootDir>/src/nexus/index.ts',
    '^@nexus/(.*)$': '<rootDir>/src/nexus/$1',
    '^@omnitron-dev/testing$': '<rootDir>/../testing/src/index.ts',
    '^@omnitron-dev/testing/(.*)$': '<rootDir>/../testing/src/$1',
    '^@omnitron-dev/eventemitter$': '<rootDir>/../eventemitter/src/index.ts',
    '^@omnitron-dev/common$': '<rootDir>/../common/src/index.ts',
    '^@omnitron-dev/msgpack$': '<rootDir>/../msgpack/src/index.ts',
    '^@omnitron-dev/msgpack/smart-buffer$': '<rootDir>/../msgpack/src/smart-buffer.ts',
    '^@kysera/core$': '<rootDir>/test/__mocks__/@kysera/core.ts',
    '^@kysera/(.*)$': '<rootDir>/test/__mocks__/@kysera/$1.ts',
    '^uuid$': '<rootDir>/test/__mocks__/uuid.ts',
  },
  resolver: 'ts-jest-resolver',
};

export default config;
