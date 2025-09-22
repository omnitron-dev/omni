import type { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  forceExit: true,
  verbose: true,
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**'
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
  testMatch: [
    '<rootDir>/test/**/*.spec.ts',
    '<rootDir>/src/**/*.spec.ts'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/runtime/'
  ],
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
          emitDecoratorMetadata: true
        },
        useESM: true
      }
    ]
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@omnitron-dev)/)'
  ],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^(\\.{1,2}/.*)\\.ts$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@nexus$': '<rootDir>/src/nexus/index.ts',
    '^@nexus/(.*)$': '<rootDir>/src/nexus/$1',
    '^@omnitron-dev/testing$': '<rootDir>/../testing/src/index.ts',
    '^@omnitron-dev/testing/(.*)$': '<rootDir>/../testing/src/$1',
    '^@omnitron-dev/eventemitter$': '<rootDir>/../eventemitter/src/index.ts',
    '^@omnitron-dev/common$': '<rootDir>/../common/src/index.ts'
  },
  resolver: 'ts-jest-resolver'
};

export default config;