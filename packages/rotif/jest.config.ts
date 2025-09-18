import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  forceExit: true,
  verbose: true,
  clearMocks: true,
  collectCoverage: false,
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testMatch: ['<rootDir>/test/**/*.spec.ts', '<rootDir>/test/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/runtime/',
  ],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          module: 'ESNext',
          target: 'ES2022',
          moduleResolution: 'node',
          isolatedModules: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
        useESM: true,
        isolatedModules: true,
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@noble|@omnitron-dev)/)',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@omnitron-dev/common$': '<rootDir>/../common/src/index.ts',
    '^@omnitron-dev/common/(.*)$': '<rootDir>/../common/src/$1',
    '^@omnitron-dev/eventemitter$': '<rootDir>/../eventemitter/src/index.ts',
    '^@omnitron-dev/eventemitter/(.*)$': '<rootDir>/../eventemitter/src/$1',
    '^@omnitron-dev/testing$': '<rootDir>/../testing/src/index.ts',
    '^@omnitron-dev/testing/(.*)$': '<rootDir>/../testing/src/$1',
  },
  resolver: 'ts-jest-resolver',
  globals: {},
};

export default config;